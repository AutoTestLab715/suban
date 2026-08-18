#!/usr/bin/env python3
"""江西省政府采购网爬虫（独立实现，不复用其他门户脚本）。"""

from __future__ import annotations

import json
import re
import threading
import time
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urljoin

import requests
from bs4 import BeautifulSoup

import jiangxi_db as db

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
STATUS_PATH = OUTPUT_DIR / "jiangxi_crawl_status.json"
STOP_FLAG = OUTPUT_DIR / "jiangxi_crawl.stop"

BASE = "https://zfcg.jxf.gov.cn"
PAGE_URL = f"{BASE}/"
LIST_API = f"{BASE}/gpcms/rest/web/v2/info/selectInfoMoreChannel"
DETAIL_API = f"{BASE}/gpcms/rest/web/v2/info/getInfoById"
SITE_ID_API = f"{BASE}/gpcms/rest/web/v2/index/getDeploymentSiteId"
DOMAIN = "zfcg.jxf.gov.cn"

# 官网「采购公告」顶栏频道（含下属全部公告类型）
DEFAULT_CHANNEL = "c5bff13f-21ca-4dac-b158-cb40accd3035"
DEFAULT_SITE_ID = "93BB7F0CFA5A6362B1100531C50AE36B"
# 接口单页建议 20–40；官网 currPage 无效，靠时间游标翻页
PAGE_SIZE = 40
DEFAULT_LOOKBACK_DAYS = 30
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

ProgressCb = Callable[[dict[str, Any]], None]

_lock = threading.Lock()
_cancel = threading.Event()
_running = False


class CrawlAlreadyRunning(RuntimeError):
    pass


class CrawlError(RuntimeError):
    pass


class CrawlStopped(RuntimeError):
    pass


def is_running() -> bool:
    with _lock:
        return _running


def external_crawl_alive() -> bool:
    """True when a CLI/cron crawler.py for this portal is running."""
    try:
        import os

        marker = str(ROOT)
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                cmdline = (entry / "cmdline").read_bytes().replace(b"\x00", b" ").decode(
                    "utf-8", "replace"
                )
            except OSError:
                continue
            if "crawler.py" not in cmdline:
                continue
            if marker not in cmdline and "jiangxi_crawler.py" not in cmdline and "jiangxi-portal" not in cmdline:
                continue
            # ignore the web app itself
            if "app.py" in cmdline:
                continue
            # ignore this status probe if any
            try:
                if int(entry.name) == os.getpid():
                    continue
            except ValueError:
                pass
            return True
    except Exception:
        return False
    return False


def crawl_busy() -> bool:
    """In-process thread or external crawler currently working."""
    if is_running():
        return True
    if external_crawl_alive():
        return True
    age = status_age_seconds()
    st = load_status()
    if st.get("running") and age is not None and age <= 90:
        return True
    return False


def try_begin() -> bool:
    """Atomically mark crawl as running. Returns False if already running."""
    global _running
    with _lock:
        if _running or external_crawl_alive():
            return False
        _running = True
        clear_stop()
        return True


def request_stop() -> None:
    _cancel.set()
    STOP_FLAG.write_text("1", encoding="utf-8")
    # Best-effort stop for CLI crawl (reads crawl.stop via _should_stop).
    # Also send SIGTERM if an external crawler is still alive after a moment.
    try:
        import os
        import signal

        marker = str(ROOT)
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                cmdline = (entry / "cmdline").read_bytes().replace(b"\x00", b" ").decode(
                    "utf-8", "replace"
                )
            except OSError:
                continue
            if "crawler.py" in cmdline and (
                marker in cmdline or "jiangxi-portal" in cmdline
            ) and "app.py" not in cmdline:
                try:
                    os.kill(int(entry.name), signal.SIGTERM)
                except OSError:
                    pass
    except Exception:
        pass


def clear_stop() -> None:
    _cancel.clear()
    if STOP_FLAG.exists():
        STOP_FLAG.unlink(missing_ok=True)


def _should_stop() -> bool:
    return _cancel.is_set() or STOP_FLAG.exists()


