#!/bin/bash
source /etc/biaoxun-query-api.env
echo "=== jiangxi in deployed code ==="
grep -n "jiangxi" /opt/biaoxun-query-api/lib/biaoxun.js | head -20
for cat in tender win intent; do
  echo "=== jiangxi $cat ==="
  curl -sS -X POST http://127.0.0.1:5100/list \
    -H "Content-Type: application/json" \
    -H "x-biaoxun-token: ${BIAOXUN_API_TOKEN}" \
    -d "{\"source\":\"jiangxi\",\"categoryGroup\":\"$cat\",\"page\":1,\"pageSize\":2}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('success', d.get('success'), 'loaded', d.get('loaded')); lst=d.get('data') or []; print('first', (lst[0].get('title') or '')[:50] if lst else None, lst[0].get('category') if lst else None, lst[0].get('sourceCode') if lst else None, lst[0].get('sourceLabel') if lst else None)"
done
