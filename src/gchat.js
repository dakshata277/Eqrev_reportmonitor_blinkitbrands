// Single combined GChat note (once per day).
const log = require("./logger");
const { gchatCombined } = require("./messages");
const { istTimestamp } = require("./dateUtils");

async function sendCombinedSuccess(webhookUrl, clientsInfo, todayISO) {
  if (!webhookUrl) {
    log.warn("[gchat] GCHAT_WEBHOOK_URL not configured - skipping notification");
    return false;
  }

  const text = gchatCombined(clientsInfo, todayISO, istTimestamp());

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      log.error(`[gchat] webhook failed with status ${response.status}`);
      return false;
    }
    log.info("[gchat] combined success notification sent");
    return true;
  } catch (err) {
    log.error(`[gchat] error sending notification: ${err.message}`);
    return false;
  }
}

module.exports = { sendCombinedSuccess };
