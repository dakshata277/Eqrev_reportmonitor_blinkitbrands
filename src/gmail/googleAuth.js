require("dotenv").config();

/**
 * Decode the base64 GCP service-account JSON from GOOGLE_CLOUD_CREDENTIALS.
 * Copied from Eqrev_reports_download_blinkitbrands (env read inlined).
 */
function getCredentials() {
  const encoded = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!encoded) {
    throw new Error("Missing GOOGLE_CLOUD_CREDENTIALS environment variable");
  }
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
}

module.exports = { getCredentials };
