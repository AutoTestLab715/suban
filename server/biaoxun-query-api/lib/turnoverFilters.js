/**
 * 换手率：库无独立字段，按标题关键词近似匹配
 * - high: 到期/续签/重新招标等（到期换手倾向）
 * - first: 首次/新签等
 */
const TURNOVER_OPTIONS = [
  { key: "all", label: "不限" },
  {
    key: "high",
    label: "到期换手率高",
    keywords: ["到期", "期满", "届满", "续签", "重新招标", "重新采购", "换届", "服务期满"],
  },
  {
    key: "first",
    label: "首次到期",
    keywords: ["首次", "新签", "新建", "新设立", "第一次"],
  },
];

const normalizeTurnoverFilter = (value) => {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();
  if (!text || text === "all" || text === "不限") return "";
  const hit = TURNOVER_OPTIONS.find((item) => item.key === text || item.label === text);
  return hit && hit.key !== "all" ? hit.key : "";
};

const resolveTurnoverKeywords = (value) => {
  const key = normalizeTurnoverFilter(value);
  if (!key) return [];
  const hit = TURNOVER_OPTIONS.find((item) => item.key === key);
  return hit ? [...(hit.keywords || [])] : [];
};

module.exports = {
  TURNOVER_OPTIONS,
  normalizeTurnoverFilter,
  resolveTurnoverKeywords,
};
