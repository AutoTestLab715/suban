#!/usr/bin/env python3
"""
Third-pass backfill for fyc.budget:
- Only extract "总价/控制价/预算" 类金额 from content_text.
- Skip matches where "单价" appears near the matched amount.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import pymysql
from pymysql.cursors import DictCursor


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


# 金额表达（重点取：元/万元/亿元，允许逗号、小数、数字中夹空格）
AMOUNT = r"(?:人民币)?\s*[¥￥]?\s*\d[\d,\.\s]*\s*(?:亿元|万元|万|元)"

# 优先的“总价/预算/控制价”相关关键词（不包含“单价”）
KEYWORDS_TOTAL = (
    "预算金额",
    "采购预算",
    "项目预算",
    "最高限价",
    "投标限价",
    "最高投标限价",
    "控制价",
    "招标控制价",
    "采购控制价",
    "控制总价",
    "控制价格",
)

KEYWORDS_RE_TOTAL = "|".join(re.escape(x) for x in KEYWORDS_TOTAL)

# 两类组合：关键词在前 或 金额在前
PATTERN_KW_BEFORE = re.compile(rf"(?P<kw>{KEYWORDS_RE_TOTAL})\s*[:：]?\s*(?P<amt>{AMOUNT})", re.I)
PATTERN_AMT_BEFORE = re.compile(rf"(?P<amt>{AMOUNT})\s*(?P<kw>{KEYWORDS_RE_TOTAL})", re.I)


def _compact(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _normalize_budget(value: str) -> str:
    out = re.sub(r"\s+", "", value or "")
    # 去掉人民币字样，避免超过长度
    out = out.replace("人民币", "")
    return out[:200]


def _unit_rank(value: str) -> int:
    text = value or ""
    if "亿元" in text:
        return 3
    if "万元" in text or text.endswith("万"):
        return 2
    if "元" in text:
        return 1
    return 0


def _skip_as_unit_price(match_span: tuple[int, int], body: str) -> bool:
    """
    如果匹配点附近出现“单价”，则认为很可能是单位价格，跳过。
    """
    start, end = match_span
    left = max(0, start - 25)
    right = min(len(body), end + 25)
    window = body[left:right]
    # 只要附近出现“单价”就跳过；另外一些常见单位价格写法也跳过
    if "单价" in window:
        return True
    unit_price_markers = ("元/㎡", "元/m", "元/吨", "/吨", "/㎡", "/m2", "/m³", "/立方", "/套", "/人", "/月", "/天")
    if any(m in window for m in unit_price_markers):
        # 没出现“单价”也有可能，但用户要求“算总价”，宁可少填
        return True
    return False


def extract_total_budget(content_text: str) -> str:
    body = _compact(content_text)
    if not body:
        return ""

    for pattern in (PATTERN_KW_BEFORE, PATTERN_AMT_BEFORE):
        for match in pattern.finditer(body):
            span = match.span()
            if _skip_as_unit_price(match.span("amt"), body):
                continue
            left = max(0, span[0] - 30)
            right = min(len(body), span[1] + 40)
            window = body[left:right]
            candidates: list[str] = []
            for candidate in re.finditer(AMOUNT, window, re.I):
                cand_amt = _normalize_budget(candidate.group(0))
                if not cand_amt:
                    continue
                if _skip_as_unit_price(candidate.span(), window):
                    continue
                candidates.append(cand_amt)
            if candidates:
                candidates.sort(key=lambda x: (_unit_rank(x), len(x)), reverse=True)
                return candidates[0]

    return ""


def extract_total_budget_debug(content_text: str) -> tuple[str, str]:
    """
    Return (budget, context_window).
    context_window is used only for debugging/validation.
    """
    body = _compact(content_text)
    if not body:
        return "", ""

    for pattern in (PATTERN_KW_BEFORE, PATTERN_AMT_BEFORE):
        for match in pattern.finditer(body):
            span = match.span()
            if _skip_as_unit_price(match.span("amt"), body):
                continue
            left = max(0, span[0] - 30)
            right = min(len(body), span[1] + 40)
            window = body[left:right]
            candidates: list[str] = []
            for candidate in re.finditer(AMOUNT, window, re.I):
                cand_amt = _normalize_budget(candidate.group(0))
                if not cand_amt:
                    continue
                if _skip_as_unit_price(candidate.span(), window):
                    continue
                candidates.append(cand_amt)
            if candidates:
                candidates.sort(key=lambda x: (_unit_rank(x), len(x)), reverse=True)
                return candidates[0], window

    return "", ""


def main() -> None:
    apply_mode = "--apply" in sys.argv
    debug_mode = "--debug" in sys.argv
    env = load_env(Path("/opt/fujian-qwjsy/.env"))

    conn = pymysql.connect(
        host=env.get("MYSQL_HOST", "127.0.0.1"),
        port=int(env.get("MYSQL_PORT", "3306")),
        user=env.get("MYSQL_USER", "biaoxun"),
        password=env.get("MYSQL_PASSWORD", ""),
        database=env.get("MYSQL_DATABASE", "biaoxun"),
        charset="utf8mb4",
        autocommit=True,
        cursorclass=DictCursor,
    )

    # 更新策略（按“只填空值”）：
    # 只回填 budget 为空（NULL 或空串）的记录，避免覆盖多金额/含税/分项歧义数据。
    where = """
    (budget IS NULL OR TRIM(budget) = '')
    """

    updates: list[tuple[str, str]] = []
    samples: list[tuple[str, str, str]] = []

    with conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, title, content_text, budget
            FROM fyc
            WHERE {where}
              AND content_text IS NOT NULL
              AND TRIM(content_text) <> ''
            """
        )
        rows: list[dict[str, Any]] = cur.fetchall()
        print(f"candidates={len(rows)} apply_mode={apply_mode}")

        for row in rows:
            nid = str(row["id"])
            content_text = str(row.get("content_text") or "")
            current_budget = str(row.get("budget") or "")
            if debug_mode:
                new_budget, window = extract_total_budget_debug(content_text)
            else:
                new_budget = extract_total_budget(content_text)
                window = ""
            if not new_budget:
                continue
            if current_budget and current_budget.strip() == new_budget.strip():
                continue

            updates.append((new_budget, nid))
            if len(samples) < 50:
                samples.append((nid, new_budget, str(row.get("title") or "")[:64] + (" | " + window if debug_mode and window else "")))

        print(f"matched_updates={len(updates)} debug_mode={debug_mode}")
        for s in samples:
            print(f"sample id={s[0]} budget={s[1]} title={s[2]}")

        if apply_mode and updates:
            cur.executemany("UPDATE fyc SET budget=%s WHERE id=%s", updates)
            print(f"updated_rows={cur.rowcount}")

        cur.execute(
            "SELECT COUNT(*) total, SUM(CASE WHEN TRIM(budget)<>'' THEN 1 ELSE 0 END) has_budget FROM fyc"
        )
        stat = cur.fetchone() or {}
        print(f"total={stat.get('total', 0)} has_budget={stat.get('has_budget', 0)}")


if __name__ == "__main__":
    main()

