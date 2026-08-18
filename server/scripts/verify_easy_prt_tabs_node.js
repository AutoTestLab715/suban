const { listBiaoxun, closePool } = require("/opt/biaoxun-query-api/lib/biaoxun");

(async () => {
  for (const group of ["tender", "win", "intent"]) {
    const result = await listBiaoxun({
      categoryGroup: group,
      pageSize: 5,
      excludePlap: true,
      source: "easy_prt",
    });
    const rows = result.data || [];
    console.log(`=== ${group} success=${result.success} n=${rows.length}`);
    rows.forEach((row) => {
      console.log(`  ${row.category} | ${String(row.title || "").slice(0, 48)}`);
    });
  }
  await closePool().catch(() => {});
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
