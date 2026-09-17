# Sales Forecasting & Operations Dashboard: design record

Date: 2026-09-17. Source of requirements: the client's "Detailed Build Brief" (chat summary). The brief is the spec; this file records how each part was built and the decisions the brief left open.

## Brief section to implementation

| Brief | Built as |
|---|---|
| 1. Company-level overview | `/` Overview. Actual and forecast sales, variance in $ and %, labor hours and cost, allowable and scheduled hours, labor variance in hours and %, guest metrics, weather summary across markets, Today live / Yesterday final / Period to date blocks. `GET /api/overview` |
| 2. Hotspots / exception view | `/hotspots`. Bottom 15% (setting `hotspot_share`). Categories: sales vs. forecast, sales vs. prior year, labor vs. allowable, sales and labor misses, unusually large changes, possible operational issue, guest metrics. Each card shows every field the brief lists, flags, and current + same-day-last-year weather. `server/src/hotspots.js` |
| Drill-down hierarchy | `/regions` to `/regions/:id` to `/areas/:id` to `/stores/:id`. Sortable comparison table, variance bars, "pulling down / lifting" drivers, hotspot counts. Store view has daily, weekly, period and history tables, dayparts, guest, weather and a recent-anomalies list. |
| Daily morning summary | `/summary`, `server/src/summary.js`. Same headings and line formats as the brief. Stored by the scheduled daily refresh; copy-as-text and print. |
| Data sources | Rosnet and guest platform arrive through one write path (`performance.js`) fed by file upload, a scheduled export drop folder (`IMPORT_DIR`), or the demo source. Supports live current-day rows, prior day, date ranges, period to date, dayparts, last year. |
| Weather integration | Open-Meteo (no key). Per restaurant: business-day weather and the comparable day last year: rain flag, thunderstorm flag, high/low, precipitation amount, morning (5 to 11am) precipitation. Shown as context with the wording "may be a contributing context factor". |
| Weekly forecasting form | `/forecast`, `server/src/forecast.js`. All brief fields and calculated fields. Store to area to region rollup, missing/incomplete list, outlier flags. |
| Refresh and data timing | `server/src/refresh.js`. Scheduled daily (default 05:30), intraday every 15 min during operating hours (configurable, can be switched off), manual Refresh now button. Every run logged with per-step results. |
| Deployment | One Node process serves API + built frontend. Dockerfile, env config, persistent SQLite path. Not yet deployed to a host. |
| Data ingestion order | API or supported export first, then approved reporting access, then scheduled CSV/Excel. No scraping, no agent logging in to vendor sites. |
| Authentication and security | scrypt passwords, hashed session tokens in HttpOnly cookies, roles executive/region/area/store enforced in every query, audit log of sign-ins, imports, refreshes and errors, lockout on repeated failures. No hard-coded credentials. |
| Suggested data model | Tables `region`, `area`, `restaurant`, `daily_performance`, `guest_metrics`, `weather`, `forecast_submission` with the brief's column names. Additions: `manager_hours`, `actual_labor_cost`, `is_final`, `forecast_to_now` (live sales), `latitude/longitude`, `avg_hourly_rate`, `morning_precipitation`. |
| Initial hotspot logic | The three formulas exactly as written. Rank each, flag stores on multiple lists, show bottom 15% overall, filter by region, area, daypart, date. Severity labels: Critical, Needs review, Watch, Positive outlier. |
| Deferred items | Not built, as instructed: automated root-cause analysis, AI explanations, predictive modeling, scraping integrations, manager workflows beyond the form. |

## Decisions the brief left open

1. **No vendor access exists yet.** The brief calls data access "the main technical unknown". The app ships with a deterministic 120-restaurant demo source (4 regions, 12 areas) so every screen works now, and real data replaces it on first import. Rosnet's actual export column names are unknown, so the importer matches headers loosely and a template is provided.
2. **Hotspot overall list.** Rank sum of the three variance ranks; the worst 15% make the list. Any store with sales down 40%+ or a possible opening-time issue is always included. Critical = unusual drop, or sales down 8%+ together with labor 8%+ over. Watch = on a category list but not in the overall group. A store-level user's restaurant is ranked among its area.
3. **Prior-year comparison** uses the same weekday 52 weeks earlier (364 days), not the same calendar date, so weekends compare with weekends. Weather uses the same comparable day.
4. **Labor by daypart** does not exist in the source systems as described, so daypart views change sales only and say so on screen.
5. **Live day** compares sales so far with the share of the day's forecast earned by that hour; prior-year comparison is hidden until the day is final.
6. **Fiscal periods** are 4-week periods from a configurable fiscal-year start (setting `fiscal_year_start`, default 2025-12-29). Confirm the client's real calendar.
7. **Forecast form rules.** A reason is required whenever the manager's number differs from the system forecast by more than 0.5%. If the manager accepts the system number while the 4-week trend disagrees with it by more than 3%, the form refuses to submit without an explanation. Allowable hours come from a labor guide (settings `labor_guide_fixed_daily_hours`, `labor_guide_sales_per_hour`) unless Rosnet supplies them. Confirm the client's real labor guide.
8. **The earlier item-level analytics app** (top items, category mix, opportunity engine, notes) is outside the brief. Its code is parked in `server/legacy` and `client/legacy`, and is no longer part of the site.
9. **Stack** stays Express + node:sqlite + React/Vite/Recharts, as approved for the previous rebuild. The old "runs only on the client's computer" constraint is replaced by the brief's web-accessible preference.

## Open items for the client

- Which Rosnet and guest-platform export or API can be approved, and a sample file, to pin the importer's column mapping.
- The real region/area/store list with addresses (coordinates are geocoded from city and state).
- Fiscal calendar, labor guide, and whether 15% and the 40% / 8% thresholds suit them.
- Hosting choice and domain, then who gets which access level.
