#!/usr/bin/env python3
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path


def load_token() -> str:
    for line in Path("/etc/biaoxun-query-api.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("BIAOXUN_API_TOKEN="):
            return line.split("=", 1)[1].strip()
    return ""


def call(token: str, payload: dict) -> tuple[int, dict]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:5100/list",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-biaoxun-token": token,
        },
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    ms = int((time.time() - t0) * 1000)
    return ms, data


def main() -> None:
    token = load_token()
    if not token:
        raise SystemExit("missing token")

    for cat in ["tender", "win", "intent", "policy"]:
        payload = {
            "categoryGroup": cat,
            "source": "",
            "excludePlap": True,
            "page": 1,
            "pageSize": 10,
        }
        ms, data = call(token, payload)
        rows = data.get("data") or []
        print(
            cat,
            "ms=",
            ms,
            "success=",
            data.get("success"),
            "rows=",
            len(rows),
            "timedOut=",
            data.get("timedOut"),
            "source=",
            data.get("source"),
            "sources=",
            data.get("sources"),
        )


if __name__ == "__main__":
    main()
