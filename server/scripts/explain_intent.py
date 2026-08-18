#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path

import pymysql


def load_env() -> None:
    for p in ("/etc/biaoxun-query-api.env", "/opt/fujian-qwjsy/.env"):
        path = Path(p)
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def main() -> None:
    load_env()
    conn = pymysql.connect(
        host=os.environ.get("BIAOXUN_DB_HOST") or os.environ.get("MYSQL_HOST") or "127.0.0.1",
        user=os.environ.get("BIAOXUN_DB_USER") or os.environ.get("MYSQL_USER"),
        password=os.environ.get("BIAOXUN_DB_PASSWORD") or os.environ.get("MYSQL_PASSWORD"),
        database=os.environ.get("BIAOXUN_DB_NAME") or os.environ.get("MYSQL_DATABASE") or "biaoxun",
        charset="utf8mb4",
    )
    cur = conn.cursor()
    print("INDEXES notices:")
    cur.execute("SHOW INDEX FROM notices")
    for r in cur.fetchall():
        print(r[2], r[4], r[5])

    sql_type = (
        "EXPLAIN SELECT /*+ MAX_EXECUTION_TIME(3500) */ id, title, notice_time "
        "FROM notices FORCE INDEX (idx_source_type_time) "
        "WHERE source=%s AND notice_type IN (%s) "
        "ORDER BY notice_time DESC LIMIT 11"
    )
    sql_time = (
        "EXPLAIN SELECT /*+ MAX_EXECUTION_TIME(3500) */ id, title, notice_time "
        "FROM notices FORCE INDEX (idx_source_notice_time) "
        "WHERE source=%s AND notice_type IN (%s) "
        "ORDER BY notice_time DESC LIMIT 11"
    )
    print("\nEXPLAIN idx_source_type_time:")
    cur.execute(sql_type, ("zfcg", "采购意向公告"))
    for r in cur.fetchall():
        print(r)

    print("\nEXPLAIN idx_source_notice_time:")
    cur.execute(sql_time, ("zfcg", "采购意向公告"))
    for r in cur.fetchall():
        print(r)

    print("\nCOUNT intent:")
    cur.execute(
        "SELECT COUNT(*) FROM notices WHERE source='zfcg' AND notice_type='采购意向公告'"
    )
    print(cur.fetchone())

    import time

    t0 = time.time()
    cur.execute(
        "SELECT id FROM notices FORCE INDEX (idx_source_type_time) "
        "WHERE source=%s AND notice_type IN (%s) ORDER BY notice_time DESC LIMIT 11",
        ("zfcg", "采购意向公告"),
    )
    rows = cur.fetchall()
    print("query type_time ms=", int((time.time() - t0) * 1000), "rows=", len(rows))

    t0 = time.time()
    cur.execute(
        "SELECT id FROM notices FORCE INDEX (idx_source_notice_time) "
        "WHERE source=%s AND notice_type IN (%s) ORDER BY notice_time DESC LIMIT 11",
        ("zfcg", "采购意向公告"),
    )
    rows = cur.fetchall()
    print("query notice_time ms=", int((time.time() - t0) * 1000), "rows=", len(rows))

    # tender types for comparison
    tender_types = (
        "公开招标采购公告",
        "竞争性磋商公告",
        "竞争性谈判公告",
        "采购更正公告",
        "询价公告",
        "单一来源采购公告",
        "单一来源公示",
    )
    placeholders = ",".join(["%s"] * len(tender_types))
    t0 = time.time()
    cur.execute(
        f"SELECT id FROM notices FORCE INDEX (idx_source_type_time) "
        f"WHERE source=%s AND notice_type IN ({placeholders}) "
        f"ORDER BY notice_time DESC LIMIT 11",
        ("zfcg",) + tender_types,
    )
    rows = cur.fetchall()
    print("query tender type_time ms=", int((time.time() - t0) * 1000), "rows=", len(rows))

    t0 = time.time()
    cur.execute(
        f"SELECT id FROM notices FORCE INDEX (idx_source_notice_time) "
        f"WHERE source=%s AND notice_type IN ({placeholders}) "
        f"ORDER BY notice_time DESC LIMIT 11",
        ("zfcg",) + tender_types,
    )
    rows = cur.fetchall()
    print("query tender notice_time ms=", int((time.time() - t0) * 1000), "rows=", len(rows))

    conn.close()


if __name__ == "__main__":
    main()
