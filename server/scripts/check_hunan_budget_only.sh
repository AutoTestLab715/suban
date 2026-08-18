#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
MYSQL=(mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun)

echo "=== basic counts ==="
"${MYSQL[@]}" -e "
SELECT 'total', COUNT(*) FROM hunan;
SELECT 'nonempty', COUNT(*) FROM hunan WHERE TRIM(IFNULL(budget,''))<>'';
SELECT 'empty', COUNT(*) FROM hunan WHERE TRIM(IFNULL(budget,''))='';
"

echo "=== format buckets ==="
"${MYSQL[@]}" -e "
SELECT
  CASE
    WHEN TRIM(IFNULL(budget,''))='' THEN 'empty'
    WHEN budget REGEXP '^[0-9]+\\\\.[0-9]{2}元$' THEN 'xx.xx元'
    WHEN budget REGEXP '元$' THEN 'ends_yuan_other'
    WHEN budget REGEXP '万' THEN 'has_wan'
    WHEN budget REGEXP '^[0-9.]+$' THEN 'bare_number'
    ELSE 'other'
  END AS fmt,
  COUNT(*) c
FROM hunan
GROUP BY fmt
ORDER BY c DESC;
"

echo "=== suspicious large (>=5000万 = 5e7 yuan) ==="
"${MYSQL[@]}" -e "
SELECT COUNT(*) FROM hunan
WHERE budget REGEXP '^[0-9.]+元$'
  AND CAST(REPLACE(budget,'元','') AS DECIMAL(20,2)) >= 50000000;
"

echo "=== top large samples ==="
"${MYSQL[@]}" -e "
SELECT budget, notice_type, LEFT(title,48)
FROM hunan
WHERE budget REGEXP '^[0-9.]+元$'
ORDER BY CAST(REPLACE(budget,'元','') AS DECIMAL(20,2)) DESC
LIMIT 15;
"

echo "=== small samples ==="
"${MYSQL[@]}" -e "
SELECT budget, notice_type, LEFT(title,48)
FROM hunan
WHERE budget REGEXP '^[0-9.]+元$'
  AND CAST(REPLACE(budget,'元','') AS DECIMAL(20,2)) > 0
ORDER BY CAST(REPLACE(budget,'元','') AS DECIMAL(20,2)) ASC
LIMIT 10;
"

echo "=== recent nonempty ==="
"${MYSQL[@]}" -e "
SELECT budget, notice_type, LEFT(title,48)
FROM hunan
WHERE TRIM(budget)<>''
ORDER BY notice_time DESC
LIMIT 12;
"

echo "=== empty but content has 预算金额 ==="
"${MYSQL[@]}" -e "
SELECT COUNT(*) FROM hunan
WHERE TRIM(IFNULL(budget,''))='' AND content_text LIKE '%预算金额%';
SELECT COUNT(*) FROM hunan
WHERE TRIM(IFNULL(budget,''))='' AND content_text LIKE '%采购预算%';
"

echo "=== bare leftover / odd ==="
"${MYSQL[@]}" -e "
SELECT budget, COUNT(*) c FROM hunan
WHERE TRIM(budget)<>'' AND budget NOT REGEXP '^[0-9]+\\\\.[0-9]{2}元$'
GROUP BY budget ORDER BY c DESC LIMIT 20;
"

echo "=== by notice_type nonempty rate ==="
"${MYSQL[@]}" -e "
SELECT notice_type,
  COUNT(*) total,
  SUM(TRIM(IFNULL(budget,''))<>'') has_budget,
  ROUND(100*SUM(TRIM(IFNULL(budget,''))<>'')/COUNT(*),1) pct
FROM hunan
GROUP BY notice_type
ORDER BY total DESC;
"
