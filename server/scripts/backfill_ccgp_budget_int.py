#!/usr/bin/env python3
"""Backfill ccgp.budget from content as integer yuan (no decimal point).

Examples:
  1,000,000.00元                         -> 1000000元
  预算金额：10.000000 万元（人民币）      -> 100000元
  27.2641万元                            -> 272641元
  bare 540000                            -> 540000元
"""

from __future__ import annotations

import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import pymysql
from pymysql.cursors import DictCursor

ENV_CANDIDATES = (
    Path("/opt/ccgp-portal/.env"),
    Path("/opt/fujian-qwjsy/.env"),
)

BARE_NUM_RE = re.compile(r"^[\d,]+(?:\.\d+)?$")
HAS_UNIT_RE = re.compile(r"[万元￥¥]")
NUM_RE = re.compile(r"([\d,]+(?:\.\d+)?)")
ZERO_BUDGET_RE = re.compile(
    r"^(?:预算金额\s*[:：]\s*)?0+(?:\.0+)?\s*(?:万元?)?(?:\s*（人民币）|\s*\(人民币\))?$"
)

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
        "contract_yuan",
        re.compile(
            r"预算金额\s*[:：]\s*[¥￥]\s*([\d,]+(?:\.\d+)?)\s*元",
            re.I,
        ),
        "yuan",
    ),
    (
        "yuan_paren_near",
        re.compile(
            r"预算金额\s*(?:[(（]\s*(?:人民币\s*/?\s*)?元\s*[)）])\s*[:：]?\s*.{0,160}?([\d,]{4,}(?:\.\d+)?)",
            re.I | re.S,
        ),
        "yuan",
    ),
    (
        "yuan_header_near",
        re.compile(
            r"预算金额\s+(?!（万元）|\(万元\)|万元).{0,80}?([\d,]{4,}(?:\.\d+)?)",
            re.I | re.S,
        ),
        "yuan",
    ),
    (
        "max_limit_yuan",
        re.compile(
            r"最高限价\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*(?:第一包\s*[:：]\s*)?([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
            re.I,
        ),
        "yuan",
    ),
]

WAN_TABLE_RE = re.compile(
    r"预算金额\s*[(（]?\s*万元\s*[)）]?(?P<body>.{0,400})",
    re.I | re.S,
)


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for path in ENV_CANDIDATES:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        if env.get("MYSQL_PASSWORD") or env.get("MYSQL_USER"):
            break
    return env


def clean_text(text: str) -> str:
    return re.sub(r"[\u00a0\u3000\u200d]+", " ", str(text or ""))


def parse_num(raw: str) -> Decimal | None:
    text = str(raw or "").replace(",", "").strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def fmt_int_yuan(num: Decimal | None) -> str:
    if num is None:
        return ""
    q = num.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if q <= 0:
        return ""
    return f"{int(q)}元"


def to_int_yuan(num: Decimal | None, unit: str) -> str:
    if num is None or num <= 0:
        return ""
    if unit == "wan":
        if num >= Decimal("100000"):
            return fmt_int_yuan(num)
        return fmt_int_yuan(num * Decimal("10000"))
    if num < Decimal("1"):
        return ""
    return fmt_int_yuan(num)


def extract_from_wan_table(text: str) -> str:
    m = WAN_TABLE_RE.search(text)
    if not m:
        return ""
    body = m.group("body") or ""

    for raw in re.findall(r"([\d,]+(?:\.\d+)?)\s*万元", body):
        out = to_int_yuan(parse_num(raw), "wan")
        if out:
            return out

    for raw in re.findall(r"([\d,]+(?:\.\d{2,6}))\s*20\d{2}(?:[-/年.]?\d{1,2})?", body):
        num = parse_num(raw)
        if num is None:
            continue
        if Decimal("0.01") <= num < Decimal("50000"):
            out = to_int_yuan(num, "wan")
            if out:
                return out

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
        if "." not in raw:
            continue
        if Decimal("0.01") <= num < Decimal("50000"):
            out = to_int_yuan(num, "wan")
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
        out = to_int_yuan(parse_num(m.group(1)), unit)
        if not out:
            continue
        n = int(out[:-1])
        if 1900 <= n <= 2100:
            continue
        if n < 100:
            continue
        return out, name
    wan_table = extract_from_wan_table(text)
    if wan_table:
        n = int(wan_table[:-1])
        if n >= 100:
            return wan_table, "wan_table"
    return "", ""


