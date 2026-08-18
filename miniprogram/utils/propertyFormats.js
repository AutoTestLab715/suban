const PROPERTY_FORMATS = [
  { key: "residential", label: "住宅" },
  { key: "gov_office", label: "政府办公楼" },
  { key: "school", label: "学校" },
  { key: "hospital", label: "医院" },
  { key: "industrial", label: "产业园区" },
  { key: "tourism", label: "旅游景区" },
  { key: "transport", label: "交通枢纽" },
  { key: "commercial_office", label: "商务办公楼" },
  { key: "hotel", label: "酒店" },
];

const PROPERTY_FORMAT_OPTIONS = [{ key: "all", label: "不限" }, ...PROPERTY_FORMATS];

module.exports = {
  PROPERTY_FORMATS,
  PROPERTY_FORMAT_OPTIONS,
};
