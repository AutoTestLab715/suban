#!/bin/bash
set -euo pipefail
source /etc/biaoxun-query-api.env
echo "=== deployed ccgp types ==="
grep -A12 'sourceExactTypes' /opt/biaoxun-query-api/lib/biaoxun.js | grep -A8 ccgp | head -12

echo "=== SQL counts ==="
source /opt/fujian-qwjsy/.env 2>/dev/null || true
DB_USER="${BIAOXUN_DB_USER:-${MYSQL_USER:-root}}"
DB_PASS="${BIAOXUN_DB_PASSWORD:-${MYSQL_PASSWORD:-}}"
DB_NAME="${BIAOXUN_DB_NAME:-${MYSQL_DATABASE:-biaoxun}}"
mysql -N -u"${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" -e "
SELECT 'tender', COUNT(*) FROM ccgp WHERE notice_type IN ('公开招标','公开招标公告','邀请招标','竞争性磋商','竞争性谈判','询价公告','单一来源','更正公告','资格预审','其他公告');
SELECT 'win', COUNT(*) FROM ccgp WHERE notice_type IN ('中标公告','成交公告','终止公告','废标公告');
"

for cat in tender win; do
  echo "=== API $cat ==="
  curl -sS -X POST http://127.0.0.1:5100/list \
    -H "Content-Type: application/json" \
    -H "x-biaoxun-token: ${BIAOXUN_API_TOKEN}" \
    -d "{\"source\":\"ccgp\",\"categoryGroup\":\"$cat\",\"page\":1,\"pageSize\":3}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('success', d.get('success'), 'loaded', d.get('loaded'), 'hasMore', d.get('hasMore')); lst=d.get('data') or []; print('first category', lst[0].get('category') if lst else None); print('first title', (lst[0].get('title') or '')[:70] if lst else None)"
done
