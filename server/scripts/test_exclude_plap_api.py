#!/usr/bin/env python3
from __future__ import annotations

import json
import urllib.request
from pathlib import Path


def load_token() -> str:
    env_path = Path("/etc/biaoxun-query-api.env")
    token = ""
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == "BIAOXUN_API_TOKEN":
                token = v.strip()
                break
    return token


def main() -> None:
    token = load_token()
    if not token:
        raise SystemExit("missing BIAOXUN_API_TOKEN")

    payload = {
        "categoryGroup": "tender",
        "source": "",
        "excludePlap": True,
        "regions": [],
        "region": "",
        "page": 1,
        "pageSize": 10,
    }
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
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    arr = data.get("data") or []
    codes = [x.get("sourceCode") for x in arr if isinstance(x, dict)]
    has_plap = any(c == "plap" for c in codes)
    distinct = sorted({c for c in codes if c})
    print("success=", data.get("success"))
    print("has_plap=", has_plap)
    print("distinct_sourceCodes=", distinct)
    print("first_sourceCodes=", codes[:20])


if __name__ == "__main__":
    main()

