#!/usr/bin/env python3
"""Re-classify easy_prt.notice_type by miniprogram CATEGORY_GROUPS rules.

Maps every row to one of:
  招标公告 / 中标公告 / 采购意向

Aligned with cloudfunctions/biaoxunApi/biaoxun.js CATEGORY_GROUPS:
  - intent: 采购意向*
  - win: exactTypes + emptyTitleInclude
  - tender: exactTypes + emptyTitleInclude, else default 招标公告
"""
from __future__ import annotations

import argparse
import os
import re
from collections import Counter
from pathlib import Path

import pymysql

TYPE_INTENT = "采购意向"
TYPE_WIN = "中标公告"
TYPE_TENDER = "招标公告"

# --- intent (CATEGORY_GROUPS.intent) ---
INTENT_PATTERNS = [
    re.compile(r"采购意向公告"),
    re.compile(r"政府采购意向"),
    re.compile(r"采购意向公开"),
    re.compile(r"采购意向"),
    re.compile(r"意向公开"),
    re.compile(r"意向公告"),
]

# --- win: exactTypes + emptyTitleInclude ---
WIN_EXACT = [
    re.compile(r"流标公告"),
    re.compile(r"成交公示"),
    re.compile(r"成交公告"),
    re.compile(r"结果公告"),
    re.compile(r"中标公告"),
    re.compile(r"终止公告"),
    re.compile(r"合同公告"),
    re.compile(r"合同公示"),
    re.compile(r"公开招标中标公告"),
    re.compile(r"竞争性磋商成交公告"),
    re.compile(r"竞争性谈判成交公告"),
    re.compile(r"废标公告"),
    re.compile(r"结果更正公告"),
    re.compile(r"询价成交公告"),
    re.compile(r"单一来源成交公告"),
    re.compile(r"合同变更公告"),
    re.compile(r"补充合同公告"),
    re.compile(r"中小企业预留份额执行情况公示"),
    re.compile(r"中标候选人公示"),
    re.compile(r"候选人公示"),
    re.compile(r"中标结果公示"),
    re.compile(r"中标结果公告"),
    re.compile(r"成交结果公告"),
    re.compile(r"成交结果公示"),
]

# emptyTitleInclude for win (weaker; title / content header only)
WIN_WEAK = [
    re.compile(r"流标"),
    re.compile(r"成交结果"),
    re.compile(r"合同变更"),
    re.compile(r"补充合同"),
    re.compile(r"入围成交"),
    re.compile(r"废标"),
    re.compile(r"中标"),
]

# --- tender: exactTypes + emptyTitleInclude ---
TENDER_EXACT = [
    re.compile(r"竞争性谈判公告"),
    re.compile(r"磋商公告"),
    re.compile(r"征集公告"),
    re.compile(r"更正公告"),
    re.compile(r"招标公告"),
    re.compile(r"公开招标采购公告"),
    re.compile(r"公开招标公告"),
    re.compile(r"竞争性磋商公告"),
    re.compile(r"采购更正公告"),
    re.compile(r"询价公告"),
    re.compile(r"单一来源采购公告"),
    re.compile(r"单一来源公示"),
    re.compile(r"采购公告"),
    re.compile(r"谈判公告"),
    re.compile(r"变更公告"),
    re.compile(r"补充公告"),
    re.compile(r"答疑公告"),
    re.compile(r"方案征集"),
    re.compile(r"需求调查"),
    re.compile(r"技术参数征集"),
    re.compile(r"需求公示"),
    re.compile(r"比选公告"),
    re.compile(r"公开比选"),
    re.compile(r"公开遴选"),
    re.compile(r"招租公告"),
    re.compile(r"公开招租"),
    re.compile(r"竞价公告"),
    re.compile(r"市场调查"),
    re.compile(r"标前"),
]

TENDER_WEAK = [
    re.compile(r"征集"),
    re.compile(r"更正"),
    re.compile(r"采购公示"),
    re.compile(r"进口产品"),
    re.compile(r"招标"),
    re.compile(r"询价"),
    re.compile(r"磋商"),
    re.compile(r"谈判"),
    re.compile(r"单一来源"),
    re.compile(r"框架协议"),
    re.compile(r"竞争性磋商"),
    re.compile(r"竞争性谈判"),
    re.compile(r"公开招标"),
]

# tender emptyTitleExclude — if these hit with only weak tender signals, prefer win check first
TENDER_EXCLUDE = [
    re.compile(r"成交结果"),
    re.compile(r"成交公示"),
    re.compile(r"成交公告"),
    re.compile(r"结果公告"),
    re.compile(r"终止公告"),
    re.compile(r"合同公告"),
    re.compile(r"流标"),
    re.compile(r"废标"),
    re.compile(r"中标"),
    re.compile(r"投诉"),
]


def load_env() -> None:
    for p in ("/etc/biaoxun-query-api.env", "/opt/fujian-qwjsy/.env", "/opt/easy-prt-portal/.env"):
        path = Path(p)
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def first_hit(text: str, patterns: list[re.Pattern]) -> str:
    for pat in patterns:
        m = pat.search(text or "")
        if m:
            return m.group(0)
    return ""


