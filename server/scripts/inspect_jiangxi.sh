#!/bin/bash
set -u
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SHOW COLUMNS FROM jiangxi;
SELECT 'total', COUNT(*) FROM jiangxi;
SELECT notice_type, COUNT(*) c FROM jiangxi GROUP BY notice_type ORDER BY c DESC LIMIT 30;
SELECT notice_name, COUNT(*) c FROM jiangxi GROUP BY notice_name ORDER BY c DESC LIMIT 15;
SELECT id, LEFT(title,50), notice_type, notice_name, region, notice_time FROM jiangxi ORDER BY notice_time DESC LIMIT 5;
SQL
