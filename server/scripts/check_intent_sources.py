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

    print("=== notices zfcg intent ===")
    cur.execute(
        "SELECT COUNT(*) FROM notices WHERE source=%s AND notice_type=%s",
        ("zfcg", "采购意向公告"),
    )
    print("count", cur.fetchone())
    cur.execute(
        "SELECT notice_type, COUNT(*) c FROM notices "
        "WHERE source=%s AND (notice_type LIKE %s OR title LIKE %s) "
        "GROUP BY notice_type ORDER BY c DESC LIMIT 20",
        ("zfcg", "%意向%", "%采购意向%"),
    )
    for r in cur.fetchall():
        print(r)

    print("=== easy_prt intent-like ===")
    cur.execute(
        "SELECT notice_type, COUNT(*) c FROM easy_prt "
        "WHERE notice_type LIKE %s OR title LIKE %s "
        "GROUP BY notice_type ORDER BY c DESC LIMIT 20",
        ("%意向%", "%采购意向%"),
    )
    for r in cur.fetchall():
        print(r)
    cur.execute(
        "SELECT COUNT(*) FROM easy_prt WHERE notice_type LIKE %s OR title LIKE %s",
        ("%意向%", "%采购意向%"),
    )
    print("easy_prt total", cur.fetchone())

    print("=== plap intent-like ===")
    cur.execute(
        "SELECT notice_type, purchase_manner, COUNT(*) c FROM plap "
        "WHERE notice_type LIKE %s OR title LIKE %s OR title LIKE %s "
        "GROUP BY notice_type, purchase_manner ORDER BY c DESC LIMIT 20",
        ("%意向%", "%采购意向%", "%意向%"),
    )
    for r in cur.fetchall():
        print(r)
    cur.execute(
        "SELECT COUNT(*) FROM plap WHERE title LIKE %s OR notice_type LIKE %s",
        ("%采购意向%", "%意向%"),
    )
    print("plap total", cur.fetchone())

    print("=== plap notice_type top ===")
    cur.execute(
        "SELECT notice_type, COUNT(*) c FROM plap GROUP BY notice_type ORDER BY c DESC LIMIT 30"
    )
    for r in cur.fetchall():
        print(r)

    print("=== easy_prt notice_type top ===")
    cur.execute(
        "SELECT notice_type, COUNT(*) c FROM easy_prt GROUP BY notice_type ORDER BY c DESC LIMIT 30"
    )
    for r in cur.fetchall():
        print(r)

    print("=== tables ===")
    cur.execute("SHOW TABLES")
    print([r[0] for r in cur.fetchall()])

    conn.close()


if __name__ == "__main__":
    main()
