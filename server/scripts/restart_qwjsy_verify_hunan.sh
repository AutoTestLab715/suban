#!/bin/bash
set -euo pipefail
pkill -f 'from app import app; app.run' || true
sleep 1
systemctl restart fujian-qwjsy-web.service
sleep 2
systemctl is-active fujian-qwjsy-web.service
ss -lntp | grep ':5000' || true
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT 'int_yuan', SUM(budget REGEXP '^[0-9]+元$') FROM hunan;
SELECT 'has_dot', SUM(budget LIKE '%.%') FROM hunan;
SELECT 'nonempty', SUM(TRIM(budget)<>'') FROM hunan;
SELECT budget, LEFT(title,36) FROM hunan WHERE budget<>'' ORDER BY notice_time DESC LIMIT 6;
SQL
