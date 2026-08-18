#!/usr/bin/env python3
"""整理 ccgp 表 notice_type / notice_name，对齐小程序 biaoxunApi 现有 sourceExactTypes。

不改动小程序代码；ccgp 在 API 中按 notice_type 精确 IN 过滤：
  招标 Tab: 公开招标, 公开招标公告, 邀请招标, 竞争性磋商, 竞争性谈判,
           询价公告, 单一来源, 更正公告, 资格预审, 其他公告
  中标 Tab: 中标公告, 成交公告, 终止公告, 废标公告
  采购意向: ccgp 未接入 intent Tab

用法:
  python backfill_ccgp_notice_type.py          # dry-run
  python backfill_ccgp_notice_type.py --apply
"""
from __future__ import annotations

import argparse
import os
import re
from collections import Counter
from pathlib import Path

import pymysql

# --- 与 cloudfunctions/biaoxunApi/biaoxun.js sourceExactTypes.ccgp 一致 ---
CCGP_TENDER_TYPES = {
    "公开招标",
    "公开招标公告",
    "邀请招标",
    "竞争性磋商",
    "竞争性谈判",
    "询价公告",
    "单一来源",
    "更正公告",
    "资格预审",
    "其他公告",
}
CCGP_WIN_TYPES = {"中标公告", "成交公告", "终止公告", "废标公告"}

TYPE_INTENT = "采购意向"

INTENT_PATTERNS = [
    re.compile(r"采购意向公告"),
    re.compile(r"政府采购意向"),
    re.compile(r"采购意向公开"),
    re.compile(r"采购意向"),
    re.compile(r"意向公开"),
]

WIN_TITLE_PATTERNS = [
    (re.compile(r"流标公告|流标公示"), "废标公告"),
    (re.compile(r"废标公告|废标公示|废标"), "废标公告"),
    (re.compile(r"终止公告|项目终止|采购活动终止"), "终止公告"),
    (re.compile(r"合同公告|合同公示"), "成交公告"),
    (re.compile(r"成交公示|成交结果公示|入围结果公告|入围公告"), "成交公告"),
    (re.compile(r"成交公告|成交结果公告"), "成交公告"),
    (re.compile(r"结果公告|结果公示|结果更正公告"), "成交公告"),
    (re.compile(r"中标公告|中标结果公告|中标公示|中标候选人"), "中标公告"),
]

TENDER_TITLE_PATTERNS = [
    (re.compile(r"资格预审"), "资格预审"),
    (re.compile(r"邀请招标"), "邀请招标"),
    (re.compile(r"竞争性谈判公告|谈判公告|竞争性谈判"), "竞争性谈判"),
    (re.compile(r"竞争性磋商公告|磋商公告|竞争性磋商"), "竞争性磋商"),
    (re.compile(r"询价公告|询价采购"), "询价公告"),
    (re.compile(r"单一来源采购公告|单一来源公示|单一来源"), "单一来源"),
    (re.compile(r"采购更正公告|更正公告|变更公告|补充公告"), "更正公告"),
    (re.compile(r"征集公告|征集入围|框架协议.*征集|方案征集"), "其他公告"),
    (re.compile(r"公开招标公告|公开招标采购公告"), "公开招标公告"),
    (re.compile(r"公开招标|公开招租|竞价公告|比选公告|比选"), "公开招标"),
    (re.compile(r"招标公告|采购公告|招标采购"), "公开招标"),
]

# notice_name 常见值 → API notice_type
NOTICE_NAME_MAP = {
    "招标公告": "公开招标",
    "公开招标公告": "公开招标公告",
    "公开招标采购公告": "公开招标公告",
    "竞争性磋商公告": "竞争性磋商",
    "磋商公告": "竞争性磋商",
    "竞争性谈判公告": "竞争性谈判",
    "谈判公告": "竞争性谈判",
    "询价公告": "询价公告",
    "单一来源采购公告": "单一来源",
    "单一来源公示": "单一来源",
    "单一来源": "单一来源",
    "采购更正公告": "更正公告",
    "更正公告": "更正公告",
    "变更公告": "更正公告",
    "补充公告": "更正公告",
    "资格预审": "资格预审",
    "资格预审公告": "资格预审",
    "邀请招标": "邀请招标",
    "征集公告": "其他公告",
    "竞价公告": "其他公告",
    "其他公告": "其他公告",
    "中标公告": "中标公告",
    "中标结果公告": "中标公告",
    "成交公告": "成交公告",
    "成交结果公告": "成交公告",
    "结果公告": "成交公告",
    "结果更正公告": "成交公告",
    "合同公告": "成交公告",
    "合同公示": "成交公告",
    "终止公告": "终止公告",
    "废标公告": "废标公告",
    "流标公告": "废标公告",
    # 已被误标为 Tab 名的，稍后重映射
    "招标公告_tab": "公开招标",
}


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


