const ATTACHMENT_OPTIONS = [
  { key: "all", label: "不限" },
  { key: "has", label: "有合同附件" },
];

const normalizeAttachmentFilter = (value) => {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();
  if (!text || text === "all" || text === "不限") return "";
  if (text === "has" || text === "有合同附件") return "has";
  return "";
};

module.exports = {
  ATTACHMENT_OPTIONS,
  normalizeAttachmentFilter,
};
