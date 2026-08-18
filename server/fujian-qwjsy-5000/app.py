#!/usr/bin/env python3
"""福建公告爬虫前端：政府采购网 + 省科技厅 + 省工信厅 + 军队采购网 + 国铁采购网。"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
from pathlib import Path

from bs4 import BeautifulSoup
from flask import Flask, abort, jsonify, render_template, request
from markupsafe import Markup

from fujian_qwjsy_crawler import PAGE_URL as ZFCG_PAGE_URL
from fujian_qwjsy_crawler import AccessBlocked as ZfcgBlocked
from fujian_qwjsy_crawler import FujianQwjsyCrawler
from kjt_xxgk_crawler import PAGE_URL as KJT_PAGE_URL
from kjt_xxgk_crawler import AccessBlocked as KjtBlocked
from kjt_xxgk_crawler import KjtXxgkCrawler
from gxt_zcfg_crawler import PAGE_URL as GXT_PAGE_URL
from gxt_zcfg_crawler import AccessBlocked as GxtBlocked
from gxt_zcfg_crawler import (
    GxtZcfgCrawler,
    LIST_CHANNELS as GXT_LIST_CHANNELS,
    clean_content_html,
    clean_publisher,
    notice_id_from_url as gxt_notice_id_from_url,
)
from cnnc_web_db import CATEGORIES as CNNC_CATEGORIES
from cnnc_web_db import count_cnnc, ensure_cnnc_schema, fetch_cnnc, fetch_cnnc_page
from cnnc_crawler import CATEGORIES as CNNC_CRAWL_CATEGORIES
from cnnc_crawler import fetch_listing as fetch_cnnc_listing
from cnnc_crawler import make_row as make_cnnc_row
from cnnc_crawler import parse_listing as parse_cnnc_listing
from cnnc_crawler import upsert_many as upsert_cnnc
from db import ensure_schema, existing_ids, fetch_notice, fetch_page, load_env, upsert_notices
from gxt_db import ensure_gxt_schema, existing_gxt_ids, fetch_gxt, fetch_gxt_page, upsert_gxt
from plap_crawler import PAGE_URL as PLAP_PAGE_URL
from plap_crawler import AccessBlocked as PlapBlocked
from plap_crawler import CrawlCancelled
from plap_crawler import PLAP_IDLE_STOP_PAGES
from plap_crawler import PLAP_MAX_LIST_PAGE
from plap_crawler import PlapCrawler, clean_plap_content_html, notice_id_from_row as plap_notice_id_from_row
from plap_db import ensure_plap_schema, existing_plap_ids, fetch_plap, fetch_plap_page, upsert_plap
from china_railway_db import ensure_schema as ensure_railway_schema, fetch_one as fetch_railway, fetch_page as fetch_railway_page
from china_railway_crawler import (
    BASE_URL as RAILWAY_PAGE_URL,
    ChallengeRequired as RailwayChallenge,
    CrawlStopped as RailwayStopped,
    CrawlError as RailwayError,
    normalize_options as railway_normalize_options,
    preview_count as railway_preview_count,
    request_stop as railway_request_stop,
    run_crawl as railway_run_crawl,
    three_month_start as railway_three_month_start,
)
import schedule_util

load_env()
try:
    ensure_schema()
    ensure_gxt_schema()
    ensure_plap_schema()
    ensure_railway_schema()
    ensure_cnnc_schema()
except Exception:  # noqa: BLE001
    pass

APP_PREFIX = (os.environ.get("APP_PREFIX") or "").rstrip("/")
PAGE_URL = ZFCG_PAGE_URL  # 模板默认外链


class _PrefixMiddleware:
    def __init__(self, app, prefix: str) -> None:
        self.app = app
        self.prefix = prefix

    def __call__(self, environ, start_response):
        environ["SCRIPT_NAME"] = self.prefix
        return self.app(environ, start_response)


app = Flask(__name__)
if APP_PREFIX:
    app.wsgi_app = _PrefixMiddleware(app.wsgi_app, APP_PREFIX)
BASE_DIR = Path(__file__).resolve().parent
PER_PAGE = 20

# Web ??????????????????????????????
MAX_WEB_PAGES = 200
DEFAULT_ZFCG_LIMIT = 0  # 0=?????????????
MAX_ZFCG_LIMIT = 100000
DEFAULT_KJT_LIMIT = 0  # 0=?????????????
DEFAULT_GXT_LIMIT = 0
DEFAULT_PLAP_LIMIT = 0
API_TOKEN = (os.environ.get("CRAWL_API_TOKEN") or "").strip()
# Web-triggered crawls use the same bounded concurrency as the 24h scripts.
WEB_ZFCG_WORKERS = max(1, min(3, int(os.environ.get("ZFCG_WORKERS", "3"))))
WEB_KJT_WORKERS = max(1, min(2, int(os.environ.get("KJT_WORKERS", "2"))))
WEB_GXT_WORKERS = max(1, min(2, int(os.environ.get("GXT_WORKERS", "2"))))


def _site_label(site: str) -> str:
    return {
        "cnnc": "CNNC",
        "gxt": "省工信厅",
        "kjt": "科技厅",
        "plap": "军队采购网",
        "railway": "国铁采购网",
        "zfcg": "政府采购网",
    }.get(site, "政府采购网")


def _safe_int(value: object, default: int, *, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _api_token_ok() -> bool:
    """??? Web API ????? CRAWL_API_TOKEN ??? X-Crawl-Token?"""
    return not API_TOKEN or request.headers.get("X-Crawl-Token", "") == API_TOKEN


def _sanitize_html(raw_html: object) -> str:
    """???????????????????? URL?"""
    html = str(raw_html or "")
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(["script", "style", "iframe", "object", "embed", "form", "meta", "link"]):
        tag.decompose()
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            name = attr.lower()
            if name.startswith("on") or name in {"srcdoc", "formaction"}:
                del tag.attrs[attr]
        for attr in ("href", "src", "action", "formaction"):
            value = tag.get(attr)
            if isinstance(value, str) and re.match(r"^\s*(?:javascript|data|vbscript):", value, re.I):
                del tag.attrs[attr]
    return str(soup)


def _output_path(site: str, mode: str) -> Path:
    stamp = time.strftime("%Y%m%d_%H%M%S")
    return BASE_DIR / "output" / f"{site}_{mode}_{stamp}.json"


def _write_json_atomic(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, path)

_lock = threading.Lock()
_status: dict[str, object] = {
    "running": False,
    "ok": True,
    "message": "就绪",
    "phase": "",
    "progress": 0,
    "output_file": "",
    "total": 0,
    "site": "zfcg",
    "count": 0,
    "latest": None,
    "recent": [],
    "db_saved": 0,
    "db_failed": 0,
    "db_error": "",
}
_results: list[dict] = []
_full: dict[str, dict] = {}
_cancel = threading.Event()


@app.context_processor
def inject_globals():
    return {
        "page_url": ZFCG_PAGE_URL,
        "kjt_page_url": KJT_PAGE_URL,
        "gxt_page_url": GXT_PAGE_URL,
        "plap_page_url": PLAP_PAGE_URL,
        "railway_page_url": RAILWAY_PAGE_URL,
        "app_prefix": APP_PREFIX,
    }


def _ui_row(item: dict) -> dict:
    return {
        "id": item.get("id"),
        "source": item.get("source") or (
            "plap" if str(item.get("id") or "").startswith("plap_")
            else "gxt" if str(item.get("id") or "").startswith("gxt_")
            else "railway" if str(item.get("id") or "").startswith("cr_")
            else "kjt" if str(item.get("id") or "").startswith("kjt_")
            else "zfcg"
        ),
        "title": item.get("title"),
        "notice_time": item.get("notice_time") or item.get("publish_time"),
        "region": item.get("region"),
        "notice_name": item.get("notice_name") or item.get("notice_type"),
        "url": item.get("url"),
        "project_no": item.get("project_no"),
        "purchaser": item.get("purchaser"),
        "agency": item.get("agency"),
        "budget": item.get("budget"),
        "successful_money": item.get("successful_money"),
        "content_text": (item.get("content_text") or item.get("description") or "")[:300],
        "has_content": bool(item.get("content_html") or item.get("content_text")),
    }


def _find_full_notice(notice_id: str) -> dict | None:
    with _lock:
        mem = _full.get(notice_id)
        if mem:
            return dict(mem)
    try:
        if notice_id.startswith("gxt_"):
            row = fetch_gxt(notice_id)
        elif notice_id.startswith("plap_"):
            row = fetch_plap(notice_id)
        elif notice_id.startswith("cr_"):
            row = fetch_railway(notice_id)
            if row:
                row = {**row, "notice_time": row.get("publish_time"), "source": "railway"}
        else:
            row = fetch_notice(notice_id)
            if not row:
                row = fetch_cnnc(notice_id)
        if row:
            return row
    except Exception:  # noqa: BLE001
        pass
    return None


@app.route("/")
def index():
    return render_template(
        "index.html",
        page_url=ZFCG_PAGE_URL,
        kjt_page_url=KJT_PAGE_URL,
        gxt_page_url=GXT_PAGE_URL,
        plap_page_url=PLAP_PAGE_URL,
        railway_page_url=RAILWAY_PAGE_URL,
        per_page=PER_PAGE,
    )


def _enrich_railway_notice(notice: dict) -> dict:
    """Lazy-load full body from indexView when only a truncated list digest is stored."""
    html = str(notice.get("content_html") or "")
    text_body = str(notice.get("content_text") or "")
    if len(html) >= 400 or len(text_body) >= 400:
        return notice
    notice_id = str(notice.get("id") or "")
    source_id = ""
    for prefix in ("cr_notice_", "cr_result_"):
        if notice_id.startswith(prefix):
            source_id = notice_id[len(prefix):]
            break
    if not source_id:
        url = str(notice.get("url") or "")
        if "id=" in url:
            source_id = url.split("id=", 1)[1].split("&", 1)[0]
    if not source_id:
        return notice
    try:
        from china_railway_crawler import Client, _clean_text, _project_no
        from china_railway_db import upsert_many

        detail = Client(interval=1.2).detail(source_id)
        full_html = str(detail.get("detail_html") or detail.get("notCont") or "").strip()
        if len(full_html) <= len(html):
            return notice
        full_text = _clean_text(full_html)
        project_no = (
            str(detail.get("biddingProjCode") or detail.get("projCode") or detail.get("inforCode") or "").strip()
            or _project_no(full_text)
            or str(notice.get("project_no") or "")
        )
        updated = {
            **notice,
            "content_html": full_html,
            "content_text": full_text,
            "description": full_text,
            "project_no": project_no[:128],
            "notice_time": notice.get("notice_time") or notice.get("publish_time"),
            "source": "railway",
        }
        try:
            row = dict(updated)
            row["publish_time"] = str(row.get("publish_time") or row.get("notice_time") or "")[:19]
            row["category"] = "result" if notice_id.startswith("cr_result_") else "notice"
            row["attchs"] = row.get("attchs") if isinstance(row.get("attchs"), list) else []
            upsert_many([row])
        except Exception:
            pass
        return updated
    except Exception:
        return notice


@app.route("/notice/<notice_id>")
def notice_detail(notice_id: str):
    notice = _find_full_notice(notice_id)
    if not notice:
        abort(404)
    if notice_id.startswith("gxt_"):
        notice = {
            **notice,
            "publisher": clean_publisher(str(notice.get("publisher") or "")),
            "purchaser": clean_publisher(str(notice.get("purchaser") or notice.get("publisher") or "")),
        }
        raw_html = clean_content_html(str(notice.get("content_html") or ""), str(notice.get("url") or ""))
    elif notice_id.startswith("plap_"):
        raw_html = clean_plap_content_html(str(notice.get("content_html") or ""))
    elif notice_id.startswith("cr_"):
        notice = _enrich_railway_notice(notice)
        raw_html = str(notice.get("content_html") or "")
    else:
        raw_html = str(notice.get("content_html") or "")
    html = _sanitize_html(raw_html)
    view = {**notice, "content_html": Markup(html) if html else ""}
    return render_template("detail.html", notice=view, page_url=ZFCG_PAGE_URL)



@app.route("/api/schedule", methods=["GET", "POST"])
def api_schedule():
    if request.method == "GET":
        return jsonify({"ok": True, "schedule": schedule_util.public_view()})
    if not _api_token_ok():
        return jsonify({"ok": False, "message": "未授权"}), 401
    payload = request.get_json(silent=True) or {}
    try:
        cfg = schedule_util.save(
            {
                "hour": payload.get("hour"),
                "minute": payload.get("minute"),
                "times": payload.get("times"),
                "source_times": payload.get("source_times"),
                "enabled": payload.get("enabled", True),
                "lookback_days": payload.get("lookback_days"),
            }
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "message": f"保存失败：{exc}"}), 500
    return jsonify({"ok": True, "message": "定时已更新", "schedule": schedule_util.public_view(cfg)})


@app.route("/api/crawl/status")
def api_status():
    return jsonify(_status)


def _read_memory_stats() -> dict[str, object]:
    """Read Linux's reclaimable-aware available memory from /proc."""
    values: dict[str, int] = {}
    for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
        name, _, raw_value = line.partition(":")
        parts = raw_value.strip().split()
        if not parts:
            continue
        try:
            value = int(parts[0])
        except ValueError:
            continue
        values[name] = value * (1024 if len(parts) > 1 and parts[1].lower() == "kb" else 1)
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", values.get("MemFree", 0))
    if not total:
        raise RuntimeError("系统内存指标不可用")
    available = max(0, min(total, available))
    used = total - available
    return {
        "total": total,
        "used": used,
        "available": available,
        "available_percent": round(available * 100 / total, 1),
        "updated_at": int(time.time()),
    }


