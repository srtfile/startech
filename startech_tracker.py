#!/usr/bin/env python3
"""
Star Tech Multi-Category Price & Stock History Tracker (GitHub Actions Edition)
===============================================================================
Tracks 13 Star Tech Bangladesh categories daily, preserving past & present
price history and stock status transitions over time in pure JSON, CSV, and
an auto-updated Markdown dashboard.

Tracked Events:
- PRICE_DROP     : Product price decreased compared to previous recorded price.
- PRICE_INCREASE : Product price increased compared to previous recorded price.
- RESTOCKED      : Product transitioned from Out Of Stock / Upcoming -> In Stock.
- OUT_OF_STOCK   : Product transitioned from In Stock -> Out Of Stock.
- STOCK_CHANGE   : Any other stock status transition.

Persistent Files:
- Per-category JSON & CSV (startech_<category>.json / .csv) with embedded
  per-product `price_history`, `lowest_price`, `highest_price`, `previous_price`,
  `previous_stock_status`, `first_seen`, and `last_checked`.
- Combined catalog: startech_all_products.json & startech_all_products.csv
- Persistent product history index: history/product_history_index.json
- Cumulative change events log: history/price_and_stock_changes.json & .csv
- Legacy drops log: startech_price_drops.csv
- Daily run metrics log: history/daily_runs_log.csv
- Auto-generated Markdown report: TRACKER_DASHBOARD.md (and $GITHUB_STEP_SUMMARY)
"""

import argparse
import concurrent.futures
import csv
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

# Fix Windows console UTF-8 / cp1252 character encoding
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ensure required libraries are installed
try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("[!] Missing required libraries (requests / beautifulsoup4). Installing...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4"]
    )
    import requests
    from bs4 import BeautifulSoup

# Bangladesh Standard Time (UTC+6) so GitHub Actions (UTC) logs accurate local BD time
BD_TZ = timezone(timedelta(hours=6))

CATEGORIES: Dict[str, Dict[str, str]] = {
    "laptop": {
        "name": "Laptop",
        "url": "https://www.startech.com.bd/laptop-notebook/laptop",
        "json": "startech_laptops.json",
        "csv": "startech_laptops.csv",
    },
    "processor": {
        "name": "Processor",
        "url": "https://www.startech.com.bd/component/processor",
        "json": "startech_processor.json",
        "csv": "startech_processor.csv",
    },
    "cpu-cooler": {
        "name": "CPU Cooler",
        "url": "https://www.startech.com.bd/component/CPU-Cooler",
        "json": "startech_cpu_cooler.json",
        "csv": "startech_cpu_cooler.csv",
    },
    "motherboard": {
        "name": "Motherboard",
        "url": "https://www.startech.com.bd/component/motherboard",
        "json": "startech_motherboard.json",
        "csv": "startech_motherboard.csv",
    },
    "graphics-card": {
        "name": "Graphics Card",
        "url": "https://www.startech.com.bd/component/graphics-card",
        "json": "startech_graphics_card.json",
        "csv": "startech_graphics_card.csv",
    },
    "ram": {
        "name": "Desktop RAM",
        "url": "https://www.startech.com.bd/component/ram",
        "json": "startech_ram.json",
        "csv": "startech_ram.csv",
    },
    "laptop-ram": {
        "name": "Laptop RAM",
        "url": "https://www.startech.com.bd/component/laptop-ram",
        "json": "startech_laptop_ram.json",
        "csv": "startech_laptop_ram.csv",
    },
    "power-supply": {
        "name": "Power Supply",
        "url": "https://www.startech.com.bd/component/power-supply",
        "json": "startech_power_supply.json",
        "csv": "startech_power_supply.csv",
    },
    "hard-disk-drive": {
        "name": "Hard Disk Drive",
        "url": "https://www.startech.com.bd/component/hard-disk-drive",
        "json": "startech_hard_disk_drive.json",
        "csv": "startech_hard_disk_drive.csv",
    },
    "ssd": {
        "name": "SSD",
        "url": "https://www.startech.com.bd/ssd",
        "json": "startech_ssd.json",
        "csv": "startech_ssd.csv",
    },
    "casing": {
        "name": "Casing",
        "url": "https://www.startech.com.bd/component/casing",
        "json": "startech_casing.json",
        "csv": "startech_casing.csv",
    },
    "monitor": {
        "name": "Monitor",
        "url": "https://www.startech.com.bd/monitor",
        "json": "startech_monitor.json",
        "csv": "startech_monitor.csv",
    },
    "desktops": {
        "name": "Desktop PC",
        "url": "https://www.startech.com.bd/desktops",
        "json": "startech_desktops.json",
        "csv": "startech_desktops.csv",
    },
}

ALL_JSON_FILE = "startech_all_products.json"
ALL_CSV_FILE = "startech_all_products.csv"
DROPS_CSV_FILE = "startech_price_drops.csv"
DASHBOARD_MD_FILE = "TRACKER_DASHBOARD.md"

HISTORY_DIR = "history"
HISTORY_INDEX_FILE = os.path.join(HISTORY_DIR, "product_history_index.json")
CHANGES_JSON_FILE = os.path.join(HISTORY_DIR, "price_and_stock_changes.json")
CHANGES_CSV_FILE = os.path.join(HISTORY_DIR, "price_and_stock_changes.csv")
DAILY_RUNS_CSV_FILE = os.path.join(HISTORY_DIR, "daily_runs_log.csv")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
}

KNOWN_BRANDS = [
    "Cooler Master", "Western Digital", "Lian Li", "Be Quiet", "G.Skill",
    "Silicon Power", "Value-Top", "Titan Army", "PC Power", "PC Cooler",
    "Golden Field", "ID-Cooling", "Star Tech", "1stplayer", "Darkflash",
    "Acer", "ADATA", "AFOX", "AMD", "Antec", "AOC", "Apacer", "Apple",
    "Arctic", "Arktek", "Arzopa", "ASRock", "Asus", "Avita", "BenQ",
    "Biostar", "Biwintech", "Chuwi", "Colorful", "Corsair", "Cougar",
    "Crucial", "Dahua", "DeepCool", "Deli", "Dell", "Doel", "Esonic",
    "FSP", "Galax", "Gamdias", "GeIL", "Gigabyte", "Gigasonic", "Gunnir",
    "Hiksemi", "Hikvision", "Honor", "HP", "Huawei", "Huntkey", "Hyte",
    "Infinix", "Inno3D", "Intel", "Kimtigo", "Kingspec", "Kingston",
    "Koorui", "Lenovo", "Lexar", "LG", "MaxGreen", "Maxsun", "Microsoft",
    "MiPhi", "Monarch", "Montech", "MSI", "Netac", "Noctua", "NPC",
    "NZXT", "OCPC", "Ovo", "Palit", "Patriot", "Peladn", "Phanteks",
    "Philips", "PNY", "PowerColor", "Razer", "Redmi", "Revenger",
    "Samsung", "Sapphire", "Seasonic", "Seagate", "SilverStone", "Soyo",
    "Sparkle", "Team", "Thermalright", "Thermaltake", "Toshiba",
    "Transcend", "TwinMOS", "Uniview", "ViewSonic", "Walton", "WD",
    "Xenthra", "XFX", "Xiaomi", "Xigmatek", "XPG", "Zotac"
]


