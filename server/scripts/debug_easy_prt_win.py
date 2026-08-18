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
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


payload = {
    "categoryGroup": "win",
    "pageSize": 10,
    "excludePlap": True,
    "source": "easy_prt",
}
data = post(payload)
print(json.dumps({k: data.get(k) for k in data if k != "data"}, ensure_ascii=False, indent=2))
rows = data.get("data") or []
print("rows", len(rows))
for row in rows:
    print(row.get("category"), row.get("publishTime"), (row.get("title") or "")[:50])
