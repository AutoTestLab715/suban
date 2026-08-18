#!/usr/bin/env python3
"""Integrate 福易采 (fyc) into /opt/fujian-qwjsy."""
from __future__ import annotations

from pathlib import Path

ROOT = Path("/opt/fujian-qwjsy")


def patch_crawler() -> None:
    path = ROOT / "fyc_crawler.py"
    text = path.read_text(encoding="utf-8")
    repls = [
        ('"crawler_status.json"', '"fyc_crawler_status.json"'),
        ('"crawler.stop"', '"fyc_crawler.stop"'),
        ('"crawler.lock"', '"fyc_crawler.lock"'),
        ('"crawler_checkpoint.json"', '"fyc_crawler_checkpoint.json"'),
        ('"site": "notice"', '"site": "fyc"'),
        ('"source": "notice"', '"source": "fyc"'),
        ('{"estimate": total, "totals": {"notice": total}', '{"estimate": total, "totals": {"fyc": total}'),
    ]
    for old, new in repls:
        text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")


def patch_app() -> None:
    path = ROOT / "app.py"
    app = path.read_text(encoding="utf-8")

    if "from fyc_crawler import" not in app:
        app = app.replace(
            "import schedule_util\n",
            '''from fyc_crawler import (
    ChallengeRequired as FycChallenge,
    CrawlAlreadyRunning as FycAlreadyRunning,
    CrawlError as FycError,
    CrawlStopped as FycStopped,
    normalize_options as fyc_normalize_options,
    preview_count as fyc_preview_count,
    request_stop as fyc_request_stop,
    run_crawl as fyc_run_crawl,
    three_month_start as fyc_three_month_start,
)
from fyc_db import (
    count_filtered as count_fyc_filtered,
    ensure_schema as ensure_fyc_schema,
    fetch_one as fetch_fyc,
    fetch_page as fetch_fyc_page,
)

FYC_PAGE_URL = "https://www.xmygcg.com/#/notice/list-upgrade"

import schedule_util
''',
        )

    if "ensure_fyc_schema()" not in app:
        app = app.replace(
            "    ensure_cnnc_schema()\n    if ensure_easy_prt_schema:",
            "    ensure_cnnc_schema()\n    ensure_fyc_schema()\n    if ensure_easy_prt_schema:",
        )

    if '"fyc": "福易采"' not in app:
        app = app.replace(
            '        "easy_prt": "工采通公告抓取",\n',
            '        "easy_prt": "工采通公告抓取",\n        "fyc": "福易采",\n',
        )

    if '"fyc_page_url"' not in app:
        app = app.replace(
            '        "railway_page_url": RAILWAY_PAGE_URL,\n',
            '        "railway_page_url": RAILWAY_PAGE_URL,\n        "fyc_page_url": FYC_PAGE_URL,\n',
        )

    if "fetch_fyc(notice_id)" not in app:
        app = app.replace(
            '''        elif notice_id.startswith("ep_"):
            # Always read from easy_prt's own table; do not fall back to notices.
            row = fetch_easy_prt(notice_id) if fetch_easy_prt else None
            if row:
                row = {**row, "source": "easy_prt"}
        else:
            row = fetch_notice(notice_id)''',
            '''        elif notice_id.startswith("ep_"):
            # Always read from easy_prt's own table; do not fall back to notices.
            row = fetch_easy_prt(notice_id) if fetch_easy_prt else None
            if row:
                row = {**row, "source": "easy_prt"}
        else:
            row = fetch_fyc(notice_id)
            if row:
                row = {
                    **row,
                    "notice_time": row.get("publish_time"),
                    "project_no": row.get("bid_code") or "",
                    "source": "fyc",
                }
            if not row:
                row = fetch_notice(notice_id)''',
        )

    if 'elif source == "fyc":' not in app:
        app = app.replace(
            '''        elif source == "railway":
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
        else:''',
            '''        elif source == "fyc":
            total, slice_ = fetch_fyc_page(page, per_page)
            slice_ = [
                {
                    **row,
                    "source": "fyc",
                    "notice_time": row.get("publish_time") or row.get("notice_time"),
                    "project_no": row.get("bid_code") or "",
                    "has_content": bool(row.get("content_text")),
                }
                for row in slice_
            ]
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
        else:''',
        )

    if 'mysql:biaoxun.fyc' not in app:
        app = app.replace(
            '''                    else "mysql:biaoxun.china_railway"
                    if source == "railway"
                    else f"mysql:biaoxun.notices"''',
            '''                    else "mysql:biaoxun.china_railway"
                    if source == "railway"
                    else "mysql:biaoxun.fyc"
                    if source == "fyc"
                    else f"mysql:biaoxun.notices"''',
        )

    if 'if site == "fyc":\n        opts = fyc_normalize_options' not in app:
        app = app.replace(
            '    if site not in ("zfcg", "kjt", "gxt", "plap", "railway", "cnnc"):\n        site = "zfcg"',
            '    if site not in ("zfcg", "kjt", "gxt", "plap", "railway", "cnnc", "fyc", "easy_prt"):\n        site = "zfcg"',
        )
        app = app.replace(
            '    return {\n        "site": site,\n        "keyword": keyword,',
            '''    if site == "fyc":
        opts = fyc_normalize_options(payload)
        opts["site"] = "fyc"
        kw = str(opts.get("keyword") or "")
        opts["label"] = f"「{kw}」" if kw else "全部"
        return opts
    return {
        "site": site,
        "keyword": keyword,''',
        )

    preview_marker = '    if site == "fyc":\n        start = (opts.get("start")'
    if preview_marker not in app:
        fyc_preview = '''    if site == "fyc":
        start = (opts.get("start") or "")[:10]
        end = (opts.get("end") or "")[:10]
        today = __import__("datetime").date.today()
        if not start:
            start = fyc_three_month_start().isoformat()
            opts = {**opts, "start": start}
        if not end:
            end = today.isoformat()
            opts = {**opts, "end": end}
        try:
            remote = fyc_preview_count(opts)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "message": f"福易采预览失败：{exc}"}
        estimate = int(remote.get("estimate") or 0)
        db_count = count_fyc_filtered(keyword=opts.get("keyword") or "", start=start, end=end)
        return {
            "ok": True,
            "estimate": estimate,
            "site": site,
            "db_existing": db_count,
            "pages": remote.get("pages") or 0,
            "message": (
                f"福易采 · {start} 至 {end} · 接口约 {estimate} 条，库内已有 {db_count} 条"
                f"（跳过已有正文，增量入库）。"
            ),
        }
'''
        app = app.replace(
            '    if site == "railway":\n        start = (opts.get("start") or "")[:10]',
            fyc_preview + '    if site == "railway":\n        start = (opts.get("start") or "")[:10]',
        )

    if 'elif site == "fyc":' not in app:
        fyc_task = '''
            elif site == "fyc":
                start_day = (start or "")[:10]
                end_day = (end or "")[:10]
                today = __import__("datetime").date.today()
                if not start_day:
                    start_day = fyc_three_month_start(today).isoformat()
                if not end_day:
                    end_day = today.isoformat()

                def on_fyc_progress(event: dict) -> None:
                    nonlocal db_saved
                    with _lock:
                        db_saved = int(event.get("count") or db_saved)
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
                                    "source": "fyc",
                                }
                            )
                            if r.get("id"):
                                _full[str(r["id"])] = {**r, "source": "fyc"}
                        if latest and latest.get("id"):
                            _full[str(latest["id"])] = {**latest, "source": "fyc"}
                        _status.update(
                            {
                                "running": True,
                                "ok": True,
                                "phase": event.get("phase") or "福易采采集中",
                                "progress": int(event.get("progress") or 0),
                                "message": event.get("message") or "",
                                "count": int(event.get("count") or 0),
                                "total": int(event.get("total") or event.get("count") or 0),
                                "latest": latest,
                                "recent": mapped_recent,
                                "db_saved": db_saved,
                                "site": "fyc",
                                "output_file": "mysql:biaoxun.fyc",
                            }
                        )
                        if mapped_recent:
                            _results[:] = [
                                {
                                    "id": r.get("id"),
                                    "source": "fyc",
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

                try:
                    result = fyc_run_crawl(
                        {
                            "keyword": keyword,
                            "mode": mode,
                            "pages": pages,
                            "limit": limit,
                            "start": start_day,
                            "end": end_day,
                            "start_page": start_page,
                        },
                        cancel_event=_cancel,
                        progress=on_fyc_progress,
                    )
                except FycStopped as exc:
                    with _lock:
                        _status = {
                            "running": False,
                            "ok": True,
                            "message": str(exc),
                            "phase": "已停止",
                            "progress": int(_status.get("progress") or 0),
                            "output_file": "mysql:biaoxun.fyc",
                            "total": int(_status.get("count") or 0),
                            "site": "fyc",
                            "count": int(_status.get("count") or 0),
                            "latest": _status.get("latest"),
                            "recent": list(_status.get("recent") or [])[:12],
                            "db_saved": db_saved,
                            "db_failed": 0,
                            "db_error": "",
                        }
                    return
                except (FycChallenge, FycError, FycAlreadyRunning) as exc:
                    with _lock:
                        _status = {
                            "running": False,
                            "ok": False,
                            "message": str(exc),
                            "phase": "需要关注",
                            "progress": int(_status.get("progress") or 0),
                            "output_file": "mysql:biaoxun.fyc",
                            "total": int(_status.get("count") or 0),
                            "site": "fyc",
                            "count": int(_status.get("count") or 0),
                            "latest": _status.get("latest"),
                            "recent": list(_status.get("recent") or [])[:12],
                            "db_saved": db_saved,
                            "db_failed": 0,
                            "db_error": "",
                        }
                    return
                with _lock:
                    _status = {
                        "running": False,
                        "ok": bool(result.get("ok", True)),
                        "message": result.get("message") or f"完成，已处理 {result.get('count', 0)} 条",
                        "phase": result.get("phase") or "完成",
                        "progress": 100,
                        "output_file": "mysql:biaoxun.fyc",
                        "total": int(result.get("count") or 0),
                        "site": "fyc",
                        "count": int(result.get("count") or 0),
                        "latest": _status.get("latest"),
                        "recent": list(_status.get("recent") or [])[:12],
                        "db_saved": int(result.get("count") or db_saved),
                        "db_failed": 0,
                        "db_error": "",
                    }
                return
'''
        app = app.replace('            elif site == "railway":', fyc_task + '            elif site == "railway":', 1)

    if "fyc_request_stop()" not in app:
        app = app.replace(
            '    _cancel.set()\n    return jsonify({"ok": True, "message": "正在停止任务…"})',
            '    _cancel.set()\n    fyc_request_stop()\n    railway_request_stop()\n    return jsonify({"ok": True, "message": "正在停止任务…"})',
        )

    path.write_text(app, encoding="utf-8")


