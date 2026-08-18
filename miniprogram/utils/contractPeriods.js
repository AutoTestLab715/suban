const CONTRACT_PERIODS = [
  { key: "lt1", label: "1年以下" },
  { key: "y1", label: "1年" },
  { key: "y2", label: "2年" },
  { key: "y3", label: "3年" },
  { key: "y5", label: "5年" },
  { key: "other", label: "其他" },
];

const CONTRACT_PERIOD_OPTIONS = [{ key: "all", label: "不限" }, ...CONTRACT_PERIODS];

module.exports = {
  CONTRACT_PERIODS,
  CONTRACT_PERIOD_OPTIONS,
};
