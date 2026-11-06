/**
 * ============================================================================
 * Star Tech Bangladesh — Live Price & Stock History Tracker (Cloudflare Worker)
 * ============================================================================
 * Repository : https://github.com/srtfile/startech
 * Deployment : Cloudflare Workers (*.workers.dev)
 *
 * Features:
 * - Automatically fetches live & historical JSON data directly from
 *   https://github.com/srtfile/startech (supports both Private & Public repos).
 * - Built-in Cloudflare Edge Cache with instant manual Sync/Refresh.
 * - Full 13-Category Explorer (Laptop, Processor, CPU Cooler, Motherboard,
 *   Graphics Card, RAM, Laptop RAM, Power Supply, HDD, SSD, Casing, Monitor, Desktop PC).
 * - Past & Present Price Timeline Modal with interactive SVG price chart,
 *   All-Time Low/High badges, and Stock Status Transition badges.
 * - Live Price Drops & Stock Changes Activity Feed.
 * - Interactive PC Builder & Budget Estimator with 1-click Markdown/CSV export.
 * ============================================================================
 */

const GITHUB_OWNER = "srtfile";
const GITHUB_REPO = "startech";
const GITHUB_BRANCH = "main";
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;

const CATEGORY_FILES = {
  all: { name: "All Categories", file: "startech_all_products.json", icon: "🌐" },
  laptop: { name: "Laptop", file: "startech_laptops.json", icon: "💻" },
  processor: { name: "Processor", file: "startech_processor.json", icon: "🧠" },
  "cpu-cooler": { name: "CPU Cooler", file: "startech_cpu_cooler.json", icon: "❄️" },
  motherboard: { name: "Motherboard", file: "startech_motherboard.json", icon: "🎛️" },
  "graphics-card": { name: "Graphics Card", file: "startech_graphics_card.json", icon: "🎮" },
  ram: { name: "Desktop RAM", file: "startech_ram.json", icon: "⚡" },
  "laptop-ram": { name: "Laptop RAM", file: "startech_laptop_ram.json", icon: "🔋" },
  "power-supply": { name: "Power Supply", file: "startech_power_supply.json", icon: "🔌" },
  "hard-disk-drive": { name: "Hard Disk Drive", file: "startech_hard_disk_drive.json", icon: "💿" },
  ssd: { name: "SSD", file: "startech_ssd.json", icon: "🚀" },
  casing: { name: "Casing", file: "startech_casing.json", icon: "🖥️" },
  monitor: { name: "Monitor", file: "startech_monitor.json", icon: "🖵" },
  desktops: { name: "Desktop PC", file: "startech_desktops.json", icon: "🏢" },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const forceRefresh = url.searchParams.get("refresh") === "1";

    try {
      // 1. API: Fetch category or master product catalog from GitHub
      if (path === "/api/catalog") {
        const cat = (url.searchParams.get("category") || "all").toLowerCase();
        const catMeta = CATEGORY_FILES[cat] || CATEGORY_FILES.all;
        const data = await fetchGitHubJson(catMeta.file, env, ctx, forceRefresh);
        return jsonResponse(data);
      }

      // 2. API: Fetch cumulative price & stock change events from GitHub
      if (path === "/api/changes") {
        try {
          const changes = await fetchGitHubJson(
            "history/price_and_stock_changes.json",
            env,
            ctx,
            forceRefresh
          );
          return jsonResponse(changes);
        } catch (err) {
          return jsonResponse({ last_updated: null, total_events: 0, events: [] });
        }
      }

      // 3. API: Fetch full product history index
      if (path === "/api/history-index") {
        const indexData = await fetchGitHubJson(
          "history/product_history_index.json",
          env,
          ctx,
          forceRefresh
        );
        return jsonResponse(indexData);
      }

      // 4. API: Health & Repo Metadata
      if (path === "/api/health") {
        return jsonResponse({
          status: "ok",
          repo: GITHUB_REPO_URL,
          branch: GITHUB_BRANCH,
          authenticated: Boolean(env && env.GITHUB_TOKEN),
          categories: Object.keys(CATEGORY_FILES),
          timestamp: new Date().toISOString(),
        });
      }

      // 5. Default: Serve the Interactive Web Application
      return new Response(renderAppHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=60",
          ...CORS_HEADERS,
        },
      });
    } catch (error) {
      return jsonResponse(
        {
          error: true,
          message: error.message || "Unexpected Worker Error",
          hint: "If https://github.com/srtfile/startech is private, set GITHUB_TOKEN in your Cloudflare Worker settings (Variables and Secrets).",
          repo: GITHUB_REPO_URL,
        },
        500
      );
    }
  },
};

/**
 * Fetches a JSON file from https://github.com/srtfile/startech
 * Works seamlessly with both Private repos (via env.GITHUB_TOKEN) and Public repos.
 */
async function fetchGitHubJson(filePath, env, ctx, forceRefresh = false) {
  const cache = caches.default;
  const cacheKey = new Request(`https://edge-cache.startech.local/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`);

  if (!forceRefresh) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return await cached.json();
    }
  }

  const token = (env && (env.GITHUB_TOKEN || env.GH_TOKEN)) || "";
  const headers = {
    "User-Agent": "StarTech-Cloudflare-Worker-Dashboard/2.0",
    Accept: "application/vnd.github.v3.raw",
  };

  let targetUrl;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    targetUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
  } else {
    targetUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;
  }

  let resp = await fetch(targetUrl, { headers });

  // Fallback to GitHub API even without token if raw.githubusercontent returned 404
  if (!resp.ok && !token) {
    const apiFallback = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
    resp = await fetch(apiFallback, { headers });
  }

  if (!resp.ok) {
    throw new Error(
      `GitHub fetch failed (${resp.status}) for '${filePath}'. Ensure the file exists in ${GITHUB_REPO_URL} and GITHUB_TOKEN is configured if the repository is private.`
    );
  }

  const text = await resp.text();
  const parsed = JSON.parse(text);

  const responseToCache = new Response(JSON.stringify(parsed), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });

  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
  }

  return parsed;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

/**
 * Generates the Single-Page Web Application HTML
 */
function renderAppHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Star Tech BD — Live Price & Stock History Tracker</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          },
          colors: {
            brand: {
              50: '#eef2ff',
              400: '#818cf8',
              500: '#6366f1',
              600: '#4f46e5',
            }
          }
        }
      }
    }
  </script>
  <style>
    :root {
      color-scheme: dark;
    }
    body {
      font-family: 'Inter', sans-serif;
      background: radial-gradient(circle at 15% 0%, rgba(99, 102, 241, 0.14), transparent 40%),
                  radial-gradient(circle at 85% 10%, rgba(16, 185, 129, 0.10), transparent 35%),
                  #090d16;
      color: #f1f5f9;
      min-height: 100vh;
    }
    html:not(.dark) body {
      background: radial-gradient(circle at 15% 0%, rgba(99, 102, 241, 0.08), transparent 40%),
                  #f8fafc;
      color: #0f172a;
    }
    .glass-card {
      background: rgba(17, 24, 39, 0.76);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    html:not(.dark) .glass-card {
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05);
    }
    .custom-scrollbar::-webkit-scrollbar {
      height: 6px;
      width: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.25);
      border-radius: 9999px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: rgba(148, 163, 184, 0.45);
    }
    @keyframes pulse-subtle {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }
    .animate-pulse-subtle {
      animation: pulse-subtle 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
  </style>
</head>
<body class="antialiased selection:bg-indigo-500 selection:text-white">

  <!-- Top Navigation Header -->
  <header class="sticky top-0 z-40 glass-card border-b border-slate-800/80">
    <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
      <!-- Brand Title -->
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-emerald-500 p-[1px] shadow-lg shadow-indigo-500/20">
          <div class="w-full h-full bg-slate-950 rounded-[11px] flex items-center justify-center text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 to-emerald-400">
            ST
          </div>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-base sm:text-lg font-bold tracking-tight">Star Tech Price & Stock Tracker</h1>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-subtle"></span>
              LIVE SYNC
            </span>
          </div>
          <p class="text-xs text-slate-400">
            Powered by GitHub Actions Daily Snapshots · <span id="lastExtractDate" class="font-mono text-slate-300">Loading snapshot...</span>
          </p>
        </div>
      </div>

      <!-- Right Action Buttons -->
      <div class="flex items-center gap-2 sm:gap-3">
        <!-- Main View Switcher -->
        <div class="inline-flex rounded-xl p-1 bg-slate-900/90 border border-slate-800 text-xs font-medium">
          <button onclick="switchMainTab('catalog')" id="tabBtn-catalog" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white shadow transition">
            🗂️ Catalog
          </button>
          <button onclick="switchMainTab('changes')" id="tabBtn-changes" class="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition flex items-center gap-1">
            📉 Price & Stock Feed
            <span id="changesBadge" class="hidden px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-mono">0</span>
          </button>
          <button onclick="switchMainTab('builder')" id="tabBtn-builder" class="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition flex items-center gap-1">
            ⚡ PC Builder
            <span id="builderCountBadge" class="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-500/30 text-indigo-300 font-mono">0</span>
          </button>
        </div>

        <!-- Refresh / Sync from GitHub -->
        <button onclick="refreshFromGitHub()" id="syncBtn" title="Pull latest commit data from GitHub"
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 transition">
          <svg id="syncIcon" class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="hidden sm:inline">Sync GitHub</span>
        </button>

        <!-- GitHub Repo Link -->
        <a href="${GITHUB_REPO_URL}" target="_blank" rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          <span class="hidden md:inline">srtfile/startech</span>
        </a>

        <!-- Theme Toggle -->
        <button onclick="toggleTheme()" class="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 transition" title="Toggle Dark/Light Mode">
          <span id="themeIcon">🌙</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Main Container -->
  <main class="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">

    <!-- Error / Setup Banner (Hidden unless error occurs) -->
    <div id="errorBanner" class="hidden rounded-2xl p-4 bg-rose-950/60 border border-rose-500/40 text-rose-200 text-sm"></div>

    <!-- Top KPI Summary Cards -->
    <section class="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
      <div class="glass-card rounded-2xl p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>TRACKED PRODUCTS</span>
          <span class="text-indigo-400">13 Categories</span>
        </div>
        <div id="kpiTotal" class="mt-2 text-2xl sm:text-3xl font-extrabold font-mono tracking-tight">—</div>
        <div id="kpiShowing" class="mt-1 text-xs text-slate-400">Loading catalog...</div>
      </div>

      <div class="glass-card rounded-2xl p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>IN STOCK STATUS</span>
          <span class="text-emerald-400">● Live</span>
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span id="kpiInStock" class="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-400">—</span>
          <span id="kpiOutStock" class="text-xs font-mono text-rose-400">0 Out</span>
        </div>
        <div class="mt-2 w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div id="kpiStockBar" class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500" style="width: 0%"></div>
        </div>
      </div>

      <div class="glass-card rounded-2xl p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>ON DISCOUNT NOW</span>
          <span class="text-amber-400">Instant Save</span>
        </div>
        <div id="kpiDiscountCount" class="mt-2 text-2xl sm:text-3xl font-extrabold font-mono text-amber-400">—</div>
        <div id="kpiMaxDiscount" class="mt-1 text-xs text-slate-400 truncate">Max Save: —</div>
      </div>

      <div class="glass-card rounded-2xl p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>PRICE RANGE (IN STOCK)</span>
          <span class="text-cyan-400">BDT ৳</span>
        </div>
        <div id="kpiPriceRange" class="mt-2 text-lg sm:text-xl font-bold font-mono text-cyan-300 truncate">—</div>
        <div id="kpiAvgPrice" class="mt-1 text-xs text-slate-400 font-mono">Avg: —</div>
      </div>

      <div class="glass-card rounded-2xl p-4 col-span-2 lg:col-span-1">
        <div class="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>PRICE / STOCK EVENTS</span>
          <span class="text-purple-400">History</span>
        </div>
        <div id="kpiEventsCount" class="mt-2 text-2xl sm:text-3xl font-extrabold font-mono text-purple-400">—</div>
        <div id="kpiEventsSub" class="mt-1 text-xs text-slate-400">Tracked transitions over time</div>
      </div>
    </section>

    <!-- ================================================================== -->
    <!-- TAB 1: PRODUCT CATALOG EXPLORER                                    -->
    <!-- ================================================================== -->
    <section id="tabContent-catalog" class="space-y-5">

      <!-- Category Pills Bar -->
      <div class="glass-card rounded-2xl p-2.5 overflow-x-auto custom-scrollbar">
        <div id="categoryPills" class="flex items-center gap-1.5 min-w-max"></div>
      </div>

      <!-- Filter & Search Control Bar -->
      <div class="glass-card rounded-2xl p-4 space-y-3.5">
        <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
          <!-- Search Input -->
          <div class="md:col-span-4 relative">
            <input id="searchInput" type="text" oninput="applyFilters()"
              placeholder="Search model, brand, specs (e.g. Ryzen 7, RTX 4060, DDR5)..."
              class="w-full pl-9 pr-8 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition" />
            <svg class="w-4 h-4 text-slate-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <button onclick="clearSearch()" id="clearSearchBtn" class="hidden absolute right-2.5 top-2.5 text-slate-400 hover:text-white text-xs px-1">✕</button>
          </div>

          <!-- Brand Filter -->
          <div class="md:col-span-2">
            <select id="brandSelect" onchange="applyFilters()"
              class="w-full px-3 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-sm focus:outline-none focus:border-indigo-500">
              <option value="all">All Brands</option>
            </select>
          </div>

          <!-- Stock Status Filter -->
          <div class="md:col-span-2">
            <select id="stockSelect" onchange="applyFilters()"
              class="w-full px-3 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-sm focus:outline-none focus:border-indigo-500">
              <option value="all">All Stock Status</option>
              <option value="In Stock">🟢 In Stock Only</option>
              <option value="Out Of Stock">🔴 Out of Stock</option>
              <option value="Upcoming">🟡 Upcoming</option>
            </select>
          </div>

          <!-- Min / Max Price Inputs -->
          <div class="md:col-span-2 flex items-center gap-1.5">
            <input id="minPriceInput" type="number" min="0" step="500" oninput="applyFilters()" placeholder="Min ৳"
              class="w-1/2 px-2.5 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs font-mono focus:outline-none focus:border-indigo-500" />
            <input id="maxPriceInput" type="number" min="0" step="500" oninput="applyFilters()" placeholder="Max ৳"
              class="w-1/2 px-2.5 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs font-mono focus:outline-none focus:border-indigo-500" />
          </div>

          <!-- Sort Order -->
          <div class="md:col-span-2">
            <select id="sortSelect" onchange="applyFilters()"
              class="w-full px-3 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-sm focus:outline-none focus:border-indigo-500">
              <option value="model-asc">Sort: Model (A → Z)</option>
              <option value="price-asc">Price: Low → High</option>
              <option value="price-desc">Price: High → Low</option>
              <option value="discount-desc">Biggest Discount (৳)</option>
              <option value="changed-desc">Recently Changed</option>
            </select>
          </div>
        </div>

        <!-- Secondary Filter Row -->
        <div class="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/60 text-xs">
          <div class="flex flex-wrap items-center gap-3">
            <label class="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-300">
              <input type="checkbox" id="discountedOnlyCheck" onchange="applyFilters()" class="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0" />
              <span>🔥 Discounted / Offer Items Only</span>
            </label>
            <label class="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-300">
              <input type="checkbox" id="priceChangedCheck" onchange="applyFilters()" class="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0" />
              <span>📉 Has Historical Price / Stock Changes</span>
            </label>
            <button onclick="resetAllFilters()" class="text-indigo-400 hover:text-indigo-300 underline">Reset Filters</button>
          </div>

          <div class="flex items-center gap-2">
            <span id="resultsCountLabel" class="text-slate-400 font-mono">0 items</span>
            <div class="inline-flex rounded-lg p-0.5 bg-slate-900 border border-slate-800">
              <button onclick="setLayoutMode('grid')" id="layoutBtn-grid" class="px-2.5 py-1 rounded-md bg-indigo-600 text-white">Grid</button>
              <button onclick="setLayoutMode('table')" id="layoutBtn-table" class="px-2.5 py-1 rounded-md text-slate-400 hover:text-white">Table</button>
            </div>
            <button onclick="exportFilteredCsv()" class="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-medium transition">
              ⬇ Export CSV
            </button>
          </div>
        </div>
      </div>

      <!-- Loading Skeleton -->
      <div id="loadingState" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="glass-card rounded-2xl p-5 h-72 animate-pulse"></div>
        <div class="glass-card rounded-2xl p-5 h-72 animate-pulse"></div>
        <div class="glass-card rounded-2xl p-5 h-72 animate-pulse"></div>
        <div class="glass-card rounded-2xl p-5 h-72 animate-pulse"></div>
      </div>

      <!-- Product Grid Container -->
      <div id="productGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"></div>

      <!-- Product Table Container -->
      <div id="productTableWrap" class="hidden glass-card rounded-2xl overflow-hidden">
        <div class="overflow-x-auto custom-scrollbar">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="border-b border-slate-800 text-xs uppercase text-slate-400 bg-slate-900/60">
                <th class="py-3 px-4">Product / Model</th>
                <th class="py-3 px-3">Category</th>
                <th class="py-3 px-3">Brand</th>
                <th class="py-3 px-3 text-right">Current Price</th>
                <th class="py-3 px-3 text-right">All-Time Low / High</th>
                <th class="py-3 px-3 text-center">Stock Status</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="productTableBody" class="divide-y divide-slate-800/60"></tbody>
          </table>
        </div>
      </div>

      <!-- Pagination Controls -->
      <div id="paginationBar" class="flex flex-wrap items-center justify-between gap-4 pt-2"></div>
    </section>

    <!-- ================================================================== -->
    <!-- TAB 2: PRICE DROPS & STOCK STATUS FEED                             -->
    <!-- ================================================================== -->
    <section id="tabContent-changes" class="hidden space-y-5">
      <div class="glass-card rounded-2xl p-5">
        <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 class="text-lg font-bold">📉 Chronological Price Changes & Stock Status Feed</h2>
            <p class="text-xs text-slate-400">
              Automatically logged whenever GitHub Actions detects a price drop, price increase, restock, or out-of-stock transition.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <select id="eventFilterSelect" onchange="renderChangesFeed()"
              class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs">
              <option value="all">All Event Types</option>
              <option value="PRICE_DROP">🟢 Price Drops Only</option>
              <option value="PRICE_INCREASE">🔴 Price Increases Only</option>
              <option value="RESTOCKED">📦 Restocked Only</option>
              <option value="OUT_OF_STOCK">⚠️ Out of Stock Only</option>
            </select>
          </div>
        </div>

        <div id="changesFeedContainer" class="space-y-3"></div>
      </div>
    </section>

    <!-- ================================================================== -->
    <!-- TAB 3: INTERACTIVE PC BUILDER & BUDGET CALCULATOR                  -->
    <!-- ================================================================== -->
    <section id="tabContent-builder" class="hidden space-y-5">
      <div class="glass-card rounded-2xl p-5">
        <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 class="text-lg font-bold">⚡ Custom PC Builder & Live Quote Estimator</h2>
            <p class="text-xs text-slate-400">
              Select components from the catalog using the <span class="text-indigo-400 font-semibold">"+ Build"</span> button on any product card to calculate your total build cost.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <div class="text-xs text-slate-400">ESTIMATED BUILD TOTAL</div>
              <div id="builderTotalPrice" class="text-2xl font-extrabold font-mono text-emerald-400">৳0</div>
            </div>
            <button onclick="copyBuildQuote()" class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition">
              📋 Copy Markdown Quote
            </button>
            <button onclick="clearBuild()" class="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition">
              Clear
            </button>
          </div>
        </div>

        <div id="builderListContainer" class="mt-4 space-y-2.5"></div>
      </div>
    </section>

  </main>

  <!-- ==================================================================== -->
  <!-- PRODUCT PRICE & STOCK TIMELINE MODAL                                 -->
  <!-- ==================================================================== -->
  <div id="historyModal" class="fixed inset-0 z-50 hidden items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
    <div class="glass-card rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar border border-slate-700 shadow-2xl p-6 space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div id="modalCategoryBadge" class="text-xs font-mono uppercase text-indigo-400"></div>
          <h3 id="modalTitle" class="text-lg sm:text-xl font-bold mt-0.5"></h3>
          <p id="modalMeta" class="text-xs text-slate-400 font-mono mt-1"></p>
        </div>
        <button onclick="closeHistoryModal()" class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300">✕</button>
      </div>

      <!-- Past & Present Price Cards -->
      <div id="modalStatsGrid" class="grid grid-cols-2 sm:grid-cols-4 gap-3"></div>

      <!-- SVG Price History Chart -->
      <div class="rounded-xl bg-slate-900/90 border border-slate-800 p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span class="font-semibold text-slate-300">📈 Historical Price Trajectory (Past → Present)</span>
          <span id="modalHistoryCount" class="font-mono"></span>
        </div>
        <div id="modalChartBox" class="w-full h-40"></div>
      </div>

      <!-- Chronological Price & Stock Event Table -->
      <div>
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">🕒 Recorded Price & Stock Status Timeline</h4>
        <div class="rounded-xl border border-slate-800 overflow-hidden">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-900 text-slate-400 uppercase">
              <tr>
                <th class="py-2.5 px-3">Date / Snapshot</th>
                <th class="py-2.5 px-3">Event</th>
                <th class="py-2.5 px-3 text-right">Recorded Price</th>
                <th class="py-2.5 px-3 text-right">Regular Price</th>
                <th class="py-2.5 px-3 text-center">Stock Status</th>
              </tr>
            </thead>
            <tbody id="modalTimelineBody" class="divide-y divide-slate-800/70 font-mono"></tbody>
          </table>
        </div>
      </div>

      <!-- Technical Specifications -->
      <div>
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">🔧 Technical Specifications</h4>
        <div id="modalSpecsBox" class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs"></div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
        <a id="modalProductUrl" href="#" target="_blank" rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition">
          🔗 Open on Star Tech BD ↗
        </a>
        <button onclick="closeHistoryModal()" class="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300">
          Close
        </button>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <footer class="max-w-[1440px] mx-auto px-4 sm:px-6 py-8 mt-8 border-t border-slate-800/70 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-4">
    <div>
      Star Tech Bangladesh Automated Price & Stock Tracker · Live Edge Dashboard
    </div>
    <div class="flex items-center gap-4">
      <a href="${GITHUB_REPO_URL}" target="_blank" class="hover:text-indigo-400 transition">GitHub Repository (srtfile/startech)</a>
      <span>·</span>
      <a href="/api/catalog" target="_blank" class="hover:text-indigo-400 transition font-mono">JSON API</a>
      <span>·</span>
      <a href="/api/changes" target="_blank" class="hover:text-indigo-400 transition font-mono">Changes API</a>
    </div>
  </footer>

  <!-- Application Script -->
  <script>
    const CATEGORIES = ${JSON.stringify(CATEGORY_FILES)};

    let allProducts = [];
    let filteredProducts = [];
    let changeEvents = [];
    let activeCategory = 'all';
    let layoutMode = 'grid';
    let currentPage = 1;
    const pageSize = 24;
    let pcBuild = JSON.parse(localStorage.getItem('startech_pc_build') || '[]');

    function formatBDT(num) {
      if (!num || num <= 0) return 'TBA / Out';
      return '৳' + Number(num).toLocaleString('en-IN');
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    async function loadDashboardData(forceRefresh = false) {
      const syncIcon = document.getElementById('syncIcon');
      if (syncIcon) syncIcon.classList.add('animate-spin');
      document.getElementById('errorBanner').classList.add('hidden');

      try {
        const q = forceRefresh ? '&refresh=1' : '';
        const [catalogResp, changesResp] = await Promise.all([
          fetch('/api/catalog?category=all' + q),
          fetch('/api/changes?' + q.replace('&', ''))
        ]);

        const catalogData = await catalogResp.json();
        if (catalogData.error) {
          throw new Error(catalogData.message + (catalogData.hint ? ' — ' + catalogData.hint : ''));
        }

        allProducts = catalogData.products || catalogData.laptops || [];
        document.getElementById('lastExtractDate').textContent = catalogData['extract-date'] || 'Synced';

        const changesData = await changesResp.json();
        changeEvents = (changesData && changesData.events) ? changesData.events : [];

        buildSyntheticEventsIfEmpty();
        renderCategoryPills();
        populateBrandsDropdown();
        applyFilters();
        renderChangesFeed();
        renderBuilder();
        document.getElementById('loadingState').classList.add('hidden');
      } catch (err) {
        document.getElementById('loadingState').classList.add('hidden');
        const banner = document.getElementById('errorBanner');
        banner.classList.remove('hidden');
        banner.innerHTML = '<strong>⚠️ Connection Notice:</strong> ' + escapeHtml(err.message);
      } finally {
        if (syncIcon) syncIcon.classList.remove('animate-spin');
      }
    }

    // Also derive transitions from embedded product price_history if events file is empty
    function buildSyntheticEventsIfEmpty() {
      const badge = document.getElementById('changesBadge');
      if (changeEvents.length > 0) {
        badge.textContent = changeEvents.length;
        badge.classList.remove('hidden');
      }
      document.getElementById('kpiEventsCount').textContent = changeEvents.length.toLocaleString();
    }

    function renderCategoryPills() {
      const container = document.getElementById('categoryPills');
      const counts = { all: allProducts.length };
      for (const p of allProducts) {
        const c = p.category || 'laptop';
        counts[c] = (counts[c] || 0) + 1;
      }

      container.innerHTML = Object.entries(CATEGORIES).map(([key, meta]) => {
        const count = counts[key] || 0;
        const active = activeCategory === key;
        const cls = active
          ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-500/20'
          : 'bg-slate-900/70 hover:bg-slate-800 text-slate-300 border-slate-800';
        return \`
          <button onclick="selectCategory('\${key}')"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 \${cls}">
            <span>\${meta.icon}</span>
            <span>\${meta.name}</span>
            <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono \${active ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-800 text-slate-400'}">\${count}</span>
          </button>
        \`;
      }).join('');
    }

    function selectCategory(catKey) {
      activeCategory = catKey;
      currentPage = 1;
      renderCategoryPills();
      populateBrandsDropdown();
      applyFilters();
    }

    function populateBrandsDropdown() {
      const select = document.getElementById('brandSelect');
      const currentVal = select.value;
      const subset = activeCategory === 'all'
        ? allProducts
        : allProducts.filter(p => (p.category || 'laptop') === activeCategory);

      const brandCounts = {};
      for (const p of subset) {
        const b = p.brand || 'Other';
        brandCounts[b] = (brandCounts[b] || 0) + 1;
      }

      const sortedBrands = Object.keys(brandCounts).sort((a, b) => a.localeCompare(b));
      select.innerHTML = '<option value="all">All Brands (' + sortedBrands.length + ')</option>' +
        sortedBrands.map(b => \`<option value="\${escapeHtml(b)}">\${escapeHtml(b)} (\${brandCounts[b]})</option>\`).join('');

      if (sortedBrands.includes(currentVal)) {
        select.value = currentVal;
      }
    }

    function applyFilters() {
      const q = document.getElementById('searchInput').value.trim().toLowerCase();
      document.getElementById('clearSearchBtn').classList.toggle('hidden', !q);

      const brand = document.getElementById('brandSelect').value;
      const stock = document.getElementById('stockSelect').value;
      const minP = Number(document.getElementById('minPriceInput').value) || 0;
      const maxP = Number(document.getElementById('maxPriceInput').value) || 0;
      const sortBy = document.getElementById('sortSelect').value;
      const discountedOnly = document.getElementById('discountedOnlyCheck').checked;
      const changedOnly = document.getElementById('priceChangedCheck').checked;

      filteredProducts = allProducts.filter(item => {
        const itemCat = item.category || 'laptop';
        if (activeCategory !== 'all' && itemCat !== activeCategory) return false;
        if (brand !== 'all' && item.brand !== brand) return false;
        if (stock !== 'all' && item.stock_status !== stock) return false;

        const price = item.current_price || 0;
        if (minP > 0 && price < minP) return false;
        if (maxP > 0 && (price > maxP || price === 0)) return false;
        if (discountedOnly && (item.discount_bdt || 0) <= 0) return false;

        if (changedOnly) {
          const histLen = (item.price_history && item.price_history.length) || 0;
          const hasDiff = (item.previous_price && item.previous_price !== item.current_price) ||
                          (item.previous_stock_status && item.previous_stock_status !== item.stock_status);
          if (histLen <= 1 && !hasDiff) return false;
        }

        if (q) {
          const hay = \`\${item.title} \${item.model} \${item.brand} \${item.specs_summary} \${item.category}\`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      filteredProducts.sort((a, b) => {
        if (sortBy === 'price-asc') {
          const pa = a.current_price > 0 ? a.current_price : Number.MAX_SAFE_INTEGER;
          const pb = b.current_price > 0 ? b.current_price : Number.MAX_SAFE_INTEGER;
          return pa - pb;
        }
        if (sortBy === 'price-desc') {
          return (b.current_price || 0) - (a.current_price || 0);
        }
        if (sortBy === 'discount-desc') {
          return (b.discount_bdt || 0) - (a.discount_bdt || 0);
        }
        if (sortBy === 'changed-desc') {
          return ((b.price_history && b.price_history.length) || 0) - ((a.price_history && a.price_history.length) || 0);
        }
        return String(a.model || '').localeCompare(String(b.model || ''));
      });

      currentPage = 1;
      updateKpis();
      renderProducts();
    }

    function updateKpis() {
      const total = filteredProducts.length;
      const inStockItems = filteredProducts.filter(x => x.stock_status === 'In Stock');
      const outItems = total - inStockItems.length;
      const stockPct = total > 0 ? Math.round((inStockItems.length / total) * 100) : 0;

      document.getElementById('kpiTotal').textContent = total.toLocaleString();
      document.getElementById('kpiShowing').textContent =
        activeCategory === 'all' ? \`Across all \${allProducts.length.toLocaleString()} catalog items\` : \`Category: \${CATEGORIES[activeCategory]?.name}\`;

      document.getElementById('kpiInStock').textContent = inStockItems.length.toLocaleString();
      document.getElementById('kpiOutStock').textContent = \`\${outItems.toLocaleString()} Out/Upc\`;
      document.getElementById('kpiStockBar').style.width = stockPct + '%';

      const discounted = filteredProducts.filter(x => (x.discount_bdt || 0) > 0);
      const maxSave = discounted.reduce((m, x) => Math.max(m, x.discount_bdt || 0), 0);
      document.getElementById('kpiDiscountCount').textContent = discounted.length.toLocaleString();
      document.getElementById('kpiMaxDiscount').textContent = maxSave > 0 ? \`Max Save: ৳\${maxSave.toLocaleString('en-IN')}\` : 'Standard retail pricing';

      const posPrices = inStockItems.map(x => x.current_price).filter(p => p > 0);
      if (posPrices.length > 0) {
        const minP = Math.min(...posPrices);
        const maxP = Math.max(...posPrices);
        const avgP = Math.round(posPrices.reduce((s, v) => s + v, 0) / posPrices.length);
        document.getElementById('kpiPriceRange').textContent = \`৳\${minP.toLocaleString('en-IN')} – ৳\${maxP.toLocaleString('en-IN')}\`;
        document.getElementById('kpiAvgPrice').textContent = \`Avg: ৳\${avgP.toLocaleString('en-IN')}\`;
      } else {
        document.getElementById('kpiPriceRange').textContent = 'N/A';
        document.getElementById('kpiAvgPrice').textContent = 'Avg: N/A';
      }

      document.getElementById('resultsCountLabel').textContent = \`\${total.toLocaleString()} products\`;
    }

    function renderProducts() {
      const grid = document.getElementById('productGrid');
      const tableWrap = document.getElementById('productTableWrap');
      const tableBody = document.getElementById('productTableBody');

      const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
      if (currentPage > totalPages) currentPage = totalPages;

      const start = (currentPage - 1) * pageSize;
      const slice = filteredProducts.slice(start, start + pageSize);

      if (layoutMode === 'grid') {
        grid.classList.remove('hidden');
        tableWrap.classList.add('hidden');

        if (slice.length === 0) {
          grid.innerHTML = \`
            <div class="col-span-full glass-card rounded-2xl p-12 text-center text-slate-400">
              No matching products found. Try adjusting your search or filters.
            </div>\`;
        } else {
          grid.innerHTML = slice.map(item => renderProductCard(item)).join('');
        }
      } else {
        grid.classList.add('hidden');
        tableWrap.classList.remove('hidden');
        tableBody.innerHTML = slice.map(item => renderProductRow(item)).join('');
      }

      renderPagination(totalPages);
    }

    function renderProductCard(item) {
      const catMeta = CATEGORIES[item.category] || CATEGORIES.laptop;
      const isInStock = item.stock_status === 'In Stock';
      const stockBadge = isInStock
        ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">In Stock</span>'
        : \`<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">\${escapeHtml(item.stock_status)}</span>\`;

      const discountBadge = (item.discount_bdt || 0) > 0
        ? \`<span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">Save ৳\${item.discount_bdt.toLocaleString('en-IN')}</span>\`
        : '';

      const lowPrice = item.lowest_price || item.current_price || 0;
      const highPrice = item.highest_price || item.current_price || 0;

      return \`
        <div class="glass-card rounded-2xl p-4 flex flex-col justify-between hover:border-indigo-500/50 transition group">
          <div>
            <!-- Top Row: Category + Stock + Discount -->
            <div class="flex items-center justify-between gap-2 mb-3">
              <span class="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <span>\${catMeta.icon}</span>
                <span>\${escapeHtml(catMeta.name)}</span>
              </span>
              <div class="flex items-center gap-1.5">
                \${discountBadge}
                \${stockBadge}
              </div>
            </div>

            <!-- Image & Title -->
            <div class="flex items-start gap-3">
              \${item.image_url ? \`
                <img src="\${escapeHtml(item.image_url)}" alt="\${escapeHtml(item.model)}" loading="lazy"
                  class="w-16 h-16 rounded-xl object-contain bg-white p-1 shrink-0 border border-slate-800" />
              \` : ''}
              <div class="min-w-0">
                <div class="text-[11px] font-mono text-indigo-400 truncate">\${escapeHtml(item.brand)} · \${escapeHtml(item.model)}</div>
                <h3 onclick="openHistoryModal('\${escapeHtml(item.product_id)}')"
                  class="text-sm font-semibold leading-snug line-clamp-2 mt-0.5 cursor-pointer group-hover:text-indigo-300 transition">
                  \${escapeHtml(item.title)}
                </h3>
              </div>
            </div>

            <!-- Key Specs Preview -->
            <div class="mt-3 text-xs text-slate-400 line-clamp-2 bg-slate-900/50 rounded-xl p-2.5 border border-slate-800/60">
              \${escapeHtml(item.specs_summary || 'Standard specifications')}
            </div>
          </div>

          <!-- Pricing & Action Footer -->
          <div class="mt-4 pt-3 border-t border-slate-800/80 space-y-2.5">
            <div class="flex items-baseline justify-between">
              <div>
                <div class="text-lg font-extrabold font-mono text-white">
                  \${formatBDT(item.current_price)}
                </div>
                \${(item.regular_price > item.current_price && item.current_price > 0) ? \`
                  <div class="text-[11px] font-mono text-slate-500 line-through">Regular: ৳\${item.regular_price.toLocaleString('en-IN')}</div>
                \` : \`
                  <div class="text-[11px] font-mono text-slate-400">Low: \${formatBDT(lowPrice)} · High: \${formatBDT(highPrice)}</div>
                \`}
              </div>
              <button onclick="openHistoryModal('\${escapeHtml(item.product_id)}')"
                class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white transition">
                📈 History
              </button>
            </div>

            <div class="flex items-center gap-2">
              <button onclick="addToBuild('\${escapeHtml(item.product_id)}')"
                class="flex-1 py-1.5 px-2.5 rounded-xl text-xs font-semibold bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition">
                + Add to Build
              </button>
              <a href="\${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"
                class="py-1.5 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition">
                Star Tech ↗
              </a>
            </div>
          </div>
        </div>
      \`;
    }

    function renderProductRow(item) {
      const catMeta = CATEGORIES[item.category] || CATEGORIES.laptop;
      const isInStock = item.stock_status === 'In Stock';
      return \`
        <tr class="hover:bg-slate-900/40 transition">
          <td class="py-3 px-4">
            <div class="font-semibold text-slate-200 cursor-pointer hover:text-indigo-400" onclick="openHistoryModal('\${escapeHtml(item.product_id)}')">
              \${escapeHtml(item.title)}
            </div>
            <div class="text-xs font-mono text-slate-400">Model: \${escapeHtml(item.model)} · ID: \${escapeHtml(item.product_id)}</div>
          </td>
          <td class="py-3 px-3 text-xs whitespace-nowrap">\${catMeta.icon} \${escapeHtml(catMeta.name)}</td>
          <td class="py-3 px-3 text-xs font-medium">\${escapeHtml(item.brand)}</td>
          <td class="py-3 px-3 text-right font-mono font-bold">\${formatBDT(item.current_price)}</td>
          <td class="py-3 px-3 text-right font-mono text-xs text-slate-400">
            \${formatBDT(item.lowest_price || item.current_price)} / \${formatBDT(item.highest_price || item.current_price)}
          </td>
          <td class="py-3 px-3 text-center">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold \${isInStock ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">
              \${escapeHtml(item.stock_status)}
            </span>
          </td>
          <td class="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
            <button onclick="openHistoryModal('\${escapeHtml(item.product_id)}')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-indigo-600 text-xs">📈 History</button>
            <button onclick="addToBuild('\${escapeHtml(item.product_id)}')" class="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 text-xs">+ Build</button>
          </td>
        </tr>
      \`;
    }

    function renderPagination(totalPages) {
      const bar = document.getElementById('paginationBar');
      if (totalPages <= 1) {
        bar.innerHTML = '';
        return;
      }

      bar.innerHTML = \`
        <div class="text-xs text-slate-400 font-mono">
          Page \${currentPage} of \${totalPages} (\${filteredProducts.length.toLocaleString()} items)
        </div>
        <div class="flex items-center gap-1.5">
          <button onclick="goToPage(1)" \${currentPage === 1 ? 'disabled' : ''}
            class="px-3 py-1.5 rounded-xl text-xs bg-slate-900 border border-slate-800 disabled:opacity-40">« First</button>
          <button onclick="goToPage(\${currentPage - 1})" \${currentPage === 1 ? 'disabled' : ''}
            class="px-3 py-1.5 rounded-xl text-xs bg-slate-900 border border-slate-800 disabled:opacity-40">‹ Prev</button>
          <button onclick="goToPage(\${currentPage + 1})" \${currentPage === totalPages ? 'disabled' : ''}
            class="px-3 py-1.5 rounded-xl text-xs bg-slate-900 border border-slate-800 disabled:opacity-40">Next ›</button>
          <button onclick="goToPage(\${totalPages})" \${currentPage === totalPages ? 'disabled' : ''}
            class="px-3 py-1.5 rounded-xl text-xs bg-slate-900 border border-slate-800 disabled:opacity-40">Last »</button>
        </div>
      \`;
    }

    function goToPage(p) {
      currentPage = p;
      renderProducts();
      window.scrollTo({ top: 180, behavior: 'smooth' });
    }

    // =========================================================================
    // PRODUCT HISTORY MODAL (PAST & PRESENT TIMELINE + SVG CHART)
    // =========================================================================
    function openHistoryModal(productId) {
      const item = allProducts.find(p => String(p.product_id) === String(productId));
      if (!item) return;

      const catMeta = CATEGORIES[item.category] || CATEGORIES.laptop;
      document.getElementById('modalCategoryBadge').textContent = \`\${catMeta.icon} \${catMeta.name} · Brand: \${item.brand}\`;
      document.getElementById('modalTitle').textContent = item.title;
      document.getElementById('modalMeta').textContent = \`Model: \${item.model} | Product ID: \${item.product_id} | First Tracked: \${item.first_seen || item['extract-date']}\`;
      document.getElementById('modalProductUrl').href = item.url || '#';

      const curP = item.current_price || 0;
      const prevP = item.previous_price || curP;
      const lowP = item.lowest_price || curP;
      const highP = item.highest_price || curP;

      document.getElementById('modalStatsGrid').innerHTML = \`
        <div class="rounded-xl bg-slate-900/90 border border-slate-800 p-3">
          <div class="text-[10px] uppercase text-slate-400">Current Price</div>
          <div class="text-lg font-extrabold font-mono text-white mt-0.5">\${formatBDT(curP)}</div>
          <div class="text-[11px] text-emerald-400">\${escapeHtml(item.stock_status)}</div>
        </div>
        <div class="rounded-xl bg-slate-900/90 border border-slate-800 p-3">
          <div class="text-[10px] uppercase text-slate-400">Previous Price</div>
          <div class="text-lg font-bold font-mono text-slate-300 mt-0.5">\${formatBDT(prevP)}</div>
          <div class="text-[11px] text-slate-400">Prev Stock: \${escapeHtml(item.previous_stock_status || item.stock_status)}</div>
        </div>
        <div class="rounded-xl bg-slate-900/90 border border-slate-800 p-3">
          <div class="text-[10px] uppercase text-emerald-400">All-Time Lowest</div>
          <div class="text-lg font-bold font-mono text-emerald-400 mt-0.5">\${formatBDT(lowP)}</div>
          <div class="text-[10px] text-slate-400 truncate">\${escapeHtml(item.lowest_price_date || item['extract-date'])}</div>
        </div>
        <div class="rounded-xl bg-slate-900/90 border border-slate-800 p-3">
          <div class="text-[10px] uppercase text-amber-400">All-Time Highest</div>
          <div class="text-lg font-bold font-mono text-amber-400 mt-0.5">\${formatBDT(highP)}</div>
          <div class="text-[10px] text-slate-400 truncate">\${escapeHtml(item.highest_price_date || item['extract-date'])}</div>
        </div>
      \`;

      const history = (item.price_history && item.price_history.length > 0)
        ? item.price_history
        : [{
            date: item['extract-date'] || 'Initial',
            price: item.current_price || 0,
            regular_price: item.regular_price || 0,
            stock_status: item.stock_status || 'In Stock',
            event: 'INITIAL'
          }];

      document.getElementById('modalHistoryCount').textContent = \`\${history.length} snapshot(s)\`;
      renderSvgChart(history);

      document.getElementById('modalTimelineBody').innerHTML = [...history].reverse().map(h => \`
        <tr>
          <td class="py-2 px-3 text-slate-300">\${escapeHtml(h.timestamp || h.date)}</td>
          <td class="py-2 px-3">
            <span class="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] font-semibold">\${escapeHtml(h.event || 'SNAPSHOT')}</span>
          </td>
          <td class="py-2 px-3 text-right font-bold text-white">\${formatBDT(h.price)}</td>
          <td class="py-2 px-3 text-right text-slate-400">\${formatBDT(h.regular_price || h.price)}</td>
          <td class="py-2 px-3 text-center">
            <span class="px-2 py-0.5 rounded text-[10px] \${h.stock_status === 'In Stock' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">
              \${escapeHtml(h.stock_status)}
            </span>
          </td>
        </tr>
      \`).join('');

      const specs = item.specs || {};
      document.getElementById('modalSpecsBox').innerHTML = Object.entries(specs).map(([k, v]) => \`
        <div class="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5">
          <div class="text-[10px] uppercase text-slate-400 font-semibold">\${escapeHtml(k)}</div>
          <div class="text-slate-200 mt-0.5">\${escapeHtml(v)}</div>
        </div>
      \`).join('');

      const modal = document.getElementById('historyModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function renderSvgChart(history) {
      const box = document.getElementById('modalChartBox');
      const pts = history.filter(h => (h.price || 0) > 0);
      if (pts.length === 0) {
        box.innerHTML = '<div class="h-full flex items-center justify-center text-xs text-slate-500">No positive in-stock price points recorded yet.</div>';
        return;
      }

      const w = 680;
      const h = 140;
      const padX = 40;
      const padY = 22;

      const prices = pts.map(p => p.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const span = maxP - minP || Math.max(1, Math.round(minP * 0.1));

      const coords = pts.map((pt, idx) => {
        const x = pts.length === 1 ? w / 2 : padX + (idx / (pts.length - 1)) * (w - padX * 2);
        const y = h - padY - ((pt.price - minP) / span) * (h - padY * 2);
        return { x, y, pt };
      });

      const polyline = coords.map(c => \`\${c.x.toFixed(1)},\${c.y.toFixed(1)}\`).join(' ');
      const circles = coords.map(c => \`
        <circle cx="\${c.x.toFixed(1)}" cy="\${c.y.toFixed(1)}" r="4.5" fill="#6366f1" stroke="#fff" stroke-width="1.5">
          <title>\${escapeHtml(c.pt.date)}: ৳\${c.pt.price.toLocaleString('en-IN')} (\${escapeHtml(c.pt.stock_status)})</title>
        </circle>
      \`).join('');

      box.innerHTML = \`
        <svg viewBox="0 0 \${w} \${h}" class="w-full h-full overflow-visible">
          <line x1="\${padX}" y1="\${padY}" x2="\${w - padX}" y2="\${padY}" stroke="rgba(148,163,184,0.15)" stroke-dasharray="4" />
          <line x1="\${padX}" y1="\${h - padY}" x2="\${w - padX}" y2="\${h - padY}" stroke="rgba(148,163,184,0.15)" stroke-dasharray="4" />
          \${coords.length > 1 ? \`<polyline fill="none" stroke="#6366f1" stroke-width="2.5" points="\${polyline}" />\` : ''}
          \${circles}
          <text x="\${padX}" y="\${padY - 6}" fill="#94a3b8" font-size="10" font-family="monospace">High: ৳\${maxP.toLocaleString('en-IN')}</text>
          <text x="\${padX}" y="\${h - 4}" fill="#10b981" font-size="10" font-family="monospace">Low: ৳\${minP.toLocaleString('en-IN')}</text>
        </svg>
      \`;
    }

    function closeHistoryModal() {
      const modal = document.getElementById('historyModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    // =========================================================================
    // TAB 2: PRICE DROPS & STOCK STATUS FEED
    // =========================================================================
    function renderChangesFeed() {
      const container = document.getElementById('changesFeedContainer');
      const filterType = document.getElementById('eventFilterSelect').value;

      const list = changeEvents.filter(ev => filterType === 'all' || ev.event_type === filterType);
      if (list.length === 0) {
        container.innerHTML = \`
          <div class="rounded-xl bg-slate-900/60 border border-slate-800 p-8 text-center space-y-2">
            <div class="text-base font-semibold text-slate-300">No Price or Stock Transitions Logged Yet</div>
            <p class="text-xs text-slate-400 max-w-xl mx-auto">
              Your baseline snapshot of <strong>\${allProducts.length.toLocaleString()} products</strong> across 13 categories is active.
              As GitHub Actions runs daily, every price drop, price increase, restock, and out-of-stock transition will appear here automatically.
            </p>
          </div>
        \`;
        return;
      }

      container.innerHTML = [...list].reverse().slice(0, 100).map(ev => {
        const isDrop = ev.event_type === 'PRICE_DROP';
        const isInc = ev.event_type === 'PRICE_INCREASE';
        const isRestock = ev.event_type === 'RESTOCKED';

        let badgeClass = 'bg-slate-800 text-slate-300';
        if (isDrop) badgeClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        else if (isInc) badgeClass = 'bg-rose-500/20 text-rose-300 border border-rose-500/30';
        else if (isRestock) badgeClass = 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30';
        else badgeClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';

        return \`
          <div class="rounded-xl bg-slate-900/70 border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold \${badgeClass}">\${escapeHtml(ev.event_type)}</span>
                <span class="text-xs font-mono text-indigo-400">[\${escapeHtml(ev.category)}]</span>
                <span class="text-xs text-slate-400 font-mono">\${escapeHtml(ev.detected_at || ev.date)}</span>
              </div>
              <div class="font-semibold text-sm text-white">\${escapeHtml(ev.title)}</div>
            </div>
            <div class="text-right font-mono">
              \${(isDrop || isInc) ? \`
                <div class="text-sm font-bold \${isDrop ? 'text-emerald-400' : 'text-rose-400'}">
                  \${formatBDT(ev.old_price)} → \${formatBDT(ev.new_price)} (\${ev.change_amount > 0 ? '+' : ''}\${ev.change_amount} ৳ / \${ev.change_percentage}%)
                </div>
              \` : \`
                <div class="text-sm font-bold text-cyan-300">
                  \${escapeHtml(ev.old_stock)} → \${escapeHtml(ev.new_stock)} (\${formatBDT(ev.new_price)})
                </div>
              \`}
              <a href="\${escapeHtml(ev.url)}" target="_blank" class="text-xs text-indigo-400 hover:underline">View Product ↗</a>
            </div>
          </div>
        \`;
      }).join('');
    }

    // =========================================================================
    // TAB 3: PC BUILDER & BUDGET CALCULATOR
    // =========================================================================
    function addToBuild(productId) {
      const item = allProducts.find(p => String(p.product_id) === String(productId));
      if (!item) return;
      pcBuild.push({
        product_id: item.product_id,
        category: item.category,
        brand: item.brand,
        model: item.model,
        title: item.title,
        price: item.current_price || 0,
        url: item.url
      });
      localStorage.setItem('startech_pc_build', JSON.stringify(pcBuild));
      renderBuilder();
    }

    function removeFromBuild(idx) {
      pcBuild.splice(idx, 1);
      localStorage.setItem('startech_pc_build', JSON.stringify(pcBuild));
      renderBuilder();
    }

    function clearBuild() {
      pcBuild = [];
      localStorage.setItem('startech_pc_build', '[]');
      renderBuilder();
    }

    function renderBuilder() {
      document.getElementById('builderCountBadge').textContent = pcBuild.length;
      const total = pcBuild.reduce((s, x) => s + (x.price || 0), 0);
      document.getElementById('builderTotalPrice').textContent = '৳' + total.toLocaleString('en-IN');

      const container = document.getElementById('builderListContainer');
      if (pcBuild.length === 0) {
        container.innerHTML = \`
          <div class="rounded-xl bg-slate-900/50 border border-slate-800 p-8 text-center text-xs text-slate-400">
            Your custom PC build list is empty. Click <strong>"+ Add to Build"</strong> on any Processor, Motherboard, RAM, SSD, GPU, PSU, Casing, or Monitor in the Catalog tab!
          </div>
        \`;
        return;
      }

      container.innerHTML = pcBuild.map((b, idx) => {
        const catMeta = CATEGORIES[b.category] || CATEGORIES.laptop;
        return \`
          <div class="rounded-xl bg-slate-900/80 border border-slate-800 p-3.5 flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <span class="text-lg">\${catMeta.icon}</span>
              <div class="min-w-0">
                <div class="text-[11px] font-mono text-indigo-400">\${escapeHtml(catMeta.name)} · \${escapeHtml(b.brand)}</div>
                <div class="text-sm font-semibold text-white truncate">\${escapeHtml(b.title)}</div>
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span class="font-mono font-bold text-emerald-400">\${formatBDT(b.price)}</span>
              <button onclick="removeFromBuild(\${idx})" class="p-1.5 rounded-lg bg-rose-500/15 text-rose-400 hover:bg-rose-500/30 text-xs">✕</button>
            </div>
          </div>
        \`;
      }).join('');
    }

    function copyBuildQuote() {
      if (pcBuild.length === 0) return;
      const total = pcBuild.reduce((s, x) => s + (x.price || 0), 0);
      const lines = [
        '### ⚡ Custom Star Tech BD PC Build Quote',
        '',
        '| Category | Component | Price (BDT) |',
        '|:---|:---|---:|',
        ...pcBuild.map(b => \`| \${b.category} | [\${b.title}](\${b.url}) | ৳\${(b.price || 0).toLocaleString('en-IN')} |\`),
        \`| **Total** | **\${pcBuild.length} Items** | **৳\${total.toLocaleString('en-IN')}** |\`
      ];
      navigator.clipboard.writeText(lines.join('\\n'));
      alert('Copied Markdown PC Build Quote to clipboard!');
    }

    // =========================================================================
    // UI HELPERS
    // =========================================================================
    function switchMainTab(tab) {
      ['catalog', 'changes', 'builder'].forEach(t => {
        document.getElementById('tabContent-' + t).classList.toggle('hidden', t !== tab);
        const btn = document.getElementById('tabBtn-' + t);
        if (t === tab) {
          btn.className = 'px-3 py-1.5 rounded-lg bg-indigo-600 text-white shadow transition flex items-center gap-1';
        } else {
          btn.className = 'px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition flex items-center gap-1';
        }
      });
    }

    function setLayoutMode(mode) {
      layoutMode = mode;
      document.getElementById('layoutBtn-grid').className = mode === 'grid'
        ? 'px-2.5 py-1 rounded-md bg-indigo-600 text-white'
        : 'px-2.5 py-1 rounded-md text-slate-400 hover:text-white';
      document.getElementById('layoutBtn-table').className = mode === 'table'
        ? 'px-2.5 py-1 rounded-md bg-indigo-600 text-white'
        : 'px-2.5 py-1 rounded-md text-slate-400 hover:text-white';
      renderProducts();
    }

    function clearSearch() {
      document.getElementById('searchInput').value = '';
      applyFilters();
    }

    function resetAllFilters() {
      document.getElementById('searchInput').value = '';
      document.getElementById('brandSelect').value = 'all';
      document.getElementById('stockSelect').value = 'all';
      document.getElementById('minPriceInput').value = '';
      document.getElementById('maxPriceInput').value = '';
      document.getElementById('sortSelect').value = 'model-asc';
      document.getElementById('discountedOnlyCheck').checked = false;
      document.getElementById('priceChangedCheck').checked = false;
      activeCategory = 'all';
      renderCategoryPills();
      populateBrandsDropdown();
      applyFilters();
    }

    function exportFilteredCsv() {
      if (filteredProducts.length === 0) return;
      const headers = ['category', 'brand', 'model', 'product_id', 'title', 'current_price', 'lowest_price', 'highest_price', 'stock_status', 'url'];
      const rows = [
        headers.join(','),
        ...filteredProducts.map(item => headers.map(h => \`"\${String(item[h] ?? '').replace(/"/g, '""')}"\`).join(','))
      ];
      const blob = new Blob([rows.join('\\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = \`startech_\${activeCategory}_export.csv\`;
      a.click();
    }

    function refreshFromGitHub() {
      loadDashboardData(true);
    }

    function toggleTheme() {
      const html = document.documentElement;
      html.classList.toggle('dark');
      const isDark = html.classList.contains('dark');
      document.getElementById('themeIcon').textContent = isDark ? '🌙' : '☀️';
    }

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeHistoryModal();
    });

    loadDashboardData(false);
  </script>
</body>
</html>`;
}
