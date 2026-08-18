#!/usr/bin/env python3
"""Backfill easy_prt.notice_type / notice_name from title+content_text.

Target types (3 tabs):
  - 招标公告
  - 中标公告
  - 采购意向
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

# More specific patterns first within each group.
INTENT_PATTERNS = [
    re.compile(r"采购意向公告"),
    re.compile(r"政府采购意向"),
    re.compile(r"采购意向公开"),
    re.compile(r"采购意向"),
    re.compile(r"意向公开"),
    re.compile(r"意向公告"),
]

WIN_PATTERNS = [
    re.compile(r"中标候选人公示"),
    re.compile(r"候选人公示"),
    re.compile(r"中标结果公示"),
    re.compile(r"中标结果公告"),
    re.compile(r"公开招标中标公告"),
    re.compile(r"中标公告"),
    re.compile(r"成交结果公告"),
    re.compile(r"成交结果公示"),
    re.compile(r"成交公告"),
    re.compile(r"结果公告"),
    re.compile(r"废标公告"),
    re.compile(r"终止公告"),
    re.compile(r"合同公示"),
    re.compile(r"合同公告"),
    re.compile(r"合同变更公告"),
    re.compile(r"补充合同公告"),
    re.compile(r"入围成交"),
]

# Strong tender markers — used when neither intent nor win matched.
TENDER_PATTERNS = [
    re.compile(r"招标公告"),
    re.compile(r"采购公告"),
    re.compile(r"竞争性磋商公告"),
    re.compile(r"竞争性谈判公告"),
    re.compile(r"询价公告"),
    re.compile(r"单一来源采购公告"),
    re.compile(r"单一来源公示"),
    re.compile(r"单一来源"),
    re.compile(r"变更公告"),
    re.compile(r"更正公告"),
    re.compile(r"补充公告"),
    re.compile(r"答疑公告"),
    re.compile(r"需求公示"),
    re.compile(r"方案征集"),
    re.compile(r"需求调查"),
    re.compile(r"技术参数征集"),
    re.compile(r"标前"),
    re.compile(r"比选公告"),
    re.compile(r"公开比选"),
    re.compile(r"公开遴选"),
    re.compile(r"招租公告"),
    re.compile(r"市场调查"),
    re.compile(r"竞争性磋商"),
    re.compile(r"竞争性谈判"),
    re.compile(r"询价"),
    re.compile(r"公开招标"),
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


def _collect_hits(
    text: str, patterns: list[re.Pattern], type_name: str, base_pos: int = 0
) -> list[tuple[int, int, str, str]]:
    """Return list of (abs_pos, type_rank, type_name, keyword)."""
    rank = {TYPE_INTENT: 0, TYPE_WIN: 1, TYPE_TENDER: 2}[type_name]
    hits: list[tuple[int, int, str, str]] = []
    for pat in patterns:
        for m in pat.finditer(text):
            hits.append((base_pos + m.start(), rank, type_name, m.group(0)))
            break  # first hit per pattern is enough
    return hits


def classify(title: str, content: str) -> tuple[str, str, str]:
    """Return (type, reason_source, matched_keyword).

    Rules:
      1) Title first, then content.
      2) Earliest keyword wins —「招标公告 结果公告」导航会归招标.
      3) Win keywords only count in title or content header (first 220 chars),
         to avoid template footer false positives (方案征集文里夹带「成交公告」).
      4) Intent/tender can match in title + content head (2500).
      5) No hit → 招标公告.
    """
    title = (title or "").strip()
    content = (content or "").strip()
    head = content[:2500]
    win_zone = content[:220]

    title_pad = 0
    content_base = len(title) + 1000

    hits: list[tuple[int, int, str, str]] = []
    if title:
        hits.extend(_collect_hits(title, INTENT_PATTERNS, TYPE_INTENT, title_pad))
        hits.extend(_collect_hits(title, WIN_PATTERNS, TYPE_WIN, title_pad))
        hits.extend(_collect_hits(title, TENDER_PATTERNS, TYPE_TENDER, title_pad))
    if head:
        hits.extend(_collect_hits(head, INTENT_PATTERNS, TYPE_INTENT, content_base))
        hits.extend(_collect_hits(head, TENDER_PATTERNS, TYPE_TENDER, content_base))
    if win_zone:
        hits.extend(_collect_hits(win_zone, WIN_PATTERNS, TYPE_WIN, content_base))

    if not hits:
        rest = content[2500:12000]
        if rest:
            hits.extend(_collect_hits(rest, INTENT_PATTERNS, TYPE_INTENT, content_base + 2500))
            hits.extend(_collect_hits(rest, TENDER_PATTERNS, TYPE_TENDER, content_base + 2500))

    if not hits:
        return TYPE_TENDER, "default", ""

    hits.sort(key=lambda x: (x[0], x[1]))
    pos, _rank, type_name, kw = hits[0]
    if pos < content_base:
        src = "title"
    elif type_name == TYPE_WIN or pos < content_base + 220:
        src = "content_head" if type_name != TYPE_WIN else "content_header"
    elif pos < content_base + 2500:
        src = "content_head"
    else:
        src = "content"
    return type_name, src, kw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write updates (default dry-run)")
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
            if len(samples[new_type]) < 5:
                samples[new_type].append(
                    f"{kw or '-'} @{src} | {(row.get('title') or '')[:80]}"
                )

            old_type = (row.get("notice_type") or "").strip()
            old_name = (row.get("notice_name") or "").strip()
            if old_type != new_type or old_name != new_type:
                updates.append((new_type, new_type, row["id"]))

        print(f"scanned {min(offset, total)}/{total}", flush=True)

    print("\n=== type distribution ===")
    for k, v in type_counter.most_common():
        print(f"  {k}: {v} ({v * 100 / total:.2f}%)")

    print("\n=== reason ===")
    for k, v in reason_counter.most_common(20):
        print(f"  {k}: {v}")

    print("\n=== top keywords ===")
    for k, v in keyword_counter.most_common(25):
        print(f"  {k}: {v}")

    print("\n=== samples ===")
    for t, items in samples.items():
        print(f"\n[{t}]")
        for s in items:
            print(f"  - {s}")

    print(f"\nrows to update: {len(updates)}")

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

    # verify
    cur.execute(
        "SELECT notice_type, COUNT(*) c FROM easy_prt GROUP BY notice_type ORDER BY c DESC"
    )
    print("\n=== current DB notice_type ===")
    for r in cur.fetchall():
        print(f"  {r['notice_type']!r}: {r['c']}")

    conn.close()


if __name__ == "__main__":
    main()
