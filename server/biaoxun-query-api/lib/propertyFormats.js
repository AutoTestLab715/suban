/**
 * 物业业态：按标题关键词匹配（库无独立字段）
 */
const PROPERTY_FORMATS = [
  { key: "residential", label: "住宅", keywords: ["住宅", "小区", "商品房", "保障房", "公租房", "安置房"] },
  { key: "gov_office", label: "政府办公楼", keywords: ["政府办公", "机关办公", "行政中心", "政务中心", "办公楼物业"] },
  { key: "school", label: "学校", keywords: ["学校", "大学", "学院", "校园", "幼儿园", "中学", "小学"] },
  { key: "hospital", label: "医院", keywords: ["医院", "卫生院", "医疗中心", "中医院"] },
  { key: "industrial", label: "产业园区", keywords: ["产业园", "工业园", "高新区", "开发区", "园区物业"] },
  { key: "tourism", label: "旅游景区", keywords: ["景区", "旅游", "风景区", "名胜"] },
  { key: "transport", label: "交通枢纽", keywords: ["机场", "高铁站", "火车站", "地铁", "交通枢纽", "客运站"] },
  { key: "commercial_office", label: "商务办公楼", keywords: ["写字楼", "商务楼", "商务办公"] },
  { key: "hotel", label: "酒店", keywords: ["酒店", "宾馆", "旅馆"] },
];

const PROPERTY_FORMAT_OPTIONS = [{ key: "all", label: "不限" }, ...PROPERTY_FORMATS];

const normalizePropertyFormat = (value) => {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();
  if (!text || text === "all" || text === "不限") return "";
  const hit = PROPERTY_FORMATS.find((item) => item.key === text || item.label === text);
  return hit ? hit.key : "";
};

const resolvePropertyFormatKeywords = (value) => {
  const key = normalizePropertyFormat(value);
  if (!key) return [];
  const hit = PROPERTY_FORMATS.find((item) => item.key === key);
  return hit ? [...(hit.keywords || [])] : [];
};

module.exports = {
  PROPERTY_FORMATS,
  PROPERTY_FORMAT_OPTIONS,
  normalizePropertyFormat,
  resolvePropertyFormatKeywords,
};
