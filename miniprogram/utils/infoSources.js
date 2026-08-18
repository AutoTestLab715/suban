const INFO_SOURCE_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "plap", label: "军队采购网" },
  { key: "ccgp", label: "中国政府采购网" },
  { key: "zfcg", label: "福建政府采购网" },
  { key: "quanzhou", label: "泉州市产权交易中心" },
  { key: "guangdong", label: "广东省政府采购网" },
  { key: "jiangxi", label: "江西政府采购网" },
  { key: "hunan", label: "湖南政府采购网" },
  { key: "shanghai", label: "上海市政府采购网" },
  { key: "jiangsu", label: "江苏省政府采购网" },
  { key: "anhui", label: "安徽省政府采购网" },
  { key: "zhejiang", label: "浙江省政府采购网" },
  { key: "sichuan", label: "四川省政府采购网" },
  { key: "hainan", label: "海南省政府采购网" },
  { key: "guizhou", label: "贵州省政府采购网" },
  { key: "hubei", label: "湖北省政府采购网" },
  { key: "gxt", label: "工信厅" },
  { key: "kjt", label: "科技厅" },
  { key: "easy_prt", label: "第三方" },
];

const SOURCE_LABEL_MAP = Object.fromEntries(
  INFO_SOURCE_OPTIONS.filter((item) => item.key !== "all").map((item) => [item.key, item.label])
);

const VALID_SOURCE_KEYS = new Set(INFO_SOURCE_OPTIONS.map((item) => item.key));

/** 地区筛选仅展示省级、不可下钻福建地市的信息源 */
const FLAT_REGION_SOURCES = new Set([
  "plap",
  "easy_prt",
  "ccgp",
  "guangdong",
  "jiangxi",
  "hunan",
  "shanghai",
  "jiangsu",
  "anhui",
  "zhejiang",
  "sichuan",
  "hainan",
  "guizhou",
  "hubei",
]);

/** 政采门户类来源（列表/详情统一展示门户名称） */
const PROCUREMENT_PORTAL_SOURCES = new Set([
  "zfcg",
  "ccgp",
  "guangdong",
  "jiangxi",
  "hunan",
  "shanghai",
  "jiangsu",
  "anhui",
  "zhejiang",
  "sichuan",
  "hainan",
  "guizhou",
  "hubei",
]);

/** 独立门户类来源（产权交易等） */
const PORTAL_NOTICE_SOURCES = new Set([...PROCUREMENT_PORTAL_SOURCES, "quanzhou", "quanzhou_hall"]);

const isValidInfoSourceKey = (key) => VALID_SOURCE_KEYS.has(String(key || "").trim());

const getSourceLabel = (key, fallback = "标讯") => {
  const normalized = String(key || "").trim();
  if (!normalized || normalized === "all") return fallback;
  if (normalized === "quanzhou_hall") return SOURCE_LABEL_MAP.quanzhou || fallback;
  return SOURCE_LABEL_MAP[normalized] || fallback;
};

const isFlatRegionSource = (source) => {
  const key = String(source || "").trim();
  return !!key && key !== "all" && FLAT_REGION_SOURCES.has(key);
};

const isProcurementPortalSource = (source) =>
  PROCUREMENT_PORTAL_SOURCES.has(String(source || "").trim().toLowerCase());

const resolveNoticeSourceLabel = (sourceCode, item = {}) => {
  const code = String(sourceCode || "").trim().toLowerCase();
  if (code === "easy_prt") return "第三方";
  if (PORTAL_NOTICE_SOURCES.has(code)) return getSourceLabel(code);
  return item.sourceLabel || getSourceLabel(code) || "标讯";
};

module.exports = {
  INFO_SOURCE_OPTIONS,
  SOURCE_LABEL_MAP,
  FLAT_REGION_SOURCES,
  PROCUREMENT_PORTAL_SOURCES,
  PORTAL_NOTICE_SOURCES,
  isValidInfoSourceKey,
  getSourceLabel,
  isFlatRegionSource,
  isProcurementPortalSource,
  resolveNoticeSourceLabel,
};
