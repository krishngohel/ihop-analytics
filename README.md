# IHOP Sales Forecasting & Operations Dashboard

A web dashboard for a ~120-restaurant organization. It replaces a manual daily review of every restaurant with a prioritized **hotspots** view, rolled up by **region, area and store**, with weather and prior-year context, a daily morning summary, and a weekly forecasting form for area managers.

Built to the client brief in `docs/superpowers/specs/2026-09-17-operations-dashboard-design.md`.

## What's in it

| Screen | What it answers |
|---|---|
| Overview | Company totals: sales vs. forecast, labor vs. allowable, guest metrics, weather. Today live, yesterday final, period to date. |
| Hotspots | The bottom 15% of restaurants on sales and labor exceptions, with flags, every supporting number, and weather context. |
| Regions and areas | Region, then area, then restaurant. Rank and sort at each level, see what is driving a result. |
| Restaurant | Daily, weekly, period and history views, dayparts, guest metrics, weather, recent anomalies. |
| Daily summary | The morning summary, generated after prior-day data lands. Copy as text or print. |
| Weekly forecast form | Managers reconcile last year, recent trend and the system forecast, then show the labor plan fits. Rolls up to area and region. |
| Data and refresh | Refresh schedule, manual refresh, imports, refresh history, people and access, audit log. |

## Requirements

Node.js 22.5 or newer (uses Node's built-in SQLite, so there is no database to install).

## Run it

```bash
cd client && npm install && npm run build
cd ../server && npm install
npm run seed     # demo organization, 120 days of results, sign-in accounts
npm start        # http://localhost:4000
```

The seed writes the demo sign-ins to `server/.demo-credentials.txt` (git-ignored). Four accounts, one per access level: `exec@`, `region@`, `area@`, `store@demo.local`. Set `DEMO_PASSWORD` before seeding to choose the password, otherwise a random one is generated.

The demo data keeps itself current: each refresh finalizes any missing days, grows today's live sales, and pulls real weather.

## Connecting real data

In order of preference (from the brief): an official API or supported export, vendor-approved reporting access, then a scheduled CSV/Excel export into a secure folder. The dashboard never logs in to vendor sites or scrapes them, and stores no vendor passwords.

Sources: **Rosnet** (sales, labor, forecasts) and **Merchant Centric STARS** (reviews and guest ratings). Step-by-step setup and the emails to send both vendors: `docs/connecting-rosnet-and-stars.md`.

Working today, all unattended once set up:

- **Rosnet API** (preferred): enter the API User ID and Key under Data and refresh > Connections (issued by api@rosnet.com; not a website sign-in). Every refresh pulls net sales (live and final), last-year sales, worked and scheduled labor, and the store list from `api.rosnet.com`. Forecast sales and allowable hours are not in the API, so that one report still comes by one of the channels below and merges with the API's rows.
- **Reports mailbox**: the vendors email their scheduled reports to a dedicated inbox; attachments from trusted senders are imported on every refresh. Set up under Data and refresh > Connections, with a Test button that lists recent senders.
- **Reports folder**: every refresh imports any `.csv`/`.xlsx` in it, then moves it to `processed/` or `rejected/`.
- **Push endpoint**: `POST /api/ingest` with `Authorization: Bearer $INGEST_TOKEN`, for a vendor API job or integration tool.
- **Saved report layouts**: upload one copy of a report under Data and refresh, check the column matches, save the layout. That layout then imports by itself from any channel. Title rows, abbreviated headers ("Net Sls", "Fcst"), total lines, a missing date column, and sales and labor arriving as separate reports are all handled. STARS works as a location summary or a one-row-per-review export.
- **Missing-data alerts**: if the prior business day hasn't arrived by the daily refresh time, every page says so.
- New restaurants are created from the export when it has Region and Area columns. Restaurants with a city and state are geocoded automatically so weather works.
- The first real import clears the demonstration data.

The Rosnet API connector (`server/src/sources/rosnet.js`) writes through the same function the importers use (`savePerformance` in `server/src/performance.js`), so nothing downstream changes. A guest-platform connector would do the same with `saveGuestMetrics`.

Tests: `cd server && npm test` runs the connector against a stand-in for the Rosnet API, and checks report dates import as written.

## Installers

`packaging/build-mac.sh` builds a drag-to-Applications `.dmg`; `packaging/build-windows.ps1` builds a per-user Windows setup program. Both bundle Node and a menu bar / tray launcher, keep data outside the app, and need no terminal. The client's steps are in `INSTALL.md`.

## Configuration

Connections (Rosnet API, reports mailbox, reports folder) are set in the dashboard and stored in the database, secrets encrypted with a key file beside it (`server/src/connections.js`). The environment variables below are for hosted installs and win over the saved values.

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 4000) |
| `OPS_DB_PATH` | SQLite file location (default `server/ops.db`). Put it on a persistent disk when hosting. |
| `ROSNET_API_USER`, `ROSNET_API_KEY`, `ROSNET_CLIENT_ID` | Rosnet API credentials (see `docs/connecting-rosnet-and-stars.md`) |
| `REPORTS_IMAP_HOST`, `REPORTS_IMAP_USER`, `REPORTS_IMAP_PASSWORD`, `REPORTS_ALLOWED_SENDERS` | Reports mailbox |
| `IMPORT_DIR` | Scheduled export drop folder |
| `OPS_HOST` | Address to listen on. `127.0.0.1` keeps it to this computer (what the installed apps do); unset listens on the network |
| `OPS_SECRET_KEY` | Key for the saved secrets, instead of the `.secret-key` file beside the database |
| `COOKIE_SECURE=1` or `NODE_ENV=production` | Send the session cookie over HTTPS only |
| `DEMO_PASSWORD` | Password for the seeded demo accounts |

Refresh timing (daily time, intraday interval, operating hours) is set in the app under Data and refresh.

## Hosting it online

The server serves both the API and the built frontend on one port, so any Node host with a persistent disk works. A `Dockerfile` is included:

```bash
docker build -t ihop-ops .
docker run -p 4000:4000 -v ihop-ops-data:/data -e NODE_ENV=production ihop-ops
```

Run `npm run seed` once inside the container (or import real data) to create the first accounts. Put it behind HTTPS.

## Security

- Passwords are scrypt-hashed. Sessions are random tokens stored hashed, sent as an HttpOnly, SameSite cookie.
- Role-based access: executive (company-wide), region, area, store. Every query is filtered by the signed-in user's scope on the server.
- Sign-ins, imports, refreshes and errors are written to an audit log. Repeated failed sign-ins lock out for ten minutes.
- No credentials in the code or the repository.

## Project layout

```
server/src
  db.js            schema (follows the brief's data model) and settings
  performance.js   the single write path for sales/labor and guest data
  analytics.js     company / region / area / store rollups, access scoping
  hotspots.js      hotspot rules, severity, flags
  summary.js       daily morning summary
  forecast.js      weekly forecasting form, checks, rollups
  weather.js       Open-Meteo current + same-day-last-year weather
  imports.js       CSV/Excel importers, drop folder, templates
  refresh.js       refresh pipeline and scheduler
  auth.js          sign-in, sessions, roles
  sources/demo.js  deterministic demo organization
client/src         React + Vite + Recharts
server/legacy, client/legacy   the earlier item-level analytics app, kept for reference
```
