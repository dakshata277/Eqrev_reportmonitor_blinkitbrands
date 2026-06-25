/**
 * Pure builders for every log line / notification text. Kept side-effect free
 * so they can be unit-tested and so wording lives in exactly one place.
 */

function formatBudget(budget) {
  if (budget === null || budget === undefined || Number.isNaN(Number(budget))) {
    return "n/a";
  }
  return Number(budget).toLocaleString("en-IN");
}

/** Combined line when NO client has yesterday-data this cycle. */
function combinedNoData(clientNames, yesterdayISO) {
  return `Data not updated for any of the ${clientNames.length} brands for ${yesterdayISO}`;
}

/** Per-client line when this client alone has no yesterday-data (mixed cycle). */
function perClientNoData(name, yesterdayISO) {
  return `data not updated | ${name} | for ${yesterdayISO}`;
}

/** Per-client line when metrics-trends returned 204 (zero spend, excluded from GChat). */
function perClientNoContent(name) {
  return `no content (zero spend) | ${name} | excluded from report wait`;
}

/** Per-client status line when the client HAS yesterday-data. */
function perClientStatus(name, budget, received) {
  const tail = received ? "report received" : "report NOT received";
  return `data updated in graph | ${name} | budget=${formatBudget(
    budget
  )} | report triggered | ${tail}`;
}

/**
 * Single combined GChat note — one message for ALL brands, each line shows
 * "client id : spend : budget consumed [@ timestamp when data arrived]".
 */
function gchatCombined(clientsInfo, todayISO, sentAt) {
  const lines = clientsInfo.map((c) => `${c.id} : spend : ${formatBudget(c.budget)}`);
  const header = sentAt ? `${todayISO} [${sentAt}]` : todayISO;
  return `Blinkit Brands Report Monitoring\n${header}\n${lines.join("\n")}`;
}

module.exports = {
  formatBudget,
  combinedNoData,
  perClientNoData,
  perClientNoContent,
  perClientStatus,
  gchatCombined,
};
