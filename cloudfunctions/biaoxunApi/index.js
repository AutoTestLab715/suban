const cloud = require("wx-server-sdk");
const {
  listBiaoxun,
  countBiaoxun,
  getBiaoxunDetail,
  fetchBiaoxunAttachment,
  resolveBiaoxunHallImages,
  cleanupBiaoxunAttachment,
  formatBiaoxunError,
} = require("./biaoxun");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ponytail: 直连 MySQL；搜索栏一律安全查询（LIKE + 时间倒序早停）
process.env.BIAOXUN_DB_HOST = String(process.env.BIAOXUN_DB_HOST || "47.99.117.191").trim();
process.env.BIAOXUN_DB_NAME = String(process.env.BIAOXUN_DB_NAME || "biaoxun").trim();
process.env.BIAOXUN_DB_TABLE = String(process.env.BIAOXUN_DB_TABLE || "notices").trim();

exports.main = async (event = {}) => {
  const type = String(event.type || "").trim();
  const data = event.data || {};
  try {
    if (type === "listBiaoxun") return await listBiaoxun(data);
    if (type === "countBiaoxun") return await countBiaoxun(data);
    if (type === "getBiaoxunDetail") return await getBiaoxunDetail(data);
    if (type === "fetchBiaoxunAttachment") return await fetchBiaoxunAttachment(data, { cloud });
    if (type === "resolveBiaoxunHallImages") return await resolveBiaoxunHallImages(data, { cloud });
    if (type === "cleanupBiaoxunAttachment") return await cleanupBiaoxunAttachment(data, { cloud });
    return { success: false, errMsg: "未支持的标讯接口" };
  } catch (error) {
    console.error("biaoxunApi failed", {
      type,
      code: error?.code || "",
      message: error?.message || String(error || ""),
    });
    return {
      success: false,
      code: error?.code || "BIAOXUN_QUERY_FAILED",
      retryable: /timeout|timed out|ECONNRESET|ETIMEDOUT|PROTOCOL_SEQUENCE_TIMEOUT/i.test(
        `${error?.code || ""} ${error?.message || ""}`
      ),
      errMsg: formatBiaoxunError(error),
    };
  }
};
