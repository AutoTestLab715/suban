#!/usr/bin/env python3
from __future__ import annotations

import os
from collections import Counter
from pathlib import Path

import pymysql


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
        host=os.environ.get("BIAOXUN_DB_HOST") or "127.0.0.1",
        user=os.environ.get("BIAOXUN_DB_USER") or os.environ.get("MYSQL_USER"),
        password=os.environ.get("BIAOXUN_DB_PASSWORD") or os.environ.get("MYSQL_PASSWORD"),
        database=os.environ.get("BIAOXUN_DB_NAME") or "biaoxun",
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )
    cur = conn.cursor()

    for col in ("notice_name", "category", "keyword"):
        cur.execute(f"SELECT `{col}`, COUNT(*) c FROM easy_prt GROUP BY `{col}` ORDER BY c DESC LIMIT 15")
        print(f"=== {col} ===")
        for r in cur.fetchall():
            print(r)

    patterns = [
        ("单一来源", "%单一来源%"),
        ("采购意向", "%采购意向%"),
        ("需求公示", "%需求公示%"),
        ("公示", "%公示%"),
        ("竞争性磋商", "%竞争性磋商%"),
        ("竞争性谈判", "%竞争性谈判%"),
        ("询价", "%询价%"),
        ("招标公告", "%招标公告%"),
        ("采购公告", "%采购公告%"),
        ("结果", "%结果%"),
        ("候选人", "%候选人%"),
        ("终止", "%终止%"),
    ]
    print("\n=== title pattern counts ===")
    for label, pat in patterns:
        cur.execute("SELECT COUNT(*) c FROM easy_prt WHERE title LIKE %s", (pat,))
        print(label, cur.fetchone()["c"])

    print("\n=== 单一来源/意向/需求公示 样本 ===")
    cur.execute(
        """
        SELECT title, notice_type, notice_time FROM easy_prt
        WHERE title LIKE '%单一来源%' OR title LIKE '%采购意向%' OR title LIKE '%需求公示%'
        ORDER BY notice_time DESC LIMIT 15
        """
    )
    for r in cur.fetchall():
        print(f"[{r['notice_type']}] {r['notice_time']} | {r['title'][:95]}")

    print("\n=== content_text 公告类型词频（最新5000条） ===")
    cur.execute(
        "SELECT LEFT(content_text, 800) t FROM easy_prt "
        "WHERE content_text IS NOT NULL ORDER BY notice_time DESC LIMIT 5000"
    )
    ctr: Counter[str] = Counter()
    words = [
        "招标公告",
        "采购公告",
        "竞争性磋商公告",
        "竞争性谈判公告",
        "询价公告",
        "单一来源",
        "采购意向",
        "结果公告",
        "候选人公示",
        "成交公告",
        "终止公告",
        "废标公告",
        "变更公告",
        "更正公告",
        "补充公告",
        "答疑公告",
    ]
    for row in cur.fetchall():
        t = row["t"] or ""
        for w in words:
            if w in t:
                ctr[w] += 1
    for w, c in ctr.most_common():
        print(w, c)

    conn.close()


if __name__ == "__main__":
    main()
