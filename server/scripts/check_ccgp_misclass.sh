#!/bin/bash
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT 'misclassified_tender', COUNT(*)
FROM ccgp
WHERE notice_type IN ('公开招标','公开招标公告','邀请招标','竞争性磋商','竞争性谈判','询价公告','单一来源','更正公告','资格预审','其他公告')
  AND (title REGEXP '结果公示|结果公告|中标公告|成交公告|废标|流标|终止公告');
SQL
