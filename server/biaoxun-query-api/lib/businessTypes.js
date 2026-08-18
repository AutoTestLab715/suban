/**
 * 标讯业务类型：按标题关键词匹配（库无独立业态字段）
 * 竞价大厅标的类型：与详情「标的类型」取值一致，匹配 content_text / content_html
 */
const BUSINESS_TYPES = [
  { key: "wuye", label: "物业管理", keywords: ["物业"] },
  { key: "baoan", label: "保安服务", keywords: ["保安", "安保"] },
  { key: "baojie", label: "保洁服务", keywords: ["保洁", "清洁"] },
  { key: "lvhua", label: "绿化养护", keywords: ["绿化", "养护"] },
  { key: "yunwei", label: "运营维护", keywords: ["运维", "运营维护", "维护服务"] },
  { key: "shitang", label: "食堂承包", keywords: ["食堂"] },
  { key: "shicai", label: "食材配送", keywords: ["食材", "配餐"] },
  { key: "huanwei", label: "环卫服务", keywords: ["环卫"] },
  { key: "laowu", label: "劳务派遣", keywords: ["劳务", "派遣"] },
  { key: "bucao", label: "布草洗涤", keywords: ["布草", "洗涤"] },
  { key: "xiaosha", label: "消杀服务", keywords: ["消杀", "消杀服务"] },
  { key: "sheshi", label: "设施维护", keywords: ["设施维护", "设施运维"] },
];

const buildHallAssetType = (key, label) => ({
  key,
  label,
  keywords: [`标的类型 ${label}`, `标的类型</th><td>${label}</td>`],
});

/** 与详情正文「标的类型」字段取值一致 */
const HALL_ASSET_TYPES = [
  buildHallAssetType("fangwu", "房屋"),
  buildHallAssetType("nongcun_jiti", "农村集体经营性资产"),
  buildHallAssetType("jidongche", "机动车"),
  buildHallAssetType("shiwu_fangchan", "实物房产"),
  buildHallAssetType("huowu_fuwu", "货物和服务采购"),
  buildHallAssetType("huwai_guanggao", "户外广告"),
  buildHallAssetType("tudi_jingying", "农村土地经营权"),
  buildHallAssetType("shifang", "石方资源"),
  buildHallAssetType("jixie", "机械设备"),
  buildHallAssetType("feijiu", "废旧物资"),
  buildHallAssetType("qita", "其他资产"),
  buildHallAssetType("guoyou_guapai", "国有挂牌项目"),
  buildHallAssetType("zhaoshang", "招商"),
  buildHallAssetType("gongcheng", "工程建设项目采购"),
  buildHallAssetType("tudi", "土地"),
];

const ALL_FILTER_TYPES = [...BUSINESS_TYPES, ...HALL_ASSET_TYPES];

const BUSINESS_TYPE_OPTIONS = [{ key: "all", label: "不限" }, ...BUSINESS_TYPES];
const HALL_ASSET_TYPE_OPTIONS = [{ key: "all", label: "全部" }, ...HALL_ASSET_TYPES];

const normalizeBusinessTypes = (value) => {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const keys = new Set(ALL_FILTER_TYPES.map((item) => item.key));
  const labels = new Map(ALL_FILTER_TYPES.map((item) => [item.label, item.key]));
  const result = [];
  list.forEach((item) => {
    const text = String(item || "").trim();
    if (!text || text === "all" || text === "不限" || text === "全部") return;
    if (keys.has(text) && !result.includes(text)) {
      result.push(text);
      return;
    }
    const byLabel = labels.get(text);
    if (byLabel && !result.includes(byLabel)) result.push(byLabel);
  });
  return result.slice(0, 20);
};

const resolveBusinessTypeKeywords = (value) => {
  const selected = new Set(normalizeBusinessTypes(value));
  if (!selected.size) return [];
  const keywords = [];
  ALL_FILTER_TYPES.forEach((item) => {
    if (!selected.has(item.key)) return;
    (item.keywords || []).forEach((word) => {
      if (word && !keywords.includes(word)) keywords.push(word);
    });
  });
  return keywords;
};

/** 是否包含竞价大厅标的类型（用于走 content 匹配） */
const hasHallAssetType = (value) => {
  const selected = new Set(normalizeBusinessTypes(value));
  if (!selected.size) return false;
  return HALL_ASSET_TYPES.some((item) => selected.has(item.key));
};

module.exports = {
  BUSINESS_TYPES,
  BUSINESS_TYPE_OPTIONS,
  HALL_ASSET_TYPES,
  HALL_ASSET_TYPE_OPTIONS,
  normalizeBusinessTypes,
  resolveBusinessTypeKeywords,
  hasHallAssetType,
};
