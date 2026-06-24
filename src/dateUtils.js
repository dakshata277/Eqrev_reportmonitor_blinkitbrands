/**
 * IST-aware date helpers. All "date" strings are plain calendar dates in
 * `YYYY-MM-DD` form (IST), so day arithmetic is timezone-safe.
 */

/** "YYYY-MM-DD" for the given instant, in IST. */
function istDateString(date = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "YYYY-MM-DD HH:mm:ss" for the given instant, in IST. */
function istTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** "YYYY-MM-DD HH:MM" for the given instant, in IST (minute precision). */
function istTimestampMinute(date = new Date()) {
  return istTimestamp(date).slice(0, 16);
}

/**
 * Parse a "YYYY-MM-DD HH:MM" string to absolute minutes (interpreting the
 * naive datetime as UTC). Both sides of a comparison use the same convention,
 * so differences are correct regardless of the real timezone. Returns null
 * on bad input.
 */
function timestampToMinutes(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  return Math.floor(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000
  );
}

/** Minutes since IST midnight for the given instant (0..1439). */
function istMinutesOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Add `n` days to a "YYYY-MM-DD" string, returning "YYYY-MM-DD". */
function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Yesterday (current_date - 1) in IST, as "YYYY-MM-DD". */
function yesterdayIST(date = new Date()) {
  return addDays(istDateString(date), -1);
}

/** Convert "YYYY-MM-DD" -> Blinkit "M/D/YYYY" (no leading zeros). */
function toBlinkitDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/**
 * "HH:MM" (24h) -> minutes since midnight. Returns NaN on bad input.
 */
function hhmmToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Build the date window the monitor queries each cycle:
 *   from = yesterday - 2, to = yesterday  (Blinkit M/D/YYYY format),
 *   plus the ISO yesterday used for matching the data point.
 */
function dateRangeForYesterday(date = new Date()) {
  const yesterdayISO = yesterdayIST(date);
  const fromISO = addDays(yesterdayISO, -2);
  return {
    yesterdayISO,
    fromDate: toBlinkitDate(fromISO),
    toDate: toBlinkitDate(yesterdayISO),
  };
}

/**
 * Extract the date portion ("YYYY-MM-DD") from a Blinkit `date_ist` value
 * like "2026-06-21 11:00:00+05:30". Returns null if unparseable.
 */
function parseDateIstDatePart(dateIst) {
  if (typeof dateIst !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dateIst.trim());
  return m ? m[1] : null;
}

module.exports = {
  istDateString,
  istTimestamp,
  istTimestampMinute,
  timestampToMinutes,
  istMinutesOfDay,
  addDays,
  yesterdayIST,
  toBlinkitDate,
  hhmmToMinutes,
  dateRangeForYesterday,
  parseDateIstDatePart,
};
