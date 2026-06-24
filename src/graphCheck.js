// Per-client graph check: does metrics-trends contain a data point for
// yesterday, and what is its budget_consumed?
const { getToken, extractToken } = require("./blinkit/getToken");
const { fetchMetricsTrends } = require("./blinkit/blinkitApi");
const { requestWithEnabledTypes } = require("./blinkit/enabledTypes");
const { parseDateIstDatePart } = require("./dateUtils");

// Find the yesterday data point in a metrics-trends data[] -> {hasData, budgetConsumed}.
function findYesterdayBudget(dataArray, yesterdayISO) {
  if (!Array.isArray(dataArray)) return { hasData: false, budgetConsumed: null };
  const entry = dataArray.find(
    (e) => parseDateIstDatePart(e?.date_ist) === yesterdayISO
  );
  if (!entry) return { hasData: false, budgetConsumed: null };
  const budget =
    entry.budget_consumed === undefined ? null : entry.budget_consumed;
  return { hasData: true, budgetConsumed: budget };
}

/**
 * Resolve a valid token for a client (throws a descriptive error on failure).
 */
async function resolveToken(client) {
  const resp = await getToken(client.email);
  const token = extractToken(resp);
  if (!token) {
    if (resp && resp.permanentFailure) {
      throw new Error(
        `token permanent failure (${resp.permanentFailure}) for ${client.email}`
      );
    }
    throw new Error(`could not obtain token for ${client.email}`);
  }
  return token;
}

/**
 * Live check for one client. Returns
 *   { hasData, budgetConsumed, token }
 * (token is returned so the caller can reuse it for the download trigger).
 * Throws on token / HTTP errors so the caller can log + isolate per client.
 */
async function checkClientGraph(client, { fromDate, toDate, yesterdayISO, campaignTypes }) {
  let token = await resolveToken(client);

  // Self-heals the per-advertiser "type not enabled" 400 and reports back the
  // type-set that worked, so the download trigger can reuse it.
  let { res, types } = await requestWithEnabledTypes(
    (t) => fetchMetricsTrends(token, fromDate, toDate, t),
    campaignTypes,
    `metrics ${client.name}`
  );

  // 401 = Blinkit server-side token expiry (shorter than Firebase TTL).
  // Force-refresh and retry once before giving up.
  if (res.status === 401) {
    const { getToken: _getToken } = require("./blinkit/getToken");
    const freshResp = await _getToken(client.email, true);
    token = extractToken(freshResp);
    if (!token) throw new Error(`metrics-trends HTTP 401: token re-fetch failed for ${client.email}`);
    ({ res, types } = await requestWithEnabledTypes(
      (t) => fetchMetricsTrends(token, fromDate, toDate, t),
      campaignTypes,
      `metrics ${client.name}`
    ));
  }

  // 204 = brand has no spend for this period (not an error)
  if (res.status === 204) {
    return { hasData: false, noContent: true, budgetConsumed: null, token, campaignTypes: types };
  }

  if (res.status !== 200) {
    const body =
      typeof res.data === "object" ? JSON.stringify(res.data) : String(res.data);
    throw new Error(`metrics-trends HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const dataArray = res.data?.data;
  const { hasData, budgetConsumed } = findYesterdayBudget(dataArray, yesterdayISO);
  return { hasData, budgetConsumed, token, campaignTypes: types };
}

module.exports = { findYesterdayBudget, checkClientGraph, resolveToken };
