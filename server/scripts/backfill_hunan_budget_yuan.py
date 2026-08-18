#!/usr/bin/env python3
"""Backfill hunan.budget from content_text to full yuan amounts with decimals.

Prefer body patterns like:
  预算金额：1,800,000.00 元
  预算金额：167.88万元
  采购预算：2300000 元
Existing list values like 196.77 (万元) are expanded when body has no amount.
"""

from __future__ import annotations

import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import pymysql
from pymysql.cursors import DictCursor

ENV_PATH = Path("/opt/fujian-qwjsy/.env")

BARE_NUM_RE = re.compile(r"^[\d,]+(?:\.\d+)?$")
HAS_UNIT_RE = re.compile(r"[万元￥¥]")

# (name, pattern, unit) unit: yuan|wan
PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    (
        "yuan_colon",
        re.compile(
            r"预算金额\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
            re.I,
        ),
        "yuan",
    ),
    (
        "wan_colon",
        re.compile(
            r"预算金额\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*万元",
            re.I,
        ),
        "wan",
    ),
    (
        "procure_yuan",
        re.compile(
            r"(?:采购预算|项目预算)\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
            re.I,
        ),
        "yuan",
    ),
    (
        "procure_wan",
        re.compile(
            r"(?:采购预算|项目预算)\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*万元",
            re.I,
        ),
        "wan",
    ),
    (
        "yuan_paren_near",
        re.compile(
            r"预算金额\s*[(（]\s*元\s*[)）]\s*[:：]?\s*.{0,160}?([\d,]{4,}(?:\.\d+)?)",
            re.I | re.S,
        ),
        "yuan",
    ),
    (
        "max_limit_yuan",
        re.compile(
            r"最高限价\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
            re.I,
        ),
        "yuan",
    ),
]

WAN_TABLE_RE = re.compile(
    r"预算金额\s*[(（]?\s*万元\s*[)）]?(?P<body>.{0,400})",
    re.I | re.S,
)
NUM_RE = re.compile(r"([\d,]+(?:\.\d+)?)")


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def clean_text(text: str) -> str:
    return re.sub(r"[\u00a0\u3000]+", " ", str(text or ""))


def parse_num(raw: str) -> Decimal | None:
    text = str(raw or "").replace(",", "").strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def fmt_yuan(num: Decimal) -> str:
    return f"{num.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)}元"


def to_yuan(num: Decimal, unit: str) -> str | None:
    if num is None or num <= 0:
        return None
    if unit == "wan":
        # Mis-labeled huge values are already yuan
        if num >= Decimal("100000"):
            return fmt_yuan(num)
        return fmt_yuan(num * Decimal("10000"))
    if num < Decimal("1"):
        return None
    return fmt_yuan(num)


def extract_from_wan_table(text: str) -> str:
    """采购意向表：预算金额（万元）后优先取「xx万元」或「金额+预计采购月份」。"""
    m = WAN_TABLE_RE.search(text)
    if not m:
        return ""
    body = m.group("body") or ""

    # 1) 正文明确写了「142.29万元」
    for raw in re.findall(r"([\d,]+(?:\.\d+)?)\s*万元", body):
        num = parse_num(raw)
        out = to_yuan(num, "wan") if num is not None else None
        if out:
            return out

    # 2) 表格常见：142.290000 2026-08 / 312.350000 202607
    for raw in re.findall(
        r"([\d,]+(?:\.\d{2,6}))\s*20\d{2}(?:[-/年.]?\d{1,2})?",
        body,
    ):
        num = parse_num(raw)
        if num is None:
            continue
        # 排除明显面积/规模（过大且无小数的另议）；万元通常 < 5万
        if Decimal("0.01") <= num < Decimal("50000"):
            out = to_yuan(num, "wan")
            if out:
                return out

    # 3) 宽松兜底：跳过序号/年份/带单位规模词附近的数字
    skip_near = re.compile(
        r"(?:亩|㎡|m2|m²|平方米|米|盒|套|kg|吨|人|栋|个|根|座|处|km)",
        re.I,
    )
    for nm in NUM_RE.finditer(body):
        raw = nm.group(1)
        num = parse_num(raw)
        if num is None:
            continue
        if num == num.to_integral_value() and Decimal("1") <= num <= Decimal("30"):
            continue
        if Decimal("1900") <= num <= Decimal("2100") and num == num.to_integral_value():
            continue
        window = body[max(0, nm.start() - 2) : nm.end() + 6]
        if skip_near.search(window):
            continue
        # 仅接受带小数的万元候选，降低误抓规模整数
        if "." not in raw:
            continue
        if Decimal("0.01") <= num < Decimal("50000"):
            out = to_yuan(num, "wan")
            if out:
                return out
    return ""


