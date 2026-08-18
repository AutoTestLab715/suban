#!/usr/bin/env python3
import sys
sys.path.insert(0, "/opt/fujian-qwjsy")
from fyc_db import connect

with connect() as conn, conn.cursor() as cur:
    cur.execute("SHOW COLUMNS FROM fyc LIKE 'budget'")
    print("column:", cur.fetchall())
    cur.execute(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN budget IS NOT NULL AND budget <> '' THEN 1 ELSE 0 END) AS has_budget "
        "FROM fyc"
    )
    print("stats:", cur.fetchone())
    cur.execute(
        "SELECT budget, LEFT(title, 50) AS title FROM fyc "
        "WHERE budget IS NOT NULL AND budget <> '' LIMIT 5"
    )
    for row in cur.fetchall():
        print("sample:", row)
