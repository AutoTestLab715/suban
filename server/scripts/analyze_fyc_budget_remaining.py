#!/usr/bin/env python3
"""
Analyze fyc remaining rows (budget empty) to classify why they weren't backfilled.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pymysql
from pymysql.cursors import DictCursor


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def count_like(cur, keyword: str, where_extra: str = "") -> int:
    sql = f"""
    SELECT COUNT(*) AS c
    FROM fyc
    WHERE {where_extra}
      AND content_text LIKE %s
    """
    cur.execute(sql, ("%"+keyword+"%",))
    row = cur.fetchone() or {}
    return int(row.get("c") or 0)


def main() -> None:
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

    empty_where = "(budget IS NULL OR TRIM(budget)='')"

    # base stats
    with conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM fyc WHERE {empty_where} AND content_text IS NOT NULL AND TRIM(content_text)<>''")
        base = cur.fetchone() or {}
        empty_count = int(base.get("c") or 0)

        cur.execute(f"SELECT COUNT(*) AS c FROM fyc WHERE {empty_where}")
        empty_all = int((cur.fetchone() or {}).get("c") or 0)

        # Keyword groups (rough classification)
        total_like_keywords = [
            "预算金额",
            "采购预算",
            "项目预算",
            "最高限价",
            "控制价",
            "招标控制价",
            "投标限价",
            "最高投标限价",
            "控制总价",
            "最高控制价",
            "最高投标控制总价",
            "预算最高限价",
            "最高限价",
        ]
        unit_like_keywords = [
            "单价",
            "报价单价",
            "单价最高",
            "每",
            "元/吨",
            "元/㎡",
            "元/平方米",
            "万元/㎡",
            "每吨",
            "每立方",
            "/吨",
            "/㎡",
        ]

        total_hits = []
        for kw in total_like_keywords:
            c = count_like(cur, kw, where_extra=empty_where + " AND TRIM(content_text)<>''")
            if c:
                total_hits.append((kw, c))

        unit_hits = []
        for kw in unit_like_keywords:
            c = count_like(cur, kw, where_extra=empty_where + " AND TRIM(content_text)<>''")
            if c:
                unit_hits.append((kw, c))

        # Any keyword presence (OR-style) via SQL OR list
        def any_keyword_count(keywords: list[str]) -> int:
            if not keywords:
                return 0
            or_clause = " OR ".join([f"content_text LIKE %s" for _ in keywords])
            sql = f"SELECT COUNT(*) AS c FROM fyc WHERE {empty_where} AND TRIM(content_text)<>'' AND ({or_clause})"
            params = [f"%{k}%" for k in keywords]
            cur.execute(sql, params)
            return int((cur.fetchone() or {}).get("c") or 0)

        total_any = any_keyword_count(total_like_keywords)
        unit_any = any_keyword_count(unit_like_keywords)

        print(f"empty_budget_all={empty_all}")
        print(f"empty_budget_with_nonempty_text={empty_count}")
        print(f"empty_budget_content_has_total_keywords={total_any}")
        print(f"empty_budget_content_has_unit_keywords={unit_any}")

        # Show top hits
        print("\\nTop total-keyword matches:")
        for kw, c in sorted(total_hits, key=lambda x: -x[1])[:15]:
            print(f"{kw}: {c}")

        print("\\nTop unit-keyword matches:")
        for kw, c in sorted(unit_hits, key=lambda x: -x[1])[:15]:
            print(f"{kw}: {c}")

        # Sample a few ids that have total keywords but still empty budget
        cur.execute(
            f"""
            SELECT id, title, SUBSTRING(content_text, 1, 220) AS snippet
            FROM fyc
            WHERE {empty_where}
              AND TRIM(content_text)<>'' AND ({' OR '.join(['content_text LIKE %s'] * len(total_like_keywords))})
            ORDER BY publish_time DESC
            LIMIT 5
            """,
            [f"%{k}%" for k in total_like_keywords],
        )
        samples = cur.fetchall() or []
        print("\nSamples (empty budget but has total keywords):")
        for r in samples:
            print(f"- id={r.get('id')} title={r.get('title')}")
            print(f"  snippet={r.get('snippet')}")


if __name__ == "__main__":
    main()

