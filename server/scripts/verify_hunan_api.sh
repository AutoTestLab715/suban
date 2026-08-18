#!/bin/bash
set -euo pipefail
TOKEN="$(grep -E '^BIAOXUN_API_TOKEN=' /etc/biaoxun-query-api.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")"
for cat in tender win intent; do
  echo "=== hunan $cat ==="
  resp="$(curl -sS -m 20 -X POST "http://127.0.0.1:5100/list" \
    -H "Content-Type: application/json" \
    -H "x-biaoxun-token: ${TOKEN}" \
    -d "{\"source\":\"hunan\",\"categoryGroup\":\"${cat}\",\"page\":1,\"pageSize\":2}")"
  python3 -c '
import json,sys
d=json.loads(sys.argv[1])
print("ok", d.get("success"), "total", d.get("total"), "err", d.get("errMsg"))
for i in (d.get("list") or [])[:2]:
    print("-", i.get("category"), (i.get("title") or "")[:40], i.get("sourceLabel"))
' "$resp"
done
