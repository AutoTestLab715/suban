#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import re
from pathlib import Path

import pymysql

spec = importlib.util.spec_from_file_location("bf", "/tmp/backfill_easy_prt_notice_type.py")
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
    print("=== ALL WIN ===")
    for row in cur.fetchall():
        t, src, kw = bf.classify(row["title"] or "", row["content_text"] or "")
        if t != bf.TYPE_WIN:
            continue
        snip = re.sub(r"\s+", " ", (row["content_text"] or "")[:180])
        print(f"[{kw} @{src}] {row['title'][:75]}")
        print(f"  {snip}")
    print("\n=== ALL INTENT ===")
    cur.execute("SELECT id, title, content_text FROM easy_prt")
    for row in cur.fetchall():
        t, src, kw = bf.classify(row["title"] or "", row["content_text"] or "")
        if t != bf.TYPE_INTENT:
            continue
        print(f"[{kw} @{src}] {row['title'][:90]}")
    conn.close()


if __name__ == "__main__":
    main()
