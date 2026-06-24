// Orchestrator + per-day state machine. Brands are processed concurrently; every
// cycle (re)triggers the report for each brand with data and refreshes its
// received status — trigger + status update happen whether or not it was received.
const log = require("./logger");
const config = require("../config/config");
const {
  dateRangeForYesterday,
  istTimestamp,
  istTimestampMinute,
} = require("./dateUtils");
const { checkClientGraph } = require("./graphCheck");
const { triggerReportDownload } = require("./blinkit/blinkitApi");
const {
  buildGmailClient,
  fetchRecentReports,
  reportPresent,
} = require("./gmail/gmailCheck");
const { sendCombinedSuccess } = require("./gchat");
const {
  combinedNoData,
  perClientNoData,
  perClientStatus,
} = require("./messages");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fresh per-day state. */
function createState() {
  return { dayKey: null, perClient: {}, successGchatSent: false };
}

function blankClientState() {
  return {
    dataFound: false,
    reportReceived: false,
    budget: null,
    triggeredTimes: [], // IST "YYYY-MM-DD HH:MM" of every trigger fired today
  };
}

// Reset on day rollover; always ensure every current client has a state entry
// (the list can change between cycles, e.g. a brand added to the DB).
function resetIfNewDay(state, clients, yesterdayISO) {
  if (state.dayKey !== yesterdayISO) {
    state.dayKey = yesterdayISO;
    state.perClient = {};
    state.successGchatSent = false;
  }
  for (const c of clients) {
    if (!state.perClient[c.key]) state.perClient[c.key] = blankClientState();
  }
  return state;
}

// One batched poll: each tick fetches recent report emails ONCE and matches all
// still-pending brands. Returns the set of client keys that became received.
async function pollForReports(pending, deps) {
  const { emailWaitMs, emailPollIntervalMs } = config;
  const deadline = Date.now() + emailWaitMs;
  const gmail = deps.buildGmailClient ? deps.buildGmailClient() : null;
  const received = new Set();

  /* eslint-disable no-constant-condition */
  while (true) {
    let reports = [];
    try {
      reports = await deps.fetchRecentReports({ gmail });
    } catch (err) {
      log.error(`[mailbox] fetch error: ${err.message}`);
    }
    for (const p of pending) {
      if (received.has(p.client.key)) continue;
      if (deps.reportPresent(reports, p.client.email, p.requestedAts)) {
        received.add(p.client.key);
      }
    }
    if (received.size >= pending.length) break;
    if (Date.now() + emailPollIntervalMs >= deadline) break;
    await sleep(emailPollIntervalMs);
  }
  return received;
}

async function runCycle(state, clients, deps = {}) {
  const d = {
    checkClientGraph: deps.checkClientGraph || checkClientGraph,
    triggerReportDownload: deps.triggerReportDownload || triggerReportDownload,
    fetchRecentReports: deps.fetchRecentReports || fetchRecentReports,
    reportPresent: deps.reportPresent || reportPresent,
    buildGmailClient: deps.buildGmailClient || buildGmailClient,
    sendCombinedSuccess: deps.sendCombinedSuccess || sendCombinedSuccess,
    logStatus: deps.logStatus || log.status,
    logRaw: deps.logRaw || log.raw,
    now: deps.now || (() => new Date()),
  };

  const { yesterdayISO, fromDate, toDate } = dateRangeForYesterday(d.now());
  resetIfNewDay(state, clients, yesterdayISO);

  d.logRaw(
    `\n================ ${istTimestamp(
      d.now()
    )} IST | checking ${yesterdayISO} | ${clients.length} brands ================`
  );

  // ── Step 1: concurrent graph checks ────────────────────────────────────────
  const results = await Promise.all(
    clients.map(async (client) => {
      try {
        const r = await d.checkClientGraph(client, {
          fromDate,
          toDate,
          yesterdayISO,
          campaignTypes: config.campaignTypes,
        });
        return { client, ...r, error: null };
      } catch (err) {
        log.error(`[graph] ${client.name}: ${err.message}`);
        return {
          client,
          hasData: false,
          budgetConsumed: null,
          token: null,
          campaignTypes: null,
          error: err.message,
        };
      }
    })
  );

  const dataResults = results.filter((r) => r.hasData);

  // ── Step 2: nobody has data -> one combined line ───────────────────────────
  if (dataResults.length === 0) {
    d.logStatus(combinedNoData(clients.map((c) => c.name), yesterdayISO));
    return state;
  }

  // ── Step 3a: fire triggers for EVERY data brand, every cycle ───────────────
  const triggerTime = istTimestampMinute(d.now());
  await Promise.all(
    dataResults.map(async (r) => {
      const st = state.perClient[r.client.key];
      st.dataFound = true;
      st.budget = r.budgetConsumed;

      try {
        const triggerTypes = r.campaignTypes || config.campaignTypes;
        const res = await d.triggerReportDownload(
          r.token,
          fromDate,
          toDate,
          triggerTypes
        );
        const ok = res?.status === 200 && res?.data?.success;
        if (ok && !st.triggeredTimes.includes(triggerTime)) {
          st.triggeredTimes.push(triggerTime);
        }
        log.info(
          `[trigger] ${r.client.name} @ ${triggerTime} -> HTTP ${res?.status} ${
            typeof res?.data === "object" ? JSON.stringify(res.data) : res?.data
          }`
        );
        if (!ok) log.warn(`[trigger] ${r.client.name}: download trigger not confirmed`);
      } catch (err) {
        log.error(`[trigger] ${r.client.name}: ${err.message}`);
      }
    })
  );

  // ── Step 3b: poll the mailbox for EVERY data brand; refresh received ───────
  const targets = dataResults.map((r) => ({
    client: r.client,
    requestedAts: state.perClient[r.client.key].triggeredTimes,
  }));
  const received = await pollForReports(targets, d);
  for (const t of targets) {
    state.perClient[t.client.key].reportReceived = received.has(t.client.key);
  }

  // ── Step 3c: one line per brand, in client order ───────────────────────────
  for (const r of results) {
    const st = state.perClient[r.client.key];
    if (r.hasData) {
      d.logStatus(perClientStatus(r.client.name, st.budget, st.reportReceived));
    } else {
      d.logStatus(perClientNoData(r.client.name, yesterdayISO));
    }
  }

  // ── Step 4: combined GChat once all brands have received ───────────────────
  const allReceived = clients.every((c) => state.perClient[c.key]?.reportReceived);
  if (allReceived && !state.successGchatSent) {
    await sendDailySummary(state, clients, d);
  }

  return state;
}

// One combined "id : budget" GChat note for brands with data, once per day.
async function sendDailySummary(state, clients, deps = {}) {
  if (state.successGchatSent || !state.dayKey) return false;
  const send = deps.sendCombinedSuccess || sendCombinedSuccess;

  const info = clients
    .filter((c) => state.perClient[c.key]?.dataFound)
    .map((c) => ({
      id: c.id,
      name: c.name,
      budget: state.perClient[c.key].budget,
    }));

  if (info.length === 0) return false;

  const sent = await send(config.gchatWebhookUrl, info, state.dayKey);
  if (sent) state.successGchatSent = true;
  return sent;
}

module.exports = {
  runCycle,
  resetIfNewDay,
  createState,
  pollForReports,
  sendDailySummary,
};
