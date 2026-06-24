// Load .env by absolute path so the working directory doesn't matter
// (Task Scheduler can run `node <abs>/server.js` from anywhere).
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });


module.exports = {
  // ─── Schedule (IST): runs cycles startHHMM..endHHMM, then exits ───────────
  startHHMM: process.env.MONITOR_START_HHMM || "11:00",
  endHHMM: process.env.MONITOR_END_HHMM || "18:00",
  // Cycle cadence in minutes (poll every 10 min).
  intervalMin: Number(process.env.MONITOR_INTERVAL_MIN) || 10,

  // ─── Email-arrival check ─────────────────────────────────────────────────
  // Max time to wait for the report email within a single cycle (ms).
  emailWaitMs: Number(process.env.EMAIL_WAIT_MS) || 600000, // 10 min
  // How often to poll the mailbox while waiting (ms).
  emailPollIntervalMs: 20000, // 20 s
  // Subject substring that identifies a Blinkit Brands report email.
  reportSubjectMatch: "dashboard reports",
  // Minutes tolerance matching the email's Requested Date vs our trigger time.
  // 0 = exact-minute match (only the report this run triggered).
  emailMatchToleranceMin:
    process.env.EMAIL_MATCH_TOLERANCE_MIN !== undefined
      ? Number(process.env.EMAIL_MATCH_TOLERANCE_MIN)
      : 0,
  // Mailbox the Gmail service account impersonates.
  gmailImpersonate: process.env.GMAIL_IMPERSONATE || "kailash@eqrev.com",

  // ─── Notifications ───────────────────────────────────────────────────────
  gchatWebhookUrl: process.env.GCHAT_WEBHOOK_URL || DEFAULT_GCHAT_WEBHOOK,

  // ─── Blinkit request payload ─────────────────────────────────────────────
  campaignTypes: [
    "PRODUCT_LISTING",
    "PRODUCT_RECOMMENDATION",
    "SEARCH_SUGGESTION",
    "SHELF_DIY",
    "STORY_DIY",
    "BANNER_DIY",
    "BRAND_SPOTLIGHT_DIY",
    "BANNER_LISTING",
    "BRAND_BOOSTER",
  ],
};
