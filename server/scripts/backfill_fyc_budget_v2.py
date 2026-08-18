#!/usr/bin/env python3
"""Second-pass budget backfill for fyc table from content_text."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pymysql
from pymysql.cursors import DictCursor


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


AMOUNT = r"(?:人民币)?\s*[¥￥]?\s*\d[\d,\.]*\s*(?:亿元|万元|万|元)"
KEYWORDS = (
    "预算金额",
    "采购预算",
    "项目预算",
    "最高限价",
    "投标限价",
    "最高投标限价",
    "控制价",
    "控制总价",
    "招标控制价",
    "采购控制价",
)

PATTERNS = [
    re.compile(rf"(?:{'|'.join(KEYWORDS)})\s*[:：]?\s*({AMOUNT})", re.IGNORECASE),
    re.compile(rf"({AMOUNT})\s*(?:整)?\s*(?:{'|'.join(KEYWORDS)})", re.IGNORECASE),
]


def normalize_budget(value: str) -> str:
    out = re.sub(r"\s+", "", value)
    out = out.replace("人民币", "")
    return out[:200]


def extract_budget(text: str) -> str:
    if not text:
        return ""
    body = re.sub(r"\s+", " ", text)
    for pattern in PATTERNS:
        match = pattern.search(body)
        if match:
            return normalize_budget(match.group(1))
    return ""


def main() -> None:
    apply_mode = "--apply" in sys.argv
    env = load_env(Path("/opt/fujian-qwjsy/.env"))
    conn = pymysql.connect(
        host=env.get("MYSQL_HOST", "127.0.0.1"),
        port=int(env.get("MYSQL_PORT", "3306")),
        user=env.get("MYSQL_USER", "biaoxun"),
        password=env.get("MYSQL_PASSWORD", ""),
        database=env.get("MYSQL_DATABASE", "biaoxun"),
        charset="utf8mb4",
        autocommit=True,
        cursorclass=DictCursor,
    )

    updates: list[tuple[str, str]] = []
    samples: list[tuple[str, str, str]] = []
    with conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, content_text
            FROM fyc
            WHERE (budget IS NULL OR TRIM(budget) = '')
              AND content_text IS NOT NULL
              AND TRIM(content_text) <> ''
            """
        )
        rows = cur.fetchall()
        for row in rows:
            budget = extract_budget(str(row.get("content_text") or ""))
            if not budget:
                continue
            nid = str(row["id"])
            updates.append((budget, nid))
            if len(samples) < 10:
                samples.append((nid, budget, str(row.get("title") or "")[:64]))

        print(f"round2_candidates={len(updates)}")
        for s in samples:
            print(f"sample id={s[0]} budget={s[1]} title={s[2]}")

        if apply_mode and updates:
            cur.executemany("UPDATE fyc SET budget=%s WHERE id=%s", updates)
            print(f"round2_updated={cur.rowcount}")

        cur.execute(
            "SELECT COUNT(*) AS total, "
            "SUM(CASE WHEN budget IS NOT NULL AND TRIM(budget) <> '' THEN 1 ELSE 0 END) AS has_budget "
            "FROM fyc"
        )
        stat = cur.fetchone() or {}
        print(f"total={stat.get('total', 0)} has_budget={stat.get('has_budget', 0)}")


if __name__ == "__main__":
    main()
