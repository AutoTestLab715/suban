-- 标讯库地区安全查询索引（可重复执行）
-- notices: 纯地区筛选时走 (source, region, notice_time)
-- plap: 纯地区筛选时走 (region, publish_time)

USE biaoxun;

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
  'SELECT ''skip idx_source_region_time'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'plap'
     AND index_name = 'idx_region_publish_time'
);
SET @sql := IF(
  @exists = 0,
  'CREATE INDEX idx_region_publish_time ON plap (region, publish_time DESC)',
  'SELECT ''skip idx_region_publish_time'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SHOW INDEX FROM notices WHERE Key_name IN ('idx_source_region_time', 'idx_source_notice_time', 'idx_region');
SHOW INDEX FROM plap WHERE Key_name IN ('idx_region_publish_time', 'idx_publish_time', 'idx_region');
