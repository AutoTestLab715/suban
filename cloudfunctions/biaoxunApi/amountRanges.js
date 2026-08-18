/**
 * 金额区间（单位：万元）
 */
const AMOUNT_RANGES = [
  { key: "all", label: "不限" },
  { key: "lt50", label: "50万以下", minWan: null, maxWan: 50 },
  { key: "50_100", label: "50-100万", minWan: 50, maxWan: 100 },
  { key: "100_200", label: "100-200万", minWan: 100, maxWan: 200 },
  { key: "200_500", label: "200-500万", minWan: 200, maxWan: 500 },
  { key: "gt500", label: "500万以上", minWan: 500, maxWan: null },
];

const normalizeAmountRange = (value) => {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();
  if (!text || text === "all" || text === "不限") return "";
  const hit = AMOUNT_RANGES.find((item) => item.key === text || item.label === text);
  return hit && hit.key !== "all" ? hit.key : "";
};

const resolveAmountRange = (value) => {
  const key = normalizeAmountRange(value);
  if (!key) return null;
  return AMOUNT_RANGES.find((item) => item.key === key) || null;
};

module.exports = {
  AMOUNT_RANGES,
  normalizeAmountRange,
  resolveAmountRange,
};
