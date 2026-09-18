# Connecting Rosnet and Merchant Centric STARS

The dashboard takes data from both systems automatically, without ever signing in to their websites and without holding anyone's password. Rosnet is read through its official API with an API key; reports the API doesn't cover, and everything from STARS, are sent to the dashboard on a schedule. All of it is read on every refresh (daily at 5:30am, every 15 minutes while restaurants are open, and whenever someone presses Refresh now).

## Rosnet API (preferred)

Rosnet has an official, documented REST API at `https://api.rosnet.com` (OpenAPI description: `https://api.rosnet.com/swagger/v1/swagger.json`). This is the first choice in the brief's data ingestion order, and it needs no report scheduling.

**Credentials.** The API uses its own **API User ID and API User Key**, issued by Rosnet: email **api@rosnet.com** with your name, company name and email address (template below). These are not a Rosnet website sign-in. A person's Rosnet username and password are never used by the dashboard: the dashboard does not sign in to the Rosnet website, and nothing in this project should hold a website password. If a key covers several Rosnet client sites, Rosnet also gives a Client ID.

Enter them in the dashboard: **Data and refresh > Connections > Rosnet API**. **Test connection** signs in and counts the restaurants Rosnet shows; **Save and load data** stores the key (encrypted, never displayed again) and runs the first pull on the spot. No file to edit, no restart. A hosted install can set `ROSNET_API_USER`, `ROSNET_API_KEY` and `ROSNET_CLIENT_ID` as environment variables instead; those win over what is saved in the dashboard.

Every refresh (daily, intraday, manual) pulls:

| From the API | Endpoint | Becomes |
|---|---|---|
| Store list, time zones | `/general/locations` | Restaurants, matched by store number. Closed locations are ignored. |
| Net sales, final and live | `/sales/totalSales` | Actual sales. Today's figures are live and refresh through the day. |
| Net sales, comparable day last year | `/sales/totalSales` 364 days back | Last-year sales (fetched once per date) |
| Worked shifts | `/labor/shifts` | Actual labor hours, labor cost (hours x pay rate), manager hours (jobs matching `ROSNET_MANAGER_JOBS`). Open shifts count up to now. |
| Schedules | `/labor/shifts/Schedule` | Scheduled labor hours |

The first run loads `ROSNET_BACKFILL_DAYS` of history (default 35). After that each run re-reads the last two complete days, for late clock-outs and corrections, plus today. Rate limits (429) and maintenance (503) are waited out using Rosnet's Retry-After header. A pull shows up under Files received as channel "Rosnet API", and as a step in the refresh history.

**What the API does not carry, and how to fill it:**

- **Forecast sales and allowable hours.** These are not in the API. Schedule the one Rosnet report that has them (store, date, forecast sales, allowable/earned hours) to the mailbox or folder below. API rows and report rows merge: neither overwrites the other. Until a forecast arrives, sales-vs-forecast and labor-vs-allowable are blank, while sales vs. last year, labor hours and scheduled hours work.
- **Region, area, area manager, city.** New stores from the API start under "Unassigned". Upload a store list once (Store Number, Restaurant, Region, Area, Area Manager, City, State) or any report with Region and Area columns, and each store moves to its area. City and state are what weather needs.
- **Daypart sales.** Only available check by check (`/sales/checks`), which is heavy for 120 stores. Not pulled. A Rosnet daypart sales report through the mailbox or folder fills it.

## The other ways in

Use whichever the vendor supports. They can be combined with the API and with each other.

| Channel | Use when | Set up |
|---|---|---|
| **Reports mailbox** | The vendor can email a report on a schedule (Rosnet calls these push reports). Reports go to a dedicated inbox; attachments from trusted senders are imported. | Data and refresh > Connections > Reports mailbox: address, app password, trusted senders. **Test connection** lists recent senders to pick from. (Hosted: `REPORTS_IMAP_*`, `REPORTS_ALLOWED_SENDERS`.) |
| **Reports folder** | The vendor can deliver files by SFTP, or drop them on a synced drive. Installed copies watch Documents > IHOP Operations Reports. | Works out of the box; the folder can be changed under Connections. (Hosted: `IMPORT_DIR`.) |
| **Push endpoint** | The vendor has an API, webhook or export job that can send a file to a URL. `POST /api/ingest`, header `Authorization: Bearer <token>`, files as form data or one CSV as the body. | Hosted installs only: `INGEST_TOKEN` environment variable |

