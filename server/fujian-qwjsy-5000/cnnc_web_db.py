#!/usr/bin/env python3
"""Read-only web queries for the CNNC crawler table."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import pymysql
from pymysql.cursors import DictCursor


ENV_FILE = Path(__file__).resolve().parent / ".env"
TABLE_NAME = "cnnc_notices"
CATEGORIES = {
    "zhaobiao": "中核招标",
    "gongcheng": "中核工程",
    "huowu": "中核设备",
    "xunjia": "中核询价",
    "zhongbiao": "中核中标",
}


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


def ensure_cnnc_schema() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS cnnc_notices LIKE notices")


def _title_query(keyword: str) -> str:
    return "".join(re.findall(r"[0-9A-Za-z\u3400-\u9fff]+", keyword))[:80]


def _where(category: str, keyword: str) -> tuple[str, list[Any]]:
    clauses = ["1=1"]
    args: list[Any] = []
    label = CATEGORIES.get(category)
    if label:
        clauses.append("notice_name = %s")
        args.append(label)
    term = _title_query(keyword.strip())
    if term:
        clauses.append("MATCH(title) AGAINST(%s IN BOOLEAN MODE)")
        args.append(term)
    return " AND ".join(clauses), args


def fetch_cnnc_page(page: int, per_page: int, category: str = "", keyword: str = "") -> tuple[int, list[dict[str, Any]]]:
    page = max(1, int(page))
    per_page = max(1, min(100, int(per_page)))
    where, args = _where(category, keyword)
    offset = (page - 1) * per_page
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM {TABLE_NAME} WHERE {where}", args)
        total = int(cur.fetchone()["c"] or 0)
        cur.execute(
            f"SELECT id, source, title, notice_time, region, notice_name, notice_type, url, project_no, "
            f"purchaser, agency, budget, successful_money, description, content_html, content_text "
            f"FROM {TABLE_NAME} WHERE {where} ORDER BY notice_time DESC, crawled_at DESC, id DESC LIMIT %s OFFSET %s",
            [*args, per_page, offset],
        )
        return total, list(cur.fetchall())


def fetch_cnnc(notice_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {TABLE_NAME} WHERE id = %s LIMIT 1",
            [notice_id],
        )
        row = cur.fetchone()
        return dict(row) if row else None


def count_cnnc() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM {TABLE_NAME}")
        return int(cur.fetchone()["c"] or 0)
