# Eqrev Report Monitor — Blinkit Brands

Watches the Blinkit Brands dashboard for **yesterday's** (`current_date - 1`) data
for every active Blinkit Brands client (loaded live from BigQuery). When a brand's
data point exists it **fires the report-download trigger every 10 minutes**
(regardless of whether the report already arrived) and **refreshes each brand's
received/not-received status** every cycle, logging to a per-day log file. Once all
brands have received, it sends **one** combined Google Chat note listing each
brand's `id : budget`.

Built on the proven Cloudflare-bypass + token modules from
`Eqrev_dataingestion_blinkitseller_v2` and the Gmail-reading approach from
`Eqrev_reports_download_blinkitbrands`. No Pub/Sub, no report storage.

## Run

```bash
npm install
node server.js        # or: npm start
```

Runs cycles every 10 min inside the active IST window (**11:00–18:00**): idles
before 11:00 and **exits at 18:00**. `.env` loads by absolute path, so it works
from any working directory.

## Clients (dynamic — nothing hardcoded)

Loaded each cycle from BigQuery `hopeful-history-405018.accounts.id_password`
(`status = 'active'` and a non-empty `blinkit_brands_email`) — the same source
seller_v2 uses for Blinkit Brands. Add/remove a brand in that table and the monitor
picks it up; the last good list is reused if a query fails. See
[`src/db/getClients.js`](src/db/getClients.js).

## What it logs (per 10-min cycle)

`logs/monitor-YYYY-MM-DD.log` (one file per IST day). Each cycle starts with a
divider so cycles are easy to scan:

```
================ 2026-06-24 11:10:03 IST | checking 2026-06-23 | 13 brands ================
data updated in graph | Ace Blend | budget=4,407 | report triggered | report received
data updated in graph | Phool | budget=78,152 | report triggered | report NOT received
data not updated | Pepe Jeans Innerfashion | for 2026-06-23
...
```

If no brand has data yet: one line — `Data not updated for any of the 13 brands for 2026-06-23`.

Infra diagnostics (token/proxy/Gmail/Cloudflare) go to `logs/debug-YYYY-MM-DD.log`.

**GChat — one combined message, once per day, only when ALL brands have received**
(no fallback — if any brand's report never arrives, no GChat is sent that day):
```
Blinkit Brands — Yesterday 2026-06-23
341pho393 : 78,152
496ace625 : 4,407
123pej456 : 12,030
...
```

## Configuration

`.env` only needs three values:

```
GOOGLE_CLOUD_CREDENTIALS=<base64 service-account JSON, DWD to the mailbox>
GMAIL_IMPERSONATE=kailash@eqrev.com
GCHAT_WEBHOOK_URL=<google chat webhook>
```

Everything else has a built-in default (Webshare `PROXIES_API_KEY`, token service
URL) — override via env or [`config/config.js`](config/config.js).

**Edit the schedule / cadence in [`config/config.js`](config/config.js):**
`startHHMM` (11:00), `endHHMM` (18:00), `intervalMin` (10), `emailWaitMs` (10 min),
`emailMatchToleranceMin` (0 = exact-minute match of the report's Requested Date
against our trigger time).

## Schedule (Windows Task Scheduler, daily 11:00 AM)

One command (note the escaped inner quotes around the node path + script):
```
schtasks /Create /TN "EQRev Blinkit Report Monitor" /TR "\"C:\Program Files\nodejs\node.exe\" \"C:\Users\daksh\OneDrive\Documents\EQREV\Eqrev_reportmonitor_blinkitbrands\server.js\"" /SC DAILY /ST 11:00 /F
```

Or via the GUI — Create Task → Action → Start a program:
- Program/script: `C:\Program Files\nodejs\node.exe`
- Add arguments: `C:\Users\daksh\OneDrive\Documents\EQREV\Eqrev_reportmonitor_blinkitbrands\server.js`

Run today manually: `node server.js` from the project folder. It runs until 18:00,
then exits. Don't run a manual and a scheduled instance at once.

## Requirements

- **Node.js ≥ 18** (uses global `fetch`).
- **Python 3 + `curl_cffi`** on PATH — required for the Cloudflare-bypass worker
  pool (`pip install curl_cffi`). Without proxies it falls back to a direct serial
  queue.

## Layout

```
server.js                entry — 11:00–18:00 loop, exits at stop time
config/config.js         schedule, timings, campaign types, webhook
src/
  monitor.js             orchestrator + per-day state machine (concurrent brands)
  graphCheck.js          token -> metrics-trends -> {hasData, budget}
  dateUtils.js           IST dates, M/D/YYYY, date_ist + timestamp parsing
  messages.js            all log/notification text builders
  logger.js              per-day file logger (monitor + debug streams)
  gchat.js               combined "id : budget" webhook
  db/getClients.js       BigQuery client list (active Blinkit Brands)
  blinkit/               CF/token infra + API wrappers + enabled-type self-heal
  gmail/                 Gmail auth/parsers + batched report-arrival check
```
