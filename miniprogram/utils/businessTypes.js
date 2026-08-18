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

const BUSINESS_TYPE_OPTIONS = [{ key: "all", label: "不限" }, ...BUSINESS_TYPES];

module.exports = {
  BUSINESS_TYPES,
  BUSINESS_TYPE_OPTIONS,
};
