#!/usr/bin/env python3
import json
import os
import urllib.request

URL = "http://127.0.0.1:5100/list"
TOKEN = os.environ.get("BIAOXUN_API_TOKEN", "").strip()


def post(payload):
    req = urllib.request.Request(
        URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-biaoxun-token": TOKEN,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        return json.load(resp)


for group in ("tender", "win", "intent"):
    data = post(
        {
            "categoryGroup": group,
            "pageSize": 5,
            "excludePlap": True,
            "source": "ccgp",
        }
    )
    rows = data.get("data") or []
    print(f"=== {group} success={data.get('success')} n={len(rows)} total={data.get('total')}")
    for row in rows[:5]:
        print(
            f"  {row.get('sourceCode')} | {row.get('category')} | {(row.get('title') or '')[:42]}"
        )

# mixed tender should include ccgp
mixed = post({"categoryGroup": "tender", "pageSize": 12, "excludePlap": True})
codes = {}
for row in mixed.get("data") or []:
    codes[row.get("sourceCode")] = codes.get(row.get("sourceCode"), 0) + 1
print("=== mixed tender sources", codes)
