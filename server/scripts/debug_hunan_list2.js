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

const { listBiaoxun, closePool } = require("/opt/biaoxun-query-api/lib/biaoxun");

(async () => {
  for (const g of ["", "tender", "win", "intent"]) {
    const r = await listBiaoxun({
      source: "hunan",
      categoryGroup: g || undefined,
      page: 1,
      pageSize: 2,
    });
    const data = r.data || [];
    console.log(
      "group=",
      g || "(none)",
      "success=",
      r.success,
      "loaded=",
      r.loaded,
      "data=",
      data.length,
      "sourceName=",
      r.sourceName,
      "err=",
      r.errMsg || ""
    );
    for (const item of data.slice(0, 2)) {
      console.log(
        " -",
        item.category,
        String(item.title || "").slice(0, 40),
        item.sourceLabel || item.sourceCode
      );
    }
  }
  await closePool();
})().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => {});
  process.exit(1);
});
