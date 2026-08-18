#!/usr/bin/env python3
import re
import pymysql
from pathlib import Path
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

patterns = [
    r"预算金额\s*[(（]?元[)）]?\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元?",
    r"预算金额\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元",
    r"采购预算\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元",
    r"最高限价\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元",
    r"预算金额\s*[(（]元[)）]\s*([\d,]+(?:\.\d+)?)",
]

with conn.cursor() as cur:
    cur.execute(
        """
        SELECT id, budget, LEFT(title,40) AS title, content_text
        FROM hunan
        WHERE TRIM(IFNULL(budget,''))='' AND content_text LIKE '%预算%'
        ORDER BY notice_time DESC
        LIMIT 40
        """
    )
    rows = cur.fetchall()

hit = 0
for row in rows:
    text = re.sub(r"[\u00a0\u3000\s]+", " ", row["content_text"] or "")
    found = None
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            found = (pat[:24], m.group(1))
            break
    if found:
        hit += 1
        print("HIT", found[1], "|", row["title"], "|", found[0])
    else:
        # show nearby 预算金额 context
        idx = text.find("预算金额")
        frag = text[idx: idx + 80] if idx >= 0 else text[:80]
        print("MISS", row["title"], "|", frag)

print("hit_rate", hit, "/", len(rows))

# also test on nonempty
with conn.cursor() as cur:
    cur.execute(
        """
        SELECT id, budget, LEFT(title,40) AS title, content_text
        FROM hunan
        WHERE TRIM(IFNULL(budget,''))<>'' AND content_text LIKE '%预算金额%'
        ORDER BY notice_time DESC
        LIMIT 10
        """
    )
    print("=== nonempty ===")
    for row in cur.fetchall():
        text = re.sub(r"[\u00a0\u3000\s]+", " ", row["content_text"] or "")
        found = None
        for pat in patterns:
            m = re.search(pat, text, re.I)
            if m:
                found = m.group(1)
                break
        print(row["budget"], "->", found, "|", row["title"])
conn.close()
