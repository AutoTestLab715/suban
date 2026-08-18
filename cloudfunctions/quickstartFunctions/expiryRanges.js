/**
 * 到期时间（投标/递交截止日）区间
 */
const EXPIRY_RANGES = [
  { key: "all", label: "不限" },
  { key: "this_month", label: "本月到期" },
  { key: "m1_3", label: "1-3个月到期" },
  { key: "m3_6", label: "3-6个月到期" },
  { key: "m6_12", label: "6-12个月到期" },
  { key: "after_12", label: "12个月后到期" },
  { key: "custom", label: "自定义到期时间", wide: true },
];

const pad2 = (n) => String(n).padStart(2, "0");

const formatDateValue = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const addMonths = (date, months) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
};

const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);

const normalizeExpiryRange = (value) => {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();
  if (!text || text === "all" || text === "不限") return "";
  const hit = EXPIRY_RANGES.find((item) => item.key === text || item.label === text);
  return hit && hit.key !== "all" ? hit.key : "";
};

/**
 * @returns {{ startDate?: string, endDate?: string } | null}
 */
const resolveExpiryRange = (value, { customStart = "", customEnd = "", now = new Date() } = {}) => {
  const key = normalizeExpiryRange(value);
  if (!key) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthEnd = endOfMonth(today);

  if (key === "this_month") {
    return { startDate: formatDateValue(today), endDate: formatDateValue(monthEnd) };
  }
  if (key === "m1_3") {
    const start = new Date(monthEnd);
    start.setDate(start.getDate() + 1);
    return { startDate: formatDateValue(start), endDate: formatDateValue(addMonths(today, 3)) };
  }
  if (key === "m3_6") {
    const start = addMonths(today, 3);
    start.setDate(start.getDate() + 1);
    return { startDate: formatDateValue(start), endDate: formatDateValue(addMonths(today, 6)) };
  }
  if (key === "m6_12") {
    const start = addMonths(today, 6);
    start.setDate(start.getDate() + 1);
    return { startDate: formatDateValue(start), endDate: formatDateValue(addMonths(today, 12)) };
  }
  if (key === "after_12") {
    const start = addMonths(today, 12);
    start.setDate(start.getDate() + 1);
    return { startDate: formatDateValue(start) };
  }
  if (key === "custom") {
    const startDate = String(customStart || "").trim();
    const endDate = String(customEnd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return null;
    }
    return {
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : undefined,
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : undefined,
    };
  }
  return null;
};

module.exports = {
  EXPIRY_RANGES,
  normalizeExpiryRange,
  resolveExpiryRange,
};
