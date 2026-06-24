// Per-advertiser campaign-type self-healing. Blinkit 400s the whole request if
// it includes a type the advertiser hasn't enabled. requestWithEnabledTypes()
// parses the disabled types from that 400, drops them, retries once, and returns
// the type-set that worked so callers can reuse it.
const log = require("../logger");

/** Pull the message text out of a Blinkit error body (string or array). */
function extractMessage(data) {
  if (!data) return "";
  const m = data.message;
  if (Array.isArray(m)) return m.join(" ");
  if (typeof m === "string") return m;
  return "";
}

/** Parse the "[...] are not enabled for given advertiser" type list, or null. */
function parseDisabledTypes(data) {
  const msg = extractMessage(data);
  const match = msg.match(/\[([^\]]+)\]\s*are not enabled for given advertiser/i);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

async function requestWithEnabledTypes(requestFn, types, label = "") {
  let res = await requestFn(types);
  let used = types;

  if (res && res.status === 400) {
    const disabled = parseDisabledTypes(res.data);
    if (disabled && disabled.length) {
      const retry = types.filter((t) => !disabled.includes(t));
      if (retry.length && retry.length !== types.length) {
        log.warn(
          `[enabledTypes]${label ? " " + label : ""} dropping disabled types ${JSON.stringify(
            disabled
          )} and retrying with ${JSON.stringify(retry)}`
        );
        res = await requestFn(retry);
        used = retry;
      }
    }
  }

  return { res, types: used };
}

module.exports = { parseDisabledTypes, requestWithEnabledTypes };
