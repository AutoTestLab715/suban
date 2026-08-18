#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun -e "
SHOW COLUMNS FROM hunan LIKE 'budget';
SHOW COLUMNS FROM hunan LIKE 'successful_money';
SELECT 'nonempty_budget', COUNT(*) FROM hunan WHERE budget<>'';
SELECT 'empty_budget', COUNT(*) FROM hunan WHERE budget='';
SELECT budget, LEFT(title,40) FROM hunan WHERE budget<>'' ORDER BY notice_time DESC LIMIT 8;
"
