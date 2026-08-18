#!/bin/bash
set -a
. /opt/fujian-qwjsy/.env
set +a
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<'SQL'
SELECT notice_type, COUNT(*) cnt FROM notices WHERE source='zfcg'
 AND (
  notice_type LIKE '%征集%' OR notice_type LIKE '%磋商%' OR notice_type LIKE '%更正%'
  OR notice_type LIKE '%招标%' OR notice_type LIKE '%流标%' OR notice_type LIKE '%成交%'
  OR notice_type LIKE '%结果%' OR notice_type LIKE '%合同%' OR notice_type LIKE '%终止%'
  OR notice_type LIKE '%中标%' OR notice_type LIKE '%谈判%'
 )
GROUP BY notice_type ORDER BY cnt DESC;
SELECT COUNT(*) empty_tenderish FROM notices WHERE source='zfcg' AND (notice_type IS NULL OR TRIM(notice_type)='')
 AND title REGEXP '征集公告|磋商公告|更正公告|招标公告|竞争性谈判';
SELECT COUNT(*) empty_winish FROM notices WHERE source='zfcg' AND (notice_type IS NULL OR TRIM(notice_type)='')
 AND title REGEXP '流标|成交公示|成交公告|结果公告|中标公告|终止公告|合同公告';
SQL
