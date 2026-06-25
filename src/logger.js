// File + console logger, rolled per IST day:
//   status()/raw()           -> logs/monitor/monitor-YYYY-MM-DD.log (business log)
//   info/warn/error/debug()  -> logs/debug/debug-YYYY-MM-DD.log     (infra)
const fs = require("fs");
const path = require("path");
const { istDateString, istTimestamp } = require("./dateUtils");

const LOG_DIR = path.join(__dirname, "..", "logs");
const MONITOR_DIR = path.join(LOG_DIR, "monitor");
const DEBUG_DIR = path.join(LOG_DIR, "debug");

const DIR_FOR = { monitor: MONITOR_DIR, debug: DEBUG_DIR };

function ensureDir() {
  for (const dir of [MONITOR_DIR, DEBUG_DIR]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {
      /* ignore */
    }
  }
}

function append(prefix, line) {
  ensureDir();
  const dir = DIR_FOR[prefix] ?? LOG_DIR;
  const file = path.join(dir, `${prefix}-${istDateString()}.log`);
  try {
    fs.appendFileSync(file, line + "\n", "utf8");
  } catch (err) {
    console.error(`[logger] failed to write ${file}: ${err.message}`);
  }
}

function fmtMeta(meta) {
  if (meta === null || meta === undefined) return "";
  return " " + (typeof meta === "string" ? meta : JSON.stringify(meta));
}

/** Clean business status line -> monitor log + console. */
function status(message) {
  const line = `[${istTimestamp()} IST] ${message}`;
  console.log(line);
  append("monitor", line);
}

/** Raw line (no timestamp prefix) -> monitor log + console. Used for dividers. */
function raw(message) {
  console.log(message);
  append("monitor", message);
}

function diag(severity, message, meta) {
  const msg = typeof message === "string" ? message : JSON.stringify(message);
  const line = `[${istTimestamp()} IST] [${severity}] ${msg}${fmtMeta(meta)}`;
  const consoleFn = console[severity.toLowerCase()] || console.log;
  consoleFn(line);
  append("debug", line);
}

module.exports = {
  status,
  raw,
  info: (msg, meta = null) => diag("INFO", msg, meta),
  warn: (msg, meta = null) => diag("WARN", msg, meta),
  error: (msg, meta = null) => diag("ERROR", msg, meta),
  debug: (msg, meta = null) => diag("DEBUG", msg, meta),
  LOG_DIR,
};
