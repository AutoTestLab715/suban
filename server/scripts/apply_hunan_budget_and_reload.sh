#!/bin/bash
set -euo pipefail
/opt/fujian-qwjsy/.venv/bin/python /tmp/backfill_hunan_budget_int.py --apply

echo "=== verify crawler helpers ==="
grep -n "normalize_hunan_budget" /opt/fujian-qwjsy/hunan_crawler.py | head -5

echo "=== restart web :5000 ==="
pkill -f "from app import app; app.run" || true
sleep 1
cd /opt/fujian-qwjsy
nohup .venv/bin/python -c 'from app import app; app.run(host="0.0.0.0", port=5000, debug=False)' \
  >/opt/fujian-qwjsy/output/web_5000.log 2>&1 &
sleep 2
ss -lntp | grep ':5000' || (echo 'port 5000 not up'; tail -30 /opt/fujian-qwjsy/output/web_5000.log; exit 1)

source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun -e "
SELECT 'int_yuan', SUM(budget REGEXP '^[0-9]+元$') FROM hunan;
SELECT 'has_dot', SUM(budget LIKE '%.%') FROM hunan;
SELECT 'nonempty', SUM(TRIM(budget)<>'') FROM hunan;
SELECT budget, LEFT(title,40) FROM hunan WHERE budget<>'' ORDER BY notice_time DESC LIMIT 8;
"
