#!/usr/bin/env python3
"""Sample hunan content budget snippets for backfill design."""
from pathlib import Path
import re
import pymysql
from pymysql.cursors import DictCursor

def load_env(path):
    env = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env = load_env("/opt/fujian-qwjsy/.env")
conn = pymysql.connect(
    host=env.get("MYSQL_HOST", "127.0.0.1"),
    user=env["MYSQL_USER"],
    password=env["MYSQL_PASSWORD"],
    database="biaoxun",
    charset="utf8mb4",
    cursorclass=DictCursor,
)
with conn.cursor() as cur:
    cur.execute(
        """
        SELECT id, budget, notice_type, LEFT(title,40) title, content_text
        FROM hunan
        WHERE content_text LIKE '%预算金额%' OR content_text LIKE '%采购预算%'
        ORDER BY notice_time DESC
        LIMIT 12
        """
    )
    for row in cur.fetchall():
        text = re.sub(r"[\u00a0\u3000\s]+", " ", row["content_text"] or "")
        for key in ("预算金额", "采购预算", "最高限价"):
            i = text.find(key)
            if i >= 0:
                print("---", row["budget"], "|", row["notice_type"], "|", row["title"])
                print(text[i : i + 90])
                break
conn.close()
