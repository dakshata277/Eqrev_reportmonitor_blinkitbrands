// Serial single-session curl_cffi fallback (from seller_v2). Used by
// wsProxyClient when no proxies / all proxy workers are Cloudflare-blocked.
const { spawn } = require("child_process");
const path = require("path");
const log = require("../logger");
const readline = require("readline");

// ──────────────────────────────────────────────────────────────
// Persistent Python helper process (single curl_cffi session)
// ──────────────────────────────────────────────────────────────
let pyProcess = null;
let pyRL = null; // readline interface on stdout
let pendingResolve = null; // only one outstanding request at a time

function _ensurePythonProcess() {
  if (pyProcess && !pyProcess.killed) return;

  const scriptPath = path.join(__dirname, "curl_helper.py");
  pyProcess = spawn("python", ["-u", scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: __dirname,
  });

  pyRL = readline.createInterface({ input: pyProcess.stdout });

  pyRL.on("line", (line) => {
    if (pendingResolve) {
      const cb = pendingResolve;
      pendingResolve = null;
      try {
        cb.resolve(JSON.parse(line));
      } catch (e) {
        cb.reject(new Error(`Bad JSON from Python helper: ${line}`));
      }
    }
  });

  pyProcess.stderr.on("data", (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) log.warn(`[PythonHelper stderr] ${msg}`);
  });

  pyProcess.on("exit", (code) => {
    log.warn(`[PythonHelper] process exited with code ${code}`);
    pyProcess = null;
    pyRL = null;
    if (pendingResolve) {
      const cb = pendingResolve;
      pendingResolve = null;
      cb.reject(new Error("Python helper process died unexpectedly"));
    }
  });
}

function _executePythonFetch(requestConfig) {
  return new Promise((resolve, reject) => {
    _ensurePythonProcess();

    pendingResolve = { resolve, reject };

    const timer = setTimeout(() => {
      if (pendingResolve) {
        const cb = pendingResolve;
        pendingResolve = null;
        cb.reject(new Error("Python helper request timed out (90s)"));
      }
    }, 90_000);

    const origResolve = resolve;
    const origReject = reject;
    pendingResolve = {
      resolve: (val) => {
        clearTimeout(timer);
        origResolve(val);
      },
      reject: (err) => {
        clearTimeout(timer);
        origReject(err);
      },
    };

    try {
      pyProcess.stdin.write(JSON.stringify(requestConfig) + "\n");
    } catch (err) {
      clearTimeout(timer);
      pendingResolve = null;
      reject(err);
    }
  });
}

// ──────────────────────────────────────────────────────────────
// Global serialisation queue (all methods)
// ──────────────────────────────────────────────────────────────
const requestQueue = [];
let requestInProgress = false;
let isFirstRequest = true;
const WARMUP_DELAY_MS = 5000;

function enqueueRequest(method, fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ method, fn, resolve, reject });
    _drainRequestQueue();
  });
}

async function _drainRequestQueue() {
  if (requestInProgress || requestQueue.length === 0) return;
  requestInProgress = true;

  if (isFirstRequest) {
    isFirstRequest = false;
    log.info(`[FetchWrapper] Warm-up delay: waiting ${WARMUP_DELAY_MS / 1000}s before first request...`);
    await new Promise((r) => setTimeout(r, WARMUP_DELAY_MS));
  }

  const { method, fn, resolve, reject } = requestQueue.shift();
  try {
    const result = await fn();
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    const spacingMs = ["POST", "PUT", "PATCH"].includes(method.toUpperCase()) ? 3000 : 500;
    setTimeout(() => {
      requestInProgress = false;
      _drainRequestQueue();
    }, spacingMs);
  }
}

// ──────────────────────────────────────────────────────────────
// Public API - drop-in replacement for axios(config)
// ──────────────────────────────────────────────────────────────
async function fetchWithCycleTLS(config) {
  const method = (config.method || "get").toUpperCase();
  const url = config.url;
  const maxRetries = 3;

  const requestConfig = {
    method: method.toLowerCase(),
    url: url,
    headers: config.headers || {},
    data: config.data,
  };

  const executeRequest = async () => {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = attempt * 5000;
        log.warn(`[FetchWrapper] 429 rate limited, retrying ${method} ${url} in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
      }

      log.info(`[FetchWrapper] Sending ${method} request to ${url} (via Python/curl_cffi)`);

      try {
        const result = await _executePythonFetch(requestConfig);

        if (result.error) {
          throw new Error(result.error);
        }

        let responseData = result.body;

        if (typeof responseData === "string" && responseData.trim().startsWith("{")) {
          try {
            responseData = JSON.parse(responseData);
          } catch (_) {}
        }

        if (result.status && (result.status < 200 || result.status >= 300)) {
          log.warn(`[FetchWrapper] HTTP ${result.status} for ${method} ${url} - body: ${typeof responseData === "object" ? JSON.stringify(responseData) : String(responseData).substring(0, 200)}`);
        }

        if (result.status === 429) {
          throw new Error("Cloudflare blocked the request. Status: 429");
        }

        if (result.status === 403 && typeof responseData === "string" && responseData.includes("challenge-error-text")) {
          throw new Error("Cloudflare blocked the request. Status: 403");
        }

        return {
          status: result.status,
          data: responseData,
          headers: result.headers || {},
        };
      } catch (err) {
        lastError = err;
        if (err.message && err.message.includes("429") && attempt < maxRetries - 1) {
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  return enqueueRequest(method, executeRequest);
}

module.exports = {
  fetchWithCycleTLS,
};
