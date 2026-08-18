#!/bin/bash
TOKEN=$(grep BIAOXUN_API_TOKEN /etc/biaoxun-query-api.env | cut -d= -f2)
for s in easy_prt plap zfcg; do
  t=$(curl -sS -o /tmp/o.json -w "%{time_total}" -H "Content-Type: application/json" -H "x-biaoxun-token: $TOKEN" -d "{\"source\":\"$s\",\"categoryGroup\":\"tender\",\"regions\":[\"福州市\"],\"page\":1,\"pageSize\":10}" http://127.0.0.1:5100/list)
  info=$(python3 -c "import json;d=json.load(open('/tmp/o.json'));print(d.get('loaded'),d.get('timedOut'))")
  echo "$s ${t}s $info"
done
