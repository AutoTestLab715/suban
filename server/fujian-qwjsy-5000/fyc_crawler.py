#!/usr/bin/env python3
"""Crawler for public notices on xmygcg.com (福易采全站)."""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin

import requests

import fyc_db


BASE = "https://www.xmygcg.com"
API_BASE = f"{BASE}/fyc"
# Empty site = 全平台公告（约 2.7 万+）；"90" 仅为厦门子集约 600 条。
DEFAULT_SOURCE_SITE = ""
LIST_URL = f"{API_BASE}/fyc3/uip/mh/project/query"
DETAIL_URL = f"{API_BASE}/fyc3/uip/mh/attachment/query"
PORTAL_DETAIL = f"{BASE}/#/notice/detail-upgrade"
STATUS_PATH = Path(__file__).resolve().parent / "crawler_status.json"
STOP_PATH = Path(__file__).resolve().parent / "crawler.stop"
LOCK_PATH = Path(__file__).resolve().parent / "crawler.lock"
CHECKPOINT_PATH = Path(__file__).resolve().parent / "crawler_checkpoint.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Origin": BASE,
    "Referer": f"{BASE}/",
}


class CrawlError(RuntimeError):
    pass


class CrawlStopped(RuntimeError):
    pass


class CrawlAlreadyRunning(RuntimeError):
    pass


class ChallengeRequired(CrawlError):
    pass


def three_month_start() -> date:
    return date.today() - timedelta(days=90)


def normalize_options(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    source_site = payload.get("source_site")
    if source_site is None:
        source_site = DEFAULT_SOURCE_SITE
    return {
        "site": "notice",
        "source_site": str(source_site),
        "keyword": str(payload.get("keyword") or "").strip(),
        "mode": str(payload.get("mode") or "content"),
        "pages": int(payload.get("pages") or 0),
        "limit": int(payload.get("limit") or 0),
        "start": str(payload.get("start") or "").strip(),
        "end": str(payload.get("end") or "").strip(),
        "page_size": int(payload.get("page_size") or 100),
        "until_empty": bool(payload.get("until_empty", True)),
        "empty_stop_pages": int(payload.get("empty_stop_pages") or 3),
        "start_page": max(1, int(payload.get("start_page") or 1)),
        "skip_existing": bool(payload.get("skip_existing", True)),
        "item_delay": float(payload.get("item_delay") or 0.15),
    }


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def _post(
    session: requests.Session,
    url: str,
    payload: dict[str, Any],
    *,
    retries: int = 5,
) -> dict[str, Any]:
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.post(url, data=json.dumps(payload, ensure_ascii=False), timeout=60)
            resp.raise_for_status()
            data = resp.json()
            code = int(data.get("code") or 0)
            if code != 200:
                msg = str(data.get("message") or f"接口返回异常：{data}")
                if attempt < retries:
                    time.sleep(min(30.0, 1.8 * attempt))
                    continue
                raise CrawlError(msg)
            return data.get("data") or {}
        except CrawlError:
            raise
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt >= retries:
                break
            time.sleep(min(30.0, 1.8 * attempt))
    raise CrawlError(f"请求失败（已重试 {retries} 次）：{last_exc}")


def _list_payload(opts: dict[str, Any], page: int, size: int) -> dict[str, Any]:
    return {
        "site": opts.get("source_site", DEFAULT_SOURCE_SITE),
        "bidName": opts.get("keyword") or "",
        "bidType": "",
        "dateType": "",
        "startDate": opts.get("start") or "",
        "endDate": opts.get("end") or "",
        "isProvince": "",
        "page": {"current": page, "size": size},
        "address": "",
        "isEffective": "",
        "purchaseMode": "",
        "title": opts.get("keyword") or "",
    }


def _detail_payload(opts: dict[str, Any], bulletin_id: str) -> dict[str, Any]:
    return {"site": opts.get("source_site", DEFAULT_SOURCE_SITE), "bulletinId": str(bulletin_id)}


def _notice_type(value: str) -> str:
    return {
        "ZBGG": "招标公告",
        "YSGG": "预审公告",
        "BGGG": "变更公告",
        "CJGG": "成交/结果公告",
        "YCGG": "其他公告",
    }.get(value or "", value or "公告")


def _category(value: str) -> str:
    return (value or "notice").lower()


def _attachments(value: Any) -> list[dict[str, str]]:
    if not value:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    if isinstance(value, dict):
        value = [value]
    out = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("fileUrl") or item.get("url") or item.get("file") or "").strip()
        name = str(item.get("fileName") or item.get("name") or url.rsplit("/", 1)[-1]).strip()
        if url and not url.startswith(("http://", "https://")):
            url = urljoin(API_BASE + "/", url.lstrip("/"))
        if url or name:
            out.append({"name": name or url, "url": url})
    return out


