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
    print("=== all notice_type ===")
    cur.execute(
        "SELECT notice_type, COUNT(*) c FROM easy_prt GROUP BY notice_type ORDER BY c DESC"
    )
    for r in cur.fetchall():
        print(r)

    for kw in ("中标", "成交", "合同", "结果", "废标", "终止", "意向"):
        cur.execute(
            "SELECT notice_type, COUNT(*) c FROM easy_prt "
            "WHERE title LIKE %s GROUP BY notice_type ORDER BY c DESC LIMIT 10",
            (f"%{kw}%",),
        )
        rows = cur.fetchall()
        print(f"title~{kw}:", rows)

    print("=== sample titles ===")
    cur.execute(
        "SELECT title, notice_type, notice_time FROM easy_prt "
        "ORDER BY notice_time DESC LIMIT 15"
    )
    for r in cur.fetchall():
        print(r)

    conn.close()


if __name__ == "__main__":
    main()
