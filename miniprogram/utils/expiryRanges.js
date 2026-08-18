const EXPIRY_RANGES = [
  { key: "all", label: "不限" },
  { key: "this_month", label: "本月到期" },
  { key: "m1_3", label: "1-3个月到期" },
  { key: "m3_6", label: "3-6个月到期" },
  { key: "m6_12", label: "6-12个月到期" },
  { key: "after_12", label: "12个月后到期" },
  { key: "custom", label: "自定义到期时间", wide: true },
];

module.exports = {
  EXPIRY_RANGES,
};