def _write_status(payload: dict[str, Any]) -> None:
    STATUS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_status() -> dict[str, Any]:
    if not STATUS_PATH.is_file():
        return {}
    try:
        data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def status_age_seconds() -> float | None:
    if not STATUS_PATH.is_file():
        return None
    try:
        return max(0.0, time.time() - STATUS_PATH.stat().st_mtime)
    except OSError:
        return None


def mark_interrupted(message: str = "抓取进程已中断，可重新开始") -> dict[str, Any]:
    data = load_status()
    data.update(
        {
            "running": False,
            "ok": True,
            "phase": "已中断",
            "message": message,
        }
    )
    _write_status(data)
    clear_stop()
    return data


def _session() -> requests.Session:
    sess = requests.Session()
    sess.headers.update(
        {
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Referer": f"{BASE}/",
            "Origin": BASE,
        }
    )
    return sess


def _get_json(sess: requests.Session, url: str, *, params: dict[str, Any], retries: int = 3) -> dict[str, Any]:
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            r = sess.get(url, params=params, timeout=45)
            r.raise_for_status()
            body = r.json()
            if str(body.get("code")) not in {"200", "0"}:
                raise CrawlError(f"接口失败：{body.get('msg') or body}")
            return body
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            time.sleep(0.8 * (attempt + 1))
    raise CrawlError(str(last_exc) if last_exc else "请求失败")


def resolve_site_id(sess: requests.Session | None = None) -> str:
    sess = sess or _session()
    try:
        body = _get_json(sess, SITE_ID_API, params={"domain": DOMAIN}, retries=2)
        site_id = str((body.get("data") or {}).get("id") or "").strip()
        if site_id:
            return site_id
    except Exception:
        pass
    return DEFAULT_SITE_ID


def _normalize_dt(value: str, *, end: bool = False) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) == 10:
        return text + (" 23:59:59" if end else " 00:00:00")
    return text[:19]


def _int_opt(value: Any, default: int) -> int:
    """Parse int option; keep 0 (unlimited) instead of falling back via `or`."""
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_options(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    # 0 = 不限页数 / 不限条数；不能用 `x or default`，否则 0 会被当成缺省
    pages = max(0, _int_opt(payload.get("pages"), 0))
    limit = max(0, _int_opt(payload.get("limit"), 0))
    keyword = str(payload.get("keyword") or "").strip()
    mode = str(payload.get("mode") or "content").strip() or "content"
    start = _normalize_dt(str(payload.get("start") or ""), end=False)
    end = _normalize_dt(str(payload.get("end") or ""), end=True)
    if not start and not end:
        end_d = date.today()
        start_d = end_d - timedelta(days=DEFAULT_LOOKBACK_DAYS)
        start = start_d.isoformat() + " 00:00:00"
        end = end_d.isoformat() + " 23:59:59"
    # 默认强制跳过已入库，避免重复抓取；仅 force_refresh=true 时允许重抓
    if payload.get("force_refresh"):
        skip_existing = False
    else:
        skip_existing = True
    return {
        "keyword": keyword,
        "mode": mode,
        "pages": pages,
        "limit": limit,
        "start": start,
        "end": end,
        "channel": str(payload.get("channel") or DEFAULT_CHANNEL),
        "site_id": str(payload.get("site_id") or ""),
        "fetch_detail": bool(payload.get("fetch_detail", True)),
        "skip_existing": bool(skip_existing),
    }


def _list_params(opts: dict[str, Any], page: int, site_id: str) -> dict[str, Any]:
    title = opts["keyword"] if opts.get("mode") == "title" else opts.get("keyword") or ""
    return {
        "siteId": site_id,
        "channel": opts["channel"],
        "currPage": page,
        "pageSize": PAGE_SIZE,
        "noticeType": "",
        "regionCode": "",
        "cityOrArea": "",
        "purchaseManner": "",
        "title": title,
        "openTenderCode": "",
        "purchaser": "",
        "agency": "",
        "purchaseNature": "",
        "operationStartTime": opts.get("start") or "",
        "operationEndTime": opts.get("end") or "",
        "verifyCode": "",
    }


def query_list(
    sess: requests.Session,
    opts: dict[str, Any],
    page: int,
    site_id: str,
) -> tuple[int, list[dict[str, Any]]]:
    body = _get_json(sess, LIST_API, params=_list_params(opts, page, site_id))
    data = body.get("data") or {}
    total = int(data.get("total") or 0)
    rows = data.get("rows") or []
    if not isinstance(rows, list):
        rows = []
    return total, rows


def preview_count(opts: dict[str, Any]) -> int:
    sess = _session()
    site_id = opts.get("site_id") or resolve_site_id(sess)
    total, _ = query_list(sess, opts, 1, site_id)
    return total


def _parse_notice_time(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:19] if fmt.endswith("%S") else text[:10], fmt)
        except ValueError:
            continue
    return None


