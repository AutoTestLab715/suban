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


for source in ("ccgp", "zfcg", "easy_prt"):
    data = post(
        {
            "categoryGroup": "tender",
            "pageSize": 3,
            "excludePlap": True,
            "source": source,
        }
    )
    rows = data.get("data") or []
    print(f"=== {source} n={len(rows)}")
    for row in rows:
        print(f"  {row.get('publishTime')} | {(row.get('title') or '')[:36]}")

mixed = post({"categoryGroup": "tender", "pageSize": 15, "excludePlap": True})
print("=== mixed")
for row in mixed.get("data") or []:
    print(
        f"  {row.get('sourceCode')} {row.get('publishTime')} | {(row.get('title') or '')[:30]}"
    )