def now_bd() -> datetime:
    return datetime.now(BD_TZ)


# ==============================================================================
# Scraper / Extractor
# ==============================================================================

class StartechCategoryScraper:
    def __init__(self, session: Optional[requests.Session] = None):
        self.session = session or requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=16)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)
        self.session.headers.update(HEADERS)

    def fetch_page(self, base_url: str, page_num: int, max_retries: int = 3) -> Optional[BeautifulSoup]:
        url = f"{base_url}?page={page_num}" if page_num > 1 else base_url
        for attempt in range(1, max_retries + 1):
            try:
                resp = self.session.get(url, timeout=25)
                if resp.status_code == 200:
                    return BeautifulSoup(resp.content, "html.parser")
                elif resp.status_code == 404:
                    return None
            except requests.RequestException as e:
                if attempt == max_retries:
                    print(f"\n[!] Network error on {url} (attempt {attempt}/{max_retries}): {e}")
            time.sleep(1.5 * attempt)
        return None

    def get_total_pages(self, soup: BeautifulSoup) -> int:
        text_match = soup.find(string=re.compile(r'\((\d+)\s*Pages?\)', re.IGNORECASE))
        if text_match:
            m = re.search(r'\((\d+)\s*Pages?\)', text_match, re.IGNORECASE)
            if m:
                return int(m.group(1))

        pagination = soup.find("ul", class_="pagination")
        if pagination:
            pages = [int(a.get_text(strip=True)) for a in pagination.find_all("a") if a.get_text(strip=True).isdigit()]
            if pages:
                return max(pages)
        return 1

    def parse_product_card(self, item_tag, category_key: str, extract_date_str: str) -> Optional[dict]:
        name_tag = item_tag.find("h4", class_="p-item-name")
        if not name_tag:
            return None

        title = name_tag.get_text(strip=True)
        link_tag = name_tag.find("a")
        product_url = link_tag["href"].strip() if link_tag and link_tag.get("href") else ""

        # Extract numeric Product ID from cart action or URL
        product_id = ""
        action_btn = item_tag.find("span", class_=re.compile(r"btn-add-cart|btn-compare"))
        if action_btn and action_btn.get("onclick"):
            m = re.search(r"\d+", action_btn["onclick"])
            if m:
                product_id = m.group(0)

        if not product_id and product_url:
            product_id = product_url.rstrip("/").split("/")[-1]

        brand = self._extract_brand(title)
        model = self._extract_model(title, brand, category_key)

        current_price, regular_price, stock_status = self._parse_pricing(item_tag)
        discount_bdt = max(0, regular_price - current_price) if regular_price > current_price else 0

        specs = self._parse_specs(item_tag)
        specs_summary = " | ".join(f"{k}: {v}" for k, v in specs.items())

        img_tag = item_tag.find("img")
        image_url = img_tag.get("src") or img_tag.get("data-src") or "" if img_tag else ""

        return {
            "extract-date": extract_date_str,
            "category": category_key,
            "product_id": str(product_id),
            "brand": brand,
            "model": model,
            "title": title,
            "current_price": current_price,
            "regular_price": regular_price,
            "discount_bdt": discount_bdt,
            "stock_status": stock_status,
            "specs": specs,
            "specs_summary": specs_summary,
            "url": product_url,
            "image_url": image_url,
        }

    def _extract_brand(self, title: str) -> str:
        for b in KNOWN_BRANDS:
            if re.match(rf"^{re.escape(b)}\b", title, re.IGNORECASE):
                return b
        for b in KNOWN_BRANDS:
            if re.search(rf"\b{re.escape(b)}\b", title, re.IGNORECASE):
                return b
        first_word = title.split(" ")[0].strip() if title else ""
        if first_word and re.match(r"^[A-Za-z0-9\-]+$", first_word):
            return first_word
        return "Other"

    def _extract_model(self, title: str, brand: str, category_key: str) -> str:
        clean = re.sub(rf"^{re.escape(brand)}\s+", "", title, flags=re.IGNORECASE).strip()

        if category_key == "laptop":
            cut_keywords = [
                r"Core\s+i\d", r"Core\s+Ultra", r"Celeron", r"Pentium",
                r"Ryzen\s+\d", r"Athlon", r"Apple\s+M\d", r"M1", r"M2", r"M3", r"M4",
                r'\d+(\.\d+)?\s*(inch|\")', r"FHD", r"OLED", r"WQXGA", r"QHD"
            ]
            pattern = r"\s+(" + "|".join(cut_keywords) + r")\b.*$"
            model_part = re.sub(pattern, "", clean, flags=re.IGNORECASE).strip()
            return model_part if len(model_part) > 2 else clean.split(" ")[0]

        suffix_patterns = [
            r"\s+(?:AM\d|LGA\d+|sWRX\d+|TR\d+)\s+Socket.*$",
            r"\s+(?:Desktop|Gaming|Mobile|Server)?\s*Processor.*$",
            r"\s+(?:Liquid|Air|ARGB|RGB|All-in-One|AIO)?\s*CPU\s+Cooler.*$",
            r"\s+(?:DDR\d\s+)?(?:mATX|ATX|Micro-ATX|Mini-ITX|E-ATX)?\s*(?:Gaming\s+)?Motherboard.*$",
            r"\s+\d+GB\s+GDDR\dX?\s+.*Graphics\s+Card.*$",
            r"\s+Graphics\s+Card.*$",
            r"\s+\d+GB\s+DDR\d\s+\d+MHz\s+(?:Desktop|Laptop)?\s*RAM.*$",
            r"\s+(?:Desktop|Laptop|SO-DIMM)\s+RAM.*$",
            r"\s+\d+W\s+.*Power\s+Supply.*$",
            r"\s+(?:Full\s+Modular|Semi\s+Modular|Non-Modular)?\s*Power\s+Supply.*$",
            r"\s+(?:Internal|External|Desktop|Laptop|Surveillance|NAS)?\s*(?:Hard\s+Disk\s+Drive|Hard\s+Drive|HDD).*$",
            r"\s+(?:NVMe|PCIe|M\.2|SATA|SATAIII|2\.5-inch|2\.5\s+inch|Portable|External|Internal).*SSD.*$",
            r"\s+SSD.*$",
            r"\s+(?:Mid\s+Tower|Full\s+Tower|Mini\s+Tower|Micro-ATX|mATX|ATX|Mini-ITX|Gaming)?\s*(?:Desktop\s+)?(?:Casing|Case).*$",
            r"\s+\d+(\.\d+)?\s*(?:inch|\"|\'\')\s+.*Monitor.*$",
            r"\s+Monitor.*$",
            r"\s+(?:Budget|Gaming|All-in-One|Brand|Mini)?\s*(?:Desktop\s+)?PC.*$",
        ]
        model_part = clean
        for pat in suffix_patterns:
            updated = re.sub(pat, "", model_part, flags=re.IGNORECASE).strip()
            if len(updated) >= 2:
                model_part = updated

        return model_part if len(model_part) >= 2 else clean

    def _parse_pricing(self, item_tag) -> Tuple[int, int, str]:
        price_div = item_tag.find("div", class_="p-item-price")
        if not price_div:
            return 0, 0, "Out Of Stock"

        raw_text = price_div.get_text(" ", strip=True)
        lower_text = raw_text.lower()
        if "out of stock" in lower_text:
            return 0, 0, "Out Of Stock"
        if "upcoming" in lower_text or "tba" in lower_text:
            return 0, 0, "Upcoming"

        new_span = price_div.find("span", class_="price-new")
        old_span = price_div.find("span", class_="price-old")

        if new_span and old_span:
            new_p = int(re.sub(r"[^\d]", "", new_span.get_text()) or 0)
            old_p = int(re.sub(r"[^\d]", "", old_span.get_text()) or 0)
            return new_p, old_p, "In Stock"

        digits = re.sub(r"[^\d]", "", raw_text)
        if digits:
            price = int(digits)
            return price, price, "In Stock"

        return 0, 0, "Out Of Stock"

    def _parse_specs(self, item_tag) -> Dict[str, str]:
        specs: Dict[str, str] = {}
        features_list: List[str] = []

        for li in item_tag.find_all("li"):
            text = li.get_text(strip=True)
            if not text:
                continue
            if ":" in text:
                parts = text.split(":", 1)
                key = parts[0].strip()
                val = parts[1].strip()
                if key in specs:
                    specs[key] = f"{specs[key]}, {val}"
                else:
                    specs[key] = val
            else:
                features_list.append(text)

        if features_list:
            if "Features" in specs:
                specs["Features"] = f"{specs['Features']} | " + " | ".join(features_list)
            else:
                specs["Features"] = " | ".join(features_list)

        return specs


