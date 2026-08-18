#!/usr/bin/env python3
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path


def token() -> str:
    for line in Path("/etc/biaoxun-query-api.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("BIAOXUN_API_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no token")


def call(tok: str, payload: dict) -> tuple[int, dict]:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:5100/list",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "x-biaoxun-token": tok},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    return int((time.time() - t0) * 1000), data


def main() -> None:
    tok = token()
    cases = [
        ("intent/zfcg", {"categoryGroup": "intent", "source": "zfcg"}),
        ("tender/zfcg", {"categoryGroup": "tender", "source": "zfcg"}),
        ("tender/easy_prt", {"categoryGroup": "tender", "source": "easy_prt"}),
        ("tender/multi", {"categoryGroup": "tender", "source": "", "excludePlap": True}),
        ("win/zfcg", {"categoryGroup": "win", "source": "zfcg"}),
    ]
    for name, payload in cases:
        payload = {**payload, "page": 1, "pageSize": 10}
        ms, data = call(tok, payload)
        print(
            name,
            "ms=",
            ms,
            "rows=",
            len(data.get("data") or []),
            "timedOut=",
            data.get("timedOut"),
            "hint=",
            data.get("searchHint") or "",
        )


if __name__ == "__main__":
    main()
