# Star Tech Multi-Category Price & Stock History Tracker (GitHub Actions + Cloudflare Worker Edition)

An automated Python, GitHub Actions, and Cloudflare Worker (`worker.js`) system that scrapes **13 product categories** from [Star Tech Bangladesh](https://www.startech.com.bd/) once every day, tracking **both price changes and stock status transitions** over time while preserving **past and present history** directly in [`https://github.com/srtfile/startech`](https://github.com/srtfile/startech) and serving a live interactive dashboard on Cloudflare Workers (`*.workers.dev`).

📊 **[View Live Auto-Updated Markdown Dashboard → `TRACKER_DASHBOARD.md`](TRACKER_DASHBOARD.md)**

---

## 🌐 Cloudflare Worker Web Dashboard (`worker.js`)

The included [`worker.js`](worker.js) and [`wrangler.toml`](wrangler.toml) power a full Single-Page Web Application on Cloudflare Workers (`*.workers.dev`) linked directly to [`https://github.com/srtfile/startech`](https://github.com/srtfile/startech):

### ✨ Web App Features
- **Live GitHub Sync**: Automatically fetches the latest `startech_all_products.json` and `history/price_and_stock_changes.json` from `https://github.com/srtfile/startech` with Cloudflare Edge caching and a 1-click **"Sync GitHub"** button.
- **13-Category Interactive Explorer**: Filter by Category, Brand (with item counts), Stock Status (`In Stock`, `Out Of Stock`, `Upcoming`), Discounted Offers, Historical Price Changes, and Min/Max BDT Budget.
- **Past & Present Price Timeline Modal**: Click any product to view its **SVG Historical Price Trajectory Chart**, Current vs. Previous Price, **All-Time Lowest & Highest Prices**, Stock Status Transitions, and full technical specifications.
- **Chronological Price & Stock Feed**: Live feed of all recorded `PRICE_DROP`, `PRICE_INCREASE`, `RESTOCKED`, and `OUT_OF_STOCK` events.
- **Custom PC Builder & Quote Calculator**: Add components from any category to assemble a custom PC build, calculate total BDT cost in real time, and copy a formatted Markdown quote.

### 🚀 Deploying `worker.js` to Cloudflare (`*.workers.dev`)
1. **Option A — Cloudflare Dashboard (Connect GitHub or Paste Worker)**:
   - Go to **Cloudflare Dashboard → Workers & Pages → Create**.
   - Either connect your GitHub repository (`srtfile/startech`) or create a Worker and paste [`worker.js`](worker.js).
   - Because `srtfile/startech` is a **private** repository, go to your Worker's **Settings → Variables and Secrets** and add:
     - `GITHUB_TOKEN`: Your GitHub Personal Access Token (with `repo` or `contents:read` permission on `srtfile/startech`) so the Worker can read the live JSON files directly from your private repo!
2. **Option B — Wrangler CLI**:
   ```bash
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN
   ```

---

## 🧠 How Past & Present History Tracking Works

Every daily run compares the live Star Tech catalog against the persistent history index (`history/product_history_index.json`) and records only meaningful transitions so the repository stays fast, clean, and compact:

1. **Per-Product Embedded Timeline (`price_history`)**:
   Every product inside `startech_<category>.json` and `history/product_history_index.json` maintains:
   - **Present State**: `current_price`, `regular_price`, `discount_bdt`, `stock_status`, `last_checked`
   - **Past State & Extremes**:
     - `previous_price` & `previous_stock_status`
     - `lowest_price` & `lowest_price_date` (All-time lowest recorded price)
     - `highest_price` & `highest_price_date` (All-time highest recorded price)
     - `first_seen` & `last_changed`
     - `price_history`: Chronological array of every price change or stock transition (`FIRST_SEEN`, `PRICE_DROP`, `PRICE_INCREASE`, `RESTOCKED`, `OUT_OF_STOCK`, `STOCK_CHANGE`).
2. **Cumulative Event Ledger (`history/price_and_stock_changes.json` & `.csv`)**:
   Every price drop, price increase, restock, or out-of-stock transition across all 13 categories is logged with exact timestamps, old vs. new price, BDT/percentage difference, old vs. new stock status, and product URL.
3. **Daily Macro Metrics (`history/daily_runs_log.csv`)**:
   Tracks daily macro statistics (total products, in-stock count, out-of-stock count, daily price drops, price increases, and stock transitions).

---

## 📂 Tracked Categories (13 Categories)

| Category Key (`-c`) | Category Name | Star Tech URL | Category Files |
|---|---|---|---|
| `laptop` | Laptop | `https://www.startech.com.bd/laptop-notebook/laptop` | `startech_laptops.json` / `.csv` |
| `processor` | Processor | `https://www.startech.com.bd/component/processor` | `startech_processor.json` / `.csv` |
| `cpu-cooler` | CPU Cooler | `https://www.startech.com.bd/component/CPU-Cooler` | `startech_cpu_cooler.json` / `.csv` |
| `motherboard` | Motherboard | `https://www.startech.com.bd/component/motherboard` | `startech_motherboard.json` / `.csv` |
| `graphics-card` | Graphics Card | `https://www.startech.com.bd/component/graphics-card` | `startech_graphics_card.json` / `.csv` |
| `ram` | Desktop RAM | `https://www.startech.com.bd/component/ram` | `startech_ram.json` / `.csv` |
| `laptop-ram` | Laptop RAM | `https://www.startech.com.bd/component/laptop-ram` | `startech_laptop_ram.json` / `.csv` |
| `power-supply` | Power Supply | `https://www.startech.com.bd/component/power-supply` | `startech_power_supply.json` / `.csv` |
| `hard-disk-drive` | Hard Disk Drive | `https://www.startech.com.bd/component/hard-disk-drive` | `startech_hard_disk_drive.json` / `.csv` |
| `ssd` | SSD | `https://www.startech.com.bd/ssd` | `startech_ssd.json` / `.csv` |
| `casing` | Casing | `https://www.startech.com.bd/component/casing` | `startech_casing.json` / `.csv` |
| `monitor` | Monitor | `https://www.startech.com.bd/monitor` | `startech_monitor.json` / `.csv` |
| `desktops` | Desktop PC | `https://www.startech.com.bd/desktops` | `startech_desktops.json` / `.csv` |
| `all` *(Master)* | All Categories | *Combined across all scanned categories* | `startech_all_products.json` / `.csv` |
