const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const envPath = process.env.ENV_FILE || "/opt/fujian-qwjsy/.env";
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    });
}

const config = {
  host: process.env.BIAOXUN_DB_HOST || process.env.MYSQL_HOST,
  user: process.env.BIAOXUN_DB_USER || process.env.MYSQL_USER,
  password: process.env.BIAOXUN_DB_PASSWORD || process.env.MYSQL_PASSWORD,
  database: process.env.BIAOXUN_DB_NAME || process.env.MYSQL_DATABASE || "biaoxun",
};

async function main() {
  const pool = mysql.createPool(config);
  const tables = ["zhejiang", "sichuan", "hainan", "guizhou", "hubei"];
  for (const table of tables) {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [config.database, table]
    );
    console.log(`\n=== ${table} columns ===`);
    console.log(cols.map((c) => c.COLUMN_NAME).join(", "));
    const [types] = await pool.query(
      `SELECT notice_type, COUNT(*) AS cnt FROM \`${table}\`
       GROUP BY notice_type ORDER BY cnt DESC LIMIT 30`
    );
    console.log("notice_type counts:");
    types.forEach((row) => console.log(`  ${row.notice_type || "(null)"}: ${row.cnt}`));
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