def first_pattern(text: str, patterns: list[tuple[re.Pattern, str]]) -> tuple[str, str]:
    for pat, mapped in patterns:
        m = pat.search(text or "")
        if m:
            return mapped, m.group(0)
    return "", ""


def is_winish_title(title: str) -> bool:
    t = title or ""
    return bool(
        re.search(
            r"中标|成交|结果公告|终止|废标|流标|合同公告|合同公示|入围结果",
            t,
        )
    )


def is_tenderish_title(title: str) -> bool:
    t = title or ""
    if is_winish_title(t):
        return False
    return bool(
        re.search(
            r"招标|磋商|谈判|询价|征集|更正|变更|单一来源|资格预审|比选|竞价|采购公告",
            t,
        )
    )


def classify_row(title: str, notice_name: str, content: str) -> tuple[str, str, str]:
    """Return (notice_type, tab, reason). tab: tender|win|intent"""
    title = (title or "").strip()
    notice_name = (notice_name or "").strip()
    header = (content or "")[:300]

    for pat in INTENT_PATTERNS:
        if pat.search(title) or pat.search(header):
            return TYPE_INTENT, "intent", f"intent|{pat.pattern}"

    # 标题/正文优先识别中标类（避免 notice_name 误标为招标）
    for src, text in (("title", title), ("header", header)):
        mapped, kw = first_pattern(text, WIN_TITLE_PATTERNS)
        if mapped:
            if src == "header" and is_tenderish_title(title) and not is_winish_title(title):
                continue
            return mapped, "win", f"{src}|{kw or mapped}"

    # 已有 notice_name 映射
    if notice_name in NOTICE_NAME_MAP:
        mapped = NOTICE_NAME_MAP[notice_name]
        tab = "win" if mapped in CCGP_WIN_TYPES else "tender"
        if notice_name == TYPE_INTENT:
            tab = "intent"
        return mapped, tab, f"notice_name|{notice_name}"

    # 误标 Tab 名
    if notice_name == "招标公告" or notice_name == "中标公告":
        pass  # fall through to title
    elif notice_name in CCGP_TENDER_TYPES:
        return notice_name, "tender", f"notice_name_raw|{notice_name}"
    elif notice_name in CCGP_WIN_TYPES:
        return notice_name, "win", f"notice_name_raw|{notice_name}"

    for src, text in (("title", title), ("header", header)):
        mapped, kw = first_pattern(text, TENDER_TITLE_PATTERNS)
        if mapped:
            return mapped, "tender", f"{src}|{kw or mapped}"

    # 兜底：旧 notice_type Tab 名
    if is_winish_title(title):
        return "成交公告", "win", "fallback|win_title"
    return "其他公告", "tender", "fallback|tender_default"


