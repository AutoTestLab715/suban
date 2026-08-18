#!/usr/bin/env python3
from __future__ import annotations

import os
import re
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


KEYWORDS = {
    "招标/采购": ["招标公告", "采购公告", "公开招标", "竞争性磋商", "竞争性谈判", "询价公告", "单一来源"],
    "中标/结果": ["中标", "成交", "结果公告", "候选人", "公示", "废标", "终止", "流标"],
    "变更/答疑": ["变更", "更正", "补充", "答疑", "澄清"],
    "意向": ["采购意向", "意向公开", "意向公告"],
    "合同": ["合同公示", "合同公告", "合同变更"],
}


def classify_title(title: str) -> str:
    t = title or ""
    for label, words in KEYWORDS.items():
        for w in words:
            if w in t:
                return label
    return "其他/未识别"


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

    print("=== notice_type 分布 ===")
    cur.execute("SELECT notice_type, COUNT(*) c FROM easy_prt GROUP BY notice_type ORDER BY c DESC")
    for r in cur.fetchall():
        print(r)

    print("\n=== 按标题关键词粗分类（全表） ===")
    cur.execute("SELECT title FROM easy_prt")
    counter: Counter[str] = Counter()
    for row in cur.fetchall():
        counter[classify_title(row["title"] or "")] += 1
    for k, v in counter.most_common():
        print(f"{k}: {v}")

    print("\n=== 标题含「中标/成交/结果/候选人/终止/意向」样本（最新20条） ===")
    cur.execute(
        """
        SELECT title, notice_type, notice_time, url
        FROM easy_prt
        WHERE title REGEXP '中标|成交|结果|候选人|终止|意向|废标|流标|公示'
        ORDER BY notice_time DESC
        LIMIT 20
        """
    )
    for r in cur.fetchall():
        print(f"[{r['notice_type']}] {r['notice_time']} | {r['title'][:80]}")

    print("\n=== 各关键词命中数 ===")
    for kw in ("中标", "成交", "结果公告", "候选人", "终止", "废标", "意向", "变更", "更正", "答疑", "合同"):
        cur.execute("SELECT COUNT(*) c FROM easy_prt WHERE title LIKE %s", (f"%{kw}%",))
        print(f"title~{kw}: {cur.fetchone()['c']}")

    print("\n=== 明显非招标标题样本（中标/结果/候选人/终止/意向）各5条 ===")
    for pat, label in [
        ("%中标%", "中标"),
        ("%候选人%", "候选人"),
        ("%结果%", "结果"),
        ("%终止%", "终止"),
        ("%意向%", "意向"),
    ]:
        cur.execute(
            "SELECT title, notice_type, notice_time FROM easy_prt WHERE title LIKE %s "
            "ORDER BY notice_time DESC LIMIT 5",
            (pat,),
        )
        rows = cur.fetchall()
        if rows:
            print(f"\n--- {label} ---")
            for r in rows:
                print(f"  [{r['notice_type']}] {r['notice_time']} | {r['title'][:90]}")

    print("\n=== content_text 含「结果公告/候选人/中标」但 notice_type=招标采购（5条） ===")
    cur.execute(
        """
        SELECT title, notice_type, LEFT(content_text, 120) snippet
        FROM easy_prt
        WHERE notice_type = '招标采购'
          AND (content_text LIKE '%结果公告%' OR content_text LIKE '%候选人%' OR content_text LIKE '%中标%')
        ORDER BY notice_time DESC
        LIMIT 5
        """
    )
    for r in cur.fetchall():
        print(f"  {r['title'][:70]}")
        print(f"    snippet: {(r['snippet'] or '')[:100]}")

    conn.close()


if __name__ == "__main__":
    main()
