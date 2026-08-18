#!/usr/bin/env python3
"""Full audit of easy_prt notice classification."""
from __future__ import annotations

import os
import re
from collections import Counter, defaultdict
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


# priority: first match wins (more specific first)
RULES = [
    ("采购意向", [r"采购意向", r"意向公开", r"意向公告", r"政府采购意向"]),
    ("中标/结果", [r"中标结果", r"中标公告", r"成交公告", r"结果公告", r"候选人公示", r"中标候选人", r"入围成交"]),
    ("终止/废标", [r"终止公告", r"废标公告", r"流标", r"已终止"]),
    ("变更/更正/答疑", [r"变更公告", r"更正公告", r"补充公告", r"答疑公告", r"澄清公告", r"补充/答疑"]),
    ("单一来源", [r"单一来源"]),
    ("需求公示", [r"需求公示", r"采购需求"]),
    ("竞争性磋商", [r"竞争性磋商", r"磋商公告"]),
    ("竞争性谈判", [r"竞争性谈判", r"谈判公告"]),
    ("询价", [r"询价公告", r"询价采购", r"询价"]),
    ("招标公告", [r"招标公告", r"公开招标"]),
    ("采购公告", [r"采购公告"]),
    ("合同", [r"合同公示", r"合同公告", r"合同变更"]),
    ("其他公示", [r"公示"]),
]


def classify(text: str) -> str:
    t = text or ""
    for label, pats in RULES:
        for pat in pats:
            if re.search(pat, t):
                return label
    return "未识别"


def classify_tab(text: str) -> str:
    """Map to miniprogram tabs: tender / win / intent / other."""
    label = classify(text)
    if label == "采购意向":
        return "采购意向(intent)"
    if label in ("中标/结果", "终止/废标", "合同"):
        return "中标公告(win)"
    if label == "未识别":
        return "未识别"
    return "招标公告(tender)"


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

    cur.execute("SELECT COUNT(*) c FROM easy_prt")
    total = cur.fetchone()["c"]
    print(f"=== easy_prt 全表审计  total={total} ===\n")

    print("--- 字段分布 ---")
    for col in ("notice_type", "notice_name", "category"):
        cur.execute(f"SELECT `{col}`, COUNT(*) c FROM easy_prt GROUP BY `{col}` ORDER BY c DESC")
        for r in cur.fetchall():
            print(f"  {col}={r[col]!r}: {r['c']}")

    print("\n--- 空字段 ---")
    for col in ("title", "content_text", "content_html", "url", "region", "purchaser", "budget", "notice_time"):
        cur.execute(
            f"SELECT COUNT(*) c FROM easy_prt WHERE `{col}` IS NULL OR TRIM(`{col}`) = ''"
        )
        print(f"  empty {col}: {cur.fetchone()['c']}")

    print("\n--- 按标题分类（全表） ---")
    cur.execute("SELECT id, title, LEFT(IFNULL(content_text,''), 600) snippet FROM easy_prt")
    by_title: Counter[str] = Counter()
    by_title_or_body: Counter[str] = Counter()
    by_tab_title: Counter[str] = Counter()
    by_tab_combo: Counter[str] = Counter()
    samples: dict[str, list] = defaultdict(list)

    for row in cur.fetchall():
        title = row["title"] or ""
        snippet = row["snippet"] or ""
        combo = f"{title}\n{snippet}"

        lt = classify(title)
        lc = classify(combo)
        tt = classify_tab(title)
        tc = classify_tab(combo)

        by_title[lt] += 1
        by_title_or_body[lc] += 1
        by_tab_title[tt] += 1
        by_tab_combo[tc] += 1

        if lt != "未识别" and len(samples[lt]) < 3:
            samples[lt].append(title[:90])
        if lt == "未识别" and lc != "未识别" and len(samples[f"正文命中:{lc}"]) < 3:
            samples[f"正文命中:{lc}"].append(title[:90])

    print("标题:")
    for k, v in by_title.most_common():
        print(f"  {k}: {v} ({v*100/total:.2f}%)")

    print("\n标题+正文前600字:")
    for k, v in by_title_or_body.most_common():
        print(f"  {k}: {v} ({v*100/total:.2f}%)")

    print("\n--- 对应小程序 Tab（标题） ---")
    for k, v in by_tab_title.most_common():
        print(f"  {k}: {v}")

    print("\n--- 对应小程序 Tab（标题+正文） ---")
    for k, v in by_tab_combo.most_common():
        print(f"  {k}: {v}")

    print("\n--- 各类样本 ---")
    for k in sorted(samples.keys()):
        print(f"\n[{k}]")
        for t in samples[k]:
            print(f"  - {t}")

    # current query filter simulation
    print("\n--- 当前后端过滤若按 notice_type 精确匹配 ---")
    for label, types in [
        ("招标(tender)", ["招标采购"]),
        ("中标(win)", ["中标公告", "成交公告", "结果公告", "合同公示", "废标公告", "终止公告"]),
        ("意向(intent)", ["采购意向", "采购意向公告"]),
    ]:
        if not types:
            continue
        ph = ",".join(["%s"] * len(types))
        cur.execute(f"SELECT COUNT(*) c FROM easy_prt WHERE notice_type IN ({ph})", types)
        print(f"  {label} notice_type IN {types}: {cur.fetchone()['c']}")

    print("\n--- 若按标题关键词模拟过滤 ---")
    title_filters = [
        ("招标侧(磋商/谈判/询价/招标/采购/单一来源/变更)", "%竞争性磋商%|%竞争性谈判%|%询价%|%招标公告%|%采购公告%|%单一来源%|%变更%|%更正%"),
        ("意向", "%采购意向%|%意向公开%|%意向公告%"),
        ("中标侧", "%中标%|%成交%|%结果公告%|%候选人%|%终止公告%|%废标%"),
    ]
    for label, _ in title_filters:
        pass
    cur.execute(
        "SELECT COUNT(*) c FROM easy_prt WHERE "
        "title LIKE '%采购意向%' OR title LIKE '%意向公开%' OR title LIKE '%意向公告%' OR title LIKE '%政府采购意向%'"
    )
    print(f"  意向(标题): {cur.fetchone()['c']}")
    cur.execute(
        "SELECT COUNT(*) c FROM easy_prt WHERE "
        "title LIKE '%中标%' OR title LIKE '%成交公告%' OR title LIKE '%结果公告%' "
        "OR title LIKE '%候选人%' OR title LIKE '%终止公告%' OR title LIKE '%废标%'"
    )
    print(f"  中标(标题): {cur.fetchone()['c']}")

    print("\n--- 时间范围 ---")
    cur.execute(
        "SELECT MIN(notice_time) mn, MAX(notice_time) mx, "
        "SUM(notice_time IS NULL) null_t FROM easy_prt"
    )
    r = cur.fetchone()
    print(f"  notice_time: {r['mn']} ~ {r['mx']}, null={r['null_t']}")

    conn.close()
    print("\n=== 审计完成 ===")


if __name__ == "__main__":
    main()
