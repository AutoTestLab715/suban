#!/bin/bash
set -euo pipefail
export MYSQL_PWD=123456
TOKEN=$(grep BIAOXUN_API_TOKEN /etc/biaoxun-query-api.env | cut -d= -f2)

bench_api() {
  local label="$1"
  local body="$2"
  local t
  t=$(date +%s%3N)
  curl -sS -o /tmp/bench_out.json -w "%{time_total}" \
    -H "Content-Type: application/json" \
    -H "x-biaoxun-token: $TOKEN" \
    -d "$body" \
    http://127.0.0.1:5100/list > /tmp/bench_time.txt
  local ms
  ms=$(cat /tmp/bench_time.txt)
  local loaded
  loaded=$(python3 -c "import json;d=json.load(open('/tmp/bench_out.json'));print(d.get('loaded',0), d.get('timedOut',False), d.get('searchHint','')[:40])")
  echo "$label | curl_s=${ms}s | $loaded"
}

bench_sql() {
  local label="$1"
  local sql="$2"
  mysql -ubiaoxun biaoxun -N -e "SET @t=NOW(6); $sql; SELECT TIMESTAMPDIFF(MICROSECOND,@t,NOW(6))/1000 AS ms;"
}

echo "=== API benches (local) ==="
bench_api "zfcg_list" '{"source":"zfcg","categoryGroup":"tender","page":1,"pageSize":10}'
bench_api "zfcg_region_jinan" '{"source":"zfcg","categoryGroup":"tender","regions":["晋安区"],"page":1,"pageSize":10}'
bench_api "zfcg_region_fuzhou" '{"source":"zfcg","categoryGroup":"tender","regions":["福州市"],"page":1,"pageSize":10}'
bench_api "zfcg_region_fujian" '{"source":"zfcg","categoryGroup":"tender","regions":["福建省"],"page":1,"pageSize":10}'
bench_api "all_tender" '{"categoryGroup":"tender","page":1,"pageSize":10}'
bench_api "all_tender_fujian" '{"categoryGroup":"tender","regions":["福建省"],"page":1,"pageSize":10}'
bench_api "keyword" '{"source":"zfcg","keyword":"物业","categoryGroup":"tender","page":1,"pageSize":10}'

echo "=== SQL benches ==="
bench_sql "region_jinan_idx" "SELECT id,title,notice_time,region FROM notices FORCE INDEX (idx_source_region_time) WHERE source='zfcg' AND region='晋安区' ORDER BY notice_time DESC LIMIT 11"
bench_sql "region_fujian_time" "SELECT id,title,notice_time,region FROM notices FORCE INDEX (idx_source_notice_time) WHERE source='zfcg' AND region IN ('福建省本级','福州市本级','鼓楼区') ORDER BY notice_time DESC LIMIT 11"
bench_sql "tender_types" "SELECT id,title,notice_time FROM notices FORCE INDEX (idx_source_notice_time) WHERE source='zfcg' AND notice_type IN ('001011','001016','001025','001026','001029') ORDER BY notice_time DESC LIMIT 11"

echo "=== processlist ==="
mysql -ubiaoxun -N -e "SHOW PROCESSLIST" 2>/dev/null | head -8
