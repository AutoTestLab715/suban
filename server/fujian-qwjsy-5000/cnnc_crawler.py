#!/usr/bin/env python3
"""Collect public CNNC listing pages into ``biaoxun.cnnc_notices``.

This crawler deliberately stores only fields exposed on the five public list
pages. It does not request announcement detail pages or attempt to bypass
access controls on those pages.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

import pymysql
from pymysql.cursors import DictCursor


BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"
SCHEMA_FILE = BASE_DIR / "schema_cnnc_notices.sql"
TABLE_NAME = "cnnc_notices"
USER_AGENT = (
    "Mozilla/5.0 (compatible; BiaoxunCNNCCollector/1.0; "
    "+https://47.99.117.191/)"
)

CATEGORIES = {
    "zhaobiao": {
        "name": "中核招标",
        "notice_type": "招标公告",
        "url": "http://cnncecp.toobiao.com/zhaobiao/",
    },
    "gongcheng": {
        "name": "中核工程",
        "notice_type": "工程公告",
        "url": "http://cnncecp.toobiao.com/gongcheng/",
    },
    "huowu": {
        "name": "中核设备",
        "notice_type": "设备采购",
        "url": "http://cnncecp.toobiao.com/huowu/",
    },
    "xunjia": {
        "name": "中核询价",
        "notice_type": "询价公告",
        "url": "http://cnncecp.toobiao.com/xunjia/",
    },
    "zhongbiao": {
        "name": "中核中标",
        "notice_type": "中标公告",
        "url": "http://cnncecp.toobiao.com/zhongbiao/",
    },
}

DETAIL_URL_RE = re.compile(
    r"https?://(?:www\.)?dlzb\.com/d-(?:zb-|zhongbiao-)?\d+\.html",
    re.IGNORECASE,
)
HREF_RE = re.compile(r"<a\b[^>]*\bhref\s*=\s*['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", re.I | re.S)
DATE_RE = re.compile(r"\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b")
TAG_RE = re.compile(r"<[^>]+>")


def load_env() -> None:
    if not ENV_FILE.is_file():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"").strip("'"))


def connect():
    load_env()
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "biaoxun"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DATABASE", "biaoxun"),
        charset="utf8mb4",
        autocommit=True,
        cursorclass=DictCursor,
    )


def ensure_schema() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(SCHEMA_FILE.read_text(encoding="utf-8"))


def text_content(raw_html: str) -> str:
    return " ".join(html.unescape(TAG_RE.sub(" ", raw_html)).split())


def parse_notice_time(raw_html: str) -> datetime | None:
    match = DATE_RE.search(text_content(raw_html))
    if not match:
        return None
    year, month, day = (int(value) for value in match.groups())
    try:
        return datetime(year, month, day)
    except ValueError:
        return None


def normalize_url(url: str) -> str:
    url = html.unescape(url.strip())
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("/"):
        return f"https://www.dlzb.com{url}"
    return url


def parse_listing(page_html: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for item in re.findall(r"<li\b[^>]*>(.*?)</li>", page_html, re.I | re.S):
        date = parse_notice_time(item)
        for href, title_html in HREF_RE.findall(item):
            url = normalize_url(href)
            if not DETAIL_URL_RE.fullmatch(url) or url in seen_urls:
                continue
            title = text_content(title_html)
            if title:
                rows.append({"title": title, "url": url, "notice_time": date})
                seen_urls.add(url)

    # A layout change should not silently produce no data. This conservative
    # fallback still stores only public title links, but may lack a date.
    if not rows:
        for href, title_html in HREF_RE.findall(page_html):
            url = normalize_url(href)
            if not DETAIL_URL_RE.fullmatch(url) or url in seen_urls:
                continue
            title = text_content(title_html)
            if title:
                rows.append({"title": title, "url": url, "notice_time": None})
                seen_urls.add(url)
    return rows


def fetch_listing(url: str) -> str:
    last_error: Exception | None = None
    for attempt in range(2):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read()
                content_type = response.headers.get_content_charset() or "utf-8"
            try:
                return body.decode(content_type)
            except (LookupError, UnicodeDecodeError):
                return body.decode("gb18030", errors="replace")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt == 0:
                time.sleep(2)
    raise RuntimeError(f"request failed for {url}: {last_error}")


def make_row(item: dict[str, Any], category: dict[str, str]) -> dict[str, Any]:
    url = item["url"]
    return {
        "id": hashlib.sha256(f"{category['name']}\0{url}".encode("utf-8")).hexdigest(),
        "source": "cnnc",
        "title": item["title"],
        "notice_time": item["notice_time"],
        "region": "全国",
        "notice_name": category["name"],
        "notice_type": category["notice_type"],
        "url": url,
        "attchs": json.dumps([], ensure_ascii=False),
        "description": None,
        "content_html": None,
        "content_text": None,
        "keyword": "中核",
        "search_mode": "title",
    }


def upsert_many(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    columns = [
        "id", "source", "title", "notice_time", "region", "notice_name", "notice_type", "url",
        "attchs", "description", "content_html", "content_text", "keyword", "search_mode",
    ]
    placeholders = ", ".join(["%s"] * len(columns))
    updates = ", ".join(f"{column}=VALUES({column})" for column in columns if column != "id")
    sql = (
        f"INSERT INTO {TABLE_NAME} ({', '.join(columns)}) VALUES ({placeholders}) "
        f"ON DUPLICATE KEY UPDATE {updates}"
    )
    with connect() as conn, conn.cursor() as cur:
        cur.executemany(sql, [[row[column] for column in columns] for row in rows])
    return len(rows)


def selected_categories(value: str | None) -> list[tuple[str, dict[str, str]]]:
    if not value:
        return list(CATEGORIES.items())
    names = [name.strip() for name in value.split(",") if name.strip()]
    invalid = sorted(set(names) - set(CATEGORIES))
    if invalid:
        raise ValueError(f"unknown categories: {', '.join(invalid)}")
    return [(name, CATEGORIES[name]) for name in names]


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect public CNNC list pages.")
    parser.add_argument("--category", help="Comma-separated category keys")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and parse without database writes")
    parser.add_argument("--sleep", type=float, default=2.0, help="Delay between category requests in seconds")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    categories = selected_categories(args.category)
    if not args.dry_run:
        ensure_schema()

    total = 0
    failures = 0
    for index, (key, category) in enumerate(categories):
        if index:
            time.sleep(max(args.sleep, 0))
        try:
            items = parse_listing(fetch_listing(category["url"]))
            rows = [make_row(item, category) for item in items]
            saved = 0 if args.dry_run else upsert_many(rows)
            total += len(rows)
            logging.info("%s: parsed=%d saved=%d", key, len(rows), saved)
        except Exception:
            failures += 1
            logging.exception("%s: collection failed", key)

    logging.info("finished categories=%d parsed=%d failures=%d", len(categories), total, failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
