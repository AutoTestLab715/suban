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

    print("=== plap type 59 samples ===")
    cur.execute(
        "SELECT title, notice_type, purchase_manner, publish_time FROM plap "
        "WHERE notice_type=%s ORDER BY publish_time DESC LIMIT 8",
        ("59",),
    )
    for r in cur.fetchall():
        print(r)

    print("=== fyc bulletin/notice types with 意向 ===")
    cur.execute("SHOW COLUMNS FROM fyc")
    cols = [r[0] for r in cur.fetchall()]
    print("cols", cols)
    for col in ("bulletin_type", "notice_name", "bid_type_name", "category", "project_type"):
        if col not in cols:
            continue
        cur.execute(
            f"SELECT `{col}`, COUNT(*) c FROM fyc "
            f"WHERE `{col}` LIKE %s OR title LIKE %s "
            f"GROUP BY `{col}` ORDER BY c DESC LIMIT 15",
            ("%意向%", "%采购意向%"),
        )
        rows = cur.fetchall()
        if rows:
            print(col, rows)

    cur.execute(
        "SELECT COUNT(*) FROM fyc WHERE title LIKE %s OR notice_name LIKE %s OR bulletin_type LIKE %s",
        ("%采购意向%", "%意向%", "%意向%"),
    )
    print("fyc intent-ish total", cur.fetchone())

    print("=== china_railway / cnnc quick ===")
    for table in ("china_railway", "cnnc", "cnnc_notices"):
        cur.execute(f"SHOW COLUMNS FROM `{table}`")
        tcols = [r[0] for r in cur.fetchall()]
        title_col = "title" if "title" in tcols else None
        type_col = next((c for c in ("notice_type", "bulletin_type", "category", "type") if c in tcols), None)
        if not title_col:
            print(table, "no title")
            continue
        if type_col:
            cur.execute(
                f"SELECT `{type_col}`, COUNT(*) c FROM `{table}` "
                f"WHERE `{type_col}` LIKE %s OR `{title_col}` LIKE %s "
                f"GROUP BY `{type_col}` ORDER BY c DESC LIMIT 10",
                ("%意向%", "%采购意向%"),
            )
            print(table, cur.fetchall())
        else:
            cur.execute(
                f"SELECT COUNT(*) FROM `{table}` WHERE `{title_col}` LIKE %s",
                ("%采购意向%",),
            )
            print(table, "title-only", cur.fetchone())

    conn.close()


if __name__ == "__main__":
    main()
