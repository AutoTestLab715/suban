#!/usr/bin/env python3
"""MySQL helpers for ccgp (中国政府采购网) table — mirrors notices schema."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from bs4 import BeautifulSoup

from db import connect, parse_time

TABLE = "ccgp"

# 公告发布时间合理上限：允许少量时区/录入误差
_NOTICE_TIME_FUTURE_GRACE = timedelta(days=1)

_BUDGET_YUAN_RE = re.compile(
    r"预算金额\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
    re.I,
)
_BUDGET_WAN_RE = re.compile(
    r"预算金额\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*万元",
    re.I,
)
_PROCURE_YUAN_RE = re.compile(
    r"(?:采购预算|项目预算)\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
    re.I,
)
_PROCURE_WAN_RE = re.compile(
    r"(?:采购预算|项目预算)\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*万元",
    re.I,
)
_MONEY_FIELD_WAN_RE = re.compile(r"([\d,]+(?:\.\d+)?)\s*万元", re.I)
_MONEY_FIELD_YUAN_RE = re.compile(r"([\d,]+(?:\.\d+)?)\s*元", re.I)
_ZERO_BUDGET_RE = re.compile(
    r"^(?:预算金额\s*[:：]\s*)?0+(?:\.0+)?\s*(?:万元?)?(?:\s*（人民币）|\s*\(人民币\))?$"
)


def _parse_money(raw: Any) -> Decimal | None:
    text = str(raw or "").replace(",", "").strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _fmt_int_yuan(num: Decimal | None) -> str:
    if num is None:
        return ""
    q = num.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if q <= 0:
        return ""
    return f"{int(q)}元"


def _to_int_yuan(num: Decimal | None, unit: str) -> str:
    if num is None or num <= 0:
        return ""
    if unit == "wan":
        if num >= Decimal("100000"):
            return _fmt_int_yuan(num)
        return _fmt_int_yuan(num * Decimal("10000"))
    if num < Decimal("1"):
        return ""
    return _fmt_int_yuan(num)


def _expand_money_field(raw: Any) -> str:
    text = re.sub(r"[\u00a0\u3000\u200d]+", " ", str(raw or "")).strip()
    if not text:
        return ""
    if re.fullmatch(r"\d+元", text):
        return text
    if text in {"/", "-", "—", "无", "暂无"} or re.fullmatch(r"[A-Za-z]包|第.+包", text):
        return ""
    text2 = re.sub(r"^(?:预算金额|成交金额|中标金额)\s*[:：]\s*", "", text)
    text2 = re.sub(r"（人民币）|\(人民币\)", "", text2).strip()
    text2 = re.split(r"[；;]\s*\d+[、.]", text2, maxsplit=1)[0].strip()
    m = re.search(r"[¥￥]\s*([\d,]+(?:\.\d+)?)", text2)
    if m and ("元" in text2 or "￥" in text2 or "¥" in text2):
        out = _fmt_int_yuan(_parse_money(m.group(1)))
        if out:
            return out
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*[(（]?\s*万元?\s*[)）]?", text2)
    if m and ("万" in text2):
        return _to_int_yuan(_parse_money(m.group(1)), "wan")
    m = _MONEY_FIELD_YUAN_RE.search(text2)
    if m:
        return _fmt_int_yuan(_parse_money(m.group(1)))
    m = re.search(r"[（(]\s*[¥￥]?\s*([\d,]{3,}(?:\.\d+)?)\s*[）)]", text2)
    if m:
        return _fmt_int_yuan(_parse_money(m.group(1)))
    if re.fullmatch(r"[\d,]+(?:\.\d+)?", text2.replace(" ", "")):
        num = _parse_money(text2)
        if num is None or num <= 0:
            return ""
        if num >= Decimal("10000"):
            return _fmt_int_yuan(num)
        return _fmt_int_yuan(num * Decimal("10000"))
    compact = re.sub(r"\s+", "", text)
    if _ZERO_BUDGET_RE.fullmatch(compact):
        return ""
    return ""


def _extract_budget_from_text(text: str) -> str:
    body = re.sub(r"[\u00a0\u3000\u200d]+", " ", str(text or ""))
    if not body:
        return ""
    for pat, unit in (
        (_BUDGET_YUAN_RE, "yuan"),
        (_BUDGET_WAN_RE, "wan"),
        (_PROCURE_YUAN_RE, "yuan"),
        (_PROCURE_WAN_RE, "wan"),
    ):
        m = pat.search(body)
        if not m:
            continue
        out = _to_int_yuan(_parse_money(m.group(1)), unit)
        if not out:
            continue
        n = int(out[:-1])
        if 1900 <= n <= 2100 or n < 100:
            continue
        return out
    return ""


def normalize_ccgp_budget(raw: Any, content_text: str = "") -> str:
    """优先正文完整金额，统一存为不带小数点的整数元，如 270000元。"""
    from_text = _extract_budget_from_text(content_text)
    if from_text:
        return from_text
    return _expand_money_field(raw)


def normalize_ccgp_successful_money(raw: Any, content_text: str = "") -> str:
    """成交/中标金额同样规范为整数元。"""
    body = re.sub(r"[\u00a0\u3000\u200d]+", " ", str(content_text or ""))
    for pat in (
        re.compile(
            r"(?:成交金额|中标金额|成交总金额)\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*万元",
            re.I,
        ),
        re.compile(
            r"(?:成交金额|中标金额|成交总金额)\s*[:：]\s*(?:人民币)?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元(?![/\w])",
            re.I,
        ),
    ):
        m = pat.search(body)
        if not m:
            continue
        unit = "wan" if "万元" in m.group(0) else "yuan"
        out = _to_int_yuan(_parse_money(m.group(1)), unit)
        if out and int(out[:-1]) >= 100:
            return out
    return _expand_money_field(raw)


def notice_time_from_url(url: object) -> datetime | None:
    """从官网链接路径提取发布日期，如 /202608/t20260805_xxx.htm。"""
    text = str(url or "")
    m = re.search(r"/(20\d{2})(\d{2})/t(20\d{2})(\d{2})(\d{2})_", text)
    if not m:
        return None
    return parse_time(f"{m.group(3)}-{m.group(4)}-{m.group(5)}")


def sanitize_notice_time(
    value: object,
    *,
    url: object = "",
    fallback: object = None,
    now: datetime | None = None,
) -> datetime | None:
    """校验公告发布时间：拒绝明显未来日期，回退到链接日期或列表时间。"""
    now = now or datetime.now()
    cutoff = now + _NOTICE_TIME_FUTURE_GRACE
    parsed = parse_time(value)
    if parsed and parsed <= cutoff:
        return parsed
    for candidate in (fallback, notice_time_from_url(url)):
        fb = parse_time(candidate) if not isinstance(candidate, datetime) else candidate
        if fb and fb <= cutoff:
            return fb
    if parsed:
        url_dt = notice_time_from_url(url)
        if url_dt and url_dt <= cutoff:
            return url_dt
    return parsed if parsed and parsed <= cutoff else None

# 三大公告类型（notice_type）及细分（notice_name）
CATEGORY_TENDER = "招标公告"
CATEGORY_AWARD = "中标公告"
CATEGORY_INTENT = "采购意向"


# 允许的细类（notice_name）白名单
FINE_TENDER = {"竞争性谈判公告", "磋商公告", "征集公告", "更正公告", "招标公告"}
FINE_AWARD = {"流标公告", "成交公示", "成交公告", "结果公告", "中标公告", "终止公告", "合同公告"}
FINE_INTENT = {"采购意向", "意向"}
FINE_ALL = FINE_TENDER | FINE_AWARD | FINE_INTENT
_JUNK_HINTS = {"其他", "其他公告", "全部", "采购公告频道", "未知"}



# 小程序 / biaoxunApi sourceExactTypes.ccgp：按三大类过滤（与 notice_type 一致）
API_CCGP_TENDER = {CATEGORY_TENDER}
API_CCGP_WIN = {CATEGORY_AWARD}
API_CCGP_INTENT = {CATEGORY_INTENT}
API_CCGP_ALL = API_CCGP_TENDER | API_CCGP_WIN | API_CCGP_INTENT


def to_api_notice_type(cat: str, fine: str, raw_type: str = "", title: str = "") -> tuple[str, str]:
    """返回入库/API 使用的 (notice_type大类, notice_name细类)。

    历史版本曾映射回官网细分（成交公告/废标公告等），会导致小程序必须多类型 OR。
    现统一三大类，细类只放 notice_name。
    """
    del raw_type, title
    cat_s = str(cat or "").strip() or CATEGORY_TENDER
    fine_s = str(fine or "").strip()
    if cat_s == CATEGORY_AWARD:
        return CATEGORY_AWARD, fine_s if fine_s in FINE_AWARD else "中标公告"
    if cat_s == CATEGORY_INTENT:
        return CATEGORY_INTENT, fine_s if fine_s in FINE_INTENT else "采购意向"
    return CATEGORY_TENDER, fine_s if fine_s in FINE_TENDER else "招标公告"

def classify_notice(
    title: object = "",
    notice_type: object = "",
    notice_name: object = "",
) -> tuple[str, str]:
    """按业务口径重标注公告类型。

    招标公告：竞争性谈判公告、磋商公告、征集公告、更正公告、招标公告
    中标公告：流标公告、成交公示、成交公告、结果公告、中标公告、终止公告、合同公告
    采购意向：意向、采购意向

    返回 (notice_type大类, notice_name细类)。
    """
    title_s = str(title or "").strip()
    type_s = str(notice_type or "").strip()
    name_s = str(notice_name or "").strip()
    cats = {CATEGORY_TENDER, CATEGORY_AWARD, CATEGORY_INTENT}

    # 三大类/垃圾细类不参与二次匹配，避免污染
    hint_type = "" if type_s in cats or type_s in _JUNK_HINTS else type_s
    hint_name = "" if name_s in cats or name_s in _JUNK_HINTS else name_s
    # 已是合法细类时可作为强提示
    if name_s in FINE_ALL:
        hint_name = name_s
    blob = f"{title_s} {hint_type} {hint_name}"

    def hit(*keys: str) -> bool:
        return any(k in blob for k in keys)

    # --- 采购意向 ---
    if hit("采购意向") or hint_type == "采购意向" or hint_name == "采购意向":
        return CATEGORY_INTENT, "采购意向"
    if hit("意向公开", "意向公示", "意向公告") or hint_type == "意向" or hint_name == "意向":
        return CATEGORY_INTENT, "意向"
    if "意向" in title_s and "采购" in title_s:
        return CATEGORY_INTENT, "采购意向"

    # --- 中标公告类 ---
    if hit("流标", "废标", "采购失败", "招标失败", "成交失败", "不足三家"):
        return CATEGORY_AWARD, "流标公告"
    if hit("成交公示") or hint_name == "成交公示":
        return CATEGORY_AWARD, "成交公示"
    if hit("合同公告", "合同公示", "政府采购合同") or hint_name == "合同公告":
        return CATEGORY_AWARD, "合同公告"
    if hit("终止公告", "中止公告", "项目终止", "采购终止", "采购中止") or hint_name == "终止公告":
        return CATEGORY_AWARD, "终止公告"
    if hit("中标公告", "中标结果", "中标（成交）", "中标(成交)") or hint_name == "中标公告":
        return CATEGORY_AWARD, "中标公告"
    if "中标" in title_s or hint_type == "中标" or hint_name == "中标":
        return CATEGORY_AWARD, "中标公告"
    if hit("成交公告", "成交结果") or hint_name == "成交公告":
        return CATEGORY_AWARD, "成交公告"
    if "成交" in title_s and not hit("征集", "招标", "谈判", "磋商"):
        return CATEGORY_AWARD, "成交公告"
    if hit("结果公告", "结果公示", "采购结果") or hint_name == "结果公告":
        return CATEGORY_AWARD, "结果公告"

    # --- 招标公告类（含官网细分以外的采购侧公告，细类归入招标公告）---
    if hit("竞争性谈判", "谈判公告") or hint_name in {"竞争性谈判", "竞争性谈判公告"}:
        return CATEGORY_TENDER, "竞争性谈判公告"
    if hit("竞争性磋商", "磋商公告") or hint_name in {"竞争性磋商", "磋商公告"}:
        return CATEGORY_TENDER, "磋商公告"
    if hit("征集公告", "征集供应商", "框架协议采购征集") or "征集" in title_s:
        return CATEGORY_TENDER, "征集公告"
    if hit("更正公告", "更正事项", "变更公告") or hint_name == "更正公告":
        return CATEGORY_TENDER, "更正公告"
    if hit(
        "公开招标",
        "邀请招标",
        "招标公告",
        "询价",
        "单一来源",
        "资格预审",
        "比选",
        "比价",
        "询比",
        "竞价",
        "简易采购",
        "采购公告",
        "预公告",
        "需求公示",
        "参数公示",
        "征求意见",
    ) or hint_name in FINE_TENDER or hint_type in {
        "公开招标",
        "公开招标公告",
        "招标公告",
        "询价",
        "询价公告",
        "单一来源",
        "资格预审",
        "邀请招标",
    }:
        return CATEGORY_TENDER, "招标公告"
    if "招标" in title_s or "采购" in title_s:
        return CATEGORY_TENDER, "招标公告"

    # 已是三大类：细类非法则按大类默认
    if type_s == CATEGORY_AWARD:
        return CATEGORY_AWARD, name_s if name_s in FINE_AWARD else "中标公告"
    if type_s == CATEGORY_INTENT:
        return CATEGORY_INTENT, name_s if name_s in FINE_INTENT else "采购意向"
    if type_s == CATEGORY_TENDER:
        return CATEGORY_TENDER, name_s if name_s in FINE_TENDER else "招标公告"

    if hint_name in FINE_ALL:
        if hint_name in FINE_AWARD:
            return CATEGORY_AWARD, hint_name
        if hint_name in FINE_INTENT:
            return CATEGORY_INTENT, hint_name
        return CATEGORY_TENDER, hint_name
    return CATEGORY_TENDER, "招标公告"


def ensure_schema() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {TABLE} (
              id varchar(64) NOT NULL COMMENT '公告ID',
              source varchar(16) NOT NULL DEFAULT 'ccgp' COMMENT '来源',
              title varchar(512) NOT NULL DEFAULT '' COMMENT '标题',
              notice_time datetime DEFAULT NULL COMMENT '发布时间',
              region varchar(128) NOT NULL DEFAULT '' COMMENT '区划',
              notice_name varchar(128) NOT NULL DEFAULT '' COMMENT '公告名称/细类',
              notice_type varchar(128) NOT NULL DEFAULT '' COMMENT '公告类型：招标公告/中标公告/采购意向',
              channel varchar(64) NOT NULL DEFAULT '' COMMENT '频道ID',
              url varchar(1024) NOT NULL DEFAULT '' COMMENT '官网链接',
              project_no varchar(256) NOT NULL DEFAULT '' COMMENT '项目编号',
              project_name varchar(512) NOT NULL DEFAULT '' COMMENT '项目名称',
              purchaser varchar(512) NOT NULL DEFAULT '' COMMENT '采购人',
              agency varchar(512) NOT NULL DEFAULT '' COMMENT '代理机构',
              budget varchar(64) NOT NULL DEFAULT '' COMMENT '预算',
              successful_money varchar(64) NOT NULL DEFAULT '' COMMENT '成交金额',
              purchase_manner varchar(128) NOT NULL DEFAULT '' COMMENT '采购方式',
              attchs json DEFAULT NULL COMMENT '附件',
              description mediumtext COMMENT '摘要',
              content_html mediumtext COMMENT '正文HTML',
              content_text mediumtext COMMENT '正文纯文本',
              keyword varchar(256) NOT NULL DEFAULT '' COMMENT '检索关键词',
              search_mode varchar(16) NOT NULL DEFAULT '' COMMENT 'content|title',
              crawled_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次入库',
              updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
              deadline date DEFAULT NULL,
              PRIMARY KEY (id),
              KEY idx_notice_time (notice_time),
              KEY idx_region (region),
              KEY idx_project_no (project_no(191)),
              KEY idx_purchaser (purchaser(191)),
              KEY idx_source_notice_time (source, notice_time),
              KEY idx_source_type_time (source, notice_type, notice_time),
              FULLTEXT KEY ft_ccgp_title (title) WITH PARSER ngram
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='中国政府采购网公告'
            """
        )


