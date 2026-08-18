#!/usr/bin/env python3
from pathlib import Path
import pymysql
from pymysql.cursors import DictCursor
import importlib.util

spec = importlib.util.spec_from_file_location("bf", "/tmp/backfill_hunan_budget_yuan.py")
bf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bf)

env = bf.load_env(Path("/opt/fujian-qwjsy/.env"))
conn = pymysql.connect(
    host=env.get("MYSQL_HOST", "127.0.0.1"),
    user=env["MYSQL_USER"],
    password=env["MYSQL_PASSWORD"],
    database="biaoxun",
    charset="utf8mb4",
    cursorclass=DictCursor,
)
with conn.cursor() as cur:
    cur.execute("SELECT id, title, budget, content_text FROM hunan")
    for row in cur.fetchall():
        new, src = bf.resolve_budget(row["budget"] or "", row["content_text"] or "")
        if not src.startswith("content:wan_table"):
            continue
        num = float(new.replace("元", ""))
        if num >= 50_000_000:  # >= 5000万
            text = bf.clean_text(row["content_text"] or "")
            m = bf.WAN_TABLE_RE.search(text)
            body = (m.group("body") if m else "")[:300]
            print(new, "|", (row["title"] or "")[:40])
            print("  body:", body.replace("\n", " ")[:220])
            print()
conn.close()