def patch_index() -> None:
    path = ROOT / "templates/index.html"
    idx = path.read_text(encoding="utf-8")
    if 'value="fyc"' in idx:
        return
    idx = idx.replace(
        '<option value="railway">国铁采购网</option></select></label>',
        '<option value="fyc">福易采</option><option value="railway">国铁采购网</option></select></label>',
    )
    idx = idx.replace(
        '<option value="railway">国铁采购网</option></select><button type="button" id="refresh-results"',
        '<option value="fyc">福易采</option><option value="railway">国铁采购网</option></select><button type="button" id="refresh-results"',
    )
    idx = idx.replace(
        'RAILWAY_URL={{ railway_page_url|tojson }};',
        'RAILWAY_URL={{ railway_page_url|tojson }},FYC_URL={{ fyc_page_url|tojson }};',
    )
    idx = idx.replace(
        'easy_prt=site==="easy_prt",railway=site==="railway",label=railway?"国铁采购网":easy_prt?',
        'easy_prt=site==="easy_prt",fyc=site==="fyc",railway=site==="railway",label=railway?"国铁采购网":fyc?"福易采":easy_prt?',
    )
    idx = idx.replace(
        '$("hint").innerHTML=railway?',
        '$("hint").innerHTML=fyc?`当前：福易采 · <a href="${FYC_URL}" target="_blank" rel="noopener">打开官网</a>（全平台公告，增量跳过已有正文）`:railway?',
    )
    idx = idx.replace(
        '$("region").closest(".field").classList.toggle("hidden",gxt||kjt||plap||railway);',
        '$("region").closest(".field").classList.toggle("hidden",gxt||kjt||plap||railway||fyc);',
    )
    idx = idx.replace(
        'document.querySelector(".field-date").classList.toggle("hidden",gxt||kjt||plap);',
        'document.querySelector(".field-date").classList.toggle("hidden",gxt||kjt||plap||fyc);',
    )
    idx = idx.replace(
        'easy_prt=x.source==="easy_prt",railway=x.source==="railway",src=railway?"国铁采购":easy_prt?',
        'easy_prt=x.source==="easy_prt",fyc=x.source==="fyc",railway=x.source==="railway",src=railway?"国铁采购":fyc?"福易采":easy_prt?',
    )
    idx = idx.replace(
        'cls=railway?"badge-railway":easy_prt?"badge-fujian"',
        'cls=railway?"badge-railway":fyc?"badge-fyc":easy_prt?"badge-fujian"',
    )
    idx = idx.replace(
        'filterSource.value==="railway"?"国铁采购网":filterSource.value==="plap"?',
        'filterSource.value==="railway"?"国铁采购网":filterSource.value==="fyc"?"福易采":filterSource.value==="plap"?',
    )
    idx = idx.replace(
        '{source:"railway",label:"国铁采购网",fallback:{hour:8,minute:30}},',
        '{source:"fyc",label:"福易采",fallback:{hour:10,minute:30}},\n  {source:"railway",label:"国铁采购网",fallback:{hour:8,minute:30}},',
    )
    path.write_text(idx, encoding="utf-8")


