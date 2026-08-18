#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun -e "
SELECT 'total', COUNT(*) FROM jiangxi;
SELECT 'nonempty', COUNT(*) FROM jiangxi WHERE TRIM(IFNULL(budget,''))<>'';
SELECT
  CASE
    WHEN TRIM(IFNULL(budget,''))='' THEN 'empty'
    WHEN budget REGEXP '^[0-9]+元$' THEN 'int_yuan'
    WHEN budget REGEXP '^[0-9]+\\.[0-9]+元$' THEN 'decimal_yuan'
    WHEN budget REGEXP '^[0-9.]+$' THEN 'bare_num'
    ELSE 'other'
  END AS fmt, COUNT(*) c
FROM jiangxi GROUP BY fmt ORDER BY c DESC;
SELECT budget, LEFT(title,40) FROM jiangxi WHERE budget<>'' ORDER BY notice_time DESC LIMIT 8;
"
