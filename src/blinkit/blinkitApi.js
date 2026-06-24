// Wrappers over the two Blinkit Brands endpoints, via the proxy client.
const { createHttpClientWithProxy } = require("./wsProxyClient");
const { buildHeaders } = require("./headers");

const METRICS_TRENDS_URL =
  "https://brands.blinkit.com/adservice/v1/campaigns/metrics-trends";
const REPORT_DOWNLOAD_URL =
  "https://brands.blinkit.com/adservice/v2/advertisers/campaigns/reports/download";

// Budget-consumed graph data for a date range -> { status, data, headers }.
async function fetchMetricsTrends(token, fromDate, toDate, campaignTypes) {
  const client = createHttpClientWithProxy();
  return client.fetch({
    method: "POST",
    url: METRICS_TRENDS_URL,
    headers: buildHeaders(token),
    data: {
      metrics: ["budget_consumed"],
      from_date: fromDate,
      to_date: toDate,
      campaign_types: campaignTypes,
    },
  });
}

// Trigger preparation + email delivery of the campaigns report for a date range.
async function triggerReportDownload(token, fromDate, toDate, campaignTypes) {
  const client = createHttpClientWithProxy();
  return client.fetch({
    method: "POST",
    url: REPORT_DOWNLOAD_URL,
    headers: buildHeaders(token),
    data: {
      from_date: fromDate,
      to_date: toDate,
      campaign_types: campaignTypes,
    },
  });
}

module.exports = {
  fetchMetricsTrends,
  triggerReportDownload,
  METRICS_TRENDS_URL,
  REPORT_DOWNLOAD_URL,
};
