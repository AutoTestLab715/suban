#!/bin/bash
set -euo pipefail
export MYSQL_PWD=123456

mysql -ubiaoxun biaoxun <<'SQL'
SET @exists := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'plap' AND index_name = 'idx_region_publish_time'
);
SET @sql := IF(
  @exists = 0,
  'CREATE INDEX idx_region_publish_time ON plap (region, publish_time DESC)',
  'SELECT ''idx_region_publish_time exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

EXPLAIN SELECT id, title, publish_time, region
  FROM plap FORCE INDEX (idx_publish_time)
 WHERE region IN ('福建省','北京市')
 ORDER BY publish_time DESC LIMIT 11;

EXPLAIN SELECT id, title, publish_time, region
  FROM plap FORCE INDEX (idx_region_publish_time)
 WHERE region IN ('福建省','北京市')
 ORDER BY publish_time DESC LIMIT 11;

SET @t=NOW(6);
SELECT id, title, publish_time, region
  FROM plap FORCE INDEX (idx_region_publish_time)
 WHERE region='福建省'
 ORDER BY publish_time DESC LIMIT 11;
SELECT TIMESTAMPDIFF(MICROSECOND, @t, NOW(6))/1000 AS region_index_ms;
SQL