def _make_url(item: dict[str, Any], notice_type: str = "notice") -> str:
    return (
        f"{PORTAL_DETAIL}?bidId={item.get('bidId') or ''}"
        f"&bulletinId={item.get('bulletinId') or ''}&noticeType={notice_type}"
    )


def _row_from(list_item: dict[str, Any], detail: dict[str, Any] | None = None) -> dict[str, Any]:
    detail = detail or {}
    merged = {**list_item, **detail}
    bulletin_type = str(merged.get("bulletinType") or list_item.get("bulletinType") or "")
    bulletin_id = str(merged.get("bulletinId") or list_item.get("bulletinId") or "")
    notice_type = "solicit" if bulletin_type == "YCGG" and not (merged.get("bidCode") or "") else "notice"
    province = merged.get("province") or ""
    city = merged.get("city") or ""
    country = merged.get("country") or ""
    region = " / ".join([str(x) for x in (province, city, country) if x])
    content_html = str(merged.get("content") or "")
    files = _attachments(merged.get("fileUrls"))
    return {
        "id": bulletin_id,
        "title": merged.get("title") or merged.get("bidName") or "",
        "publish_time": merged.get("pushTime") or merged.get("publishTime") or "",
        "category": _category(bulletin_type),
        "bulletin_type": bulletin_type,
        "notice_name": _notice_type(bulletin_type),
        "url": _make_url(merged, notice_type),
        "bid_id": str(merged.get("bidId") or ""),
        "bulletin_id": bulletin_id,
        "package_id": str(merged.get("packageId") or ""),
        "bid_code": str(merged.get("bidCode") or ""),
        "bid_name": merged.get("bidName") or "",
        "bid_type_name": merged.get("purchaseModeName") or merged.get("bidType") or "",
        "project_type": merged.get("bidType") or "",
        "purchaser": merged.get("tenderName") or "",
        "agency": merged.get("agencyName") or "",
        "region": region,
        "budget": str(merged.get("budget") or merged.get("budgetAmount") or ""),
        "content_html": content_html,
        "attchs": files,
        "raw_json": {"list": list_item, "detail": detail},
    }


def preview_count(opts: dict[str, Any]) -> dict[str, Any]:
    opts = normalize_options(opts)
    with _session() as session:
        data = _post(session, LIST_URL, _list_payload(opts, 1, 10))
    total = int(data.get("total") or 0)
    pages = int(data.get("pages") or 0)
    page_limit = int(opts.get("pages") or 0)
    if page_limit > 0:
        pages = min(pages, page_limit)
        total = min(total, pages * int(opts.get("page_size") or 100))
    limit = int(opts.get("limit") or 0)
    if limit > 0:
        total = min(total, limit)
    return {"estimate": total, "totals": {"notice": total}, "pages": pages}


def _progress_payload(**kwargs: Any) -> dict[str, Any]:
    payload = {"running": True, "ok": True}
    payload.update(kwargs)
    return payload


def read_status() -> dict[str, Any]:
    if not STATUS_PATH.is_file():
        return {}
    try:
        return json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_status(data: dict[str, Any]) -> None:
    STATUS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def request_stop() -> None:
    STOP_PATH.write_text(datetime.now().isoformat(), encoding="utf-8")


def verify_challenge() -> None:
    return None


