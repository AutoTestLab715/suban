/**
 * 甲方类型：按采购单位/发布单位名称关键词匹配（库无独立字段）
 */
const PARTY_A_TYPES = [
  {
    key: "gov",
    label: "政府体系",
    keywords: ["政府", "机关", "管理局", "管委会", "街道", "居委会", "财政局", "住建局", "办公室", "厅", "委员会"],
  },
  {
    key: "medical",
    label: "医疗单位",
    keywords: ["医院", "卫生", "医疗", "诊所", "疾控", "中医院", "卫生院"],
  },
  {
    key: "education",
    label: "教育单位",
    keywords: ["学校", "大学", "学院", "幼儿园", "教育局", "中学", "小学", "职业技术"],
  },
  {
    key: "finance",
    label: "金融企业",
    keywords: ["银行", "保险", "证券", "金融", "信用社", "信托"],
  },
  {
    key: "commercial",
    label: "商业公司",
    keywords: ["有限公司", "股份", "集团", "商贸", "实业", "科技有限"],
  },
];

const normalizePartyAType = (value) => {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();
  if (!text || text === "all" || text === "全部") return "";
  const hit = PARTY_A_TYPES.find((item) => item.key === text || item.label === text);
  return hit ? hit.key : "";
};

const resolvePartyAKeywords = (value) => {
  const key = normalizePartyAType(value);
  if (!key) return [];
  const hit = PARTY_A_TYPES.find((item) => item.key === key);
  return hit ? [...(hit.keywords || [])] : [];
};

module.exports = {
  PARTY_A_TYPES,
  normalizePartyAType,
  resolvePartyAKeywords,
};
