#!/usr/bin/env python3
"""Backfill fyc.budget by extracting budget strings from content_text."""

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


PATTERNS = [
    re.compile(
        r"(?:预算金额|采购预算|项目预算|最高限价|控制价|招标控制价)\s*[:：]?\s*"
        r"((?:人民币)?\s*[¥￥]?\s*\d[\d,\.]*\s*(?:亿元|万元|万|元)?)",
        re.IGNORECASE,
    ),
    re.compile(
        r"((?:人民币)?\s*[¥￥]\s*\d[\d,\.]*\s*(?:亿元|万元|万|元)?)",
        re.IGNORECASE,
    ),
]


def extract_budget(text: str) -> str:
    body = re.sub(r"\s+", " ", text or "")
    for pattern in PATTERNS:
        match = pattern.search(body)
        if not match:
            continue
        value = re.sub(r"\s+", "", match.group(1))
        if len(value) > 200:
            value = value[:200]
        return value
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

    candidates: list[tuple[str, str]] = []
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
            notice_id = str(row["id"])
            candidates.append((budget, notice_id))
            if len(samples) < 8:
                samples.append((notice_id, budget, str(row.get("title") or "")[:60]))

        print(f"empty_budget_with_text={len(rows)}")
        print(f"matched_for_backfill={len(candidates)}")
        for sample in samples:
            print(f"sample id={sample[0]} budget={sample[1]} title={sample[2]}")

        if apply_mode and candidates:
            cur.executemany("UPDATE fyc SET budget=%s WHERE id=%s", candidates)
            print(f"updated_rows={cur.rowcount}")

        cur.execute(
            "SELECT COUNT(*) AS total, "
            "SUM(CASE WHEN budget IS NOT NULL AND TRIM(budget) <> '' THEN 1 ELSE 0 END) AS has_budget "
            "FROM fyc"
        )
        stat = cur.fetchone() or {}
        print(f"total={stat.get('total', 0)} has_budget={stat.get('has_budget', 0)}")


if __name__ == "__main__":
    main()
