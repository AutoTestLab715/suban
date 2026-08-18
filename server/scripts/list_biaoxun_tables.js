process.chdir("/opt/biaoxun-query-api");
require("fs").readFileSync("/opt/fujian-qwjsy/.env", "utf8")
  .split("\n")
  .forEach((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
process.env.BIAOXUN_DB_HOST = process.env.MYSQL_HOST || "127.0.0.1";
process.env.BIAOXUN_DB_PORT = process.env.MYSQL_PORT || "3306";
process.env.BIAOXUN_DB_USER = process.env.MYSQL_USER || "";
process.env.BIAOXUN_DB_PASSWORD = process.env.MYSQL_PASSWORD || "";
process.env.BIAOXUN_DB_NAME = process.env.MYSQL_DATABASE || "biaoxun";

const { getPool, closePool } = require("./lib/biaoxun");

(async () => {
  const { pool } = getPool();
  const [tables] = await pool.query("SHOW TABLES");
  const [counts] = await pool.query(
    `SELECT TABLE_NAME, TABLE_ROWS
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
    [process.env.BIAOXUN_DB_NAME]
  );
  const countMap = Object.fromEntries(counts.map((row) => [row.TABLE_NAME, row.TABLE_ROWS]));
  tables.forEach((row) => {
    const name = Object.values(row)[0];
    console.log(`${name}\t${countMap[name] ?? "?"}`);
  });
  await closePool();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