def relabel_notice_types(*, limit: int = 0, dry_run: bool = False) -> dict[str, int]:
    """全表按 classify_notice 重写 notice_type(大类) / notice_name(细类) / channel。"""
    ensure_schema()
    updated = 0
    scanned = 0
    dist: dict[str, int] = {}
    fine_dist: dict[str, int] = {}
    samples: list[tuple[str, str, str, str, str]] = []
    batch_size = 500
    with connect() as conn, conn.cursor() as cur:
        sql = "SELECT id, title, notice_type, notice_name, channel FROM ccgp"
        if limit and limit > 0:
            sql += f" LIMIT {int(limit)}"
        cur.execute(sql)
        rows = cur.fetchall() or []
        batch: list[tuple[str, str, str, str]] = []

        def flush() -> None:
            nonlocal batch, updated
            if dry_run or not batch:
                batch = []
                return
            cur.executemany(
                "UPDATE ccgp SET notice_type=%s, notice_name=%s, channel=%s WHERE id=%s",
                batch,
            )
            conn.commit()
            batch = []

        for row in rows:
            scanned += 1
            cat, fine = classify_notice(
                row.get("title"), row.get("notice_type"), row.get("notice_name")
            )
            dist[cat] = dist.get(cat, 0) + 1
            fine_dist[fine] = fine_dist.get(fine, 0) + 1
            old_t = str(row.get("notice_type") or "")
            old_n = str(row.get("notice_name") or "")
            old_c = str(row.get("channel") or "")
            if old_t == cat and old_n == fine and old_c == cat:
                continue
            updated += 1
            if len(samples) < 20:
                samples.append((old_t, old_n, cat, fine, str(row.get("title") or "")[:60]))
            batch.append((cat, fine, cat, row["id"]))
            if len(batch) >= batch_size:
                flush()
                print(f"relabel progress scanned={scanned} updated={updated}", flush=True)
        flush()
    return {
        "scanned": scanned,
        "updated": updated,
        "dry_run": dry_run,
        "dist": dist,
        "fine_dist": fine_dist,
        "samples": samples,
    }


