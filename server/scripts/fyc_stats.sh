#!/bin/bash
export MYSQL_PWD=$(/www/server/panel/pyenv/bin/python3 -c 'import sys;sys.path.insert(0,"/www/server/panel/class");import public;print(public.M("config").where("id=?",(1,)).getField("mysql_root"))')
mysql -uroot biaoxun -e "
SELECT bulletin_type, COUNT(*) c FROM fyc GROUP BY bulletin_type ORDER BY c DESC LIMIT 10;
SELECT LEFT(region,30) region, COUNT(*) c FROM fyc GROUP BY LEFT(region,30) ORDER BY c DESC LIMIT 8;
"
