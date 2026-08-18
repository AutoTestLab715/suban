#!/usr/bin/env python3
"""MySQL helpers for the FYC notice portal."""

from __future__ import annotations

import json
from typing import Any

from bs4 import BeautifulSoup

from db import connect, parse_time


TABLE = "fyc"


def ensure_schema() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {TABLE} (
                id VARCHAR(128) NOT NULL PRIMARY KEY,
                title VARCHAR(600) NOT NULL DEFAULT '',
                publish_time DATETIME NULL,
                category VARCHAR(64) NOT NULL DEFAULT 'notice',
                bulletin_type VARCHAR(64) NOT NULL DEFAULT '',
                notice_name VARCHAR(120) NOT NULL DEFAULT '',
                url VARCHAR(1000) NOT NULL DEFAULT '',
                bid_id VARCHAR(128) NOT NULL DEFAULT '',
                bulletin_id VARCHAR(128) NOT NULL DEFAULT '',
                package_id VARCHAR(255) NOT NULL DEFAULT '',
                bid_code VARCHAR(255) NOT NULL DEFAULT '',
                bid_name VARCHAR(600) NOT NULL DEFAULT '',
                bid_type_name VARCHAR(120) NOT NULL DEFAULT '',
                project_type VARCHAR(120) NOT NULL DEFAULT '',
                purchaser VARCHAR(500) NOT NULL DEFAULT '',
                agency VARCHAR(500) NOT NULL DEFAULT '',
                region VARCHAR(255) NOT NULL DEFAULT '',
                budget VARCHAR(200) NOT NULL DEFAULT '',
                content_html MEDIUMTEXT NULL,
                content_text MEDIUMTEXT NULL,
                attchs JSON NULL,
                raw_json JSON NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_publish_time (publish_time),
                KEY idx_bulletin_type (bulletin_type),
                KEY idx_bid_id (bid_id),
                KEY idx_title (title(191))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """
        )
        # Widen legacy columns if an older schema already exists.
        alters = [
            ("id", "VARCHAR(128) NOT NULL"),
            ("bid_id", "VARCHAR(128) NOT NULL DEFAULT ''"),
            ("bulletin_id", "VARCHAR(128) NOT NULL DEFAULT ''"),
            ("package_id", "VARCHAR(255) NOT NULL DEFAULT ''"),
            ("bid_code", "VARCHAR(255) NOT NULL DEFAULT ''"),
            ("region", "VARCHAR(255) NOT NULL DEFAULT ''"),
            ("url", "VARCHAR(1000) NOT NULL DEFAULT ''"),
        ]
        for col, typedef in alters:
            try:
                cur.execute(f"ALTER TABLE {TABLE} MODIFY COLUMN {col} {typedef}")
            except Exception:
                pass


def _clip(value: Any, max_len: int) -> str:
    text = "" if value is None else str(value)
    return text if len(text) <= max_len else text[:max_len]


def _json_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return json.dumps(value, ensure_ascii=False)


def _loads(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _plain_text(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text("\n", strip=True)


def _format_row(row: dict[str, Any]) -> dict[str, Any]:
    row = dict(row)
    for key in ("attchs", "raw_json"):
        row[key] = _loads(row.get(key), [] if key == "attchs" else {})
    value = row.get("publish_time")
    if hasattr(value, "strftime"):
        row["publish_time"] = value.strftime("%Y-%m-%d %H:%M:%S")
    return row


def _where(keyword: str = "", category: str = "", start: str = "", end: str = "") -> tuple[str, list[Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if keyword:
        like = f"%{keyword}%"
        clauses.append("(title LIKE %s OR bid_name LIKE %s OR purchaser LIKE %s OR content_text LIKE %s)")
        params.extend([like, like, like, like])
    if category:
        clauses.append("category=%s")
        params.append(category)
    if start:
        clauses.append("publish_time >= %s")
        params.append(start)
    if end:
        clauses.append("publish_time <= %s")
        params.append(end)
    return " AND ".join(clauses), params


def fetch_page(
    page: int,
    per_page: int,
    *,
    keyword: str = "",
    mode: str = "",
    category: str = "",
    start: str = "",
    end: str = "",
) -> tuple[int, list[dict[str, Any]]]:
    del mode
    page = max(1, int(page or 1))
    per_page = min(100, max(1, int(per_page or 20)))
    where, params = _where(keyword=keyword, category=category, start=start, end=end)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM {TABLE} WHERE {where}", params)
        total = int((cur.fetchone() or {}).get("c") or 0)
        cur.execute(
            f"""
            SELECT id, title, publish_time, category, bulletin_type, notice_name, url,
                   bid_id, bulletin_id, package_id, bid_code, bid_name, bid_type_name,
                   project_type, purchaser, agency, region, budget, content_text
            FROM {TABLE}
            WHERE {where}
            ORDER BY publish_time DESC, updated_at DESC, id DESC
            LIMIT %s OFFSET %s
            """,
            params + [per_page, (page - 1) * per_page],
        )
        rows = [_format_row(row) for row in cur.fetchall()]
    return total, rows


def fetch_one(notice_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {TABLE} WHERE id=%s", (notice_id,))
        row = cur.fetchone()
    return _format_row(row) if row else None


def count_all(category: str = "") -> int:
    where = "WHERE category=%s" if category else ""
    params = [category] if category else []
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM {TABLE} {where}", params)
        return int((cur.fetchone() or {}).get("c") or 0)


def count_filtered(**kwargs: Any) -> int:
    where, params = _where(
        keyword=kwargs.get("keyword") or "",
        category=kwargs.get("category") or "",
        start=kwargs.get("start") or "",
        end=kwargs.get("end") or "",
    )
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM {TABLE} WHERE {where}", params)
        return int((cur.fetchone() or {}).get("c") or 0)


UPSERT_COLUMNS = [
    "id",
    "title",
    "publish_time",
    "category",
    "bulletin_type",
    "notice_name",
    "url",
    "bid_id",
    "bulletin_id",
    "package_id",
    "bid_code",
    "bid_name",
    "bid_type_name",
    "project_type",
    "purchaser",
    "agency",
    "region",
    "budget",
    "content_html",
    "content_text",
    "attchs",
    "raw_json",
]


def ids_with_content(ids: list[str]) -> set[str]:
    """Return ids that already have non-empty content_html in DB."""
    clean = [str(x).strip() for x in ids if str(x).strip()]
    if not clean:
        return set()
    ensure_schema()
    out: set[str] = set()
    chunk = 200
    with connect() as conn, conn.cursor() as cur:
        for i in range(0, len(clean), chunk):
            part = clean[i : i + chunk]
            placeholders = ", ".join(["%s"] * len(part))
            cur.execute(
                f"""
                SELECT id FROM {TABLE}
                WHERE id IN ({placeholders})
                  AND content_html IS NOT NULL
                  AND content_html <> ''
                """,
                part,
            )
            out.update(str(row["id"]) for row in cur.fetchall())
    return out


def upsert_many(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    ensure_schema()
    values = []
    for row in rows:
        content_html = row.get("content_html") or ""
        values.append(
            [
                _clip(row.get("id") or row.get("bulletin_id"), 128),
                _clip(row.get("title") or "", 600),
                parse_time(row.get("publish_time") or row.get("pushTime")),
                _clip(row.get("category") or "notice", 64),
                _clip(row.get("bulletin_type") or "", 64),
                _clip(row.get("notice_name") or "", 120),
                _clip(row.get("url") or "", 1000),
                _clip(row.get("bid_id") or "", 128),
                _clip(row.get("bulletin_id") or "", 128),
                _clip(row.get("package_id") or "", 255),
                _clip(row.get("bid_code") or "", 255),
                _clip(row.get("bid_name") or "", 600),
                _clip(row.get("bid_type_name") or "", 120),
                _clip(row.get("project_type") or "", 120),
                _clip(row.get("purchaser") or "", 500),
                _clip(row.get("agency") or "", 500),
                _clip(row.get("region") or "", 255),
                _clip(row.get("budget") or "", 200),
                content_html,
                row.get("content_text") or _plain_text(content_html),
                _json_value(row.get("attchs") or []),
                _json_value(row.get("raw_json") or {}),
            ]
        )
    placeholders = ", ".join(["%s"] * len(UPSERT_COLUMNS))
    updates = ", ".join([f"{col}=VALUES({col})" for col in UPSERT_COLUMNS if col != "id"])
    sql = (
        f"INSERT INTO {TABLE} ({', '.join(UPSERT_COLUMNS)}) "
        f"VALUES ({placeholders}) ON DUPLICATE KEY UPDATE {updates}"
    )
    with connect() as conn, conn.cursor() as cur:
        cur.executemany(sql, values)
        return int(cur.rowcount or 0)
