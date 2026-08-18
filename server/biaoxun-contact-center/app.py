from __future__ import annotations

import csv
import hashlib
import hmac
import io
import os
import re
import secrets
import threading
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from functools import wraps
from urllib.parse import quote

import pymysql
from flask import Flask, Response, redirect, render_template, request, session, url_for

from extractor import extract_purchaser_contact, normalize_text

PREFIX = ""
MAX_LIMIT = 1000
DEFAULT_LIMIT = 300

app = Flask(__name__)
app.secret_key = os.environ.get("CONTACT_EXPORT_SECRET", "")
if not app.secret_key or not os.environ.get("CONTACT_EXPORT_PASSWORD"):
    raise RuntimeError("CONTACT_EXPORT_SECRET and CONTACT_EXPORT_PASSWORD must be configured")
app.config.update(
    SESSION_COOKIE_NAME="biaoxun_contact_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_PATH=PREFIX + "/",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
)

_login_failures: dict[str, list[float]] = defaultdict(list)
_login_lock = threading.Lock()
_cache: dict[tuple, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def _db_config() -> dict:
    return {
        "host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.environ.get("MYSQL_PORT", "3306")),
        "user": os.environ["MYSQL_USER"],
        "password": os.environ["MYSQL_PASSWORD"],
        "database": os.environ.get("MYSQL_DATABASE", "biaoxun"),
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.DictCursor,
        "connect_timeout": 5,
        "read_timeout": 35,
        "write_timeout": 10,
        "autocommit": True,
    }


def _safe_date(value: str) -> str:
    try:
        return date.fromisoformat(value).isoformat() if value else ""
    except ValueError:
        return ""


def _safe_limit(value: str) -> int:
    try:
        return max(20, min(MAX_LIMIT, int(value)))
    except (TypeError, ValueError):
        return DEFAULT_LIMIT


def _tokens(keyword: str) -> list[str]:
    return [t for t in re.split(r"\s+", keyword.strip()) if t][:5]


def _query_rows(keyword: str, start_date: str, end_date: str, content_search: bool, limit: int) -> list[dict]:
    tokens = _tokens(keyword)
    if not tokens:
        return []
    where: list[str] = ["purchaser <> ''"]
    params: list[object] = []
    for token in tokens:
        like = f"%{token}%"
        fields = ["title LIKE %s", "project_name LIKE %s", "purchaser LIKE %s", "project_no LIKE %s"]
        values = [like] * len(fields)
        if content_search:
            fields.append("content_text LIKE %s")
            values.append(like)
        where.append("(" + " OR ".join(fields) + ")")
        params.extend(values)
    if start_date:
        where.append("notice_time >= %s")
        params.append(start_date + " 00:00:00")
    if end_date:
        where.append("notice_time < %s")
        params.append((date.fromisoformat(end_date) + timedelta(days=1)).isoformat() + " 00:00:00")

    # First select only compact metadata. Forcing the notice_time index lets MySQL
    # scan newest-to-oldest and stop as soon as enough matches are found. Selecting
    # MEDIUMTEXT before LIMIT caused a full filesort and 30-second timeouts.
    metadata_params = [*params, limit]
    metadata_sql = f"""
        SELECT /*+ MAX_EXECUTION_TIME(30000) */
          id, source, title, notice_time, region, project_no, project_name,
          purchaser, agency, url
        FROM notices FORCE INDEX (idx_notice_time)
        WHERE {' AND '.join(where)}
        ORDER BY notice_time DESC
        LIMIT %s
    """
    conn = pymysql.connect(**_db_config())
    try:
        with conn.cursor() as cursor:
            cursor.execute(metadata_sql, metadata_params)
            rows = list(cursor.fetchall())
            if not rows:
                return []

            # Fetch the large body fields only for the already-limited primary keys.
            ids = [row["id"] for row in rows]
            placeholders = ",".join(["%s"] * len(ids))
            body_sql = f"""
                SELECT id,
                  CASE WHEN CHAR_LENGTH(COALESCE(content_text,'')) <= 60000
                       THEN COALESCE(content_text,'')
                       ELSE CONCAT(LEFT(content_text,24000),' ... ',RIGHT(content_text,36000)) END AS content_text,
                  description
                FROM notices
                WHERE id IN ({placeholders})
            """
            cursor.execute(body_sql, ids)
            bodies = {row["id"]: row for row in cursor.fetchall()}
            for row in rows:
                body = bodies.get(row["id"], {})
                row["content_text"] = body.get("content_text", "")
                row["description"] = body.get("description", "")
            return rows
    finally:
        conn.close()


def _merge_rows(rows: list[dict]) -> dict:
    groups: dict[str, dict] = {}
    confidence_rank = {"未提取": 0, "低": 1, "中": 2, "高": 3}
    extracted_notices = 0
    for row in rows:
        contact = extract_purchaser_contact(row)
        unit = contact["purchaser"] or normalize_text(row.get("purchaser")) or "未识别甲方单位"
        key = re.sub(r"[\s,，。()（）]", "", unit).lower()
        item = groups.setdefault(
            key,
            {
                "purchaser": unit,
                "phones": [],
                "emails": [],
                "contact_people": [],
                "addresses": [],
                "notice_count": 0,
                "contact_notice_count": 0,
                "latest_title": "",
                "latest_date": "",
                "latest_url": "",
                "region": "",
                "confidence": "未提取",
                "match_basis": "",
                "evidence": "",
            },
        )
        item["notice_count"] += 1
        if contact["has_contact"]:
            extracted_notices += 1
            item["contact_notice_count"] += 1
        for field in ("phones", "emails", "contact_people", "addresses"):
            for value in contact[field]:
                if value and value not in item[field]:
                    item[field].append(value)
        notice_date = row.get("notice_time")
        notice_date = notice_date.strftime("%Y-%m-%d") if hasattr(notice_date, "strftime") else str(notice_date or "")[:10]
        if not item["latest_date"] or notice_date > item["latest_date"]:
            item["latest_date"] = notice_date
            item["latest_title"] = normalize_text(row.get("title"))
            item["latest_url"] = str(row.get("url") or "")
            item["region"] = normalize_text(row.get("region"))
        if confidence_rank[contact["confidence"]] > confidence_rank[item["confidence"]]:
            item["confidence"] = contact["confidence"]
            item["match_basis"] = contact["match_basis"]
            item["evidence"] = contact["evidence"]

    items = list(groups.values())
    for item in items:
        item["phones"] = item["phones"][:8]
        item["emails"] = item["emails"][:5]
        item["contact_people"] = item["contact_people"][:5]
        item["addresses"] = item["addresses"][:3]
        item["has_contact"] = bool(item["phones"] or item["emails"])
    items.sort(key=lambda x: (not x["has_contact"], -confidence_rank[x["confidence"]], x["purchaser"]))
    return {
        "items": items,
        "matched_notices": len(rows),
        "extracted_notices": extracted_notices,
        "unit_count": len(items),
        "unit_with_contact": sum(1 for x in items if x["has_contact"]),
    }


def search_contacts(keyword: str, start_date: str, end_date: str, content_search: bool, limit: int) -> dict:
    key = (keyword.strip(), start_date, end_date, content_search, limit)
    now = time.time()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and now - cached[0] < 300:
            return cached[1]
    rows = _query_rows(*key)
    result = _merge_rows(rows)
    result["truncated"] = len(rows) >= limit
    with _cache_lock:
        _cache[key] = (now, result)
        if len(_cache) > 30:
            oldest = min(_cache, key=lambda k: _cache[k][0])
            _cache.pop(oldest, None)
    return result


def _client_ip() -> str:
    return request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()


def _rate_limited(ip: str) -> bool:
    cutoff = time.time() - 600
    with _login_lock:
        _login_failures[ip] = [t for t in _login_failures[ip] if t >= cutoff]
        return len(_login_failures[ip]) >= 8


def _record_failure(ip: str) -> None:
    with _login_lock:
        _login_failures[ip].append(time.time())


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("authenticated"):
            return redirect(url_for("login", next=request.full_path))
        return view(*args, **kwargs)
    return wrapped


@app.route(PREFIX + "/login", methods=["GET", "POST"])
def login():
    error = ""
    ip = _client_ip()
    token = session.setdefault("csrf", secrets.token_urlsafe(24))
    if request.method == "POST":
        if _rate_limited(ip):
            error = "登录失败次数过多，请 10 分钟后再试。"
        elif not hmac.compare_digest(request.form.get("csrf", ""), token):
            error = "页面已过期，请刷新后重试。"
        else:
            username_ok = hmac.compare_digest(request.form.get("username", ""), os.environ.get("CONTACT_EXPORT_USER", "admin"))
            password_ok = hmac.compare_digest(request.form.get("password", ""), os.environ["CONTACT_EXPORT_PASSWORD"])
            if username_ok and password_ok:
                session.clear()
                session["authenticated"] = True
                session.permanent = True
                return redirect(PREFIX + "/")
            _record_failure(ip)
            error = "用户名或密码错误。"
    return render_template("login.html", prefix=PREFIX, csrf=token, error=error)


@app.route(PREFIX + "/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return redirect(PREFIX + "/login")


@app.route(PREFIX + "/")
@login_required
def index():
    keyword = request.args.get("keyword", "").strip()[:100]
    start_date = _safe_date(request.args.get("start_date", ""))
    end_date = _safe_date(request.args.get("end_date", ""))
    content_search = request.args.get("content_search") == "1"
    limit = _safe_limit(request.args.get("limit", str(DEFAULT_LIMIT)))
    contact_scope = request.args.get("contact_scope", "contacts")
    if contact_scope not in {"contacts", "all"}:
        contact_scope = "contacts"
    result = None
    error = ""
    elapsed_ms = 0
    if keyword:
        started = time.perf_counter()
        try:
            raw_result = search_contacts(keyword, start_date, end_date, content_search, limit)
            result = dict(raw_result)
            result["items"] = list(raw_result["items"])
            if contact_scope == "contacts":
                result["items"] = [item for item in result["items"] if item["has_contact"]]
            result["display_count"] = len(result["items"])
        except Exception as exc:
            app.logger.exception("contact search failed")
            error = f"查询失败：{type(exc).__name__}。请缩小日期范围或取消正文搜索后重试。"
        elapsed_ms = round((time.perf_counter() - started) * 1000)
    return render_template(
        "index.html",
        prefix=PREFIX,
        keyword=keyword,
        start_date=start_date,
        end_date=end_date,
        content_search=content_search,
        contact_scope=contact_scope,
        limit=limit,
        result=result,
        error=error,
        elapsed_ms=elapsed_ms,
    )


def _csv_safe(value: object) -> str:
    text = "；".join(value) if isinstance(value, list) else str(value or "")
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


@app.route(PREFIX + "/export.csv")
@login_required
def export_csv():
    keyword = request.args.get("keyword", "").strip()[:100]
    if not keyword:
        return redirect(PREFIX + "/")
    start_date = _safe_date(request.args.get("start_date", ""))
    end_date = _safe_date(request.args.get("end_date", ""))
    content_search = request.args.get("content_search") == "1"
    limit = _safe_limit(request.args.get("limit", str(DEFAULT_LIMIT)))
    contact_scope = request.args.get("contact_scope", "contacts")
    if contact_scope not in {"contacts", "all"}:
        contact_scope = "contacts"
    result = search_contacts(keyword, start_date, end_date, content_search, limit)
    export_items = result["items"] if contact_scope == "all" else [item for item in result["items"] if item["has_contact"]]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["甲方单位", "联系人", "电话", "邮箱", "地址", "地区", "匹配公告数", "含联系方式公告数", "置信度", "匹配依据", "最新公告日期", "最新公告标题", "公告链接", "提取依据片段"])
    for item in export_items:
        writer.writerow([
            _csv_safe(item["purchaser"]),
            _csv_safe(item["contact_people"]),
            _csv_safe(item["phones"]),
            _csv_safe(item["emails"]),
            _csv_safe(item["addresses"]),
            _csv_safe(item["region"]),
            item["notice_count"],
            item["contact_notice_count"],
            item["confidence"],
            item["match_basis"],
            item["latest_date"],
            _csv_safe(item["latest_title"]),
            _csv_safe(item["latest_url"]),
            _csv_safe(item["evidence"]),
        ])
    filename = f"甲方联系方式_{keyword}_{datetime.now():%Y%m%d_%H%M}.csv"
    body = "\ufeff" + output.getvalue()
    disposition = "attachment; filename*=UTF-8''" + quote(filename)
    return Response(body, content_type="text/csv; charset=utf-8", headers={"Content-Disposition": disposition, "Cache-Control": "no-store"})


@app.route(PREFIX + "/health")
def health():
    return {"ok": True, "service": "biaoxun-contact-center"}


@app.after_request
def security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'")
    return response


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("CONTACT_EXPORT_PORT", "6000")), debug=False, threaded=True)