def _check_stop(cancel_event: threading.Event | None) -> None:
    if STOP_PATH.exists() or (cancel_event and cancel_event.is_set()):
        raise CrawlStopped("任务已停止")


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _acquire_lock() -> None:
    if LOCK_PATH.exists():
        try:
            old = int((LOCK_PATH.read_text(encoding="utf-8") or "0").strip() or "0")
        except Exception:
            old = 0
        if _pid_alive(old):
            raise CrawlAlreadyRunning(f"已有福易采爬虫正在运行(pid={old})")
        LOCK_PATH.unlink(missing_ok=True)
    LOCK_PATH.write_text(str(os.getpid()), encoding="utf-8")


def _save_checkpoint(page_no: int, opts: dict[str, Any], count: int, total: int) -> None:
    CHECKPOINT_PATH.write_text(
        json.dumps(
            {
                "page": page_no,
                "count": count,
                "total": total,
                "source_site": opts.get("source_site", ""),
                "start": opts.get("start") or "",
                "end": opts.get("end") or "",
                "updated_at": datetime.now().isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _load_checkpoint() -> dict[str, Any]:
    if not CHECKPOINT_PATH.is_file():
        return {}
    try:
        return json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def run_crawl(
    opts: dict[str, Any] | None = None,
    *,
    cancel_event: threading.Event | None = None,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    opts = normalize_options(opts)
    _acquire_lock()
    STOP_PATH.unlink(missing_ok=True)
    page_size = max(1, min(100, int(opts.get("page_size") or 100)))
    max_pages = int(opts.get("pages") or 0)
    max_items = int(opts.get("limit") or 0)
    start_page = max(1, int(opts.get("start_page") or 1))
    skip_existing = bool(opts.get("skip_existing", True))
    item_delay = max(0.05, float(opts.get("item_delay") or 0.15))
    recent: list[dict[str, Any]] = []
    count = 0
    skipped = 0
    total = 0
    pages = 1
    try:
        with _session() as session:
            first = _post(session, LIST_URL, _list_payload(opts, 1, page_size))
            total = int(first.get("total") or 0)
            api_pages = int(first.get("pages") or 0)
            pages = api_pages or 1
            if max_pages > 0:
                pages = min(pages, max_pages)
            elif api_pages <= 0 and opts.get("until_empty"):
                pages = 1000000
            elif api_pages > 0:
                pages = api_pages

            if progress:
                progress(
                    _progress_payload(
                        phase="准备中",
                        progress=0,
                        count=0,
                        total=total,
                        message=(
                            f"全站抓取启动：预计 {total} 条 / {pages} 页"
                            f"（source_site={opts.get('source_site')!r}，无条数上限）"
                        ),
                    )
                )

            empty_pages = 0
            for page_no in range(start_page, pages + 1):
                _check_stop(cancel_event)
                if page_no == 1 and start_page == 1:
                    data = first
                else:
                    data = _post(session, LIST_URL, _list_payload(opts, page_no, page_size))
                records = data.get("records") or []
                if not records:
                    empty_pages += 1
                    event = _progress_payload(
                        phase=f"第 {page_no} 页为空",
                        progress=99,
                        count=count,
                        total=total,
                        recent=recent,
                        message=f"已连续遇到 {empty_pages} 个空页",
                    )
                    write_status(event)
                    if progress:
                        progress(event)
                    if empty_pages >= int(opts.get("empty_stop_pages") or 3):
                        break
                    continue
                empty_pages = 0

                ids = [str(x.get("bulletinId") or "") for x in records]
                have = fyc_db.ids_with_content(ids) if skip_existing else set()

                for idx, item in enumerate(records):
                    _check_stop(cancel_event)
                    bulletin_id = str(item.get("bulletinId") or "")
                    detail: dict[str, Any] = {}
                    reused = False
                    if bulletin_id and bulletin_id in have:
                        reused = True
                        skipped += 1
                    elif bulletin_id:
                        try:
                            detail = _post(session, DETAIL_URL, _detail_payload(opts, bulletin_id))
                        except Exception as exc:  # noqa: BLE001
                            detail = {"detail_error": str(exc)}
                        time.sleep(item_delay)
                    if reused:
                        # Already have full content; count as processed without re-fetch/re-write.
                        row = _row_from(item, {})
                        count += 1
                    else:
                        row = _row_from(item, detail)
                        fyc_db.upsert_many([row])
                        count += 1

                    ui = {
                        "id": row["id"],
                        "title": row["title"],
                        "notice_name": row["notice_name"],
                        "notice_time": row["publish_time"],
                        "region": row["region"],
                        "snippet": "",
                        "url": row["url"],
                        "source": "notice",
                    }
                    recent.insert(0, ui)
                    recent = recent[:10]
                    done_pages = page_no - start_page
                    page_fraction = (idx + 1) / max(1, len(records))
                    denominator = max(1, pages - start_page + 1)
                    pct = int(((done_pages + page_fraction) / denominator) * 100)
                    event = _progress_payload(
                        phase=f"第 {page_no}/{pages} 页",
                        progress=min(99, pct),
                        count=count,
                        total=total,
                        latest=ui,
                        recent=recent,
                        skipped=skipped,
                        message=(
                            f"已处理 {count}/{total} 条"
                            f"（跳过已有正文 {skipped}，source_site={opts.get('source_site')!r}）"
                        ),
                    )
                    if idx == len(records) - 1 or idx % 10 == 0:
                        write_status(event)
                        _save_checkpoint(page_no, opts, count, total)
                    if progress:
                        progress(event)
                    if max_items and count >= max_items:
                        break
                _save_checkpoint(page_no + 1, opts, count, total)
                if max_items and count >= max_items:
                    break

        result = {
            "running": False,
            "ok": True,
            "phase": "完成",
            "progress": 100,
            "message": f"福易采公告抓取完成，处理 {count} 条（跳过已有正文 {skipped}）",
            "count": count,
            "total": total,
            "new_count": max(0, count - skipped),
            "skipped": skipped,
            "recent": recent,
            "output_file": "mysql:biaoxun.fyc",
        }
        write_status(result)
        CHECKPOINT_PATH.unlink(missing_ok=True)
        return result
    except CrawlStopped as exc:
        result = {
            "running": False,
            "ok": True,
            "phase": "已停止",
            "progress": int(read_status().get("progress") or 0),
            "message": str(exc),
            "count": count,
            "total": total,
            "skipped": skipped,
            "recent": recent,
            "output_file": "mysql:biaoxun.fyc",
        }
        write_status(result)
        return result
    except Exception as exc:  # noqa: BLE001
        result = {
            "running": False,
            "ok": False,
            "phase": "异常暂停",
            "progress": int(read_status().get("progress") or 0),
            "message": f"采集异常：{exc}",
            "count": count,
            "total": total,
            "skipped": skipped,
            "recent": recent,
            "output_file": "mysql:biaoxun.fyc",
        }
        write_status(result)
        raise
    finally:
        LOCK_PATH.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="0=不限制条数")
    parser.add_argument("--pages", type=int, default=0, help="0=不限制页数")
    parser.add_argument("--start", default="", help="开始日期 YYYY-MM-DD，空=不限")
    parser.add_argument("--end", default="", help="结束日期 YYYY-MM-DD，空=不限")
    parser.add_argument("--source-site", default=DEFAULT_SOURCE_SITE, help="接口 site，空=全站")
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--resume", action="store_true", help="从断点页继续")
    parser.add_argument("--no-skip-existing", action="store_true")
    parser.add_argument("--item-delay", type=float, default=0.15)
    parser.add_argument("--daily", action="store_true")
    parser.add_argument("--lookback-days", type=int, default=3)
    args = parser.parse_args()
    fyc_db.ensure_schema()
    start = args.start
    end = args.end
    start_page = max(1, args.start_page)
    if args.daily and not start:
        start = (date.today() - timedelta(days=max(1, args.lookback_days))).isoformat()
        end = end or date.today().isoformat()
    if args.resume:
        ck = _load_checkpoint()
        if ck.get("page"):
            start_page = max(start_page, int(ck["page"]))
            print(f"resume from page {start_page}", flush=True)
    result = run_crawl(
        {
            "limit": args.limit,
            "pages": args.pages,
            "start": start,
            "end": end,
            "source_site": args.source_site,
            "page_size": args.page_size,
            "start_page": start_page,
            "skip_existing": not args.no_skip_existing,
            "item_delay": args.item_delay,
        },
        progress=write_status,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
