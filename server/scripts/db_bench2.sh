#!/bin/bash
set -euo pipefail
TOKEN=$(grep BIAOXUN_API_TOKEN /etc/biaoxun-query-api.env | cut -d= -f2)
bench() {
  local label="$1" body="$2"
  curl -sS -o /tmp/o.json -w "%{time_total}" -H "Content-Type: application/json" -H "x-biaoxun-token: $TOKEN" -d "$body" http://127.0.0.1:5100/list > /tmp/t.txt
  echo "$label $(cat /tmp/t.txt)s $(python3 -c "import json;d=json.load(open('/tmp/o.json'));print(d.get('loaded'),d.get('timedOut'),d.get('sources',d.get('source')))")"
}
bench "tender_fuzhou" '{"categoryGroup":"tender","regions":["福州市"],"page":1,"pageSize":10}'
bench "tender_jinan" '{"categoryGroup":"tender","regions":["晋安区"],"page":1,"pageSize":10}'
bench "zfcg_fuzhou" '{"source":"zfcg","categoryGroup":"tender","regions":["福州市"],"page":1,"pageSize":10}'
