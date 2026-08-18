#!/bin/bash
/www/server/panel/pyenv/bin/python3 <<'PY'
import sys
sys.path.insert(0, "/www/server/panel/class")
import public
print(public.M("config").where("id=?", (1,)).getField("mysql_root"))
PY
