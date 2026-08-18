#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
MYSQL=(mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun)

echo "=== counts ==="
"${MYSQL[@]}" -e "
SELECT 'total', COUNT(*) FROM hunan;
SELECT 'budget_nonempty', COUNT(*) FROM hunan WHERE TRIM(budget)<>'';
SELECT 'content_has_预算金额', COUNT(*) FROM hunan WHERE content_text LIKE '%预算金额%';
SELECT 'content_has_预算', COUNT(*) FROM hunan WHERE content_text LIKE '%预算%';
SELECT 'empty_but_预算金额', COUNT(*) FROM hunan WHERE TRIM(IFNULL(budget,''))='' AND content_text LIKE '%预算金额%';
SELECT 'empty_but_采购预算', COUNT(*) FROM hunan WHERE TRIM(IFNULL(budget,''))='' AND content_text LIKE '%采购预算%';
"

echo "=== samples empty budget with 预算金额 ==="
"${MYSQL[@]}" -e "
SELECT
  budget,
  SUBSTRING_INDEX(SUBSTRING_INDEX(content_text, '预算金额', -1), '\n', 1) AS frag,
  LEFT(title, 40)
FROM hunan
WHERE TRIM(IFNULL(budget,''))='' AND content_text LIKE '%预算金额%'
ORDER BY notice_time DESC
LIMIT 20;
"

echo "=== samples nonempty budget vs content ==="
"${MYSQL[@]}" -e "
SELECT
  budget,
  SUBSTRING_INDEX(SUBSTRING_INDEX(content_text, '预算金额', -1), '\n', 1) AS frag,
  LEFT(title, 40)
FROM hunan
WHERE TRIM(IFNULL(budget,''))<>'' AND content_text LIKE '%预算金额%'
ORDER BY notice_time DESC
LIMIT 10;
"

echo "=== other keywords near money ==="
"${MYSQL[@]}" -e "
SELECT '最高限价', COUNT(*) FROM hunan WHERE TRIM(IFNULL(budget,''))='' AND content_text LIKE '%最高限价%';
SELECT '控制价', COUNT(*) FROM hunan WHERE TRIM(IFNULL(budget,''))='' AND content_text LIKE '%控制价%';
SELECT '预算金额（元）', COUNT(*) FROM hunan WHERE content_text LIKE '%预算金额（元）%' OR content_text LIKE '%预算金额(元)%';
"
