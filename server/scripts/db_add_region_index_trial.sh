#!/bin/bash
set -euo pipefail
export MYSQL_PWD=123456

mysql -ubiaoxun biaoxun <<'SQL'
SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'notices'
     AND index_name = 'idx_source_region_time'
);
SET @sql := IF(
  @exists = 0,
  'CREATE INDEX idx_source_region_time ON notices (source, region, notice_time DESC)',
  'SELECT ''idx_source_region_time exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'explain_region_index' AS section;
EXPLAIN SELECT id, title, notice_time, region
  FROM notices FORCE INDEX (idx_source_region_time)
 WHERE source='zfcg' AND region IN ('鼓楼区','台江区','仓山区')
 ORDER BY notice_time DESC LIMIT 11;

EXPLAIN SELECT id, title, notice_time, region
  FROM notices FORCE INDEX (idx_source_region_time)
 WHERE source='zfcg' AND region='晋安区'
 ORDER BY notice_time DESC LIMIT 11;

SET @t=NOW(6);
SELECT id, title, notice_time, region
  FROM notices FORCE INDEX (idx_source_region_time)
 WHERE source='zfcg' AND region='晋安区'
 ORDER BY notice_time DESC LIMIT 11;
SELECT TIMESTAMPDIFF(MICROSECOND, @t, NOW(6))/1000 AS single_region_ms;

SET @t=NOW(6);
SELECT id, title, notice_time, region
  FROM notices FORCE INDEX (idx_source_notice_time)
 WHERE source='zfcg' AND region='晋安区'
 ORDER BY notice_time DESC LIMIT 11;
SELECT TIMESTAMPDIFF(MICROSECOND, @t, NOW(6))/1000 AS time_index_ms;
SQL
