#!/usr/bin/env python3
"""Backfill jiangxi.budget from content_text to full yuan amount with decimals.

List API stores abbreviated 万元 (e.g. 27). Detail body has:
  预算金额：270000.00 元
We overwrite budget with the full yuan string (e.g. 270000.00元).
When body has no match but budget looks like a bare 万元 number, convert ×10000.
"""

from __future__ import annotations

import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import pymysql
from pymysql.cursors import DictCursor

ENV_PATH = Path("/opt/fujian-qwjsy/.env")

BUDGET_RE = re.compile(
    r"预算金额\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?!/)(?!\s*/)",
    re.IGNORECASE,
)
# fallback: 采购预算(人民币) near tables sometimes
BUDGET_ALT_RE = re.compile(
    r"(?:采购预算|项目预算)\s*[(（]?人民币[)）]?\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*元",
    re.IGNORECASE,
)
SUCCESS_RE = re.compile(
    r"(?:成交金额|中标金额|成交总金额)\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元",
    re.IGNORECASE,
)
BARE_NUM_RE = re.compile(r"^[\d,]+(?:\.\d+)?$")
HAS_UNIT_RE = re.compile(r"[万元￥¥]")


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


def _fmt_yuan(num: Decimal) -> str:
    q = num.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{q}元"


def _parse_decimal(raw: str) -> Decimal | None:
    text = str(raw or "").replace(",", "").strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def extract_yuan_amount(text: str, patterns: list[re.Pattern[str]]) -> str:
    body = str(text or "")
    if not body:
        return ""
    for pat in patterns:
        m = pat.search(body)
        if not m:
            continue
        num = _parse_decimal(m.group(1))
        if num is None:
            continue
        return _fmt_yuan(num)
    return ""


def normalize_from_list_wan(raw: str) -> str:
    """List API budget is in 万元 without unit — expand to yuan with 2 decimals."""
    text = str(raw or "").strip()
    if not text or HAS_UNIT_RE.search(text):
        return ""
    if not BARE_NUM_RE.match(text.replace(" ", "")):
        return ""
    num = _parse_decimal(text)
    if num is None:
        return ""
    # Heuristic: values already looking like yuan (>= 10000 and integer-ish large)
    # keep as yuan; small values are 万元 abbreviations from Jiangxi list API.
    if num >= Decimal("10000"):
        return _fmt_yuan(num)
    return _fmt_yuan(num * Decimal("10000"))


def resolve_budget(current: str, content: str) -> tuple[str, str]:
    """Return (new_budget, source) where source is content|list|keep."""
    from_content = extract_yuan_amount(content, [BUDGET_RE, BUDGET_ALT_RE])
    if from_content:
        if from_content != str(current or "").strip():
            return from_content, "content"
        return current, "keep"

    cur = str(current or "").strip()
    if not cur:
        return "", "keep"
    if cur.endswith("元") and BARE_NUM_RE.match(cur[:-1].replace(",", "")):
        # already full yuan style
        num = _parse_decimal(cur[:-1])
        if num is not None:
            formatted = _fmt_yuan(num)
            return (formatted, "keep" if formatted == cur else "list")
        return cur, "keep"
    if HAS_UNIT_RE.search(cur):
        return cur, "keep"

    converted = normalize_from_list_wan(cur)
    if converted and converted != cur:
        return converted, "list"
    return cur, "keep"


def resolve_successful_money(current: str, content: str) -> tuple[str, str]:
    from_content = extract_yuan_amount(content, [SUCCESS_RE])
    if from_content and from_content != str(current or "").strip():
        return from_content, "content"
    cur = str(current or "").strip()
    if cur and not HAS_UNIT_RE.search(cur) and BARE_NUM_RE.match(cur.replace(" ", "")):
        converted = normalize_from_list_wan(cur)
        if converted and converted != cur:
            return converted, "list"
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

    budget_updates: list[tuple[str, str]] = []  # (id, new_budget)
    money_updates: list[tuple[str, str]] = []
    samples: list[tuple[str, str, str, str]] = []
    source_counts = {"content": 0, "list": 0, "keep": 0}

    with conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, budget, successful_money, content_text
                FROM jiangxi
                """
            )
            rows = cur.fetchall()

        for row in rows:
            rid = str(row["id"])
            content = str(row.get("content_text") or "")
            old_b = str(row.get("budget") or "").strip()
            old_m = str(row.get("successful_money") or "").strip()

            new_b, src_b = resolve_budget(old_b, content)
            source_counts[src_b] = source_counts.get(src_b, 0) + 1
            if src_b != "keep" and new_b:
                budget_updates.append((new_b, rid))
                if len(samples) < 15:
                    samples.append((old_b, new_b, src_b, rid[:12]))

            new_m, src_m = resolve_successful_money(old_m, content)
            if src_m != "keep" and new_m:
                money_updates.append((new_m, rid))

        print(f"total_rows={len(rows)}")
        print(f"budget_updates={len(budget_updates)} source={source_counts}")
        print(f"successful_money_updates={len(money_updates)}")
        print("samples (old -> new @source):")
        for old, new, src, rid in samples:
            print(f"  {old!r} -> {new!r} @{src} id={rid}")

        if not apply_mode:
            print("dry-run only; pass --apply to update")
            return

        with conn.cursor() as cur:
            if budget_updates:
                cur.executemany(
                    "UPDATE jiangxi SET budget=%s WHERE id=%s",
                    budget_updates,
                )
            if money_updates:
                cur.executemany(
                    "UPDATE jiangxi SET successful_money=%s WHERE id=%s",
                    money_updates,
                )
        conn.commit()
        print(
            f"applied budget_rows={len(budget_updates)} "
            f"successful_money_rows={len(money_updates)}"
        )

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  SUM(budget REGEXP '[0-9]\\\\.\\\\d+元$') AS with_decimal_yuan,
                  SUM(budget REGEXP '元$') AS ends_yuan,
                  SUM(budget REGEXP '^[0-9]+$') AS bare_int,
                  SUM(budget<>'') AS nonempty
                FROM jiangxi
                """
            )
            print("after:", dict(cur.fetchone() or {}))


if __name__ == "__main__":
    main()
