#!/usr/bin/env python3
import json
import sys
sys.path.insert(0, "/opt/fujian-qwjsy")
from fyc_db import connect

with connect() as conn, conn.cursor() as cur:
    cur.execute(
        """
        SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fyc'
        ORDER BY ORDINAL_POSITION
        """
    )
    print("=== fyc columns ===")
    for row in cur.fetchall():
        print(f"{row['COLUMN_NAME']}\t{row['COLUMN_TYPE']}\t{row['COLUMN_COMMENT'] or ''}")

    cur.execute(
        """
        SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notices'
        ORDER BY ORDINAL_POSITION
        """
    )
    print("\n=== notices columns ===")
    for row in cur.fetchall():
        print(f"{row['COLUMN_NAME']}\t{row['COLUMN_TYPE']}\t{row['COLUMN_COMMENT'] or ''}")

    cur.execute(
        "SELECT id, title, publish_time, category, bulletin_type, notice_name, "
        "bid_code, bid_name, purchaser, agency, region, budget, "
        "LEFT(content_text, 80) AS snippet, attchs, raw_json "
        "FROM fyc WHERE content_html IS NOT NULL AND content_html <> '' LIMIT 1"
    )
    sample = cur.fetchone()
    if sample:
        print("\n=== sample row keys ===")
        for k, v in sample.items():
            if k == "raw_json" and v:
                try:
                    raw = json.loads(v) if isinstance(v, str) else v
                    list_keys = list((raw.get("list") or {}).keys())[:20]
                    detail_keys = list((raw.get("detail") or {}).keys())[:20]
                    print(f"raw_json.list keys: {list_keys}")
                    print(f"raw_json.detail keys: {detail_keys}")
                except Exception:
                    print("raw_json: (parse failed)")
            elif k == "attchs":
                print(f"attchs: {v}")
            else:
                print(f"{k}: {str(v)[:120]}")
