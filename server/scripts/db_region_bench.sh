#!/bin/bash
set -euo pipefail
export MYSQL_PWD=123456

mysql -ubiaoxun biaoxun <<'SQL'
SELECT 'counts' AS section;
SELECT COUNT(*) AS zfcg_total FROM notices WHERE source='zfcg';
SELECT COUNT(DISTINCT region) AS zfcg_regions FROM notices WHERE source='zfcg';

SELECT 'explain_time_index' AS section;
EXPLAIN SELECT id, title, notice_time, region
  FROM notices FORCE INDEX (idx_source_notice_time)
 WHERE source='zfcg' AND region IN ('鼓楼区','台江区','仓山区')
 ORDER BY notice_time DESC LIMIT 11;

SELECT 'explain_auto' AS section;
EXPLAIN SELECT id, title, notice_time, region
  FROM notices
 WHERE source='zfcg' AND region IN ('鼓楼区','台江区','仓山区')
 ORDER BY notice_time DESC LIMIT 11;

SELECT 'bench_time_index_ms' AS section;
SET @t=NOW(6);
SELECT id, title, notice_time, region
  FROM notices FORCE INDEX (idx_source_notice_time)
 WHERE source='zfcg' AND region IN ('鼓楼区','台江区','仓山区','马尾区','晋安区','长乐区')
 ORDER BY notice_time DESC LIMIT 11;
SELECT TIMESTAMPDIFF(MICROSECOND, @t, NOW(6))/1000 AS elapsed_ms;

SELECT 'top_regions' AS section;
SELECT region, COUNT(*) c FROM notices WHERE source='zfcg' GROUP BY region ORDER BY c DESC LIMIT 10;
SQL