def expand_list_value(raw: str) -> str:
    """Normalize stored/list budget strings (CCGP often has commas / 万元（人民币）)."""
    text = clean_text(raw).strip()
    if not text:
        return ""
    if re.fullmatch(r"\d+元", text):
        return text
    # junk non-amount labels
    if text in {"/", "-", "—", "无", "暂无"} or re.fullmatch(r"[A-Za-z]包|第.+包", text):
        return ""

    text2 = re.sub(r"^预算金额\s*[:：]\s*", "", text)
    text2 = re.sub(r"（人民币）|\(人民币\)", "", text2).strip()
    # crawler sometimes glued trailing sentence after amount
    text2 = re.split(r"[；;]\s*\d+[、.]", text2, maxsplit=1)[0].strip()

    m = re.search(r"[¥￥]\s*([\d,]+(?:\.\d+)?)", text2)
    if m and ("元" in text2 or "￥" in text2 or "¥" in text2):
        out = fmt_int_yuan(parse_num(m.group(1)))
        if out:
            return out
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*[(（]?\s*万元?\s*[)）]?", text2)
    if m and ("万" in text2):
        return to_int_yuan(parse_num(m.group(1)), "wan")
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*元", text2)
    if m:
        return fmt_int_yuan(parse_num(m.group(1)))
    # Arabic amount inside Chinese money sentence: （¥3,000,000.00） or （1,320,000.00）
    m = re.search(r"[（(]\s*[¥￥]?\s*([\d,]{3,}(?:\.\d+)?)\s*[）)]", text2)
    if m:
        return fmt_int_yuan(parse_num(m.group(1)))

    if "万元" in text2:
        return to_int_yuan(parse_num(text2.replace("万元", "")), "wan")
    if text2.endswith("元"):
        return fmt_int_yuan(parse_num(text2[:-1]))
    if HAS_UNIT_RE.search(text2):
        return ""
    if not BARE_NUM_RE.match(text2.replace(" ", "")):
        return ""
    num = parse_num(text2)
    if num is None or num <= 0:
        return ""
    # CCGP bare values are usually already 元 when >= 10000
    if num >= Decimal("10000"):
        return fmt_int_yuan(num)
    return fmt_int_yuan(num * Decimal("10000"))


def resolve_budget(current: str, content: str) -> tuple[str, str]:
    from_content, src = extract_budget(content)
    if from_content:
        if from_content != str(current or "").strip():
            return from_content, f"content:{src}"
        return from_content, "keep"
    converted = expand_list_value(current)
    cur = str(current or "").strip()
    if converted and converted != cur:
        return converted, "list"
    if converted:
        return converted, "keep"
    compact = re.sub(r"\s+", "", cur)
    if ZERO_BUDGET_RE.fullmatch(compact) or re.fullmatch(r"0+(?:\.0+)?元?", compact):
        return "", "clear_zero"
    if cur in {"/", "-", "—", "无", "暂无"} or re.fullmatch(r"[A-Za-z]包|第.+包", cur):
        return "", "clear_junk"
    # pure Chinese amount without Arabic digits — cannot reliably parse; clear noise labels only
    if cur and not re.search(r"\d", cur) and len(cur) <= 4:
        return "", "clear_junk"
    return cur, "keep"


def main() -> None:
    apply_mode = "--apply" in sys.argv
    env = load_env()
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
            cur.execute("SELECT id, budget, content_text FROM ccgp")
            rows = cur.fetchall()

        for row in rows:
            rid = str(row["id"])
            old = str(row.get("budget") or "").strip()
            new, src = resolve_budget(old, str(row.get("content_text") or ""))
            bucket = src.split(":", 1)[0]
            source_counts[bucket] = source_counts.get(bucket, 0) + 1
            if new == old:
                continue
            if not new and src not in {"clear_zero", "clear_junk"}:
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
                # chunked to avoid huge packets / long locks
                for i in range(0, len(updates), 500):
                    cur.executemany(
                        "UPDATE ccgp SET budget=%s WHERE id=%s", updates[i : i + 500]
                    )
                    conn.commit()
                    print(f"applied {min(i + 500, len(updates))}/{len(updates)}", flush=True)
        print(f"applied budget_rows={len(updates)}")

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  SUM(budget REGEXP '^[0-9]+元$') AS int_yuan,
                  SUM(budget LIKE '%.%') AS has_dot,
                  SUM(TRIM(budget)<>'') AS nonempty,
                  SUM(budget REGEXP '万') AS has_wan
                FROM ccgp
                """
            )
            print("after:", dict(cur.fetchone() or {}))


if __name__ == "__main__":
    main()
