#!/bin/bash
set -euo pipefail
python3 -m py_compile /opt/jiangxi-portal/crawler.py
echo "crawler syntax ok"
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun -e "
SELECT budget, LEFT(title,40) FROM jiangxi WHERE title LIKE '%历市镇卫生院门诊采购电梯%' LIMIT 1;
SELECT budget FROM jiangxi WHERE budget<>'' ORDER BY notice_time DESC LIMIT 8;
SELECT
  SUM(budget REGEXP '\\\\.\\\\d{2}元\$') AS decimal_yuan,
  SUM(budget REGEXP '元\$') AS ends_yuan,
  SUM(budget REGEXP '^[0-9.]+\$') AS bare_num,
  SUM(budget<>'') AS nonempty
FROM jiangxi;
"
systemctl try-reload-or-restart jiangxi-portal.service 2>/dev/null || true
systemctl is-active jiangxi-portal.service 2>/dev/null || echo 'service n/a'