def extract_budget(content: str) -> tuple[str, str]:
    text = clean_text(content)
    if not text:
        return "", ""
    for name, pat, unit in PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        num = parse_num(m.group(1))
        if num is None:
            continue
        out = to_yuan(num, unit)
        if out:
            return out, name
    wan_table = extract_from_wan_table(text)
    if wan_table:
        return wan_table, "wan_table"
    return "", ""


def expand_list_wan(raw: str) -> str:
    text = str(raw or "").strip()
    if not text or HAS_UNIT_RE.search(text):
        return ""
    if not BARE_NUM_RE.match(text.replace(" ", "")):
        return ""
    num = parse_num(text)
    if num is None or num <= 0:
        return ""
    # Already looks like yuan
    if num >= Decimal("10000"):
        return fmt_yuan(num)
    return fmt_yuan(num * Decimal("10000"))


def resolve_budget(current: str, content: str) -> tuple[str, str]:
    from_content, src = extract_budget(content)
    cur = str(current or "").strip()
    if from_content:
        if from_content != cur:
            return from_content, f"content:{src}"
        return cur, "keep"
    if not cur:
        return "", "keep"
    if cur.endswith("元"):
        num = parse_num(cur[:-1])
        if num is not None:
            formatted = fmt_yuan(num)
            return (formatted, "keep" if formatted == cur else "normalize")
        return cur, "keep"
    if HAS_UNIT_RE.search(cur):
        return cur, "keep"
    converted = expand_list_wan(cur)
    if converted and converted != cur:
        return converted, "list_wan"
    return cur, "keep"


def main() -> None:
    apply_mode = "--apply" in sys.argv
    env = load_env(ENV_PATH)
    conn = pymysql.connect(
        host=env.get("MYSQL_HOST", "127.0.0.1"),
        port=int(env.get("MYSQL_PORT", "3306")),
        user=env.get("MYSQL_USER", "biaoxun"),
        password=env.get("MYSQL_PASSWORD", ""),
        database=env.get("MYSQL_DATABASE", "biaoxun"),
        charset="utf8mb4",
        autocommit=False,
        cursorclass=DictCursor,
    )

    updates: list[tuple[str, str]] = []
    samples: list[tuple[str, str, str]] = []
    source_counts: dict[str, int] = {}

    with conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, budget, content_text FROM hunan")
            rows = cur.fetchall()

        for row in rows:
            rid = str(row["id"])
            old = str(row.get("budget") or "").strip()
            new, src = resolve_budget(old, str(row.get("content_text") or ""))
            bucket = src.split(":", 1)[0]
            source_counts[bucket] = source_counts.get(bucket, 0) + 1
            if src == "keep" or not new or new == old:
                continue
            updates.append((new, rid))
            if len(samples) < 20:
                samples.append((old, new, src))

        print(f"total_rows={len(rows)}")
        print(f"budget_updates={len(updates)} source={source_counts}")
        print("samples (old -> new @source):")
        for old, new, src in samples:
            print(f"  {old!r} -> {new!r} @{src}")

        if not apply_mode:
            print("dry-run only; pass --apply to update")
            return

        with conn.cursor() as cur:
            if updates:
                cur.executemany("UPDATE hunan SET budget=%s WHERE id=%s", updates)
        conn.commit()
        print(f"applied budget_rows={len(updates)}")

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  SUM(budget REGEXP '\\\\.\\\\d{2}元$') AS decimal_yuan,
                  SUM(budget REGEXP '元$') AS ends_yuan,
                  SUM(budget REGEXP '^[0-9.]+$') AS bare_num,
                  SUM(TRIM(budget)<>'') AS nonempty
                FROM hunan
                """
            )
            print("after:", dict(cur.fetchone() or {}))


if __name__ == "__main__":
    main()
