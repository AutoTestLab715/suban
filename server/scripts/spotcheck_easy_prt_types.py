#!/usr/bin/env python3
"""Spot-check win/intent classifications before apply."""
from __future__ import annotations

import os
import re
from pathlib import Path

import pymysql

# import classifier from sibling script path after upload
import importlib.util

spec = importlib.util.spec_from_file_location(
    "bf", "/tmp/backfill_easy_prt_notice_type.py"
)
bf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bf)


def load_env() -> None:
    for p in ("/etc/biaoxun-query-api.env", "/opt/fujian-qwjsy/.env"):
        path = Path(p)
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def main() -> None:
    load_env()
    conn = pymysql.connect(
        host=os.environ.get("BIAOXUN_DB_HOST") or os.environ.get("MYSQL_HOST") or "127.0.0.1",
        user=os.environ.get("BIAOXUN_DB_USER") or os.environ.get("MYSQL_USER"),
        password=os.environ.get("BIAOXUN_DB_PASSWORD") or os.environ.get("MYSQL_PASSWORD"),
        database=os.environ.get("BIAOXUN_DB_NAME") or os.environ.get("MYSQL_DATABASE") or "biaoxun",
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )
    cur = conn.cursor()
    cur.execute("SELECT id, title, content_text FROM easy_prt")
    wins = []
    intents = []
    for row in cur.fetchall():
        t, src, kw = bf.classify(row["title"] or "", row["content_text"] or "")
        if t == bf.TYPE_WIN:
            wins.append((kw, src, row["title"][:70], (row["content_text"] or "")[:200]))
        elif t == bf.TYPE_INTENT:
            intents.append((kw, src, row["title"][:70]))

    print(f"win={len(wins)} intent={len(intents)}")
    print("\n=== WIN sample 30 ===")
    for i, (kw, src, title, snip) in enumerate(wins[:30]):
        print(f"{i+1}. [{kw} @{src}] {title}")
        snip_one = re.sub(r"\s+", " ", snip)[:120]
        print(f"   snip: {snip_one}")

    # how many title is platform junk
    junk = [w for w in wins if "工采通电子招投标交易平台" in (w[2] or "")]
    print(f"\njunk platform title wins: {len(junk)}")

    # win keyword breakdown
    from collections import Counter

    print("\nwin keywords:", Counter(w[0] for w in wins).most_common())
    print("\nintent:")
    for kw, src, title in intents:
        print(f"  [{kw} @{src}] {title}")
    conn.close()


if __name__ == "__main__":
    main()
