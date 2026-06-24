/**
 * Email parsing helpers. Copied from Eqrev_reports_download_blinkitbrands.
 */
function extractEmailAddress(headerValue = "") {
  const match = headerValue.match(/<([^>]+)>/);
  const email = match ? match[1] : headerValue;
  return (email || "").trim().toLowerCase();
}

function getBody(payload) {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  if (payload.parts) {
    for (const mimeType of ["text/html", "text/plain"]) {
      for (const part of payload.parts) {
        if (part.mimeType === mimeType && part.body?.data) {
          return Buffer.from(part.body.data, "base64").toString("utf-8");
        }
        if (part.mimeType?.startsWith("multipart/") && part.parts) {
          const nested = getBody(part);
          if (nested) return nested;
        }
      }
    }
  }
  return "";
}

function extractLink(body) {
  const links = body.match(/https?:\/\/[^\s"<>]+/g);
  return (links || []).map((link) => link.replace(/&amp;/g, "&"));
}

function extractToFromBody(body) {
  const text = body
    .replace(/<([\w.+-]+@[\w-]+\.[\w.]+)>/g, " $1 ")
    .replace(/&lt;([\w.+-]+@[\w-]+\.[\w.]+)&gt;/gi, " $1 ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");

  const match = text.match(/\bTo:\s*[^@]*?([\w.+-]+@[\w-]+\.[\w.]+)/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

function extractRequestedDate(body) {
  const text = body.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ");
  const match = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : null;
}

module.exports = {
  extractEmailAddress,
  getBody,
  extractLink,
  extractToFromBody,
  extractRequestedDate,
};