def normalize_region(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    text = re.sub(r"^(采购人|招标人|采购单位)\s*[:：]\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if re.match(r"^(采购人|名称)[：:]", text):
        return ""
    return text[:128]


def normalize_purchaser(value: str, title: str) -> str:
    text = (value or "").strip()
    if text:
        return text[:512]
    m = re.search(r"采购人\s*[:：]\s*([^\n\r，。；;]{2,120})", title or "")
    if m:
        return m.group(1).strip()[:512]
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--batch", type=int, default=500)
    args = parser.parse_args()

    load_env()
    conn = pymysql.connect(
        host=os.environ.get("BIAOXUN_DB_HOST") or os.environ.get("MYSQL_HOST") or "127.0.0.1",
        user=os.environ.get("BIAOXUN_DB_USER") or os.environ.get("MYSQL_USER"),
        password=os.environ.get("BIAOXUN_DB_PASSWORD") or os.environ.get("MYSQL_PASSWORD"),
        database=os.environ.get("BIAOXUN_DB_NAME") or os.environ.get("MYSQL_DATABASE") or "biaoxun",
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM ccgp")
    total = cur.fetchone()["c"]
    print(f"total={total} mode={'APPLY' if args.apply else 'DRY-RUN'}")

    type_counter: Counter[str] = Counter()
    tab_counter: Counter[str] = Counter()
    reason_counter: Counter[str] = Counter()
    updates: list[tuple[str, str, str, str, str, str]] = []
    offset = 0

    while True:
        cur.execute(
            "SELECT id, title, notice_type, notice_name, region, purchaser, "
            "LEFT(content_text, 4000) AS content_text "
            "FROM ccgp ORDER BY id LIMIT %s OFFSET %s",
            (args.batch, offset),
        )
        rows = cur.fetchall()
        if not rows:
            break
        offset += len(rows)
        for row in rows:
            new_type, tab, reason = classify_row(
                row.get("title") or "",
                row.get("notice_name") or row.get("notice_type") or "",
                row.get("content_text") or "",
            )
            # notice_name 保留可读细类（招标公告/中标公告 Tab 文案）
            if tab == "win":
                display_name = {
                    "中标公告": "中标公告",
                    "成交公告": "成交公告",
                    "终止公告": "终止公告",
                    "废标公告": "废标公告",
                }.get(new_type, "成交公告")
            elif tab == "intent":
                display_name = TYPE_INTENT
            else:
                display_name = {
                    "公开招标": "招标公告",
                    "公开招标公告": "公开招标公告",
                    "竞争性磋商": "竞争性磋商公告",
                    "竞争性谈判": "竞争性谈判公告",
                    "询价公告": "询价公告",
                    "单一来源": "单一来源",
                    "更正公告": "更正公告",
                    "资格预审": "资格预审",
                    "邀请招标": "邀请招标",
                    "其他公告": "其他公告",
                }.get(new_type, "招标公告")

            new_region = normalize_region(row.get("region") or "")
            new_purchaser = normalize_purchaser(row.get("purchaser") or "", row.get("title") or "")

            type_counter[new_type] += 1
            tab_counter[tab] += 1
            reason_counter[reason.split("|")[0] + "|" + reason.split("|")[-1][:20]] += 1

            old_type = (row.get("notice_type") or "").strip()
            old_name = (row.get("notice_name") or "").strip()
            old_region = (row.get("region") or "").strip()
            old_purchaser = (row.get("purchaser") or "").strip()

            if (
                old_type != new_type
                or old_name != display_name
                or old_region != new_region
                or old_purchaser != new_purchaser
            ):
                updates.append(
                    (
                        new_type,
                        display_name,
                        new_region,
                        new_purchaser,
                        row["id"],
                    )
                )
        print(f"scanned {min(offset, total)}/{total}", flush=True)

    print("\n=== notice_type (API filter) ===")
    for k, v in type_counter.most_common():
        print(f"  {k}: {v}")

    print("\n=== tab ===")
    for k, v in tab_counter.most_common():
        print(f"  {k}: {v}")

    print(f"\nrows needing update: {len(updates)}")

    if args.apply and updates:
        for i in range(0, len(updates), args.batch):
            chunk = updates[i : i + args.batch]
            cur.executemany(
                "UPDATE ccgp SET notice_type=%s, notice_name=%s, region=%s, purchaser=%s "
                "WHERE id=%s",
                [(a, b, c, d, e) for a, b, c, d, e in chunk],
            )
            conn.commit()
            print(f"updated {min(i + len(chunk), len(updates))}/{len(updates)}", flush=True)
        print("APPLY done")
    elif not args.apply:
        print("dry-run only; re-run with --apply to write")

    cur.execute(
        "SELECT notice_type, COUNT(*) c FROM ccgp GROUP BY notice_type ORDER BY c DESC LIMIT 20"
    )
    print("\n=== DB notice_type now ===")
    for r in cur.fetchall():
        print(f"  {r['notice_type']!r}: {r['c']}")

    # 验证 API 可命中数量
    tender_in = ", ".join(f"'{x}'" for x in sorted(CCGP_TENDER_TYPES))
    win_in = ", ".join(f"'{x}'" for x in sorted(CCGP_WIN_TYPES))
    cur.execute(f"SELECT COUNT(*) c FROM ccgp WHERE notice_type IN ({tender_in})")
    tender_n = cur.fetchone()["c"]
    cur.execute(f"SELECT COUNT(*) c FROM ccgp WHERE notice_type IN ({win_in})")
    win_n = cur.fetchone()["c"]
    print(f"\nAPI tender match: {tender_n}, win match: {win_n}")

    conn.close()


if __name__ == "__main__":
    main()
