const crypto = require("crypto");
const http = require("http");

process.env.BIAOXUN_DB_HOST = process.env.BIAOXUN_DB_HOST || process.env.MYSQL_HOST || "127.0.0.1";
process.env.BIAOXUN_DB_PORT = process.env.BIAOXUN_DB_PORT || process.env.MYSQL_PORT || "3306";
process.env.BIAOXUN_DB_USER = process.env.BIAOXUN_DB_USER || process.env.MYSQL_USER || "";
process.env.BIAOXUN_DB_PASSWORD = process.env.BIAOXUN_DB_PASSWORD || process.env.MYSQL_PASSWORD || "";
process.env.BIAOXUN_DB_NAME = process.env.BIAOXUN_DB_NAME || process.env.MYSQL_DATABASE || "biaoxun";
process.env.BIAOXUN_DB_TABLE = process.env.BIAOXUN_DB_TABLE || "notices";
process.env.BIAOXUN_QUERY_TIMEOUT = process.env.BIAOXUN_QUERY_TIMEOUT || "5000";
process.env.BIAOXUN_SAFE_MAX_EXEC_MS = process.env.BIAOXUN_SAFE_MAX_EXEC_MS || "3500";
process.env.BIAOXUN_SAFE_QUERY_TIMEOUT = process.env.BIAOXUN_SAFE_QUERY_TIMEOUT || "4500";
process.env.BIAOXUN_SAFE_REGION_INDEX_MAX = process.env.BIAOXUN_SAFE_REGION_INDEX_MAX || "12";
delete process.env.BIAOXUN_USE_FULLTEXT;

const { listBiaoxun, getBiaoxunDetail, closePool, getPool, formatBiaoxunError } = require("./lib/biaoxun");

const HOST = process.env.BIAOXUN_API_HOST || "127.0.0.1";
const PORT = Math.min(65535, Math.max(1, Number(process.env.BIAOXUN_API_PORT || 5100)));
const API_TOKEN = String(process.env.BIAOXUN_API_TOKEN || "").trim();
const MAX_BODY_BYTES = 128 * 1024;

const json = (response, statusCode, body) => {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(data);
};

const tokenMatches = (provided) => {
  if (!API_TOKEN || !provided) return false;
  const expected = Buffer.from(API_TOKEN);
  const actual = Buffer.from(String(provided));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const readJson = (request) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求数据过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(new Error("请求数据格式错误"));
      }
    });
    request.on("error", reject);
  });

const runWithRequestConnection = async (request, operation) => {
  const resolved = getPool();
  const connection = await resolved.pool.getConnection();
  let settled = false;
  const abortQuery = () => {
    if (!settled) connection.destroy();
  };
  request.once("close", abortQuery);
  const executor = {
    query(query, params) {
      const statement = typeof query === "string" ? { sql: query, timeout: resolved.config.queryTimeout } : query;
      return connection.query(statement, params);
    },
  };
  try {
    return await operation({ executor, config: resolved.config });
  } finally {
    settled = true;
    request.removeListener("close", abortQuery);
    if (!connection.destroyed) connection.release();
  }
};

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { success: true, service: "biaoxun-query-api" });
    return;
  }
  if (request.method !== "POST" || !["/list", "/detail"].includes(request.url)) {
    json(response, 404, { success: false, errMsg: "接口不存在" });
    return;
  }
  if (!tokenMatches(request.headers["x-biaoxun-token"])) {
    json(response, 401, { success: false, errMsg: "未授权" });
    return;
  }

  try {
    const input = await readJson(request);
    const result = await runWithRequestConnection(request, (dependencies) =>
      request.url === "/list" ? listBiaoxun(input, dependencies) : getBiaoxunDetail(input, dependencies)
    );
    json(response, 200, result);
  } catch (error) {
    console.error("biaoxun api error", error);
    json(response, 500, { success: false, errMsg: formatBiaoxunError(error) });
  }
});

server.requestTimeout = 8000;
server.headersTimeout = 9000;
server.keepAliveTimeout = 5000;
server.listen(PORT, HOST, () => {
  console.log(`biaoxun query api listening on http://${HOST}:${PORT}`);
  // Establish the database pool and cache both known schemas before the first
  // cloud-function request arrives. This removes the cold connection penalty.
  Promise.all([
    listBiaoxun({ source: "zfcg", page: 1, pageSize: 1 }),
    listBiaoxun({ source: "gxt", page: 1, pageSize: 1 }),
    listBiaoxun({ source: "zfcg", regions: ["福州市"], categoryGroup: "tender", page: 1, pageSize: 1 }),
  ]).catch((error) => console.error("biaoxun api warmup failed", error));
});

const shutdown = async () => {
  server.close();
  await closePool().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
