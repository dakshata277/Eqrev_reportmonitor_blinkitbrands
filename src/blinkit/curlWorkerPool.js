// Pool of persistent curl_cffi Python workers (from seller_v2). Each runs
// curl_helper.py (chrome124) with a unique Webshare proxy to bypass Cloudflare.
const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");
const log = require("../logger");

const PYTHON_SCRIPT = path.join(__dirname, "curl_helper.py");
const REQUEST_TIMEOUT_MS = 90_000;

// ─── Single worker ────────────────────────────────────────────────────────────

class CurlWorker {
  constructor(id, proxyUrl) {
    this.id = id;
    this.proxyUrl = proxyUrl;
    this._queue = [];
    this._busy = false;
    this._currentCb = null;
    this._timer = null;
    this._proc = null;
    this._rl = null;
    this._spawn();
  }

  _spawn() {
    this._proc = spawn("python", ["-u", PYTHON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: __dirname,
    });

    this._rl = readline.createInterface({ input: this._proc.stdout });

    this._rl.on("line", (line) => {
      const cb = this._currentCb;
      if (!cb) return;
      this._currentCb = null;
      this._busy = false;
      clearTimeout(this._timer);

      try {
        cb.resolve(JSON.parse(line));
      } catch (e) {
        cb.reject(new Error(`[Worker#${this.id}] Bad JSON: ${line.substring(0, 120)}`));
      }
      this._next();
    });

    this._proc.stderr.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) log.warn(`[CurlWorker#${this.id}] ${msg}`);
    });

    this._proc.on("exit", (code) => {
      log.warn(`[CurlWorker#${this.id}] process exited (code=${code}), restarting...`);
      if (this._currentCb) {
        const cb = this._currentCb;
        this._currentCb = null;
        this._busy = false;
        clearTimeout(this._timer);
        cb.reject(new Error(`[Worker#${this.id}] process died`));
      }
      this._proc = null;
      setTimeout(() => this._spawn(), 1500);
    });
  }

  /** Enqueue a request; resolves with { status, body, headers } from Python. */
  request(config) {
    return new Promise((resolve, reject) => {
      this._queue.push({ config, resolve, reject });
      this._next();
    });
  }

  _next() {
    if (this._busy || this._queue.length === 0 || !this._proc) return;

    const task = this._queue.shift();
    this._busy = true;
    this._currentCb = task;

    // Inject proxy into config so curl_helper.py routes through it
    const toSend = { ...task.config };
    if (this.proxyUrl) toSend.proxy = this.proxyUrl;

    this._timer = setTimeout(() => {
      log.warn(`[CurlWorker#${this.id}] Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      const cb = this._currentCb;
      if (cb) {
        this._currentCb = null;
        this._busy = false;
        cb.reject(new Error(`[Worker#${this.id}] timeout`));
        this._next();
      }
    }, REQUEST_TIMEOUT_MS);

    try {
      this._proc.stdin.write(JSON.stringify(toSend) + "\n");
    } catch (err) {
      clearTimeout(this._timer);
      this._busy = false;
      this._currentCb = null;
      task.reject(err);
    }
  }

  /** Approximate load = queued + (1 if busy). Used for least-loaded scheduling. */
  get load() {
    return this._queue.length + (this._busy ? 1 : 0);
  }
}

// ─── Pool singleton ───────────────────────────────────────────────────────────

const MAX_POOL_SIZE = 15;
let _workers = null;

/**
 * Initialise the worker pool with the given proxy list.
 * Safe to call multiple times - ignored after first call.
 * @param {string[]} proxies - Array of "http://user:pass@host:port" strings.
 */
function initPool(proxies) {
  if (_workers) return _workers;

  const size = Math.min(MAX_POOL_SIZE, proxies.length);
  if (size === 0) {
    log.warn("[CurlWorkerPool] No proxies available - pool not initialised");
    return [];
  }

  _workers = proxies.slice(0, size).map((proxy, i) => new CurlWorker(i, proxy));
  log.info(`[CurlWorkerPool] Initialised ${_workers.length} workers (proxy pool size=${proxies.length})`);
  return _workers;
}

/**
 * Return the worker at position (index mod pool_size).
 */
function getWorkerByIndex(index) {
  if (!_workers || _workers.length === 0) return null;
  return _workers[index % _workers.length];
}

/**
 * Return the least-loaded worker (shortest queue + busy flag).
 */
function getLeastLoadedWorker() {
  if (!_workers || _workers.length === 0) return null;
  return _workers.reduce((best, w) => (w.load < best.load ? w : best), _workers[0]);
}

/**
 * Parse and normalise a raw Python worker result into the standard
 * { status, data, headers } envelope.
 */
function normaliseWorkerResult(raw) {
  if (raw.error) throw new Error(raw.error);

  let body = raw.body;
  if (typeof body === "string" && body.trim().startsWith("{")) {
    try {
      body = JSON.parse(body);
    } catch (_) {
      // leave as string
    }
  }
  return { status: raw.status, data: body, headers: raw.headers || {} };
}

module.exports = {
  initPool,
  getWorkerByIndex,
  getLeastLoadedWorker,
  normaliseWorkerResult,
};
