# Connecting Rosnet and Merchant Centric STARS

The dashboard takes data from both systems automatically, without ever signing in to them and without holding their passwords. The vendor systems send their scheduled reports to the dashboard; the dashboard reads them on every refresh (daily at 5:30am, every 15 minutes while restaurants are open, and whenever someone presses Refresh now).

## The three ways in

Use whichever the vendor supports. They can be combined.

| Channel | Use when | Server setting |
|---|---|---|
| **Reports mailbox** | The vendor can email a report on a schedule (most can). Reports go to a dedicated inbox; attachments from trusted senders are imported. | `REPORTS_IMAP_HOST`, `REPORTS_IMAP_USER`, `REPORTS_IMAP_PASSWORD`, `REPORTS_ALLOWED_SENDERS` |
| **Watched folder** | The vendor can deliver files by SFTP, or drop them on a synced drive. | `IMPORT_DIR` |
| **Push endpoint** | The vendor has an API, webhook or export job that can send a file to a URL. `POST /api/ingest`, header `Authorization: Bearer <token>`, files as form data or one CSV as the body. | `INGEST_TOKEN` |

Settings go in `server/.env` (copy `server/.env.example`). The file is git-ignored.

## One-time setup with the client (about 30 minutes)

1. **In Rosnet**, find the reports that carry, per restaurant per day: net sales, forecast sales, last-year sales (by daypart if offered), actual / scheduled / allowable labor hours, manager hours, labor cost. It is fine if sales and labor are separate reports: the dashboard merges them.
2. **Export each one once** (Excel or CSV) and open Data and refresh > Reports and layouts. Choose the file. The dashboard shows how it read it. Fix any column it matched wrong, name the layout ("Rosnet Daily Sales Flash"), import. That layout now imports unattended from any channel.
3. **The first sales report must include Region and Area columns** (or upload a store list with Store Number, Name, Region, Area, Area Manager, City, State first). That builds the region > area > store hierarchy. Cities are geocoded automatically for weather.
4. **Schedule those same reports in Rosnet** to run daily after close (before 5:30am) and deliver to the mailbox or folder. For live sales, schedule the sales report every 15 to 60 minutes during the day: rows dated today are treated as live.
5. **In Merchant Centric STARS**, do the same with either export shape:
   - location summary: Location, Date, Rating, Review count
   - review export: one row per review with Review Date, Location, Source, Rating (Google rows feed the Google rating, other sites feed the survey/other rating)
   STARS location names are matched to restaurants by name, or by the store number inside the name ("IHOP - Plano #3100").
6. **Create the mailbox** (for example `ihop-reports@clientdomain.com`), turn on IMAP, create an app password, and put it in `server/.env`. Set `REPORTS_ALLOWED_SENDERS` to the addresses or domains the vendors send from (check one real email's From line), for example `rosnet.com,merchantcentric.com`.

## What happens when something goes wrong

- A report in a layout nobody has mapped is logged as **Needs column mapping**, and a notice appears on Data and refresh. Import one copy and save the layout.
- If the prior business day has not arrived by the daily refresh time, **every page shows a red banner** saying which day is missing, so nobody mistakes old hotspots for new ones.
- Every file received, from every channel, is listed under **Files received** with rows imported and rows skipped. Every refresh lists its steps and any error.
- Mail from senders not on the trusted list is ignored and noted in the audit log.

## Email to Rosnet support (support@rosnet.com)

Subject: Scheduled report delivery and API access for [Company name]

Hello,

We are building an internal operations dashboard for our [number] IHOP restaurants and would like to feed it from Rosnet automatically. Could you help us with the following?

1. Scheduled delivery. We would like these reports delivered daily before 5:30am Central, as Excel or CSV, to an email address or SFTP location we provide: daily net sales by restaurant with forecast and last-year sales (by daypart if available), and daily labor by restaurant with actual, scheduled and allowable hours, manager hours and labor cost. Please let us know how to set up that schedule, or whether you can set it up for us.
2. Intraday sales. Is there a way to have the current-day sales report delivered every 15 to 60 minutes during operating hours?
3. API access. Your site mentions an API for custom applications. Could you send the documentation and the process for getting read-only credentials for our account? We only need to read sales, forecast, labor and the store hierarchy.

Our account contact is [name, email, phone]. Thank you.

## Email to Merchant Centric (your account manager, or via merchantcentric.com)

Subject: Scheduled STARS export for [Company name]

Hello,

We are building an internal operations dashboard and would like to include our STARS review data automatically. Could you help us with the following?

1. A scheduled daily export, as CSV or Excel, delivered by email or SFTP: either a location summary (location, date, average rating, review count, by source if possible) or the review-level export (review date, location, source, rating).
2. If STARS has an API or a webhook for new reviews, the documentation and how to get read-only credentials.
3. Whether the export can include our store numbers, so locations match our other systems exactly.

Our account contact is [name, email, phone]. Thank you.
