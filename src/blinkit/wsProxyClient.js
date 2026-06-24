// Webshare rotating proxy client, curl_cffi backed (from seller_v2).
// createHttpClientWithProxy().fetch(config) routes through a Python worker with
// a unique proxy + Chrome TLS fingerprint to pass Cloudflare; falls back to the
// serial queue when no proxies / all workers are CF-blocked.
const axios = require("axios");
const log = require("../logger");
const {
  initPool,
  getWorkerByIndex,
  normaliseWorkerResult,
} = require("./curlWorkerPool");

// ─── Proxy list cache ─────────────────────────────────────────────────────────

let cachedProxies = null;
let proxyFetchInProgress = null;

async function fetchProxyList() {
  if (cachedProxies !== null) return cachedProxies;
  if (proxyFetchInProgress) return proxyFetchInProgress;

  proxyFetchInProgress = (async () => {
    const apiKey = process.env.PROXIES_API_KEY || process.env.WEBSHARE_PROXY_API_KEY;
    if (!apiKey) {
      log.warn("[ProxyClient] PROXIES_API_KEY not set - falling back to serial queue");
      cachedProxies = [];
      proxyFetchInProgress = null;
      return cachedProxies;
    }

    try {
      const response = await axios.get("https://proxy.webshare.io/api/v2/proxy/list/", {
        headers: { Authorization: `Token ${apiKey}` },
        params: { mode: "direct", page: 1, page_size: 250 },
        timeout: 15000,
      });

      const results = response.data?.results || [];
      cachedProxies = results
        .filter((p) => p.valid === true)
        .map((p) => `http://${p.username}:${p.password}@${p.proxy_address}:${p.port}`);

      log.info(
        `[ProxyClient] Loaded ${cachedProxies.length} valid proxies (${results.length} total from Webshare)`
      );

      if (cachedProxies.length > 0) {
        initPool(cachedProxies);
      }
    } catch (error) {
      log.warn(`[ProxyClient] Proxy list fetch failed: ${error.message} - falling back to serial queue`);
      cachedProxies = [];
    }

    proxyFetchInProgress = null;
    return cachedProxies;
  })();

  return proxyFetchInProgress;
}

// ─── Round-robin counter ──────────────────────────────────────────────────────

let roundRobinCounter = 0;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create an HTTP client backed by a dedicated curl_cffi worker process.
 * .fetch(config) accepts { method, url, headers, data } and returns
 * { status, data, headers }.
 */
function createHttpClientWithProxy() {
  const workerIndex = roundRobinCounter++;

  return {
    async fetch(config) {
      const proxies = await fetchProxyList();

      // No proxies available - fall back to the serial singleton queue
      if (!proxies || proxies.length === 0) {
        const { fetchWithCycleTLS } = require("./fetchWrapper");
        return fetchWithCycleTLS(config);
      }

      // Try up to MAX_WORKER_ATTEMPTS different workers on Cloudflare 403 or timeout.
      const MAX_WORKER_ATTEMPTS = 5;
      let lastError;

      for (let attempt = 0; attempt < MAX_WORKER_ATTEMPTS; attempt++) {
        const worker = getWorkerByIndex(workerIndex + attempt);
        if (!worker) break;

        let result;
        try {
          const raw = await worker.request(config);
          result = normaliseWorkerResult(raw);
        } catch (err) {
          // Worker timed out, process died, or returned bad JSON — try next worker
          log.warn(
            `[ProxyClient] Worker#${(workerIndex + attempt) % proxies.length} error (${err.message.slice(0, 80)}) - rotating (attempt ${attempt + 1}/${MAX_WORKER_ATTEMPTS})`
          );
          lastError = err;
          continue;
        }

        const isCloudflareBan =
          result.status === 403 &&
          (typeof result.data !== "object" ||
            result.data === null ||
            Array.isArray(result.data)) &&
          (typeof result.data === "string"
            ? result.data.includes("challenge-error-text") ||
              result.data.includes("Just a moment") ||
              result.data.includes("cf-browser-verification") ||
              result.data.trimStart().startsWith("<!DOCTYPE") ||
              result.data.trimStart().startsWith("<html")
            : false);

        if (!isCloudflareBan) return result; // success or a real app-level error

        log.warn(
          `[ProxyClient] Worker#${(workerIndex + attempt) % proxies.length} Cloudflare-blocked - rotating (attempt ${attempt + 1}/${MAX_WORKER_ATTEMPTS})`
        );
        lastError = new Error("Cloudflare blocked");
      }

      // All proxy attempts exhausted - fall back to direct serial queue
      log.warn("[ProxyClient] All proxy workers CF-blocked - falling back to direct serial queue");
      const { fetchWithCycleTLS } = require("./fetchWrapper");
      return fetchWithCycleTLS(config);
    },
  };
}

/** Returns how many proxies are currently loaded. */
function getProxyCount() {
  return cachedProxies?.length ?? 0;
}

/** Pre-warm proxy list + worker pool at startup (optional - also lazy on first use). */
async function warmProxyCache() {
  return fetchProxyList();
}

module.exports = { createHttpClientWithProxy, getProxyCount, warmProxyCache, fetchProxyList };
