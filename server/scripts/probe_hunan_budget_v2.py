#!/usr/bin/env python3
"""Probe improved hunan budget extractors."""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import pymysql
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


def clean(text: str) -> str:
    return re.sub(r"[\u00a0\u3000]+", " ", str(text or ""))


def parse_num(raw: str):
    try:
        return Decimal(str(raw).replace(",", "").strip())
    except InvalidOperation:
        return None


def fmt_yuan(num: Decimal) -> str:
    return f"{num.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)}元"


PATTERNS = [
    # 预算金额：1,800,000.00 元
    (
        "yuan_colon",
        re.compile(
            r"预算金额\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
            re.I,
        ),
        "yuan",
    ),
    # 预算金额：167.88万元
    (
        "wan_colon",
        re.compile(
            r"预算金额\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*万元",
            re.I,
        ),
        "wan",
    ),
    # 采购预算：2300000 元
    (
        "procure_yuan",
        re.compile(
            r"(?:采购预算|项目预算)\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
            re.I,
        ),
        "yuan",
    ),
    # 预算金额（元） ... 1204090.57  (within 120 chars)
    (
        "yuan_paren_near",
        re.compile(
            r"预算金额\s*[(（]\s*元\s*[)）]\s*[:：]?\s*.{0,120}?([\d,]{3,}(?:\.\d+)?)",
            re.I,
        ),
        "yuan",
    ),
    # 预算金额 （万元） table for intent - first numeric cell-ish
    (
        "wan_paren_near",
        re.compile(
            r"预算金额\s*[(（]?\s*万元\s*[)）]?\s*.{0,200}?([\d,]+(?:\.\d+)?)",
            re.I,
        ),
        "wan",
    ),
    # 最高限价：xxx 元 (fallback)
    (
        "max_limit",
        re.compile(
            r"最高限价\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
            re.I,
        ),
        "yuan",
    ),
]


def extract(text: str):
    body = clean(text)
    for name, pat, unit in PATTERNS:
        m = pat.search(body)
        if not m:
            continue
        num = parse_num(m.group(1))
        if num is None or num <= 0:
            continue
        # intent table wan_paren_near can catch tiny serial numbers; require sensible size
        if unit == "wan" and num > Decimal("100000"):
            # already looks like yuan mistakenly labeled 万元 — treat as yuan
            return fmt_yuan(num), name
        if unit == "wan":
            return fmt_yuan(num * Decimal("10000")), name
        # yuan values should usually be >= 100 for project budgets; allow smaller
        if unit == "yuan" and num < Decimal("1"):
            continue
        return fmt_yuan(num), name
    return "", ""


env = load_env("/opt/fujian-qwjsy/.env")
conn = pymysql.connect(
    host=env.get("MYSQL_HOST", "127.0.0.1"),
    user=env["MYSQL_USER"],
    password=env["MYSQL_PASSWORD"],
    database="biaoxun",
    charset="utf8mb4",
    cursorclass=DictCursor,
)

with conn.cursor() as cur:
    cur.execute(
        """
        SELECT id, budget, content_text
        FROM hunan
        WHERE TRIM(IFNULL(budget,''))='' AND content_text IS NOT NULL AND TRIM(content_text)<>''
        """
    )
    rows = cur.fetchall()

by_src = {}
hits = 0
samples = []
for row in rows:
    val, src = extract(row["content_text"])
    if not val:
        continue
    hits += 1
    by_src[src] = by_src.get(src, 0) + 1
    if len(samples) < 15:
        samples.append((val, src, row["id"][:16]))

print("empty_rows", len(rows))
print("extractable", hits)
print("by_src", by_src)
print("samples")
for s in samples:
    print(" ", s)

with conn.cursor() as cur:
    cur.execute(
        """
        SELECT id, budget, content_text
        FROM hunan
        WHERE TRIM(IFNULL(budget,''))<>''
        """
    )
    nonempty = cur.fetchall()
overwrite = 0
for row in nonempty:
    val, src = extract(row["content_text"] or "")
    if val and val != str(row["budget"]).strip() and not str(row["budget"]).endswith("元"):
        overwrite += 1
print("nonempty", len(nonempty), "would_overwrite_from_content_or_keep_list", overwrite)
conn.close()
