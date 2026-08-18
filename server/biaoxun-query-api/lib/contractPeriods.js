/**
 * 合同周期：按标题关键词匹配（库无独立字段）
 */
const CONTRACT_PERIODS = [
  {
    key: "lt1",
    label: "1年以下",
    keywords: ["半年", "6个月", "六个月", "三个月", "3个月", "一年以下", "不满一年", "不足一年"],
  },
  {
    key: "y1",
    label: "1年",
    keywords: ["一年期", "期限一年", "服务期一年", "合同期一年", "为期一年", "期限1年", "服务期1年", "合同期1年", "1年期"],
  },
  {
    key: "y2",
    label: "2年",
    keywords: ["两年", "二年", "2年期", "期限两年", "服务期两年", "合同期两年", "期限2年", "服务期2年"],
  },
  {
    key: "y3",
    label: "3年",
    keywords: ["三年", "3年期", "期限三年", "服务期三年", "合同期三年", "期限3年", "服务期3年"],
  },
  {
    key: "y5",
    label: "5年",
    keywords: ["五年", "5年期", "期限五年", "服务期五年", "合同期五年", "期限5年", "服务期5年"],
  },
  {
    key: "other",
    label: "其他",
    keywords: ["四年", "六年", "七年", "八年", "九年", "十年", "4年", "6年", "7年", "8年", "10年", "长期"],
  },
];

const CONTRACT_PERIOD_OPTIONS = [{ key: "all", label: "不限" }, ...CONTRACT_PERIODS];

const normalizeContractPeriod = (value) => {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();
  if (!text || text === "all" || text === "不限") return "";
  const hit = CONTRACT_PERIODS.find((item) => item.key === text || item.label === text);
  return hit ? hit.key : "";
};

const resolveContractPeriodKeywords = (value) => {
  const key = normalizeContractPeriod(value);
  if (!key) return [];
  const hit = CONTRACT_PERIODS.find((item) => item.key === key);
  return hit ? [...(hit.keywords || [])] : [];
};

module.exports = {
  CONTRACT_PERIODS,
  CONTRACT_PERIOD_OPTIONS,
  normalizeContractPeriod,
  resolveContractPeriodKeywords,
};
