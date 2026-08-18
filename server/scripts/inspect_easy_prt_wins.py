#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path

import pymysql

spec = importlib.util.spec_from_file_location("bf", "/tmp/backfill_easy_prt_by_category_rules.py")
bf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bf)
bf.load_env()
conn = pymysql.connect(
    host=os.environ.get("BIAOXUN_DB_HOST") or "127.0.0.1",
    user=os.environ.get("BIAOXUN_DB_USER") or os.environ.get("MYSQL_USER"),
    password=os.environ.get("BIAOXUN_DB_PASSWORD") or os.environ.get("MYSQL_PASSWORD"),
    database=os.environ.get("BIAOXUN_DB_NAME") or "biaoxun",
    charset="utf8mb4",
    cursorclass=pymysql.cursors.DictCursor,
)
cur = conn.cursor()
cur.execute(
    "SELECT title, content_text FROM easy_prt WHERE notice_type=%s ORDER BY notice_time DESC",
    ("中标公告",),
)
for r in cur.fetchall():
    t, s, k = bf.classify(r["title"] or "", r["content_text"] or "")
    print("---")
    print("title:", (r["title"] or "")[:70])
    print("class:", t, s, k)
    head = (r["content_text"] or "")[:200].replace("\n", " ")
    print("head:", head)
conn.close()