def make_id(url: str) -> str:
    return "ccgp_" + hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


def _clip(value: Any, max_len: int) -> str:
    text = "" if value is None else str(value)
    return text if len(text) <= max_len else text[:max_len]


def _json_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    return json.dumps(value, ensure_ascii=False)


def _loads(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _plain_text(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text("\n", strip=True)


def _format_row(row: dict[str, Any]) -> dict[str, Any]:
    row = dict(row)
    row["attchs"] = _loads(row.get("attchs"), [])
    value = row.get("notice_time")
    if hasattr(value, "strftime"):
        row["notice_time"] = value.strftime("%Y-%m-%d %H:%M:%S")
        row["publish_time"] = row["notice_time"]
    return row


def _where(
    keyword: str = "",
    notice_type: str = "",
    start: str = "",
    end: str = "",
) -> tuple[str, list[Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if keyword:
        like = f"%{keyword}%"
        clauses.append(
            "(title LIKE %s OR project_no LIKE %s OR purchaser LIKE %s OR content_text LIKE %s)"
        )
        params.extend([like, like, like, like])
    if notice_type:
        clauses.append("(notice_type=%s OR notice_name=%s)")
        params.extend([notice_type, notice_type])
    if start:
        clauses.append("notice_time >= %s")
        params.append(start)
    if end:
        clauses.append("notice_time <= %s")
        params.append(end)
    return " AND ".join(clauses), params


def fetch_page(
    page: int,
    per_page: int,
    *,
    keyword: str = "",
    mode: str = "",
    notice_type: str = "",
    start: str = "",
    end: str = "",
) -> tuple[int, list[dict[str, Any]]]:
    del mode
    page = max(1, int(page or 1))
    per_page = min(100, max(1, int(per_page or 20)))
    where, params = _where(keyword=keyword, notice_type=notice_type, start=start, end=end)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM {TABLE} WHERE {where}", params)
        total = int((cur.fetchone() or {}).get("c") or 0)
        cur.execute(
            f"""
            SELECT id, title, notice_time, region, notice_name, notice_type, url,
                   project_no, project_name, purchaser, agency, budget,
                   successful_money, purchase_manner, content_text
            FROM {TABLE}
            WHERE {where}
            ORDER BY notice_time DESC, updated_at DESC, id DESC
            LIMIT %s OFFSET %s
            """,
            params + [per_page, (page - 1) * per_page],
        )
        rows = [_format_row(row) for row in cur.fetchall()]
    return total, rows


def fetch_one(notice_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {TABLE} WHERE id=%s", (notice_id,))
        row = cur.fetchone()
    return _format_row(row) if row else None


def count_all() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM {TABLE}")
        return int((cur.fetchone() or {}).get("c") or 0)


def title_date_key(title: object, notice_time: object = None) -> str:
    """Normalize title+date for duplicate detection across different URLs/types."""
    import re

    text = re.sub(r"[\u200b\ufeff\u00a0]", " ", str(title or ""))
    text = re.sub(r"\s+", " ", text).strip().lower()
    if not text:
        return ""
    date = ""
    if hasattr(notice_time, "strftime"):
        date = notice_time.strftime("%Y-%m-%d")
    else:
        raw = str(notice_time or "").strip()
        m = re.search(r"(20\d{2}-\d{2}-\d{2})", raw)
        if m:
            date = m.group(1)
    return f"{text}|{date}" if date else text


def existing_title_keys(limit: int = 0) -> set[str]:
    """Load title|date keys already in DB (optionally capped)."""
    keys: set[str] = set()
    with connect() as conn, conn.cursor() as cur:
        sql = f"SELECT title, notice_time FROM {TABLE} WHERE title <> ''"
        if limit and limit > 0:
            sql += f" ORDER BY notice_time DESC LIMIT {int(limit)}"
        cur.execute(sql)
        for row in cur.fetchall() or []:
            key = title_date_key(row.get("title"), row.get("notice_time"))
            if key:
                keys.add(key)
    return keys


def existing_urls(urls: list[str]) -> set[str]:
    clean = [u for u in urls if u]
    if not clean:
        return set()
    out: set[str] = set()
    with connect() as conn, conn.cursor() as cur:
        for i in range(0, len(clean), 200):
            part = clean[i : i + 200]
            ph = ",".join(["%s"] * len(part))
            cur.execute(f"SELECT url FROM {TABLE} WHERE url IN ({ph})", part)
            out.update(r["url"] for r in cur.fetchall())
    return out


def urls_missing_content(urls: list[str]) -> set[str]:
    clean = [u for u in urls if u]
    if not clean:
        return set()
    need: set[str] = set()
    with connect() as conn, conn.cursor() as cur:
        for i in range(0, len(clean), 200):
            part = clean[i : i + 200]
            ph = ",".join(["%s"] * len(part))
            cur.execute(
                f"SELECT url, content_html FROM {TABLE} WHERE url IN ({ph})",
                part,
            )
            found = {r["url"]: r.get("content_html") or "" for r in cur.fetchall()}
            for u in part:
                html = found.get(u)
                if html is None or not str(html).strip():
                    need.add(u)
    return need


def fix_future_notice_times(*, limit: int = 0) -> dict[str, int]:
    """修正 notice_time 落在未来的记录（多为误取正文截止/合同日期）。"""
    ensure_schema()
    scanned = 0
    updated = 0
    cleared = 0
    with connect() as conn, conn.cursor() as cur:
        sql = "SELECT id, url, notice_time FROM ccgp WHERE notice_time > NOW()"
        if limit and limit > 0:
            sql += f" LIMIT {int(limit)}"
        cur.execute(sql)
        rows = cur.fetchall() or []
        for row in rows:
            scanned += 1
            old = row.get("notice_time")
            new = sanitize_notice_time(old, url=row.get("url"))
            if new == old and old is not None:
                url_dt = notice_time_from_url(row.get("url"))
                if url_dt and url_dt <= datetime.now() + _NOTICE_TIME_FUTURE_GRACE:
                    new = url_dt
            if new == old:
                continue
            if new is None:
                cleared += 1
            else:
                updated += 1
            cur.execute("UPDATE ccgp SET notice_time=%s WHERE id=%s", (new, row["id"]))
        conn.commit()
    return {"scanned": scanned, "updated": updated, "cleared": cleared}


UPSERT_COLUMNS = [
    "id",
    "source",
    "title",
    "notice_time",
    "region",
    "notice_name",
    "notice_type",
    "channel",
    "url",
    "project_no",
    "project_name",
    "purchaser",
    "agency",
    "budget",
    "successful_money",
    "purchase_manner",
    "attchs",
    "description",
    "content_html",
    "content_text",
    "keyword",
    "search_mode",
]


def upsert_many(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    ensure_schema()
    values = []
    for item in rows:
        url = _clip(item.get("url") or "", 1024)
        if not url:
            continue
        html = item.get("content_html") or ""
        text = item.get("content_text") or _plain_text(html)
        # 入库统一三大类：notice_type=大类，notice_name=细类，channel=大类
        # 勿再写回官网细分（成交公告/废标公告等），否则小程序只能多类型 OR
        cat, fine = classify_notice(
            item.get("title"),
            item.get("notice_type"),
            item.get("notice_name"),
        )
        api_type, display_name = to_api_notice_type(
            cat,
            fine,
            str(item.get("notice_type") or ""),
            str(item.get("title") or ""),
        )
        values.append(
            [
                _clip(item.get("id") or make_id(url), 64),
                _clip(item.get("source") or "ccgp", 16),
                _clip(item.get("title") or "", 512),
                sanitize_notice_time(item.get("notice_time"), url=url),
                _clip(item.get("region") or "", 128),
                _clip(display_name, 128),
                _clip(api_type, 128),
                _clip(api_type, 64),
                url,
                _clip(item.get("project_no") or "", 256),
                _clip(item.get("project_name") or "", 512),
                _clip(item.get("purchaser") or "", 512),
                _clip(item.get("agency") or "", 512),
                _clip(
                    normalize_ccgp_budget(item.get("budget") or "", text),
                    64,
                ),
                _clip(
                    normalize_ccgp_successful_money(
                        item.get("successful_money") or "", text
                    ),
                    64,
                ),
                _clip(item.get("purchase_manner") or "", 128),
                _json_value(item.get("attchs") or []),
                item.get("description") or "",
                html,
                text,
                _clip(item.get("keyword") or "", 256),
                _clip(item.get("search_mode") or "detail", 16),
            ]
        )
    if not values:
        return 0
    cols = ", ".join(UPSERT_COLUMNS)
    ph = ", ".join(["%s"] * len(UPSERT_COLUMNS))
    updates = ", ".join(
        f"{c}=VALUES({c})"
        for c in UPSERT_COLUMNS
        if c not in {"id", "source", "crawled_at"}
    )
    sql = f"INSERT INTO {TABLE} ({cols}) VALUES ({ph}) ON DUPLICATE KEY UPDATE {updates}"
    with connect() as conn, conn.cursor() as cur:
        cur.executemany(sql, values)
        conn.commit()
        return len(values)


if __name__ == "__main__":
    import json
    import sys

    apply_mode = "--apply" in sys.argv
    limit = 0
    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            limit = int(arg.split("=", 1)[1])
    out = relabel_notice_types(limit=limit, dry_run=not apply_mode)
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    if not apply_mode:
        print("dry-run only; pass --apply to update", file=sys.stderr)
