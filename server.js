// Entry point (node server.js). Runs cycles every intervalMin between startHHMM
// and endHHMM IST, idles before the start, and exits at the stop time.
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const config = require("./config/config");
const log = require("./src/logger");
const { istMinutesOfDay, hhmmToMinutes } = require("./src/dateUtils");
const { runCycle, createState } = require("./src/monitor");
const { getClients } = require("./src/db/getClients");
const { warmProxyCache } = require("./src/blinkit/wsProxyClient");

const state = createState();
let clients = []; // last successfully loaded client list
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function atOrPastStopTime(now = new Date()) {
  const end = hhmmToMinutes(config.endHHMM);
  if (Number.isNaN(end)) return false;
  return istMinutesOfDay(now) >= end;
}

function beforeStartTime(now = new Date()) {
  const start = hhmmToMinutes(config.startHHMM);
  if (Number.isNaN(start)) return false;
  return istMinutesOfDay(now) < start;
}

function stop(reason) {
  log.info(`[loop] ${reason} - stopping monitor`);
  process.exit(0);
}

/** Refresh the client list from BigQuery, keeping the last good list on error. */
async function loadClients() {
  try {
    const fresh = await getClients();
    if (fresh && fresh.length) {
      clients = fresh;
      log.info(`[clients] loaded ${clients.length} Blinkit Brands clients`);
    } else {
      log.warn("[clients] query returned 0 clients - keeping previous list");
    }
  } catch (err) {
    log.error(`[clients] load failed: ${err.message} - using ${clients.length} cached`);
  }
}

async function tick() {
  if (atOrPastStopTime()) {
    await stop(`reached stop time ${config.endHHMM} IST`);
    return;
  }
  if (beforeStartTime()) {
    log.info(`[loop] before start time ${config.startHHMM} IST - skipping cycle`);
    return;
  }
  try {
    await loadClients();
    if (!clients.length) {
      log.warn("[loop] no clients available - skipping cycle");
      return;
    }
    log.info("[loop] cycle start");
    await runCycle(state, clients);
    log.info("[loop] cycle end");
  } catch (err) {
    log.error(`[loop] unhandled cycle error: ${err.stack || err.message}`);
  }
}

async function main() {
  log.info(
    `[startup] Blinkit Brands report monitor | window ${config.startHHMM}-${config.endHHMM} IST | every ${config.intervalMin} min | email wait ${config.emailWaitMs / 1000}s`
  );

  if (atOrPastStopTime()) {
    log.info(
      `[startup] launched at/after stop time ${config.endHHMM} IST - nothing to do today`
    );
    process.exit(0);
  }

  // Pre-warm the proxy pool (non-fatal if it fails / no proxies configured).
  try {
    await warmProxyCache();
  } catch (err) {
    log.warn(`[startup] proxy warm-up failed: ${err.message}`);
  }

  // Self-pacing loop: the next cycle starts `intervalMin` after the previous
  // START, or immediately if the cycle (incl. the up-to-10-min mailbox wait)
  // ran longer — so cycles never overlap even when wait ≈ interval.
  const intervalMs = config.intervalMin * 60 * 1000;
  while (true) {
    const startedAt = Date.now();
    await tick(); // exits the process at the stop time
    const wait = Math.max(0, intervalMs - (Date.now() - startedAt));
    await sleep(wait);
  }
}

process.on("unhandledRejection", (reason) => {
  log.error(`[process] unhandledRejection: ${reason?.stack || reason}`);
});

main();
