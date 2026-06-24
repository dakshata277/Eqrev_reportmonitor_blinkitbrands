// Report-arrival check. One Gmail fetch per poll tick returns recent report
// emails; every brand matches against that single set. A report counts for a
// brand only when subject matches, recipient is that brand, and the email's
// Requested Date matches a trigger time we fired.
const { google } = require("googleapis");
const { getCredentials } = require("./googleAuth");
const {
  getBody,
  extractEmailAddress,
  extractToFromBody,
  extractRequestedDate,
} = require("./emailUtils");
const { timestampToMinutes } = require("../dateUtils");
const config = require("../../config/config");

/** Build an authorised Gmail client impersonating the configured mailbox. */
function buildGmailClient() {
  const credentials = getCredentials();
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    subject: config.gmailImpersonate,
  });
  return google.gmail({ version: "v1", auth });
}

/** Run async fn over items with bounded concurrency. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx], idx);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

// Fetch + parse recent report emails (last 1 day) -> [{recipient, requestedMin}].
async function fetchRecentReports({ gmail, limit = 100, concurrency = 8 } = {}) {
  const client = gmail || buildGmailClient();
  const list = await client.users.messages.list({
    userId: "me",
    q: `subject:("${config.reportSubjectMatch}") newer_than:1d`,
    maxResults: limit,
  });
  const messages = list.data.messages || [];

  return mapLimit(messages, concurrency, async (m) => {
    const full = await client.users.messages.get({ userId: "me", id: m.id });
    const headers = full.data.payload.headers || [];
    const to = headers.find((h) => h.name === "To")?.value || "";
    const body = getBody(full.data.payload);
    const recipient = (
      extractToFromBody(body) ||
      extractEmailAddress(to) ||
      ""
    ).toLowerCase();
    const requestedMin = timestampToMinutes(extractRequestedDate(body));
    return { recipient, requestedMin };
  });
}

// Is there a report for this brand whose Requested Date matches one of our
// trigger timestamps (within toleranceMin)?
function reportPresent(
  reports,
  clientEmail,
  requestedAts,
  toleranceMin = config.emailMatchToleranceMin
) {
  const email = (clientEmail || "").toLowerCase();
  const ats = (requestedAts || [])
    .map(timestampToMinutes)
    .filter((v) => v !== null);

  return (reports || []).some((r) => {
    if (r.recipient !== email) return false; // brand ownership
    if (ats.length === 0) return true; // no trigger times -> recipient-only
    if (r.requestedMin === null) return false;
    return ats.some((a) => Math.abs(a - r.requestedMin) <= toleranceMin);
  });
}

module.exports = { buildGmailClient, fetchRecentReports, reportPresent };
