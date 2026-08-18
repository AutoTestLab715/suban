#!/bin/bash
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SHOW COLUMNS FROM jiangxi LIKE '%budget%';
SHOW COLUMNS FROM jiangxi LIKE '%money%';
SELECT 'sample', budget, successful_money, LEFT(title,40)
FROM jiangxi
WHERE budget IS NOT NULL AND TRIM(budget) <> ''
ORDER BY notice_time DESC LIMIT 15;
SELECT
  CASE
    WHEN budget REGEXP '[万千百元]' THEN 'has_unit'
    WHEN budget REGEXP '^[0-9.,]+$' THEN 'number_only'
    WHEN TRIM(budget)='' OR budget IS NULL THEN 'empty'
    ELSE 'other'
  END AS kind,
  COUNT(*) c
FROM jiangxi
GROUP BY kind
ORDER BY c DESC;
SELECT budget, COUNT(*) c FROM jiangxi
WHERE budget REGEXP '^[0-9.,]+$'
GROUP BY budget ORDER BY c DESC LIMIT 10;
SQL