def patch_schedule() -> None:
    path = ROOT / "schedule_util.py"
    sched = path.read_text(encoding="utf-8")
    if '"fyc"' in sched:
        return
    sched = sched.replace(
        'SOURCE_ORDER = ("zfcg", "kjt", "gxt", "plap", "easy_prt", "railway", "cnnc")',
        'SOURCE_ORDER = ("zfcg", "kjt", "gxt", "plap", "easy_prt", "fyc", "railway", "cnnc")',
    )
    sched = sched.replace(
        '    "easy_prt": "工采通公告抓取",\n',
        '    "easy_prt": "工采通公告抓取",\n    "fyc": "福易采",\n',
    )
    sched = sched.replace(
        '    "easy_prt": [{"hour": 12, "minute": 0}],\n',
        '    "easy_prt": [{"hour": 12, "minute": 0}],\n    "fyc": [{"hour": 10, "minute": 30}],\n',
    )
    path.write_text(sched, encoding="utf-8")


def patch_crawl_daily() -> None:
    path = ROOT / "crawl_daily.sh"
    sh = path.read_text(encoding="utf-8")
    if "fyc)" in sh:
        return
    sh = sh.replace(
        '''    cnnc)
      run_one cnnc "$ROOT/cnnc_crawler.py" --sleep 2
      ;;
''',
        '''    fyc)
      run_one fyc "$ROOT/fyc_crawler.py" --daily --lookback-days "$LOOKBACK" --limit 0 --pages 0
      ;;
    cnnc)
      run_one cnnc "$ROOT/cnnc_crawler.py" --sleep 2
      ;;
''',
    )
    path.write_text(sh, encoding="utf-8")


def patch_css() -> None:
    path = ROOT / "static/style.css"
    css = path.read_text(encoding="utf-8")
    if ".badge-fyc" in css:
        return
    css = css.replace(
        ".badge-railway{background:#0f766e;color:#fff}",
        ".badge-railway{background:#0f766e;color:#fff}\n.badge-fyc{background:#7c3aed;color:#fff}",
    )
    path.write_text(css, encoding="utf-8")


def main() -> None:
    patch_crawler()
    patch_app()
    patch_index()
    patch_schedule()
    patch_crawl_daily()
    patch_css()
    print("patch ok")


if __name__ == "__main__":
    main()