def _shift_time(value: str, *, seconds: int) -> str:
    dt = _parse_notice_time(value)
    if not dt:
        return value
    return (dt + timedelta(seconds=seconds)).strftime("%Y-%m-%d %H:%M:%S")


def _detail_url(raw_id: str) -> str:
    return f"{BASE}/gpcms-center-web/#/noticeInformationJx?id={quote(raw_id)}"


def _abs_url(url: str) -> str:
    text = str(url or "").strip()
    if not text:
        return ""
    if text.startswith("//"):
        return "https:" + text
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return urljoin(BASE + "/", text.lstrip("/"))


def _normalize_attchs(value: Any) -> list[dict[str, str]]:
    items = value if isinstance(value, list) else []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(
            item.get("name")
            or item.get("fileName")
            or item.get("file")
            or item.get("attchName")
            or ""
        ).strip()
        url = _abs_url(
            str(
                item.get("url")
                or item.get("fileUrl")
                or item.get("file")
                or item.get("path")
                or item.get("attchUrl")
                or ""
            )
        )
        if not url:
            continue
        if url in seen:
            continue
        seen.add(url)
        out.append({"name": name or url.rsplit("/", 1)[-1] or url, "url": url})
    return out


def _absolutize_html(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(["a", "img"]):
        for attr in ("href", "src"):
            val = tag.get(attr)
            if isinstance(val, str) and val.strip() and not re.match(
                r"^\s*(?:javascript|data|vbscript|#):", val, re.I
            ):
                if val.startswith("/") or not re.match(r"^https?://", val, re.I):
                    if not val.startswith("#") and not val.lower().startswith("mailto:"):
                        tag[attr] = _abs_url(val)
    return str(soup)


def _attchs_from_html(html: str) -> list[dict[str, str]]:
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = _abs_url(str(a.get("href") or ""))
        if not href:
            continue
        low = href.lower()
        if not any(k in low for k in ("download", "freecms", "attach", "file", ".pdf", ".doc", ".xls", ".zip", ".rar", ".wps")):
            continue
        if href in seen:
            continue
        seen.add(href)
        name = a.get_text(" ", strip=True) or href.rsplit("/", 1)[-1]
        out.append({"name": name, "url": href})
    return out


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
_BUDGET_PAREN_YUAN_RE = re.compile(
    r"预算金额\s*(?:[(（]\s*(?:人民币\s*/?\s*)?元\s*[)）])\s*[:：]?\s*.{0,160}?([\d,]{4,}(?:\.\d+)?)",
    re.I | re.S,
)
_WAN_TABLE_RE = re.compile(
    r"预算金额\s*[(（]?\s*万元\s*[)）]?(?P<body>.{0,400})",
    re.I | re.S,
)


def _parse_money(raw: Any) -> Decimal | None:
    text = str(raw or "").replace(",", "").strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _fmt_int_yuan(num: Decimal) -> str:
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


def _extract_budget_from_text(text: str) -> str:
    body = re.sub(r"[\u00a0\u3000]+", " ", str(text or ""))
    if not body:
        return ""
    for pat, unit in (
        (_BUDGET_YUAN_RE, "yuan"),
        (_BUDGET_WAN_RE, "wan"),
        (_PROCURE_YUAN_RE, "yuan"),
        (_PROCURE_WAN_RE, "wan"),
        (_BUDGET_PAREN_YUAN_RE, "yuan"),
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
    m = _WAN_TABLE_RE.search(body)
    if m:
        chunk = m.group("body") or ""
        for raw in re.findall(r"([\d,]+(?:\.\d+)?)\s*万元", chunk):
            out = _to_int_yuan(_parse_money(raw), "wan")
            if out and int(out[:-1]) >= 100:
                return out
        for raw in re.findall(r"([\d,]+(?:\.\d{2,6}))\s*20\d{2}(?:[-/年.]?\d{1,2})?", chunk):
            num = _parse_money(raw)
            if num is None:
                continue
            if Decimal("0.01") <= num < Decimal("50000"):
                out = _to_int_yuan(num, "wan")
                if out and int(out[:-1]) >= 100:
                    return out
    return ""


def _expand_list_budget(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if re.fullmatch(r"\d+元", text):
        return text
    if text.endswith("元"):
        num = _parse_money(text[:-1])
        return _fmt_int_yuan(num) if num is not None else ""
    if "万元" in text:
        return _to_int_yuan(_parse_money(text.replace("万元", "")), "wan")
    if any(ch in text for ch in ("万", "￥", "¥")):
        return ""
    if not re.fullmatch(r"[\d,]+(?:\.\d+)?", text.replace(" ", "")):
        return ""
    num = _parse_money(text)
    if num is None or num <= 0:
        return ""
    # 列表接口 budget 多为万元
    if num >= Decimal("10000"):
        return _fmt_int_yuan(num)
    return _fmt_int_yuan(num * Decimal("10000"))


def normalize_jiangxi_budget(raw: Any, content_text: str = "") -> str:
    """优先正文完整金额，统一存为不带小数点的整数元，如 270000元。"""
    from_text = _extract_budget_from_text(content_text)
    if from_text:
        return from_text
    return _expand_list_budget(raw)


def _map_list_row(row: dict[str, Any]) -> dict[str, Any]:
    raw_id = str(row.get("id") or "").strip()
    notice_time = str(row.get("noticeTime") or row.get("publishTime") or "").strip()
    catalogue = row.get("catalogueNameList")
    if isinstance(catalogue, list):
        catalogue_text = "、".join(str(x) for x in catalogue if x)
    else:
        catalogue_text = str(catalogue or "").strip()
    project_no = str(
        row.get("openTenderCode") or row.get("planCodes") or row.get("planCode") or ""
    ).strip()
    description = str(row.get("description") or "").strip()
    if not description and catalogue_text:
        description = f"采购目录：{catalogue_text}"
    return {
        "raw_id": raw_id,
        "id": db.make_id(raw_id),
        "source": "zfcg",
        "title": str(row.get("title") or "").strip(),
        "notice_time": notice_time,
        "region": str(row.get("regionName") or row.get("regionCode") or "").strip(),
        "notice_name": str(
            row.get("noticeTypeName") or row.get("channelName") or "采购公告"
        ).strip(),
        "notice_type": str(row.get("noticeTypeName") or row.get("noticeType") or "").strip(),
        "channel": str(row.get("channel") or "")[:64],
        "url": _detail_url(raw_id) if raw_id else BASE,
        "project_no": project_no,
        "project_name": str(row.get("title") or "").strip(),
        "purchaser": str(row.get("purchaser") or row.get("author") or "").strip(),
        "agency": str(row.get("agency") or "").strip(),
        "budget": normalize_jiangxi_budget(row.get("budget") or ""),
        "successful_money": _expand_list_budget(row.get("successfulMoney") or ""),
        "purchase_manner": str(
            row.get("purchaseMannerName") or row.get("purchaseManner") or ""
        ).strip(),
        "description": description,
        "attchs": _normalize_attchs(row.get("attchs") or row.get("attchList")),
        "content_html": "",
        "content_text": "",
        "catalogue": catalogue_text,
        "plan_codes": str(row.get("planCodes") or row.get("planCode") or "").strip(),
        "data_source": str(row.get("dataSource") or "").strip(),
    }


def _escape_html(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _build_fallback_html(data: dict[str, Any], mapped: dict[str, Any]) -> str:
    """采购计划等无富文本时，用接口结构化字段拼详情正文。"""
    pairs: list[tuple[str, str]] = [
        ("公告类型", mapped.get("notice_name") or mapped.get("notice_type") or ""),
        ("区划", mapped.get("region") or ""),
        ("采购人", mapped.get("purchaser") or ""),
        ("代理机构", mapped.get("agency") or ""),
        ("项目编号/计划编号", mapped.get("project_no") or mapped.get("plan_codes") or ""),
        ("采购方式", mapped.get("purchase_manner") or ""),
        ("预算金额", mapped.get("budget") or ""),
        ("成交金额", mapped.get("successful_money") or ""),
        ("采购目录", mapped.get("catalogue") or ""),
        ("发布时间", mapped.get("notice_time") or ""),
        ("摘要", mapped.get("description") or ""),
    ]
    # 补充详情里其它可读字段
    extra_keys = [
        ("recordTime", "备案时间"),
        ("author", "发布单位"),
        ("channelName", "栏目"),
        ("purchaseNature", "采购性质"),
    ]
    for key, label in extra_keys:
        val = data.get(key)
        if val not in (None, "", [], {}) and not any(p[0] == label for p in pairs):
            pairs.append((label, str(val)))

    rows = []
    for label, value in pairs:
        text = str(value or "").strip()
        if not text:
            continue
        rows.append(
            f"<tr><th>{_escape_html(label)}</th><td>{_escape_html(text)}</td></tr>"
        )
    if not rows:
        return ""
    tip = (
        "<p class='muted'>该公告在官网详情接口中无独立富文本正文，以下为结构化信息。"
        "完整内容请打开官网原文。</p>"
    )
    return (
        tip
        + "<table class='meta-table'><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )


def fetch_detail(sess: requests.Session, raw_id: str) -> dict[str, Any]:
    body = _get_json(sess, DETAIL_API, params={"id": raw_id})
    data = body.get("data") or {}
    mapped = _map_list_row(data)
    html = _absolutize_html(str(data.get("content") or data.get("noticeContent") or ""))
    attchs = _normalize_attchs(data.get("attchs") or data.get("attchList"))
    if not attchs:
        attchs = _attchs_from_html(html)
    else:
        extra = _attchs_from_html(html)
        seen = {a["url"] for a in attchs}
        for item in extra:
            if item["url"] not in seen:
                attchs.append(item)
                seen.add(item["url"])
    mapped["attchs"] = attchs
    mapped["notice_name"] = str(
        data.get("noticeTypeName") or data.get("channelName") or mapped["notice_name"]
    ).strip()
    mapped["purchaser"] = str(
        data.get("purchaser") or data.get("author") or mapped["purchaser"]
    ).strip()

    if not html.strip():
        html = _build_fallback_html(data, mapped)
    mapped["content_html"] = html
    mapped["content_text"] = (
        BeautifulSoup(html, "html.parser").get_text("\n", strip=True) if html else ""
    )
    # 正文预算优先；统一为整数元（无小数点）
    mapped["budget"] = normalize_jiangxi_budget(
        mapped.get("budget") or data.get("budget") or "",
        mapped.get("content_text") or "",
    )
    if not str(mapped.get("successful_money") or "").endswith("元"):
        mapped["successful_money"] = _expand_list_budget(
            mapped.get("successful_money") or data.get("successfulMoney") or ""
        )
    return mapped


def run_crawl(
    opts: dict[str, Any],
    on_progress: ProgressCb | None = None,
    *,
    already_started: bool = False,
    cancel: threading.Event | None = None,
) -> dict[str, Any]:
    global _running
    if not already_started:
        if not try_begin():
            raise CrawlAlreadyRunning("已有抓取任务在运行")

    opts = normalize_options(opts)
    sess = _session()
    site_id = opts.get("site_id") or resolve_site_id(sess)
    opts["site_id"] = site_id

    recent: list[dict[str, Any]] = []
    count = 0
    new_count = 0
    skipped = 0
    pages_done = 0
    target = 1
    latest: dict[str, Any] | None = None

    def stopped() -> bool:
        return _should_stop() or bool(cancel and cancel.is_set())

    def emit(phase: str, progress: int, message: str, **extra: Any) -> None:
        payload = {
            "running": True,
            "ok": True,
            "phase": phase,
            "progress": progress,
            "message": message,
            "count": count,
            "new_count": new_count,
            "skipped": skipped,
            "current_page": pages_done,
            "latest": latest,
            "recent": recent[:12],
            "options": opts,
            "db_total": db.count_all(),
            "site": "jiangxi",
            **extra,
        }
        _write_status(payload)
        if on_progress:
            on_progress(payload)

    try:
        emit("预览", 2, "正在查询可抓取数量…")
        # 官网 currPage 分页失效，改用「结束时间游标」向更早翻页
        total_remote, _ = query_list(sess, opts, 1, site_id)
        limit = opts["limit"]
        if limit <= 0:
            limit = total_remote or 10**9
        # pages>0 时按页数估算上限（兼容旧选项）
        if opts["pages"] > 0:
            limit = min(limit, opts["pages"] * PAGE_SIZE)
        target = min(limit, total_remote) if total_remote else limit
        emit(
            "列表抓取",
            5,
            f"官网约 {total_remote} 条，本次目标约 {target} 条（跳过已入库，时间游标翻页）",
        )

        cursor_end = opts.get("end") or (date.today().isoformat() + " 23:59:59")
        start_bound = opts.get("start") or ""
        seen_ids: set[str] = set()
        stagnant = 0

        while count < limit:
            if stopped():
                raise CrawlStopped("用户停止抓取")

            page_opts = dict(opts)
            page_opts["end"] = cursor_end
            _, rows = query_list(sess, page_opts, 1, site_id)
            pages_done += 1
            if not rows:
                break

            fresh_rows: list[dict[str, Any]] = []
            for row in rows:
                raw_id = str(row.get("id") or "").strip()
                if not raw_id or raw_id in seen_ids:
                    continue
                notice_time = str(row.get("noticeTime") or row.get("publishTime") or "")
                if start_bound and notice_time and notice_time < start_bound:
                    continue
                seen_ids.add(raw_id)
                fresh_rows.append(row)

            if not fresh_rows:
                stagnant += 1
                oldest = min(
                    (str(r.get("noticeTime") or r.get("publishTime") or "9999") for r in rows),
                    default="",
                )
                if not oldest or oldest == "9999":
                    break
                next_end = _shift_time(oldest, seconds=-1)
                if start_bound and next_end < start_bound:
                    break
                if next_end == cursor_end or stagnant > 20:
                    break
                cursor_end = next_end
                time.sleep(0.2)
                continue

            stagnant = 0
            id_batch = [db.make_id(str(r.get("id") or "")) for r in fresh_rows if r.get("id")]
            # 强制按库去重：已入库不拉详情、不写库
            existed_set = db.existing_ids(id_batch)
            to_fetch = [
                r
                for r in fresh_rows
                if db.make_id(str(r.get("id") or "")) not in existed_set
            ]
            batch_skip = len(fresh_rows) - len(to_fetch)
            if batch_skip:
                skipped += batch_skip
                count += batch_skip
                progress = min(99, int(count / max(target, 1) * 100))
                emit(
                    "抓取中",
                    progress,
                    f"已处理 {count}/{target}（新增 {new_count}，跳过重复 {skipped}）· 游标 {cursor_end[:19]}",
                )

            for row in to_fetch:
                if stopped():
                    raise CrawlStopped("用户停止抓取")
                if count >= limit:
                    break
                mapped = _map_list_row(row)
                raw_id = mapped["raw_id"]
                if not raw_id:
                    continue
                if mapped["id"] in db.existing_ids([mapped["id"]]):
                    skipped += 1
                    count += 1
                    continue
                if opts.get("fetch_detail"):
                    try:
                        mapped = fetch_detail(sess, raw_id)
                        time.sleep(0.15)
                    except Exception as exc:  # noqa: BLE001
                        mapped["description"] = f"详情拉取失败：{exc}"
                db.upsert_many(
                    [mapped],
                    keyword=opts.get("keyword") or "",
                    search_mode=opts.get("mode") or "",
                )
                count += 1
                new_count += 1
                latest = {
                    "id": mapped["id"],
                    "title": mapped["title"],
                    "url": mapped["url"],
                    "notice_time": mapped["notice_time"],
                    "notice_name": mapped["notice_name"],
                    "region": mapped["region"],
                    "snippet": (mapped.get("content_text") or "")[:160],
                    "attch_count": len(mapped.get("attchs") or []),
                }
                recent.insert(0, latest)
                recent = recent[:12]
                progress = min(99, int(count / max(target, 1) * 100))
                emit(
                    "抓取中",
                    progress,
                    f"已入库 {count}/{target}（新增 {new_count}，跳过重复 {skipped}）· 游标 {cursor_end[:19]}",
                )

            oldest = min(
                (str(r.get("noticeTime") or r.get("publishTime") or "9999") for r in rows),
                default="",
            )
            if not oldest or oldest == "9999":
                break
            if start_bound and oldest < start_bound:
                break
            # 下一窗：包含边界时间，靠 seen_ids 去重；若卡住再减 1 秒
            cursor_end = oldest
            time.sleep(0.15)

        final = {
            "running": False,
            "ok": True,
            "phase": "完成",
            "progress": 100,
            "message": f"抓取完成：处理 {count} 条，新增 {new_count} 条，跳过重复 {skipped} 条",
            "count": count,
            "new_count": new_count,
            "skipped": skipped,
            "current_page": pages_done,
            "latest": latest,
            "recent": recent[:12],
            "options": opts,
            "db_total": db.count_all(),
            "site": "jiangxi",
        }
        _write_status(final)
        if on_progress:
            on_progress(final)
        return final
    except CrawlStopped as exc:
        final = {
            "running": False,
            "ok": True,
            "phase": "已停止",
            "progress": min(99, int(count / max(1, target) * 100)),
            "message": str(exc),
            "count": count,
            "new_count": new_count,
            "skipped": skipped,
            "latest": latest,
            "recent": recent[:12],
            "options": opts,
            "db_total": db.count_all(),
            "site": "jiangxi",
        }
        _write_status(final)
        if on_progress:
            on_progress(final)
        return final
    except Exception as exc:  # noqa: BLE001
        final = {
            "running": False,
            "ok": False,
            "phase": "失败",
            "progress": 0,
            "message": f"抓取失败：{exc}",
            "count": count,
            "new_count": new_count,
            "skipped": skipped,
            "latest": latest,
            "recent": recent[:12],
            "options": opts,
            "db_total": db.count_all(),
            "site": "jiangxi",
        }
        _write_status(final)
        if on_progress:
            on_progress(final)
        raise CrawlError(str(exc)) from exc
    finally:
        with _lock:
            _running = False
        clear_stop()


def lookback_options(days: int = 3) -> dict[str, Any]:
    days = max(1, min(365, int(days or 3)))
    end = date.today()
    start = end - timedelta(days=days - 1)
    return normalize_options(
        {
            "pages": 0,
            "limit": 0,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "keyword": "",
            "mode": "title",
        }
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="江西省政府采购网爬虫")
    parser.add_argument("--daily", action="store_true", help="按回看天数增量抓取（条数不设上限）")
    parser.add_argument("--lookback", type=int, default=3, help="回看天数（配合 --daily）")
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--limit", type=int, default=0, help="条数上限，0 表示不限")
    parser.add_argument("--keyword", default="")
    parser.add_argument("--start", default="")
    parser.add_argument("--end", default="")
    parser.add_argument("--no-skip-existing", action="store_true")
    args = parser.parse_args()
    db.ensure_schema()
    if args.daily:
        opts = lookback_options(args.lookback)
        # 定时增量：页数/条数均不设上限，按官网总量抓取并跳过已入库
        opts["pages"] = 0
        opts["limit"] = 0 if args.limit <= 0 else max(0, int(args.limit))
        opts["skip_existing"] = not args.no_skip_existing
    else:
        opts = {
            "pages": args.pages,
            "limit": args.limit,
            "keyword": args.keyword,
            "start": args.start,
            "end": args.end,
            "skip_existing": not args.no_skip_existing,
        }
    result = run_crawl(
        opts,
        on_progress=lambda p: print(p.get("message"), p.get("progress")),
    )
    print(
        json.dumps(
            {k: result[k] for k in ("message", "count", "new_count", "skipped", "db_total")},
            ensure_ascii=False,
        )
    )
