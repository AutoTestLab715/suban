#!/usr/bin/env python3
import json
import sys
sys.path.insert(0, "/opt/fujian-qwjsy")
from fyc_db import connect

with connect() as conn, conn.cursor() as cur:
    cur.execute("SELECT COUNT(*) AS total FROM fyc")
    total = cur.fetchone()["total"]

    cur.execute(
        "SELECT COUNT(*) AS c FROM fyc WHERE budget IS NOT NULL AND TRIM(budget) <> ''"
    )
    has_budget = cur.fetchone()["c"]

    cur.execute(
        "SELECT budget, title, publish_time FROM fyc "
        "WHERE budget IS NOT NULL AND TRIM(budget) <> '' "
        "ORDER BY publish_time DESC LIMIT 10"
    )
    samples = cur.fetchall()

    # scan raw_json for budget-like keys
    budget_keys = {}
    cur.execute(
        "SELECT raw_json FROM fyc WHERE raw_json IS NOT NULL "
        "ORDER BY publish_time DESC LIMIT 500"
    )
    for row in cur.fetchall():
        raw = row["raw_json"]
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                continue
        for part in ("list", "detail"):
            data = raw.get(part) or {}
            if not isinstance(data, dict):
                continue
            for k, v in data.items():
                lk = k.lower()
                if "budget" in lk or "amount" in lk or "price" in lk or "money" in lk:
                    if v not in (None, "", [], {}):
                        budget_keys.setdefault(k, 0)
                        budget_keys[k] += 1

    print(f"total={total}")
    print(f"has_budget={has_budget}")
    print(f"empty_rate={(total-has_budget)/total*100:.2f}%")
    print("samples_with_budget:", samples)
    print("raw_json_budget_like_keys_top:", sorted(budget_keys.items(), key=lambda x: -x[1])[:20])
