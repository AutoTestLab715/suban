#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SHOW COLUMNS FROM guangdong;
SELECT 'total', COUNT(*) FROM guangdong;
SELECT notice_type, COUNT(*) c FROM guangdong GROUP BY notice_type ORDER BY c DESC LIMIT 25;
SELECT notice_name, COUNT(*) c FROM guangdong GROUP BY notice_name ORDER BY c DESC LIMIT 15;
SELECT id, LEFT(title,60), notice_type, notice_name, region FROM guangdong ORDER BY id DESC LIMIT 5;
SQL
