#!/usr/bin/env python3
import json, time, urllib.request
from pathlib import Path

token = ""
for line in Path("/etc/biaoxun-query-api.env").read_text().splitlines():
    if line.startswith("BIAOXUN_API_TOKEN="):
        token = line.split("=", 1)[1].strip()


def call(payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:5100/list",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "x-biaoxun-token": token},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    return int((time.time() - t0) * 1000), data


ms, d = call({"categoryGroup": "intent", "source": "plap", "page": 1, "pageSize": 5})
rows = d.get("data") or []
print("plap-only intent", ms, "ms", "rows", len(rows), "codes", [r.get("sourceCode") for r in rows])
if rows:
    print("sample", rows[0].get("title"), rows[0].get("category"))

ms, d = call({"categoryGroup": "intent", "source": "", "excludePlap": True, "page": 1, "pageSize": 5})
rows = d.get("data") or []
print("default excludePlap", ms, "ms", "rows", len(rows), "codes", [r.get("sourceCode") for r in rows], "sources", d.get("sources"))

ms, d = call({"categoryGroup": "intent", "source": "", "excludePlap": False, "page": 1, "pageSize": 5})
rows = d.get("data") or []
print("include plap mix", ms, "ms", "rows", len(rows), "codes", [r.get("sourceCode") for r in rows], "sources", d.get("sources"))
