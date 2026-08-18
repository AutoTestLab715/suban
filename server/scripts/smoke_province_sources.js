const { listBiaoxun, closePool } = require("../biaoxun-query-api/lib/biaoxun");

(async () => {
  for (const source of ["zhejiang", "sichuan", "hainan", "guizhou", "hubei"]) {
    const result = await listBiaoxun({ source, page: 1, pageSize: 2 });
    const first = Array.isArray(result.data) && result.data[0] ? result.data[0] : null;
    console.log(
      source,
      result.success !== false ? "ok" : "fail",
      Array.isArray(result.data) ? result.data.length : 0,
      first ? String(first.title || "").slice(0, 50) : result.errMsg || ""
    );
  }
  await closePool();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