@app.route("/api/server/memory")
def api_server_memory():
    try:
        return jsonify({"ok": True, "memory": _read_memory_stats()})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "message": f"读取服务器内存失败：{exc}"}), 500


def _read_disk_stats() -> dict[str, object]:
    """Read usage for the server's root filesystem."""
    usage = shutil.disk_usage("/")
    total = int(usage.total)
    used = int(usage.used)
    available = int(usage.free)
    return {
        "path": "/",
        "total": total,
        "used": used,
        "available": available,
        "usage_percent": round(used * 100 / total, 1) if total else 0,
        "updated_at": int(time.time()),
    }


@app.route("/api/server/disk")
def api_server_disk():
    try:
        return jsonify({"ok": True, "disk": _read_disk_stats()})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "message": f"读取服务器硬盘失败：{exc}"}), 500


@app.route("/api/crawl/stop", methods=["POST"])
def api_crawl_stop():
    if not _status.get("running"):
        return jsonify({"ok": False, "message": "当前没有运行中的任务"}), 409
    _cancel.set()
    return jsonify({"ok": True, "message": "正在停止任务…"})


@app.route("/api/results")
def api_results():
    page = max(1, request.args.get("page", 1, type=int))
    per_page = min(100, max(1, request.args.get("per_page", PER_PAGE, type=int)))
    source = str(request.args.get("source") or "").strip()
    with _lock:
        session_items = list(_results)
        running = bool(_status.get("running"))
        out_file = str(_status.get("output_file") or "")
        site = str(_status.get("site") or "")
    if session_items and running:
        if source and site and source != site:
            pass
        else:
            # 抓取进行中：用内存会话实时展示（最新在前）
            view = list(reversed(session_items))
            total = len(view)
            pages = max(1, (total + per_page - 1) // per_page) if total else 0
            if pages and page > pages:
                page = pages
            start = (page - 1) * per_page
            return jsonify(
                {
                    "ok": True,
                    "page": page,
                    "per_page": per_page,
                    "pages": pages,
                    "total": total,
                    "output_file": out_file or "session",
                    "source": site or source,
                    "items": view[start : start + per_page],
                }
            )
    try:
        if source == "gxt":
            total, slice_ = fetch_gxt_page(page, per_page)
        elif source == "cnnc":
            total, slice_ = fetch_cnnc_page(page, per_page)
        elif source == "plap":
            total, slice_ = fetch_plap_page(page, per_page)
        elif source == "railway":
            total, slice_ = fetch_railway_page(page, per_page)
            slice_ = [
                {
                    **row,
                    "source": "railway",
                    "notice_time": row.get("publish_time") or row.get("notice_time"),
                    "has_content": bool(row.get("content_text")),
                }
                for row in slice_
            ]
        else:
            total, slice_ = fetch_page(page, per_page, source=source)
        pages = max(1, (total + per_page - 1) // per_page) if total else 0
        return jsonify(
            {
                "ok": True,
                "page": page,
                "per_page": per_page,
                "pages": pages,
                "total": total,
                "output_file": (
                    "mysql:biaoxun.gxt_zcfg"
                    if source == "gxt"
                    else "mysql:biaoxun.cnnc_notices"
                    if source == "cnnc"
                    else "mysql:biaoxun.plap"
                    if source == "plap"
                    else "mysql:biaoxun.china_railway"
                    if source == "railway"
                    else f"mysql:biaoxun.notices" + (f"?source={source}" if source else "")
                ),
                "source": source,
                "items": [_ui_row(x) for x in slice_],
            }
        )
    except Exception:  # noqa: BLE001
        total = len(session_items)
        pages = max(1, (total + per_page - 1) // per_page) if total else 0
        if pages and page > pages:
            page = pages
        start = (page - 1) * per_page
        return jsonify(
            {
                "ok": True,
                "page": page,
                "per_page": per_page,
                "pages": pages,
                "total": total,
                "output_file": out_file,
                "items": session_items[start : start + per_page],
            }
        )


def _parse_crawl_payload(payload: dict) -> dict:
    site = str(payload.get("site") or "zfcg").strip()
    if site not in ("zfcg", "kjt", "gxt", "plap", "railway", "cnnc"):
        site = "zfcg"
    keyword = str(payload.get("keyword") or "").strip()
    mode = str(payload.get("mode") or "content").strip()
    if mode not in ("content", "title"):
        mode = "content"
    default_limit = (
        DEFAULT_PLAP_LIMIT if site == "plap"
        else DEFAULT_GXT_LIMIT if site == "gxt"
        else DEFAULT_KJT_LIMIT if site == "kjt"
        else DEFAULT_ZFCG_LIMIT
    )
    max_limit = MAX_ZFCG_LIMIT
    # 0 ????????????????/???????????? `or 1` ???? 1?
    raw_pages = payload.get("pages", 0)
    raw_limit = payload.get("limit", default_limit)
    pages = _safe_int(raw_pages, 0, minimum=0, maximum=MAX_WEB_PAGES)
    limit = _safe_int(raw_limit, default_limit, minimum=0, maximum=max_limit)
    return {
        "site": site,
        "keyword": keyword,
        "mode": mode,
        "pages": pages,
        "region": str(payload.get("region") or "").strip(),
        "start": str(payload.get("start") or "").strip(),
        "end": str(payload.get("end") or "").strip(),
        "limit": limit,
        "start_page": _safe_int(payload.get("start_page", 1), 1, minimum=1, maximum=500000),
        "label": f"「{keyword}」" if keyword else "全部",
    }


def _preview_count(opts: dict) -> dict:
    """只查列表总数，不拉详情。"""
    site = opts["site"]
    if site == "cnnc":
        known = count_cnnc()
        estimate = min(opts["limit"], 100) if opts["limit"] > 0 else 100
        return {
            "ok": True,
            "site": site,
            "total": 100,
            "known": known,
            "estimate": estimate,
            "pages": 1,
            "message": f"CNNC: five public lists, one page each, up to {estimate} records.",
        }
    if site == "railway":
        start = (opts.get("start") or "")[:10]
        end = (opts.get("end") or "")[:10]
        today = __import__("datetime").date.today()
        if not start:
            start = railway_three_month_start(today).isoformat()
        if not end:
            end = today.isoformat()
        remote = railway_preview_count(
            {
                "site": "both",
                "keyword": opts.get("keyword") or "",
                "mode": opts.get("mode") or "content",
                "pages": opts.get("pages") or 0,
                "limit": opts.get("limit") or 0,
                "start": start,
                "end": end,
            }
        )
        estimate = int(remote.get("estimate") or 0)
        totals = remote.get("totals") or {}
        source_text = "，".join(f"{k} {v} 条" for k, v in totals.items())
        return {
            "ok": True,
            "estimate": estimate,
            "site": site,
            "pages": opts.get("pages") or 0,
            "message": (
                f"国铁采购网 · {start} 至 {end} · {source_text or '暂无'} · "
                f"本次最多处理约 {estimate} 条（低频断点续跑，遇频控自动重置）。"
            ),
        }
    if site == "plap":
        plap_pages = max(0, min(MAX_WEB_PAGES, opts["pages"]))
        plap_cap = opts["limit"]
        try:
            known_set = existing_plap_ids()
        except Exception:  # noqa: BLE001
            known_set = set()
        crawler = PlapCrawler(delay_lo=1.0, delay_hi=1.5, page_size=20)
        total, rows = crawler.fetch_list_page(1, keyword=opts["keyword"])
        page_new = sum(
            1 for row in rows if plap_notice_id_from_row(row) and plap_notice_id_from_row(row) not in known_set
        )
        if plap_cap > 0:
            estimate = plap_cap
        elif plap_pages > 0:
            scan_pages = min(plap_pages, PLAP_MAX_LIST_PAGE)
            estimate = min(page_new * scan_pages, scan_pages * 20)
        else:
            estimate = max(0, total - len(known_set))
        if plap_pages > 0:
            page_desc = f"{plap_pages} 页（增量，连续 {PLAP_IDLE_STOP_PAGES} 页无新数据则提前结束）"
            mode_desc = "增量扫描"
        else:
            page_desc = "全量补抓（按公告类型分片，绕过单通道 500 页限制）"
            mode_desc = "全量补抓"
        # API total 含采购大厅外类型（如 00802 知情告知）；此处仅统计采购大厅。
        api_note = (
            f"采购大厅接口索引约 {total} 条（含非大厅类型时偏多，与官网前台约 3 万条口径不同）"
            if not opts["keyword"]
            else f"关键词「{opts['keyword']}」接口索引约 {total} 条"
        )
        return {
            "ok": True,
            "site": site,
            "total": total,
            "estimate": estimate,
            "known": len(known_set),
            "pages": plap_pages,
            "message": (
                f"军队采购网 {api_note}；库中已有 {len(known_set)} 条。"
                f"本次{mode_desc}：{page_desc}，预计还可新抓约 {estimate} 条详情"
                f"（按 ID 去重跳过已入库，上限 {plap_cap or '不限'}）。"
            ),
        }
    if site == "gxt":
        gxt_pages = max(0, min(MAX_WEB_PAGES, opts["pages"]))
        gxt_cap = opts["limit"]
        try:
            known_set = existing_gxt_ids()
        except Exception:  # noqa: BLE001
            known_set = set()
        crawler = GxtZcfgCrawler(delay_lo=1.0, delay_hi=1.5, workers=WEB_GXT_WORKERS)
        total = 0
        page_new = 0
        parts: list[str] = []
        for ch in GXT_LIST_CHANNELS:
            ch_total, rows = crawler.fetch_list_page(
                1,
                searchword=opts["keyword"],
                classsql=f"chnlid={ch['chnlid']}",
                referer=ch["referer"],
            )
            total += ch_total
            ch_new = 0
            for row in rows:
                url = str(row.get("chnldocurl") or row.get("docpuburl") or "")
                nid = gxt_notice_id_from_url(url) or (f"gxt_{row['docid2']}" if row.get("docid2") else "")
                if nid and nid not in known_set:
                    ch_new += 1
            page_new += ch_new
            parts.append(f"{ch['name']}约 {ch_total} 条")
        estimate = gxt_cap if gxt_cap > 0 else (page_new if opts["pages"] > 0 else total)
        return {
            "ok": True,
            "site": site,
            "total": total,
            "estimate": estimate,
            "known": len(known_set),
            "pages": gxt_pages,
            "message": (
                f"省工信厅政策法规（{len(GXT_LIST_CHANNELS)} 个栏目）：{'，'.join(parts)}；"
                f"库中已有 {len(known_set)} 条。"
                f"本次每栏目扫 {gxt_pages or '全部'} 页，预计新抓约 {estimate} 条详情（增量，上限 {gxt_cap or '不限'}）。"
            ),
        }
    if site == "kjt":
        from kjt_xxgk_crawler import LIST_CHANNELS, notice_id_from_url

        # pages=0 means scan all list pages until the end.
        kjt_pages = max(0, min(MAX_WEB_PAGES, opts["pages"]))
        kjt_cap = opts["limit"]
        try:
            known_set = existing_ids(source="kjt")
        except Exception:  # noqa: BLE001
            known_set = set()
        crawler = KjtXxgkCrawler(delay_lo=1.0, delay_hi=1.5, workers=WEB_KJT_WORKERS)
        total = 0
        page_new = 0
        parts: list[str] = []
        for ch in LIST_CHANNELS:
            ch_total, rows = crawler.fetch_list_page(
                1,
                searchword=opts["keyword"],
                classsql=f"chnlid={ch['chnlid']}",
            )
            total += ch_total
            ch_new = 0
            for row in rows:
                url = str(row.get("chnldocurl") or row.get("docpuburl") or "")
                nid = notice_id_from_url(url) or (
                    f"kjt_{row['docid2']}" if row.get("docid2") else ""
                )
                if nid and nid not in known_set:
                    ch_new += 1
            page_new += ch_new
            parts.append(f"{ch['name']}约 {ch_total} 条")
        estimate = kjt_cap if kjt_cap > 0 else (page_new if opts["pages"] > 0 else total)
        return {
            "ok": True,
            "site": site,
            "total": total,
            "estimate": estimate,
            "known": len(known_set),
            "pages": kjt_pages,
            "message": (
                f"科技厅（通知公告+政策文件）：{'，'.join(parts)}；"
                f"库中已有 {len(known_set)} 条。"
                f"本次每栏目扫 {kjt_pages} 页，预计新抓约 {estimate} 条详情（增量，上限 {kjt_cap}）。"
            ),
        }

    total, rows = FujianQwjsyCrawler(delay=2.0, daily_cap=0, workers=WEB_ZFCG_WORKERS).search_page(
        opts["keyword"],
        mode=opts["mode"],
        page=1,
        region_code=opts["region"],
        start_time=opts["start"],
        end_time=opts["end"],
    )
    try:
        known_set = existing_ids(source="zfcg")
    except Exception:  # noqa: BLE001
        known_set = set()
    page_size = 20
    page_new = sum(1 for r in rows if str(r.get("id") or "") not in known_set)
    # pages=0 means scan all list pages; limit=0 means no detail limit.
    scan_scope = total if opts["pages"] == 0 else min(total, opts["pages"] * page_size)
    estimate = scan_scope if opts["limit"] == 0 else min(scan_scope, opts["limit"])
    page_desc = "\u81ea\u52a8\u626b\u63cf\u5168\u90e8\u5217\u8868\u9875" if opts["pages"] == 0 else f"\u626b\u63cf\u524d {opts['pages']} \u9875"
    limit_desc = "\u4e0d\u8bbe\u8be6\u60c5\u4e0a\u9650" if opts["limit"] == 0 else f"\u6700\u591a\u6293 {opts['limit']} \u6761\u65b0\u8be6\u60c5"
    return {
        "ok": True,
        "site": site,
        "total": total,
        "estimate": estimate,
        "known": len(known_set),
        "pages": opts["pages"],
        "message": (
            f"政府采购网检索约 {total} 条，库中已有 {len(known_set)} 条。"
            f"\u5c06\u8df3\u8fc7\u5df2\u5165\u5e93\u8bb0\u5f55\uff0c{limit_desc}\uff0c{page_desc}"
            f"\uff08\u9884\u8ba1\u8303\u56f4\u7ea6 {estimate} \u6761\uff1b\u9996\u5c4f {page_new}/{len(rows) or 0} \u6761\u4e3a\u65b0\uff0c\u5176\u4f59\u8fb9\u6293\u8fb9\u8df3\u8fc7\uff09\u3002"
        ),
    }


@app.route("/api/crawl/preview", methods=["POST"])
def api_crawl_preview():
    if _status.get("running"):
        return jsonify({"ok": False, "message": "任务正在运行"}), 409
    opts = _parse_crawl_payload(request.get_json(silent=True) or {})
    try:
        return jsonify(_preview_count(opts))
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "message": f"预览失败：{exc}"}), 500


@app.route("/api/crawl", methods=["POST"])
def api_crawl():
    global _status, _results
    if _status.get("running"):
        return jsonify({"ok": False, "message": "任务正在运行"}), 409

    payload = request.get_json(silent=True) or {}
    if not payload.get("confirm"):
        return jsonify({"ok": False, "message": "请先预览并确认后再抓取"}), 400

    opts = _parse_crawl_payload(payload)
    site = opts["site"]
    keyword = opts["keyword"]
    mode = opts["mode"]
    pages = opts["pages"]
    region = opts["region"]
    start = opts["start"]
    end = opts["end"]
    limit = opts["limit"]
    start_page = int(opts.get("start_page") or 1)
    label = opts["label"]

    with _lock:
        _results = []
        _full.clear()
        _cancel.clear()
        _status = {
            "running": True,
            "ok": True,
            "message": f"{_site_label(site)}：抓取{label}",
            "phase": "准备中",
            "progress": 0,
            "output_file": "",
            "total": 0,
            "site": site,
            "count": 0,
            "latest": None,
            "recent": [],
            "db_saved": 0,
            "db_failed": 0,
            "db_error": "",
        }

    def task() -> None:
        global _status, _results
        db_saved = 0
        db_failed = 0
        db_last_error = ""

        def on_page(page: int, max_pages: int, count: int, total: int, partition: str = "") -> None:
            with _lock:
                part = f"{partition} · " if partition else ""
                _status.update(
                    {
                        "phase": (
                            f"{part}第 {page} 页（自动扫描，含详情）"
                            if max_pages <= 0
                            else f"{part}第 {page}/{max_pages} 页（含详情）"
                        ),
                        "progress": (
                            min(99, int(page * 20 / max(total, 1) * 100))
                            if max_pages <= 0
                            else min(99, int(page / max(max_pages, 1) * 100))
                        ),
                        "message": f"已抓 {count} 条完整公告，已实时入库 {db_saved} 条 / 约 {total} 条",
                        "total": total,
                        "db_saved": db_saved,
                        "db_failed": db_failed,
                        "db_error": db_last_error,
                    }
                )

        def on_partition(_code: str, name: str, idx: int, total_parts: int) -> None:
            with _lock:
                _status.update(
                    {
                        "phase": f"分片 {idx}/{total_parts}：{name}",
                        "message": f"正在扫描「{name}」…",
                    }
                )

        def on_discover(step: int, total: int, types_found: int, stage: str) -> None:
            with _lock:
                if stage == "sample":
                    _status.update(
                        {
                            "phase": f"分析公告类型 · 采样第 {step}/{total} 页（已识别 {types_found} 种）",
                            "progress": min(8, int(step / max(total, 1) * 8)),
                            "message": "全量补抓前先分析公告类型，通常需 1～3 分钟…",
                        }
                    )
                else:
                    _status.update(
                        {
                            "phase": f"统计各类公告数量 · {step}/{total}（共 {types_found} 种）",
                            "progress": min(10, 8 + int(step / max(total, 1) * 2)),
                            "message": "即将开始分片抓取…",
                        }
                    )

        def on_item(item: dict) -> None:
            nonlocal db_saved, db_failed, db_last_error
            item.setdefault(
                "source",
                "plap" if site == "plap"
                else "gxt" if site == "gxt"
                else "kjt" if site == "kjt"
                else "cnnc" if site == "cnnc"
                else "zfcg",
            )
            row = _ui_row(item)
            with _lock:
                nid = str(item.get("id") or "")
                if nid:
                    _full[nid] = item
                _results.append(row)
                latest = {
                    "id": row.get("id"),
                    "title": row.get("title") or "(\u65e0\u6807\u9898)",
                    "notice_time": row.get("notice_time") or "",
                    "notice_name": row.get("notice_name") or "",
                    "region": row.get("region") or "",
                    "url": row.get("url") or "",
                    "snippet": (row.get("content_text") or "")[:120],
                }
                recent = list(_status.get("recent") or [])
                recent.insert(0, latest)
                _status.update(
                    {
                        "count": len(_results),
                        "latest": latest,
                        "recent": recent[:12],
                        "message": f"\u5df2\u6293 {len(_results)} \u6761\uff0c\u6b63\u5728\u5b9e\u65f6\u5165\u5e93 \u00b7 {str(latest['title'])[:42]}",
                    }
                )

            # Persist each completed detail immediately so long jobs survive interruption.
            saved = 0
            db_exc: Exception | None = None
            for db_attempt in range(1, 4):
                try:
                    if site == "gxt":
                        saved = upsert_gxt([item], keyword=keyword)
                    elif site == "plap":
                        saved = upsert_plap([item], keyword=keyword)
                    elif site == "cnnc":
                        saved = upsert_cnnc([item])
                    else:
                        saved = upsert_notices(
                            [item],
                            keyword=keyword,
                            search_mode="kjt" if site == "kjt" else mode,
                        )
                    db_exc = None
                    break
                except Exception as exc:  # noqa: BLE001
                    db_exc = exc
                    if db_attempt < 3:
                        time.sleep(0.5 * db_attempt)
            if db_exc is None:
                with _lock:
                    db_saved += saved
                    _status.update(
                        {
                            "db_saved": db_saved,
                            "db_failed": db_failed,
                            "db_error": db_last_error,
                            "message": f"\u5df2\u6293 {len(_results)} \u6761\uff0c\u5df2\u5b9e\u65f6\u5165\u5e93 {db_saved} \u6761",
                        }
                    )
            else:
                with _lock:
                    db_failed += 1
                    db_last_error = str(db_exc)[:300]
                    failed_path = BASE_DIR / "output" / "db_failed_items.jsonl"
                    failed_path.parent.mkdir(parents=True, exist_ok=True)
                    with failed_path.open("a", encoding="utf-8") as fh:
                        fh.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")
                    _status.update(
                        {
                            "db_saved": db_saved,
                            "db_failed": db_failed,
                            "db_error": db_last_error,
                            "message": f"\u5df2\u6293 {len(_results)} \u6761\uff1b\u672c\u6761\u5165\u5e93\u91cd\u8bd5 3 \u6b21\u4ecd\u5931\u8d25\uff0c\u5df2\u5199\u5165\u8865\u507f\u65e5\u5fd7",
                        }
                    )

        try:
            if site == "cnnc":
                items: list[dict] = []
                max_items = limit if limit > 0 else 100
                categories = list(CNNC_CRAWL_CATEGORIES.items())
                for index, (_key, category) in enumerate(categories, start=1):
                    if _cancel.is_set():
                        raise CrawlCancelled()
                    public_rows = parse_cnnc_listing(fetch_cnnc_listing(category["url"]))
                    for public_row in public_rows:
                        if keyword and keyword not in str(public_row.get("title") or ""):
                            continue
                        notice_time = public_row.get("notice_time")
                        notice_day = (
                            notice_time.strftime("%Y-%m-%d")
                            if hasattr(notice_time, "strftime")
                            else str(notice_time or "")[:10]
                        )
                        if start and (not notice_day or notice_day < start[:10]):
                            continue
                        if end and (not notice_day or notice_day > end[:10]):
                            continue
                        item = make_cnnc_row(public_row, category)
                        items.append(item)
                        on_item(item)
                        if len(items) >= max_items:
                            break
                    on_page(index, len(categories), len(items), 100, category["name"])
                    if len(items) >= max_items:
                        break
                    if index < len(categories):
                        time.sleep(2)
                out = _output_path("cnnc", "title")
                search_mode = "title"
                _write_json_atomic(out, items)
                with _lock:
                    _results = [_ui_row(x) for x in items]
                    for x in items:
                        nid = str(x.get("id") or "")
                        if nid:
                            _full[nid] = x
                    _status = {
                        "running": False,
                        "ok": True,
                        "message": f"CNNC complete: {len(items)} public list records saved.",
                        "phase": "complete",
                        "progress": 100,
                        "output_file": str(out.relative_to(BASE_DIR)),
                        "total": len(items),
                        "site": "cnnc",
                        "count": len(items),
                        "latest": _status.get("latest"),
                        "recent": list(_status.get("recent") or [])[:12],
                        "db_saved": db_saved,
                        "db_failed": db_failed,
                        "db_error": db_last_error,
                    }
                return
            elif site == "railway":
                start_day = (start or "")[:10]
                end_day = (end or "")[:10]
                today = __import__("datetime").date.today()
                if not start_day:
                    start_day = railway_three_month_start(today).isoformat()
                if not end_day:
                    end_day = today.isoformat()

                def on_railway_progress(event: dict) -> None:
                    nonlocal db_saved
                    with _lock:
                        db_saved = int(event.get("stored") or event.get("count") or db_saved)
                        latest = event.get("latest")
                        recent = list(event.get("recent") or [])
                        mapped_recent = []
                        for r in recent[:12]:
                            mapped_recent.append(
                                {
                                    "id": r.get("id"),
                                    "title": r.get("title") or "(无标题)",
                                    "notice_time": r.get("notice_time") or "",
                                    "notice_name": r.get("notice_name") or "",
                                    "region": r.get("region") or "",
                                    "url": r.get("url") or "",
                                    "snippet": r.get("snippet") or "",
                                    "source": "railway",
                                }
                            )
                            if r.get("id"):
                                _full[str(r["id"])] = {**r, "source": "railway"}
                        if latest and latest.get("id"):
                            _full[str(latest["id"])] = {**latest, "source": "railway"}
                        _status.update(
                            {
                                "running": True,
                                "ok": True,
                                "phase": event.get("phase") or "国铁采集中",
                                "progress": int(event.get("progress") or 0),
                                "message": event.get("message") or "",
                                "count": int(event.get("count") or 0),
                                "total": int(event.get("total") or event.get("count") or 0),
                                "latest": latest,
                                "recent": mapped_recent,
                                "db_saved": db_saved,
                                "site": "railway",
                                "output_file": "mysql:biaoxun.china_railway",
                            }
                        )
                        if mapped_recent:
                            _results[:] = [
                                {
                                    "id": r.get("id"),
                                    "source": "railway",
                                    "title": r.get("title"),
                                    "notice_time": r.get("notice_time"),
                                    "region": r.get("region"),
                                    "notice_name": r.get("notice_name"),
                                    "url": r.get("url"),
                                    "content_text": r.get("snippet") or "",
                                    "has_content": True,
                                }
                                for r in mapped_recent
                            ]

                result = railway_run_crawl(
                    {
                        "site": "both",
                        "keyword": keyword,
                        "mode": mode,
                        "pages": pages,
                        "limit": limit,
                        "start": start_day,
                        "end": end_day,
                    },
                    cancel_event=_cancel,
                    progress=on_railway_progress,
                )
                items = list(_full.values()) if _full else []
                out = _output_path("railway", mode)
                try:
                    _write_json_atomic(out, items)
                except Exception:
                    pass
                with _lock:
                    _status = {
                        "running": False,
                        "ok": True,
                        "message": result.get("message") or f"完成，已入库 {result.get('stored', 0)} 条",
                        "phase": "完成",
                        "progress": 100,
                        "output_file": "mysql:biaoxun.china_railway",
                        "total": int(result.get("count") or 0),
                        "site": "railway",
                        "count": int(result.get("count") or 0),
                        "latest": _status.get("latest"),
                        "recent": list(_status.get("recent") or [])[:12],
                        "db_saved": int(result.get("stored") or 0),
                        "db_failed": 0,
                        "db_error": "",
                    }
                return
            if site == "plap":
                known = set()
                try:
                    known = existing_plap_ids()
                except Exception:  # noqa: BLE001
                    pass
                plap_pages = pages if pages > 0 else 0
                plap_cap = limit
                plap_full = plap_pages == 0 and not keyword
                crawler = PlapCrawler(
                    delay_lo=1.0,
                    delay_hi=1.5,
                    daily_cap=plap_cap,
                    list_pages=plap_pages,
                    page_size=20,
                )
                items = crawler.crawl(
                    keyword=keyword,
                    max_pages=plap_pages,
                    known_ids=known,
                    partition_by_type=plap_full,
                    cancel_check=_cancel.is_set,
                    idle_stop_pages=0 if plap_full else PLAP_IDLE_STOP_PAGES,
                    on_page=on_page,
                    on_item=on_item,
                    on_partition=on_partition if plap_full else None,
                    on_discover=on_discover if plap_full else None,
                )
                out = _output_path("plap", mode)
                search_mode = "plap"
            elif site == "gxt":
                known = set()
                try:
                    known = existing_gxt_ids()
                except Exception:  # noqa: BLE001
                    pass
                gxt_pages = pages if pages > 0 else 0
                gxt_cap = limit
                crawler = GxtZcfgCrawler(
                    delay_lo=3.0,
                    delay_hi=8.0,
                    daily_cap=gxt_cap,
                    list_pages=gxt_pages,
                    workers=WEB_GXT_WORKERS,
                )
                items = crawler.crawl(
                    searchword=keyword,
                    max_pages=gxt_pages,
                    known_ids=known,
                    on_page=on_page,
                    on_item=on_item,
                )
                out = _output_path("gxt", mode)
                search_mode = "gxt"
            elif site == "kjt":
                known = set()
                try:
                    known = existing_ids(source="kjt")
                except Exception:  # noqa: BLE001
                    pass
                kjt_pages = pages if pages > 0 else 0
                kjt_cap = limit
                crawler = KjtXxgkCrawler(
                    delay_lo=5.0,
                    delay_hi=15.0,
                    daily_cap=kjt_cap,
                    list_pages=kjt_pages,
                    workers=WEB_KJT_WORKERS,
                )
                items = crawler.crawl(
                    searchword=keyword,
                    max_pages=kjt_pages,
                    known_ids=known,
                    on_page=on_page,
                    on_item=on_item,
                )
                out = _output_path("kjt", mode)
                search_mode = "kjt"
            else:
                known = set()
                try:
                    known = existing_ids(source="zfcg")
                except Exception:  # noqa: BLE001
                    pass
                items = FujianQwjsyCrawler(
                    delay=2.0, daily_cap=limit, workers=WEB_ZFCG_WORKERS, retries=3
                ).crawl(
                    keyword,
                    mode=mode,
                    max_pages=pages,
                    with_detail=True,
                    region_code=region,
                    start_time=start,
                    end_time=end,
                    on_page=on_page,
                    on_item=on_item,
                    known_ids=known,
                    start_page=start_page,
                )
                for x in items:
                    x.setdefault("source", "zfcg")
                out = _output_path("qwjsy", mode)
                search_mode = mode

            _write_json_atomic(out, items)
            db_msg = f"\uff0c\u5df2\u5b9e\u65f6\u5165\u5e93 {db_saved} \u6761"
            # Reconcile the whole batch only if one or more immediate writes failed.
            if db_failed:
                try:
                    if site == "gxt":
                        n = upsert_gxt(items, keyword=keyword)
                    elif site == "plap":
                        n = upsert_plap(items, keyword=keyword)
                    elif site == "cnnc":
                        n = upsert_cnnc(items)
                    else:
                        n = upsert_notices(items, keyword=keyword, search_mode=search_mode)
                    db_saved = n
                    db_failed = 0
                    db_last_error = ""
                    db_msg = f"\uff0c\u5b9e\u65f6\u5165\u5e93\u5e76\u8865\u507f\u5b8c\u6210 {n} \u6761"
                except Exception as db_exc:  # noqa: BLE001
                    db_last_error = str(db_exc)[:300]
                    db_msg = f"\uff0c\u5b9e\u65f6\u5165\u5e93 {db_saved} \u6761\uff0c\u8865\u507f\u5931\u8d25\uff1a{db_last_error}"
            ui = [_ui_row(x) for x in items]
            with _lock:
                _results = ui
                for x in items:
                    nid = str(x.get("id") or "")
                    if nid:
                        _full[nid] = x
                _status = {
                    "running": False,
                    "ok": True,
                    "message": f"完成，共 {len(items)} 条{db_msg}",
                    "phase": "完成",
                    "progress": 100,
                    "output_file": str(out.relative_to(BASE_DIR)),
                    "total": len(items),
                    "site": site,
                    "count": len(items),
                    "latest": _status.get("latest"),
                    "recent": list(_status.get("recent") or [])[:12],
                    "db_saved": db_saved,
                    "db_failed": db_failed,
                    "db_error": db_last_error,
                }
        except RailwayStopped:
            with _lock:
                _status = {
                    "running": False,
                    "ok": True,
                    "message": f"已停止，断点已保存，已入库 {db_saved} 条",
                    "phase": "已停止",
                    "progress": int(_status.get("progress") or 0),
                    "output_file": "mysql:biaoxun.china_railway",
                    "total": int(_status.get("count") or 0),
                    "site": site,
                    "count": int(_status.get("count") or 0),
                    "latest": _status.get("latest"),
                    "recent": list(_status.get("recent") or [])[:12],
                    "db_saved": db_saved,
                    "db_failed": db_failed,
                    "db_error": db_last_error,
                }
        except (RailwayChallenge, RailwayError) as exc:
            with _lock:
                _status = {
                    "running": False,
                    "ok": False,
                    "message": str(exc),
                    "phase": "需要关注",
                    "progress": int(_status.get("progress") or 0),
                    "output_file": "mysql:biaoxun.china_railway",
                    "total": int(_status.get("count") or 0),
                    "site": site,
                    "count": int(_status.get("count") or 0),
                    "latest": _status.get("latest"),
                    "recent": list(_status.get("recent") or [])[:12],
                    "db_saved": db_saved,
                    "db_failed": db_failed,
                    "db_error": db_last_error,
                }
        except CrawlCancelled:
            with _lock:
                _status = {
                    "running": False,
                    "ok": True,
                    "message": f"已停止，本次共抓 {len(_results)} 条，已入库 {db_saved} 条",
                    "phase": "已停止",
                    "progress": int(_status.get("progress") or 0),
                    "output_file": str(_status.get("output_file") or ""),
                    "total": len(_results),
                    "site": site,
                    "count": len(_results),
                    "latest": _status.get("latest"),
                    "recent": list(_status.get("recent") or [])[:12],
                    "db_saved": db_saved,
                    "db_failed": db_failed,
                    "db_error": db_last_error,
                }
        except (ZfcgBlocked, KjtBlocked, GxtBlocked, PlapBlocked) as exc:
            with _lock:
                _status = {
                    "running": False,
                    "ok": False,
                    "message": f"已暂停：{exc}",
                    "phase": "暂停",
                    "progress": int(_status.get("progress") or 0),
                    "output_file": str(_status.get("output_file") or ""),
                    "total": len(_results),
                    "site": site,
                    "count": len(_results),
                    "latest": _status.get("latest"),
                    "recent": list(_status.get("recent") or [])[:12],
                    "db_saved": db_saved,
                    "db_failed": db_failed,
                    "db_error": db_last_error,
                }
        except Exception as exc:  # noqa: BLE001
            with _lock:
                _status = {
                    "running": False,
                    "ok": False,
                    "message": f"失败：{exc}",
                    "phase": "失败",
                    "progress": int(_status.get("progress") or 0),
                    "output_file": str(_status.get("output_file") or ""),
                    "total": len(_results),
                    "site": site,
                    "count": len(_results),
                    "latest": _status.get("latest"),
                    "recent": list(_status.get("recent") or [])[:12],
                    "db_saved": db_saved,
                    "db_failed": db_failed,
                    "db_error": db_last_error,
                }

    threading.Thread(target=task, daemon=True).start()
    return jsonify({"ok": True, "message": "任务已启动"})


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=8080)
