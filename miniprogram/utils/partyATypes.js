const PARTY_A_TYPES = [
  { key: "gov", label: "政府体系" },
  { key: "medical", label: "医疗单位" },
  { key: "education", label: "教育单位" },
  { key: "finance", label: "金融企业" },
  { key: "commercial", label: "商业公司" },
];

const PARTY_A_OPTIONS = [{ key: "all", label: "全部" }, ...PARTY_A_TYPES];

module.exports = {
  PARTY_A_TYPES,
  PARTY_A_OPTIONS,
};