def classify(title: str, content: str) -> tuple[str, str, str]:
    """Return (type, source, keyword) following CATEGORY_GROUPS priority:
    intent → win → tender → default tender.
    """
    title = (title or "").strip()
    content = (content or "").strip()
    head = content[:2500]
    header = content[:220]
    title_head = f"{title}\n{header}"

    # 1) 采购意向
    for src, text in (("title", title), ("content_head", head), ("content", content[:12000])):
        kw = first_hit(text, INTENT_PATTERNS)
        if kw:
            return TYPE_INTENT, src, kw

    # 2) 中标公告
    # exactTypes：只认标题，或正文开头 220 字（文档标题区），避免模板后半段误伤
    title_is_tender = bool(
        first_hit(title, TENDER_EXACT) or first_hit(title, TENDER_WEAK)
    ) and not first_hit(title, WIN_EXACT)

    for src, text in (("title", title), ("content_header", header)):
        kw = first_hit(text, WIN_EXACT)
        if not kw:
            continue
        if src == "content_header" and title_is_tender:
            # 标题已是招标/征集，不因正文模板里的「终止公告/候选人公示」改判
            continue
        if src == "content_header":
            tpos = None
            wpos = None
            for pat in TENDER_EXACT:
                m = pat.search(text)
                if m and (tpos is None or m.start() < tpos):
                    tpos = m.start()
            for pat in WIN_EXACT:
                m = pat.search(text)
                if m and (wpos is None or m.start() < wpos):
                    wpos = m.start()
            if tpos is not None and wpos is not None and tpos < wpos:
                continue
        return TYPE_WIN, src, kw

    # emptyTitleInclude 弱词：仅标题
    kw = first_hit(title, WIN_WEAK)
    if kw and not title_is_tender:
        return TYPE_WIN, "title", kw

    # 3) 招标公告 — exact then weak; respect emptyTitleExclude on weak title matches
    for src, text in (("title", title), ("content_head", head), ("content", content[2500:12000])):
        kw = first_hit(text, TENDER_EXACT)
        if kw:
            return TYPE_TENDER, src, kw

    for src, text in (("title", title), ("content_head", head)):
        kw = first_hit(text, TENDER_WEAK)
        if not kw:
            continue
        # emptyTitleExclude: if exclude word also present, and no clear tender exact, still
        # default to tender unless win already caught — here we stay tender only if exclude
        # is absent OR tender exact already handled. Mirror backend: exclude means NOT tender
        # via empty heuristic; those should have been win. If only exclude+weak, leave default.
        if src == "title" and first_hit(text, TENDER_EXCLUDE):
            continue
        return TYPE_TENDER, src, kw

    return TYPE_TENDER, "default", ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--batch", type=int, default=500)
    args = parser.parse_args()

    load_env()
    conn = pymysql.connect(
        host=os.environ.get("BIAOXUN_DB_HOST")
        or os.environ.get("MYSQL_HOST")
        or "127.0.0.1",
        user=os.environ.get("BIAOXUN_DB_USER") or os.environ.get("MYSQL_USER"),
        password=os.environ.get("BIAOXUN_DB_PASSWORD") or os.environ.get("MYSQL_PASSWORD"),
        database=os.environ.get("BIAOXUN_DB_NAME")
        or os.environ.get("MYSQL_DATABASE")
        or "biaoxun",
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM easy_prt")
    total = cur.fetchone()["c"]
    print(f"total={total} mode={'APPLY' if args.apply else 'DRY-RUN'}")

    type_counter: Counter[str] = Counter()
    reason_counter: Counter[str] = Counter()
    keyword_counter: Counter[str] = Counter()
    samples: dict[str, list[str]] = {TYPE_INTENT: [], TYPE_WIN: [], TYPE_TENDER: []}
    updates: list[tuple[str, str, str]] = []
    changed = 0

    offset = 0
    while True:
        cur.execute(
            "SELECT id, title, content_text, notice_type, notice_name "
            "FROM easy_prt ORDER BY id LIMIT %s OFFSET %s",
            (args.batch, offset),
        )
        rows = cur.fetchall()
        if not rows:
            break
        offset += len(rows)
        for row in rows:
            new_type, src, kw = classify(row.get("title") or "", row.get("content_text") or "")
            type_counter[new_type] += 1
            reason_counter[f"{new_type}|{src}"] += 1
            if kw:
                keyword_counter[f"{new_type}|{kw}"] += 1
            if len(samples[new_type]) < 8:
                samples[new_type].append(
                    f"{kw or '-'} @{src} | {(row.get('title') or '')[:80]}"
                )
            old_type = (row.get("notice_type") or "").strip()
            old_name = (row.get("notice_name") or "").strip()
            if old_type != new_type or old_name != new_type:
                changed += 1
                updates.append((new_type, new_type, row["id"]))
        print(f"scanned {min(offset, total)}/{total}", flush=True)

    print("\n=== distribution ===")
    for k, v in type_counter.most_common():
        print(f"  {k}: {v} ({v * 100 / total:.2f}%)")

    print("\n=== reason ===")
    for k, v in reason_counter.most_common(25):
        print(f"  {k}: {v}")

    print("\n=== top keywords ===")
    for k, v in keyword_counter.most_common(30):
        print(f"  {k}: {v}")

    print("\n=== samples ===")
    for t, items in samples.items():
        print(f"\n[{t}]")
        for s in items:
            print(f"  - {s}")

    print(f"\nrows needing update: {changed}")

    if args.apply and updates:
        for i in range(0, len(updates), args.batch):
            chunk = updates[i : i + args.batch]
            cur.executemany(
                "UPDATE easy_prt SET notice_type=%s, notice_name=%s WHERE id=%s",
                chunk,
            )
            conn.commit()
            print(f"updated {min(i + len(chunk), len(updates))}/{len(updates)}", flush=True)
        print("APPLY done")
    elif not args.apply:
        print("dry-run only; re-run with --apply to write")

    cur.execute(
        "SELECT notice_type, COUNT(*) c FROM easy_prt GROUP BY notice_type ORDER BY c DESC"
    )
    print("\n=== DB notice_type now ===")
    for r in cur.fetchall():
        print(f"  {r['notice_type']!r}: {r['c']}")
    conn.close()


if __name__ == "__main__":
    main()
