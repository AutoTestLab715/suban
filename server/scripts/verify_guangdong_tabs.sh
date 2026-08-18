#!/bin/bash
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT 'tender', COUNT(*) FROM guangdong WHERE notice_type IN (
  '公开招标采购公告','公开招标公告','竞争性磋商公告','竞争性谈判公告','询价公告',
  '单一来源公示','单一来源采购公告','采购更正公告','更正公告','采购需求'
);
SELECT 'win', COUNT(*) FROM guangdong WHERE notice_type IN (
  '公开招标中标公告','中标公告','竞争性磋商成交公告','竞争性谈判成交公告','询价成交公告',
  '成交公告','成交公示','结果公告','结果更正公告','合同公示','合同公告',
  '废标公告','流标公告','终止公告','验收结果公告','单一来源成交公告'
);
SELECT 'intent', COUNT(*) FROM guangdong WHERE notice_type IN ('采购意向公告');
SQL