# ==============================================================================
# Historical State & Event Tracker
# ==============================================================================

class StartechTracker:
    def __init__(self, categories: Optional[List[str]] = None, workers: int = 4):
        if not categories or "all" in [c.lower() for c in categories]:
            self.selected_categories = list(CATEGORIES.keys())
        else:
            self.selected_categories = [c.lower() for c in categories if c.lower() in CATEGORIES]
        self.workers = max(1, workers)
        self.scraper = StartechCategoryScraper()
        os.makedirs(HISTORY_DIR, exist_ok=True)

    def load_history_index(self) -> Dict[str, dict]:
        """
        Loads persistent per-product historical state from history/product_history_index.json
        and seeds it from any existing category JSON files if not yet indexed.
        """
        index: Dict[str, dict] = {}
        if os.path.exists(HISTORY_INDEX_FILE):
            try:
                with open(HISTORY_INDEX_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        index = data.get("products", data)
            except Exception:
                index = {}

        # Also merge any existing category JSON files so we never miss prior state
        for cat_key, cat_info in CATEGORIES.items():
            jpath = cat_info["json"]
            if not os.path.exists(jpath):
                continue
            try:
                with open(jpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    items = (data.get("products") or data.get("laptops") or []) if isinstance(data, dict) else data
                    for item in items:
                        pid = str(item.get("product_id", ""))
                        if not pid or pid in index:
                            continue
                        price = item.get("current_price", 0)
                        stock = item.get("stock_status", "Out Of Stock")
                        ext_date = item.get("extract-date", "")
                        iso_date = ext_date
                        index[pid] = {
                            "product_id": pid,
                            "category": item.get("category", cat_key),
                            "title": item.get("title", ""),
                            "brand": item.get("brand", ""),
                            "model": item.get("model", ""),
                            "url": item.get("url", ""),
                            "first_seen": iso_date,
                            "last_checked": iso_date,
                            "last_changed": iso_date,
                            "current_price": price,
                            "previous_price": item.get("previous_price", price),
                            "lowest_price": item.get("lowest_price", price if price > 0 else 0),
                            "lowest_price_date": item.get("lowest_price_date", iso_date if price > 0 else ""),
                            "highest_price": item.get("highest_price", price if price > 0 else 0),
                            "highest_price_date": item.get("highest_price_date", iso_date if price > 0 else ""),
                            "stock_status": stock,
                            "previous_stock_status": item.get("previous_stock_status", stock),
                            "price_history": item.get("price_history") or [
                                {
                                    "date": iso_date,
                                    "price": price,
                                    "regular_price": item.get("regular_price", price),
                                    "stock_status": stock,
                                    "event": "INITIAL",
                                }
                            ],
                        }
            except Exception:
                continue

        return index

    def save_history_index(self, index: Dict[str, dict], extract_date_str: str):
        payload = {
            "last_updated": extract_date_str,
            "total_tracked_products": len(index),
            "products": index,
        }
        with open(HISTORY_INDEX_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)

    def reconcile_product_history(
        self,
        item: dict,
        history_index: Dict[str, dict],
        extract_date_str: str,
        iso_date_str: str,
    ) -> List[dict]:
        """
        Compares current scraped product with its historical state, updates
        past & present price/stock fields, and returns any change events detected.
        """
        pid = str(item["product_id"])
        new_price = item["current_price"]
        new_reg_price = item["regular_price"]
        new_stock = item["stock_status"]
        events: List[dict] = []

        prev = history_index.get(pid)
        if not prev:
            # Newly discovered product
            history_entry = {
                "date": iso_date_str,
                "timestamp": extract_date_str,
                "price": new_price,
                "regular_price": new_reg_price,
                "stock_status": new_stock,
                "event": "FIRST_SEEN",
            }
            record = {
                "product_id": pid,
                "category": item["category"],
                "title": item["title"],
                "brand": item["brand"],
                "model": item["model"],
                "url": item["url"],
                "first_seen": iso_date_str,
                "last_checked": extract_date_str,
                "last_changed": iso_date_str,
                "current_price": new_price,
                "previous_price": new_price,
                "lowest_price": new_price if new_price > 0 else 0,
                "lowest_price_date": iso_date_str if new_price > 0 else "",
                "highest_price": new_price if new_price > 0 else 0,
                "highest_price_date": iso_date_str if new_price > 0 else "",
                "stock_status": new_stock,
                "previous_stock_status": new_stock,
                "price_history": [history_entry],
            }
            history_index[pid] = record
        else:
            old_price = prev.get("current_price", 0)
            old_stock = prev.get("stock_status", "Out Of Stock")
            lowest_price = prev.get("lowest_price", 0)
            lowest_date = prev.get("lowest_price_date", "")
            highest_price = prev.get("highest_price", 0)
            highest_date = prev.get("highest_price_date", "")
            history_list = list(prev.get("price_history") or [])

            # Find last known positive price if product was previously out of stock
            last_positive_price = old_price
            if last_positive_price == 0:
                for h in reversed(history_list):
                    if h.get("price", 0) > 0:
                        last_positive_price = h["price"]
                        break

            price_changed = (
                new_price > 0
                and last_positive_price > 0
                and new_price != last_positive_price
            )
            stock_changed = new_stock.lower() != old_stock.lower()

            event_tags: List[str] = []

            # 1. Check Stock Status Transition
            if stock_changed:
                if new_stock == "In Stock" and old_stock != "In Stock":
                    stock_event_type = "RESTOCKED"
                elif new_stock != "In Stock" and old_stock == "In Stock":
                    stock_event_type = "OUT_OF_STOCK"
                else:
                    stock_event_type = "STOCK_CHANGE"

                event_tags.append(stock_event_type)
                events.append({
                    "detected_at": extract_date_str,
                    "date": iso_date_str,
                    "event_type": stock_event_type,
                    "category": item["category"],
                    "product_id": pid,
                    "brand": item["brand"],
                    "model": item["model"],
                    "title": item["title"],
                    "old_price": last_positive_price,
                    "new_price": new_price,
                    "change_amount": (new_price - last_positive_price) if (new_price > 0 and last_positive_price > 0) else 0,
                    "change_percentage": round(((new_price - last_positive_price) / last_positive_price) * 100, 2)
                    if (new_price > 0 and last_positive_price > 0) else 0.0,
                    "old_stock": old_stock,
                    "new_stock": new_stock,
                    "url": item["url"],
                })

            # 2. Check Price Change (Drop / Increase)
            if price_changed:
                diff = new_price - last_positive_price
                pct = round((diff / last_positive_price) * 100, 2)
                price_event_type = "PRICE_DROP" if diff < 0 else "PRICE_INCREASE"
                event_tags.append(price_event_type)
                events.append({
                    "detected_at": extract_date_str,
                    "date": iso_date_str,
                    "event_type": price_event_type,
                    "category": item["category"],
                    "product_id": pid,
                    "brand": item["brand"],
                    "model": item["model"],
                    "title": item["title"],
                    "old_price": last_positive_price,
                    "new_price": new_price,
                    "change_amount": diff,
                    "change_percentage": pct,
                    "old_stock": old_stock,
                    "new_stock": new_stock,
                    "url": item["url"],
                })

            # Update lowest / highest price records
            if new_price > 0:
                if lowest_price == 0 or new_price < lowest_price:
                    lowest_price = new_price
                    lowest_date = iso_date_str
                if new_price > highest_price:
                    highest_price = new_price
                    highest_date = iso_date_str

            # Append to product's price_history only when price or stock changed
            if event_tags:
                history_list.append({
                    "date": iso_date_str,
                    "timestamp": extract_date_str,
                    "price": new_price,
                    "regular_price": new_reg_price,
                    "stock_status": new_stock,
                    "event": "+".join(event_tags),
                })

            record = {
                "product_id": pid,
                "category": item["category"],
                "title": item["title"],
                "brand": item["brand"],
                "model": item["model"],
                "url": item["url"],
                "first_seen": prev.get("first_seen") or iso_date_str,
                "last_checked": extract_date_str,
                "last_changed": iso_date_str if event_tags else prev.get("last_changed", iso_date_str),
                "current_price": new_price,
                "previous_price": last_positive_price if price_changed else prev.get("previous_price", new_price),
                "lowest_price": lowest_price,
                "lowest_price_date": lowest_date,
                "highest_price": highest_price,
                "highest_price_date": highest_date,
                "stock_status": new_stock,
                "previous_stock_status": old_stock if stock_changed else prev.get("previous_stock_status", new_stock),
                "price_history": history_list[-100:],  # Keep up to last 100 distinct transitions per item
            }
            history_index[pid] = record

        # Enrich product item with past & present tracking metadata
        item["first_seen"] = record["first_seen"]
        item["last_changed"] = record["last_changed"]
        item["previous_price"] = record["previous_price"]
        item["lowest_price"] = record["lowest_price"]
        item["lowest_price_date"] = record["lowest_price_date"]
        item["highest_price"] = record["highest_price"]
        item["highest_price_date"] = record["highest_price_date"]
        item["previous_stock_status"] = record["previous_stock_status"]
        item["price_history"] = record["price_history"]

        return events

    def scrape_category_pages(
        self,
        cat_key: str,
        max_pages: Optional[int],
        delay: float,
        extract_date_str: str,
    ) -> List[dict]:
        cat_info = CATEGORIES[cat_key]
        cat_name = cat_info["name"]
        base_url = cat_info["url"]

        print(f"\n[+] Category: {cat_name} ({base_url})")
        first_page = self.scraper.fetch_page(base_url, 1)
        if not first_page:
            print(f"[!] Failed to fetch initial page for {cat_name}.")
            return []

        total_available = self.scraper.get_total_pages(first_page)
        total_to_scrape = min(total_available, max_pages) if max_pages else total_available
        print(f"[OK] Detected {total_available} page(s). Scraping {total_to_scrape} page(s)...")

        pages_soups: Dict[int, BeautifulSoup] = {1: first_page}

        if total_to_scrape > 1:
            remaining = list(range(2, total_to_scrape + 1))
            if self.workers > 1:
                with concurrent.futures.ThreadPoolExecutor(max_workers=self.workers) as executor:
                    future_to_page = {
                        executor.submit(self.scraper.fetch_page, base_url, p): p
                        for p in remaining
                    }
                    completed = 1
                    for future in concurrent.futures.as_completed(future_to_page):
                        p = future_to_page[future]
                        completed += 1
                        sys.stdout.write(f"\r--> [{cat_name}] Fetched {completed}/{total_to_scrape} pages...")
                        sys.stdout.flush()
                        soup = future.result()
                        if soup:
                            pages_soups[p] = soup
                        if delay > 0:
                            time.sleep(delay / self.workers)
            else:
                for p in remaining:
                    sys.stdout.write(f"\r--> [{cat_name}] Scraping page {p}/{total_to_scrape}...")
                    sys.stdout.flush()
                    soup = self.scraper.fetch_page(base_url, p)
                    if soup:
                        pages_soups[p] = soup
                    if delay > 0:
                        time.sleep(delay)

        cat_items: List[dict] = []
        seen_ids = set()

        for p in sorted(pages_soups.keys()):
            soup = pages_soups[p]
            for tag in soup.find_all("div", class_="p-item"):
                item = self.scraper.parse_product_card(tag, cat_key, extract_date_str)
                if item and item["product_id"] and item["product_id"] not in seen_ids:
                    seen_ids.add(item["product_id"])
                    cat_items.append(item)

        return cat_items

    def run_scan(self, max_pages: Optional[int] = None, delay: float = 0.25) -> Tuple[List[dict], List[dict]]:
        dt = now_bd()
        extract_date_str = dt.strftime("%a %d %b %Y %I:%M %p %A")
        iso_date_str = dt.strftime("%Y-%m-%d")

        history_index = self.load_history_index()
        master_items: List[dict] = []
        run_events: List[dict] = []

        print(f"\n[*] Starting Star Tech Tracker across {len(self.selected_categories)} categories (BD Time: {extract_date_str})...")

        for cat_key in self.selected_categories:
            cat_info = CATEGORIES[cat_key]
            cat_name = cat_info["name"]

            cat_items = self.scrape_category_pages(cat_key, max_pages, delay, extract_date_str)
            if not cat_items:
                continue

            for item in cat_items:
                events = self.reconcile_product_history(item, history_index, extract_date_str, iso_date_str)
                if events:
                    run_events.extend(events)

            # Sort model-wise (alphabetical A-Z)
            cat_items.sort(key=lambda x: (x.get("model", "").lower(), x.get("brand", "").lower()))
            print(f"\n[OK] {cat_name}: Processed {len(cat_items)} items.")

            self.export_json(cat_items, extract_date_str, cat_info["json"], cat_key)
            self.export_csv(cat_items, cat_info["csv"])
            master_items.extend(cat_items)

        # Save updated persistent product history index
        self.save_history_index(history_index, extract_date_str)

        # Export combined master files
        if master_items:
            master_items.sort(key=lambda x: (x.get("category", ""), x.get("model", "").lower(), x.get("brand", "").lower()))
            self.export_json(master_items, extract_date_str, ALL_JSON_FILE, "all")
            self.export_csv(master_items, ALL_CSV_FILE)

        # Log price & stock events
        if run_events:
            self._record_events(run_events)
        else:
            print("\n[i] Tracker: No price or stock status changes detected in this run.")

        # Log daily run metrics & generate Markdown Dashboard
        self._append_daily_run_log(iso_date_str, extract_date_str, master_items, run_events)
        self.generate_markdown_dashboard(extract_date_str, master_items, run_events)

        return master_items, run_events

    def _record_events(self, events: List[dict]):
        print("\n" + "=" * 75)
        print(f"[!] DETECTED {len(events)} PRICE / STOCK STATUS CHANGE EVENT(S)!")
        print("=" * 75)

        drops: List[dict] = []
        for ev in events:
            etype = ev["event_type"]
            cat = ev["category"]
            title = ev["title"]
            if etype in ("PRICE_DROP", "PRICE_INCREASE"):
                print(f"[{etype}] [{cat}] {title}")
                print(f"   Price: BDT {ev['old_price']:,} -> BDT {ev['new_price']:,} "
                      f"({ev['change_amount']:+,} BDT | {ev['change_percentage']:+.2f}%) | Stock: {ev['new_stock']}")
            else:
                print(f"[{etype}] [{cat}] {title}")
                print(f"   Stock: {ev['old_stock']} -> {ev['new_stock']} (Price: BDT {ev['new_price']:,})")
            print(f"   Link : {ev['url']}\n")

            if etype == "PRICE_DROP":
                drops.append(ev)

        # 1. Append to cumulative CSV log: history/price_and_stock_changes.csv
        csv_exists = os.path.exists(CHANGES_CSV_FILE)
        fields = [
            "detected_at", "date", "event_type", "category", "product_id",
            "brand", "model", "title", "old_price", "new_price",
            "change_amount", "change_percentage", "old_stock", "new_stock", "url"
        ]
        with open(CHANGES_CSV_FILE, mode="a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            if not csv_exists:
                writer.writeheader()
            for ev in events:
                writer.writerow(ev)

        # 2. Update cumulative JSON log: history/price_and_stock_changes.json
        existing_events: List[dict] = []
        if os.path.exists(CHANGES_JSON_FILE):
            try:
                with open(CHANGES_JSON_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    existing_events = data.get("events", []) if isinstance(data, dict) else data
            except Exception:
                existing_events = []

        existing_events.extend(events)
        # Keep most recent 5,000 events in JSON
        existing_events = existing_events[-5000:]
        with open(CHANGES_JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "last_updated": events[-1]["detected_at"],
                    "total_events": len(existing_events),
                    "events": existing_events,
                },
                f,
                indent=2,
                ensure_ascii=False,
            )

        # 3. Also append price drops to legacy startech_price_drops.csv
        if drops:
            drops_exists = os.path.exists(DROPS_CSV_FILE)
            drop_keys = [
                "detected_at", "category", "product_id", "title",
                "old_price", "new_price", "change_amount", "change_percentage", "url"
            ]
            with open(DROPS_CSV_FILE, mode="a", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=drop_keys, extrasaction="ignore")
                if not drops_exists:
                    writer.writeheader()
                for d in drops:
                    writer.writerow(d)

        print(f"[OK] Logged {len(events)} event(s) to '{CHANGES_CSV_FILE}' and '{CHANGES_JSON_FILE}'.")

    def _append_daily_run_log(self, iso_date: str, extract_date_str: str, items: List[dict], run_events: List[dict]):
        file_exists = os.path.exists(DAILY_RUNS_CSV_FILE)
        in_stock = sum(1 for x in items if x.get("stock_status") == "In Stock")
        out_of_stock = sum(1 for x in items if x.get("stock_status") == "Out Of Stock")
        upcoming = sum(1 for x in items if x.get("stock_status") == "Upcoming")
        drops = sum(1 for e in run_events if e["event_type"] == "PRICE_DROP")
        increases = sum(1 for e in run_events if e["event_type"] == "PRICE_INCREASE")
        restocked = sum(1 for e in run_events if e["event_type"] == "RESTOCKED")
        newly_oos = sum(1 for e in run_events if e["event_type"] == "OUT_OF_STOCK")

        fields = [
            "date", "timestamp", "total_products", "in_stock", "out_of_stock",
            "upcoming", "price_drops", "price_increases", "restocked", "newly_out_of_stock"
        ]
        with open(DAILY_RUNS_CSV_FILE, mode="a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            if not file_exists:
                writer.writeheader()
            writer.writerow({
                "date": iso_date,
                "timestamp": extract_date_str,
                "total_products": len(items),
                "in_stock": in_stock,
                "out_of_stock": out_of_stock,
                "upcoming": upcoming,
                "price_drops": drops,
                "price_increases": increases,
                "restocked": restocked,
                "newly_out_of_stock": newly_oos,
            })

    def export_csv(self, items: List[dict], csv_path: str):
        if not items:
            return
        fields = [
            "extract-date", "category", "model", "brand", "product_id", "title",
            "current_price", "previous_price", "lowest_price", "highest_price",
            "regular_price", "discount_bdt", "stock_status", "previous_stock_status",
            "first_seen", "last_changed", "specs_summary", "url", "image_url"
        ]
        with open(csv_path, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            for item in items:
                writer.writerow(item)
        print(f"[OK] Exported {len(items)} items to CSV: '{csv_path}'")

    def export_json(self, items: List[dict], extract_date_str: str, json_path: str, category_key: str):
        if not items:
            return
        payload = {
            "extract-date": extract_date_str,
            "category": category_key,
            "sorted_by": "model",
            "total_items": len(items),
            "products": items,
        }
        if category_key == "laptop":
            payload["total_laptops"] = len(items)
            payload["laptops"] = items

        with open(json_path, mode="w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        print(f"[OK] Exported {len(items)} items to JSON: '{json_path}'")

    def generate_markdown_dashboard(self, extract_date_str: str, items: List[dict], run_events: List[dict]):
        """
        Generates a Markdown dashboard (TRACKER_DASHBOARD.md) and writes to
        $GITHUB_STEP_SUMMARY when running inside GitHub Actions.
        """
        if not items:
            return

        total_items = len(items)
        in_stock_total = sum(1 for x in items if x.get("stock_status") == "In Stock")
        oos_total = sum(1 for x in items if x.get("stock_status") == "Out Of Stock")
        upcoming_total = sum(1 for x in items if x.get("stock_status") == "Upcoming")

        drops = [e for e in run_events if e["event_type"] == "PRICE_DROP"]
        increases = [e for e in run_events if e["event_type"] == "PRICE_INCREASE"]
        stock_changes = [e for e in run_events if e["event_type"] in ("RESTOCKED", "OUT_OF_STOCK", "STOCK_CHANGE")]

        # Load recent historical events if this run had none, so dashboard always shows recent activity
        recent_historical_events: List[dict] = []
        if os.path.exists(CHANGES_JSON_FILE):
            try:
                with open(CHANGES_JSON_FILE, "r", encoding="utf-8") as f:
                    recent_historical_events = json.load(f).get("events", [])[-30:]
            except Exception:
                recent_historical_events = []

        lines = [
            "# 📊 Star Tech Bangladesh — Automated Price & Stock Tracker Dashboard",
            "",
            f"> **Last Scan (Bangladesh Time):** `{extract_date_str}`  ",
            f"> **Total Products Tracked:** `{total_items:,}` | **In Stock:** `{in_stock_total:,}` | **Out of Stock:** `{oos_total:,}` | **Upcoming:** `{upcoming_total:,}`  ",
            f"> **Latest Run Changes:** 📉 `{len(drops)}` Price Drops | 📈 `{len(increases)}` Price Increases | 📦 `{len(stock_changes)}` Stock Transitions",
            "",
            "---",
            "",
            "## 🗂️ Category Breakdown",
            "",
            "| Category | Total Tracked | In Stock | Out of Stock | Lowest Price (BDT) | Highest Price (BDT) | Average Price (BDT) | Data Files |",
            "|:---|---:|---:|---:|---:|---:|---:|:---|",
        ]

        for cat_key, cat_info in CATEGORIES.items():
            cat_items = [x for x in items if x.get("category") == cat_key]
            if not cat_items:
                continue
            c_prices = [x["current_price"] for x in cat_items if x.get("current_price", 0) > 0]
            c_in = sum(1 for x in cat_items if x.get("stock_status") == "In Stock")
            c_oos = sum(1 for x in cat_items if x.get("stock_status") != "In Stock")
            low_s = f"৳{min(c_prices):,}" if c_prices else "N/A"
            high_s = f"৳{max(c_prices):,}" if c_prices else "N/A"
            avg_s = f"৳{round(sum(c_prices) / len(c_prices)):,}" if c_prices else "N/A"
            lines.append(
                f"| **{cat_info['name']}** | {len(cat_items):,} | {c_in:,} | {c_oos:,} | {low_s} | {high_s} | {avg_s} | "
                f"[JSON]({cat_info['json']}) · [CSV]({cat_info['csv']}) |"
            )

        lines.extend([
            "",
            "---",
            "",
            "## 📉 Latest Price Drops",
            "",
        ])

        display_drops = drops if drops else [e for e in reversed(recent_historical_events) if e.get("event_type") == "PRICE_DROP"][:15]
        if display_drops:
            lines.append("| Date | Category | Product | Old Price | New Price | Saved | Link |")
            lines.append("|:---|:---|:---|---:|---:|---:|:---|")
            for d in display_drops[:25]:
                saved = abs(int(d.get("change_amount", 0)))
                pct = d.get("change_percentage", 0)
                lines.append(
                    f"| `{d.get('date', '')}` | `{d.get('category', '')}` | {d.get('title', '')} | "
                    f"৳{int(d.get('old_price', 0)):,} | **৳{int(d.get('new_price', 0)):,}** | "
                    f"🟢 **-৳{saved:,} ({pct}%)** | [View]({d.get('url', '')}) |"
                )
        else:
            lines.append("_No price drops recorded yet. Run daily scans to build price drop history._")

        lines.extend([
            "",
            "---",
            "",
            "## 📈 Latest Price Increases",
            "",
        ])

        display_inc = increases if increases else [e for e in reversed(recent_historical_events) if e.get("event_type") == "PRICE_INCREASE"][:15]
        if display_inc:
            lines.append("| Date | Category | Product | Old Price | New Price | Increase | Link |")
            lines.append("|:---|:---|:---|---:|---:|---:|:---|")
            for inc in display_inc[:25]:
                diff = abs(int(inc.get("change_amount", 0)))
                pct = inc.get("change_percentage", 0)
                lines.append(
                    f"| `{inc.get('date', '')}` | `{inc.get('category', '')}` | {inc.get('title', '')} | "
                    f"৳{int(inc.get('old_price', 0)):,} | **৳{int(inc.get('new_price', 0)):,}** | "
                    f"🔴 **+৳{diff:,} (+{pct}%)** | [View]({inc.get('url', '')}) |"
                )
        else:
            lines.append("_No price increases recorded yet._")

        lines.extend([
            "",
            "---",
            "",
            "## 📦 Latest Stock Status Transitions (Restocked / Out of Stock)",
            "",
        ])

        display_stock = stock_changes if stock_changes else [
            e for e in reversed(recent_historical_events)
            if e.get("event_type") in ("RESTOCKED", "OUT_OF_STOCK", "STOCK_CHANGE")
        ][:15]
        if display_stock:
            lines.append("| Date | Event | Category | Product | Previous Status | New Status | Price | Link |")
            lines.append("|:---|:---|:---|:---|:---|:---|---:|:---|")
            for sc in display_stock[:25]:
                badge = "🟢 RESTOCKED" if sc.get("event_type") == "RESTOCKED" else "🟠 OUT OF STOCK"
                price_str = f"৳{int(sc.get('new_price', 0)):,}" if int(sc.get("new_price", 0)) > 0 else "N/A"
                lines.append(
                    f"| `{sc.get('date', '')}` | **{badge}** | `{sc.get('category', '')}` | {sc.get('title', '')} | "
                    f"`{sc.get('old_stock', '')}` | **`{sc.get('new_stock', '')}`** | {price_str} | [View]({sc.get('url', '')}) |"
                )
        else:
            lines.append("_No stock status transitions recorded yet._")

        lines.append("")
        md_content = "\n".join(lines)

        with open(DASHBOARD_MD_FILE, "w", encoding="utf-8") as f:
            f.write(md_content)
        print(f"[OK] Updated Markdown Dashboard: '{DASHBOARD_MD_FILE}'")

        # Write to GitHub Actions Step Summary if running in GitHub Actions
        step_summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
        if step_summary_path:
            try:
                with open(step_summary_path, "a", encoding="utf-8") as sf:
                    sf.write(md_content + "\n")
                print("[OK] Published summary to GitHub Actions $GITHUB_STEP_SUMMARY.")
            except Exception as e:
                print(f"[!] Could not write GITHUB_STEP_SUMMARY: {e}")

    def load_items(self) -> List[dict]:
        all_items: List[dict] = []
        for cat_key in self.selected_categories:
            json_path = CATEGORIES[cat_key]["json"]
            if not os.path.exists(json_path):
                continue
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    items = (data.get("products") or data.get("laptops") or []) if isinstance(data, dict) else data
                    for item in items:
                        item.setdefault("category", cat_key)
                    all_items.extend(items)
            except Exception:
                continue
        return all_items

    def print_changes(self, limit: int = 30):
        if not os.path.exists(CHANGES_CSV_FILE):
            print("\n[i] No recorded price or stock changes yet.")
            print("    Run scans over time to track price & stock history!")
            return

        with open(CHANGES_CSV_FILE, "r", encoding="utf-8") as f:
            events = list(csv.DictReader(f))

        if not events:
            print("\n[i] No recorded price or stock changes yet.")
            return

        print("\n" + "=" * 85)
        print(f"RECENT PRICE & STOCK CHANGES (Showing last {min(limit, len(events))} of {len(events)} events)")
        print("=" * 85)
        for ev in events[-limit:]:
            etype = ev.get("event_type", "")
            cat = ev.get("category", "")
            title = ev.get("title", "")
            det = ev.get("detected_at", "")
            if etype in ("PRICE_DROP", "PRICE_INCREASE"):
                print(f"* [{det}] [{etype}] [{cat}] {title}")
                print(f"  Price: BDT {int(ev.get('old_price', 0)):,} -> BDT {int(ev.get('new_price', 0)):,} "
                      f"({int(ev.get('change_amount', 0)):+,} BDT / {ev.get('change_percentage')}%)")
            else:
                print(f"* [{det}] [{etype}] [{cat}] {title}")
                print(f"  Stock: {ev.get('old_stock')} -> {ev.get('new_stock')} | Price: BDT {int(ev.get('new_price', 0)):,}")
        print("=" * 85)

    def print_product_history(self, query: str):
        index = self.load_history_index()
        q = query.lower().strip()
        matches = [
            rec for rec in index.values()
            if q == str(rec.get("product_id", "")).lower()
            or q in rec.get("title", "").lower()
            or q in rec.get("model", "").lower()
        ]
        if not matches:
            print(f"\n[!] No product history found matching '{query}'.")
            return

        print(f"\nFound {len(matches)} product(s) with tracked history:")
        for rec in matches[:10]:
            print("\n" + "=" * 80)
            print(f"Product : [{rec.get('category')}] {rec.get('title')} (ID: {rec.get('product_id')})")
            print(f"Current : BDT {rec.get('current_price', 0):,} | Stock: {rec.get('stock_status')}")
            print(f"Previous: BDT {rec.get('previous_price', 0):,} | Previous Stock: {rec.get('previous_stock_status')}")
            print(f"All-Time: Lowest BDT {rec.get('lowest_price', 0):,} ({rec.get('lowest_price_date')}) | "
                  f"Highest BDT {rec.get('highest_price', 0):,} ({rec.get('highest_price_date')})")
            print(f"URL     : {rec.get('url')}")
            print("-" * 80)
            print("Timeline (Past -> Present):")
            for h in rec.get("price_history", []):
                print(f"  - [{h.get('date')}] Event: {h.get('event', 'SCAN'):<16} | "
                      f"Price: BDT {h.get('price', 0):>9,} | Stock: {h.get('stock_status')}")
        print("=" * 80)

    def print_summary(self):
        items = self.load_items()
        if not items:
            print("\n[!] No products loaded. Run a scan first: python startech_tracker.py")
            return

        prices = [x["current_price"] for x in items if x.get("current_price", 0) > 0]
        in_stock = sum(1 for x in items if x.get("stock_status") == "In Stock")
        oos = sum(1 for x in items if x.get("stock_status") != "In Stock")

        print("\n" + "=" * 78)
        print("STAR TECH MULTI-CATEGORY PRICE & STOCK TRACKER SUMMARY")
        print("=" * 78)
        print(f"{'Category':<18} | {'Total':>6} | {'In Stock':>8} | {'Out/Upc':>7} | {'Lowest (BDT)':>13} | {'Highest (BDT)':>13}")
        print("-" * 78)

        for cat_key in self.selected_categories:
            cat_items = [x for x in items if x.get("category") == cat_key]
            if not cat_items:
                continue
            c_prices = [x["current_price"] for x in cat_items if x.get("current_price", 0) > 0]
            c_stock = sum(1 for x in cat_items if x.get("stock_status") == "In Stock")
            c_oos = len(cat_items) - c_stock
            low_str = f"{min(c_prices):,}" if c_prices else "N/A"
            high_str = f"{max(c_prices):,}" if c_prices else "N/A"
            print(f"{CATEGORIES[cat_key]['name']:<18} | {len(cat_items):>6} | {c_stock:>8} | {c_oos:>7} | {low_str:>13} | {high_str:>13}")

        print("-" * 78)
        print(f"Total Products Tracked  : {len(items):,}")
        print(f"In Stock / Out of Stock : {in_stock:,} In Stock | {oos:,} Out of Stock / Upcoming")
        print(f"Overall Lowest Price    : BDT {min(prices):,}" if prices else "Overall Lowest Price    : N/A")
        print(f"Overall Average Price   : BDT {round(sum(prices) / len(prices)):,}" if prices else "Overall Average Price   : N/A")
        print(f"Overall Highest Price   : BDT {max(prices):,}" if prices else "Overall Highest Price   : N/A")
        print("=" * 78)

    def print_search(self, query: str = "", min_p: int = 0, max_p: int = 0, in_stock_only: bool = False):
        items = self.load_items()
        results = []
        q = query.lower()

        for item in items:
            title = item.get("title", "").lower()
            model = item.get("model", "").lower()
            brand = item.get("brand", "").lower()
            specs = item.get("specs_summary", "").lower()
            cat = item.get("category", "").lower()
            price = item.get("current_price", 0)
            stock = item.get("stock_status", "")

            if in_stock_only and stock != "In Stock":
                continue
            if query and not (q in title or q in model or q in brand or q in specs or q in cat):
                continue
            if min_p > 0 and price < min_p:
                continue
            if max_p > 0 and price > max_p:
                continue

            results.append(item)

        print(f"\nSearch Results (Found {len(results)} matches, model-sorted):")
        print("-" * 80)
        for r in results[:25]:
            status_tag = " [In Stock]" if r["stock_status"] == "In Stock" else f" [{r['stock_status']}]"
            price_display = f"BDT {r['current_price']:,}" if r['current_price'] > 0 else "N/A"
            low_p = r.get("lowest_price", 0)
            high_p = r.get("highest_price", 0)
            range_str = f" (Low: BDT {low_p:,} | High: BDT {high_p:,})" if low_p > 0 else ""
            cat_tag = CATEGORIES.get(r.get("category", ""), {}).get("name", r.get("category", ""))
            print(f"* [{cat_tag}] Model: {r['model']} | [{r['brand']}] {r['title']}")
            print(f"  Price: {price_display}{status_tag}{range_str}")
            print(f"  Specs: {r['specs_summary']}")
            print(f"  URL  : {r['url']}\n")
        if len(results) > 25:
            print(f"... and {len(results) - 25} more items.")


# ==============================================================================
# CLI Entry Point
# ==============================================================================

def main():
    valid_cats = ["all"] + list(CATEGORIES.keys())
    parser = argparse.ArgumentParser(
        description="Star Tech Bangladesh Multi-Category Price & Stock History Tracker"
    )
    parser.add_argument(
        "-c", "--category",
        nargs="+",
        default=["all"],
        choices=valid_cats,
        help="Categories to track/query (default: all)."
    )
    parser.add_argument("--pages", type=int, default=None, help="Max pages per category (omit to scrape all pages)")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent page fetch workers (default: 4)")
    parser.add_argument("--delay", type=float, default=0.25, help="Polite delay in seconds between requests")
    parser.add_argument("--track", action="store_true", help="Run continuously in tracking loop mode")
    parser.add_argument("--interval", type=int, default=86400, help="Loop interval in seconds (default: 86400s = 24h)")
    parser.add_argument("--report", action="store_true", help="Show summary statistics table")
    parser.add_argument("--drops", action="store_true", help="List recent price & stock change events")
    parser.add_argument("--changes", action="store_true", help="List recent price & stock change events")
    parser.add_argument("--history", type=str, default="", help="View full past-to-present timeline for a product ID or model")
    parser.add_argument("--search", type=str, default="", help="Search tracked products by keyword")
    parser.add_argument("--in-stock", action="store_true", help="Filter search results to In Stock items only")
    parser.add_argument("--min-price", type=int, default=0, help="Minimum price filter")
    parser.add_argument("--max-price", type=int, default=0, help="Maximum price filter")

    args = parser.parse_args()
    tracker = StartechTracker(categories=args.category, workers=args.workers)

    if args.report:
        tracker.print_summary()
        return

    if args.drops or args.changes:
        tracker.print_changes()
        return

    if args.history:
        tracker.print_product_history(args.history)
        return

    if args.search or args.min_price or args.max_price or args.in_stock:
        tracker.print_search(
            query=args.search,
            min_p=args.min_price,
            max_p=args.max_price,
            in_stock_only=args.in_stock,
        )
        return

    if args.track:
        print(f"[*] Starting Continuous Tracker Mode (Interval: {args.interval}s)")
        try:
            while True:
                tracker.run_scan(max_pages=args.pages, delay=args.delay)
                tracker.print_summary()
                print(f"[~] Sleeping for {args.interval} seconds until next scan...")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n[!] Tracker stopped by user.")
        return

    tracker.run_scan(max_pages=args.pages, delay=args.delay)
    tracker.print_summary()


if __name__ == "__main__":
    main()