Everything except the push endpoint is set up in the dashboard. `server/.env` (copy `server/.env.example`) is only for hosted installs that prefer environment variables.

## One-time setup with the client (about 30 minutes)

1. **In Rosnet**, find the reports that carry, per restaurant per day: forecast sales and allowable labor hours (always needed), and, if the Rosnet API is not connected, also net sales, last-year sales (by daypart if offered), actual and scheduled labor hours, manager hours, labor cost. It is fine if these are separate reports: the dashboard merges them, with each other and with the API.
2. **Export each one once** (Excel or CSV) and open Data and refresh > Reports and layouts. Choose the file. The dashboard shows how it read it. Fix any column it matched wrong, name the layout ("Rosnet Daily Sales Flash"), import. That layout now imports unattended from any channel.
3. **The first sales report must include Region and Area columns** (or upload a store list with Store Number, Name, Region, Area, Area Manager, City, State first). That builds the region > area > store hierarchy. Cities are geocoded automatically for weather.
4. **Schedule those same reports in Rosnet** to run daily after close (before 5:30am) and deliver to the mailbox or folder. For live sales, schedule the sales report every 15 to 60 minutes during the day: rows dated today are treated as live.
5. **In Merchant Centric STARS**, do the same with either export shape:
   - location summary: Location, Date, Rating, Review count
   - review export: one row per review with Review Date, Location, Source, Rating (Google rows feed the Google rating, other sites feed the survey/other rating)
   STARS location names are matched to restaurants by name, or by the store number inside the name ("IHOP - Plano #3100").
6. **Create the mailbox** (for example `ihop-reports@clientdomain.com`), turn on IMAP, create an app password, and enter both under Data and refresh > Connections > Reports mailbox. After the first vendor email arrives, press **Test connection** and pick the vendor from the recent senders to trust it (for example `rosnet.com`, `merchantcentric.com`).

## What happens when something goes wrong

- A report in a layout nobody has mapped is logged as **Needs column mapping**, and a notice appears on Data and refresh. Import one copy and save the layout.
- If the prior business day has not arrived by the daily refresh time, **every page shows a red banner** saying which day is missing, so nobody mistakes old hotspots for new ones.
- Every file received, from every channel, is listed under **Files received** with rows imported and rows skipped. Every refresh lists its steps and any error.
- Mail from senders not on the trusted list is ignored and noted in the audit log.

## Email to Rosnet for API access (api@rosnet.com)

Subject: API credentials for [Company name]

Hello,

We operate [number] IHOP restaurants on Rosnet ([Rosnet site or client name]) and are building an internal operations dashboard. Please issue read-only API credentials (API User ID and Key) for our account.

Name: [name]
Company: [company name]
Email: [email]

We will read `general/locations`, `sales/totalSales`, `labor/shifts`, `labor/shifts/Schedule` and `labor/definitions/jobs`, for all of our locations, about every 15 minutes during operating hours and once early each morning. Two questions:

1. Is forecast (projected) sales or allowable/earned labor hours available from any endpoint? We did not find them in the published API description.
2. Are there rate limits we should plan around for that polling pattern?

Thank you.

## Email to Rosnet support (support@rosnet.com), for what the API doesn't carry

Subject: Scheduled report delivery for [Company name]

Hello,

We are feeding an internal operations dashboard from Rosnet. We are using the Rosnet API for sales and labor, and need one scheduled report for the figures the API doesn't include.

1. Scheduled delivery. Daily before 5:30am Central, as Excel or CSV, to an email address or SFTP location we provide: by restaurant and business date, forecast sales (by daypart if available) and allowable (earned) labor hours. Please let us know how to set up that schedule, or whether you can set it up for us.
2. If available, the same report with daypart net sales and last-year daypart sales.

Our account contact is [name, email, phone]. Thank you.

## Email to Merchant Centric (your account manager, or via merchantcentric.com)

Subject: Scheduled STARS export for [Company name]

Hello,

We are building an internal operations dashboard and would like to include our STARS review data automatically. Could you help us with the following?

1. A scheduled daily export, as CSV or Excel, delivered by email or SFTP: either a location summary (location, date, average rating, review count, by source if possible) or the review-level export (review date, location, source, rating).
2. If STARS has an API or a webhook for new reviews, the documentation and how to get read-only credentials.
3. Whether the export can include our store numbers, so locations match our other systems exactly.

Our account contact is [name, email, phone]. Thank you.
