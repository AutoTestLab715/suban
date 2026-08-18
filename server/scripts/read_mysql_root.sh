#!/bin/bash
python3 <<'PY'
import sqlite3
c = sqlite3.connect("/www/server/panel/data/default.db")
row = c.execute("select mysql_root from config where id=1").fetchone()
print("len:", len(row[0]) if row else 0)
print("value:", row[0][:80] if row else "none")
PY
