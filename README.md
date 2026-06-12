# IHOP Sales Analytics Dashboard

Analytics on what sells: top items, revenue trends, category mix, dayparts, plus Excel uploads and staff input logging. Currently running on mock data — see PLAN.md for the roadmap.

## Requirements
Node.js 22.5 or newer (uses Node's built-in SQLite — no database install needed).

## Run the website (single URL)

```bash
# one-time setup
cd client && npm install && npm run build
cd ../server && npm install && npm run seed

# start it (from server/)
npm start
```

Open **http://localhost:4000** — the whole site (dashboard + API) is served there.
On the same Wi-Fi network, other devices can reach it at `http://<your-pc-ip>:4000`.

After changing frontend code, rebuild: `cd client && npm run build`.

## Dev mode (optional, hot reload)
```bash
cd server && npm start          # API on :4000
cd client && npm run dev        # UI on :5173 with live reload
```

## Troubleshooting
If `npm install` errors about node_modules, delete that `node_modules` folder and rerun — leftovers from the initial scaffold.

## Switching to real data
1. On the **Upload Data** tab, download the Excel template.
2. Export sales from the POS into that column format (Date, Time, Item, Category, Quantity, Unit Price, Total, Payment Method).
3. Upload the file. To clear mock data first:
   `sqlite3 server/ihop.db "DELETE FROM sales WHERE source='seed'"`
