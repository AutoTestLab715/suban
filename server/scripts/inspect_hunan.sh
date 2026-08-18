#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun -e "
SHOW TABLES LIKE 'hunan';
SHOW COLUMNS FROM hunan;
SELECT 'total', COUNT(*) FROM hunan;
SELECT notice_type, COUNT(*) c FROM hunan GROUP BY notice_type ORDER BY c DESC LIMIT 30;
SELECT notice_name, COUNT(*) c FROM hunan GROUP BY notice_name ORDER BY c DESC LIMIT 15;
SELECT id, LEFT(title,50), notice_type, notice_name, region, budget FROM hunan ORDER BY notice_time DESC LIMIT 8;
"
