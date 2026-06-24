// Token fetcher (from seller_v2). Reads the stored token, refreshes via Firebase
// when missing/expired. 50-min cache + in-flight dedup. Use extractToken() for
// the JWT string.
const axios = require("axios");

require("dotenv").config();
const log = require("../logger");

const TOKEN_BASE_URL =
  process.env.FAST_TOKEN_BASE_URL ||
  "https://eqrev-qcom-session-collector.vercel.app";

const TOKEN_CACHE_TTL = 50 * 60 * 1000; // 50 min local cache
const TOKEN_PREEMPTIVE_WINDOW = 5 * 60 * 1000; // proactive refresh window
const REFRESH_TIMEOUT = 30_000; // 30 s per HTTP call

let dnsFailureUntil = 0;
const DNS_COOLDOWN_MS = 2 * 60 * 1000;

// email → { token, expiresAt, promise, resolved }
const tokenRefreshCache = new Map();

/** Decode JWT exp claim and return whether the token has already expired. */
function isJwtExpired(jwt) {
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")
    );
    return typeof payload.exp === "number"
      ? payload.exp * 1000 - 60_000 < Date.now()
      : true;
  } catch {
    return true;
  }
}

/** Extract the raw JWT string from either endpoint's response shape. */
function extractJwt(data) {
  return (
    data?.token ||
    data?.platforms?.["blinkit-brands"]?.token ||
    null
  );
}

function cacheToken(email, responseData) {
  tokenRefreshCache.set(email, {
    token: responseData,
    expiresAt: Date.now() + TOKEN_CACHE_TTL,
    promise: null,
    resolved: true,
  });
}

async function getToken(email, forceRefresh = false) {
  if (Date.now() < dnsFailureUntil) {
    log.warn("[getToken] Skipping during DNS failure cooldown");
    return null;
  }

  if (forceRefresh) {
    log.info(`[TokenCache] Force-refresh requested for ${email}`);
    tokenRefreshCache.delete(email);
  } else if (tokenRefreshCache.has(email)) {
    const cached = tokenRefreshCache.get(email);

    if (cached.token && cached.expiresAt - Date.now() > TOKEN_PREEMPTIVE_WINDOW) {
      log.info(
        `[TokenCache] Returning cached token for ${email} (expires in ${Math.round(
          (cached.expiresAt - Date.now()) / 1000
        )}s)`
      );
      return cached.token;
    }

    if (cached.promise && !cached.resolved) {
      log.info(`[TokenCache] Refresh in progress for ${email} - waiting...`);
      try {
        return await cached.promise;
      } catch (err) {
        log.error(`[TokenCache] In-flight refresh failed: ${err.message}`);
        return null;
      }
    }
  }

  const fetchPromise = (async () => {
    try {
      const t0 = Date.now();

      // ── Step 1: read stored token (fast DB read, no Firebase) ────────────
      if (!forceRefresh) {
        try {
          const readUrl = `${TOKEN_BASE_URL}/token/${encodeURIComponent(email)}`;
          log.info(`[TokenFetch] Reading stored token for ${email}...`);
          const readResp = await axios.get(readUrl, { timeout: REFRESH_TIMEOUT });

          if (readResp.status === 200 && readResp.data) {
            const jwt = extractJwt(readResp.data);
            if (jwt && !isJwtExpired(jwt)) {
              const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
              log.info(`[TokenFetch] Stored token valid for ${email} (${elapsed}s) - skipping Firebase refresh`);
              cacheToken(email, readResp.data);
              return readResp.data;
            }
            log.info(`[TokenFetch] Stored token for ${email} is expired - calling /refresh`);
          }
        } catch (readErr) {
          log.warn(`[TokenFetch] Could not read stored token for ${email}: ${readErr.message} - falling back to /refresh`);
        }
      }

      // ── Step 2: force-refresh via Firebase ───────────────────────────────
      const refreshUrl = `${TOKEN_BASE_URL}/token/${encodeURIComponent(email)}/refresh`;
      log.info(`[TokenRefresh] Refreshing token for ${email} via Firebase endpoint...`);
      const refreshResp = await axios.get(refreshUrl, { timeout: REFRESH_TIMEOUT });
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

      if (!refreshResp || refreshResp.status !== 200) {
        log.error(`[TokenRefresh] Non-200 for ${email}: ${refreshResp?.status} (${elapsed}s)`);
        tokenRefreshCache.delete(email);
        return null;
      }

      log.info(`[TokenRefresh] Token refreshed for ${email} in ${elapsed}s`);
      cacheToken(email, refreshResp.data);
      return refreshResp.data;
    } catch (error) {
      const status = error?.response?.status;

      if (status === 404) {
        log.error(
          `[TokenRefresh] ${email} not found in session collector (HTTP 404) - needs onboarding, skipping retries`
        );
        tokenRefreshCache.delete(email);
        return { permanentFailure: "NOT_FOUND", email };
      }

      if ((error?.message || "").includes("ENOTFOUND")) {
        dnsFailureUntil = Date.now() + DNS_COOLDOWN_MS;
      }
      log.error(`[TokenRefresh] Failed for ${email}: ${error?.message || error}`);

      try {
        await new Promise((r) => setTimeout(r, 1000));
        log.info(`[TokenRefresh] Retry attempt for ${email}...`);
        const retryUrl = `${TOKEN_BASE_URL}/token/${encodeURIComponent(email)}/refresh`;
        const retryResp = await axios.get(retryUrl, { timeout: REFRESH_TIMEOUT });
        if (retryResp?.status === 200 && retryResp.data) {
          cacheToken(email, retryResp.data);
          log.info(`[TokenRefresh] Retry succeeded for ${email}`);
          return retryResp.data;
        }
      } catch (retryErr) {
        if (retryErr?.response?.status === 404) {
          log.error(
            `[TokenRefresh] ${email} not found in session collector on retry (HTTP 404) - needs onboarding`
          );
          tokenRefreshCache.delete(email);
          return { permanentFailure: "NOT_FOUND", email };
        }
        log.error(`[TokenRefresh] Retry also failed for ${email}: ${retryErr?.message}`);
      }

      tokenRefreshCache.delete(email);
      return null;
    }
  })();

  tokenRefreshCache.set(email, {
    promise: fetchPromise,
    token: null,
    expiresAt: 0,
    resolved: false,
  });

  return fetchPromise;
}

/**
 * Pull the JWT string out of a getToken() response (or return null on
 * failure / permanent failure marker).
 */
function extractToken(resp) {
  if (!resp || resp.permanentFailure) return null;
  return extractJwt(resp);
}

module.exports = { getToken, extractToken };
