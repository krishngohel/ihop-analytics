# IHOP Sales Analytics Dashboard — Project Plan

**Date:** 2026-06-11 · **Owner:** Krishn · **Status:** In development

## Goal
Give an IHOP franchise location clear analytics on **what sells**: which menu items drive revenue, when sales happen, and how money flows — fed by Excel exports from the POS (mock data until real exports arrive).

## Core Questions the Dashboard Answers
1. What are the top-selling items by revenue and by quantity?
2. How is revenue trending day over day / week over week?
3. Which menu categories (pancakes, combos, omelettes, beverages, sides, kids) earn the most?
4. Which dayparts (breakfast, lunch, dinner, late night) perform best?
5. What's the average ticket and order count over time?
6. What did staff observe? (manual notes/inputs: promos, waste, events)

## Architecture
```
ihop-analytics/
├── PLAN.md
├── README.md
├── server/          Node + Express + better-sqlite3
│   ├── src/index.js        API server (port 4000)
│   ├── src/db.js           SQLite schema + connection
│   ├── src/seed.js         Mock POS data generator (~90 days)
│   └── src/routes/         upload, analytics, entries
└── client/          Vite + React + Recharts (port 5173)
    └── src/                Dashboard, Upload, Manual Entry
```

- **Frontend:** React (Vite), Recharts for charts, fetch to REST API
- **Backend:** Express; `xlsx` (SheetJS) parses uploaded Excel files; `multer` handles uploads
- **DB:** SQLite (file-based, zero setup, fine for one location; can swap to Postgres if multi-store later)

## Data Model
**sales** — one row per line item sold
| column | type | notes |
|---|---|---|
| id | integer pk | |
| sold_at | text (ISO datetime) | from POS |
| item | text | e.g. "Original Buttermilk Pancakes" |
| category | text | Pancakes, Combos, Omelettes, Burgers & Sandwiches, Beverages, Sides, Kids |
| quantity | integer | |
| unit_price | real | |
| total | real | quantity × unit_price |
| payment_method | text | card / cash / mobile |
| source | text | 'seed', 'upload', 'manual' |

**entries** — manual user inputs (staff observations)
| column | type |
|---|---|
| id, created_at, entry_date, type (note/promo/waste/event), text, amount (optional $) |

## Excel Upload Format (template provided)
Columns expected, first sheet, header row:
`Date | Time | Item | Category | Quantity | Unit Price | Total | Payment Method`
Parser is forgiving: computes Total if missing, skips blank rows, reports rows it couldn't parse.

## API
- `GET /api/summary?from&to` — revenue, orders, avg ticket, top item
- `GET /api/revenue-trend?from&to` — daily revenue + order counts
- `GET /api/top-items?by=revenue|quantity&limit=10`
- `GET /api/categories` — revenue share by category
- `GET /api/dayparts` — revenue by daypart
- `POST /api/upload` — Excel file → parsed into sales
- `GET/POST /api/entries` — manual staff inputs
- `GET /api/template` — downloads the Excel template

## Dashboard Pages
1. **Dashboard** — KPI cards (revenue, orders, avg ticket, top seller), revenue trend line, top-10 items bar, category pie, daypart bars; date-range filter
2. **Upload Data** — drop an .xlsx, see import results; template download link
3. **Staff Inputs** — form to log notes/promos/waste; recent entries list

## Reports Feature (added M1.5)
**Goal:** one-click business report for any period, readable by a non-analyst, printable from the browser.

**Trigger:** Reports tab → pick period (This week / Last week / This month / Last month / Custom) → Generate.

**Comparison logic:** every metric is compared against the *prior period of equal length* (e.g. a 7-day report compares to the 7 days before it).

**Report sections:**
1. Header — store name, period, generated date
2. Highlights — auto-written sentences (rule-based, no AI dependency):
   revenue vs prior period, fastest-growing item, biggest decliner, best/slowest day, dominant daypart, weekend vs weekday, avg ticket shift
3. KPI table — revenue, orders, avg ticket, units vs prior period with % change
4. Top 10 items — revenue, quantity, % change vs prior period
5. Declining items — items down >15% vs prior period (worth attention)
6. Category breakdown with % change
7. Daypart breakdown with % change
8. Staff observations logged during the period (context for anomalies)

**API:** `GET /api/report?from&to` → single JSON payload with all of the above (server/src/report.js, mounted in index.js).

**Print:** Print button uses browser print; print CSS hides nav/controls so the page doubles as a PDF (Ctrl+P → Save as PDF).

## Milestones
- **M1 (now):** Working app with mock data — all of the above
- **M2:** Replace mock with first real Excel export; tune parser to actual POS columns
- **M3:** Week-over-week comparisons, item-level drilldown, export reports
- **M4 (optional):** Auth, multi-store support, Postgres

## Running It
```
cd server && npm install && npm run seed && npm start   # API on :4000
cd client && npm install && npm run dev                  # UI on :5173
```
