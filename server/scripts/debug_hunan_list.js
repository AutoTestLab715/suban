#!/usr/bin/env node
const fs = require("fs");
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const i = text.indexOf("=");
    const key = text.slice(0, i).trim();
    let val = text.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv("/opt/fujian-qwjsy/.env");
loadEnv("/etc/biaoxun-query-api.env");
process.env.BIAOXUN_DB_HOST = process.env.BIAOXUN_DB_HOST || process.env.MYSQL_HOST || "127.0.0.1";
process.env.BIAOXUN_DB_PORT = process.env.BIAOXUN_DB_PORT || process.env.MYSQL_PORT || "3306";
process.env.BIAOXUN_DB_USER = process.env.BIAOXUN_DB_USER || process.env.MYSQL_USER || "";
process.env.BIAOXUN_DB_PASSWORD = process.env.BIAOXUN_DB_PASSWORD || process.env.MYSQL_PASSWORD || "";
process.env.BIAOXUN_DB_NAME = process.env.BIAOXUN_DB_NAME || process.env.MYSQL_DATABASE || "biaoxun";

const { listBiaoxun, closePool, _test } = require("/opt/biaoxun-query-api/lib/biaoxun");

(async () => {
  const r0 = await listBiaoxun({ source: "hunan", page: 1, pageSize: 3 });
  console.log("no group keys", Object.keys(r0));
  console.log("no group", {
    success: r0.success,
    errMsg: r0.errMsg,
    listLen: (r0.list || r0.notices || []).length,
    sample: (r0.list || r0.notices || [])[0],
  });

  const r1 = await listBiaoxun({ source: "jiangxi", page: 1, pageSize: 1 });
  console.log("jiangxi control", {
    success: r1.success,
    listLen: (r1.list || r1.notices || []).length,
    label: (r1.list || r1.notices || [])[0]?.sourceLabel,
  });

  console.log("normalize", _test.normalizeSourceFilter("hunan"), _test.normalizeCategoryGroup("tender"));
  console.log("sources tender", _test.resolveListSources("hunan", "tender"));
  console.log("hunan tender types", _test.CATEGORY_SOURCE_MAP.tender.includes("hunan"));
  await closePool();
})().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => {});
  process.exit(1);
});
