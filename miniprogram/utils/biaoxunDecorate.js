const { getSourceLabel, resolveNoticeSourceLabel } = require("./infoSources");
const { buildHallCountdown } = require("./hallCountdown");

const formatSourceLabel = (value) =>
  getSourceLabel(value, String(value || "").trim() || "标讯");

const formatDate = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replace("T", " ").replace(/\.\d{3}Z?$/, "");
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized;
};

const formatPublishLabel = (value) => {
  const text = formatDate(value);
  if (!text) return "发布时间待公布";
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}年${m[2]}月${m[3]}日发布`;
  return `${text} 发布`;
};

const hasDisplayText = (value, placeholders = []) => {
  const text = String(value || "").trim();
  if (!text) return false;
  const blocked = new Set([
    "暂未公开",
    "暂无",
    "未公布",
    "面议",
    "面议/未公布",
    "/",
    "-",
    "—",
    "无",
    ...placeholders,
  ]);
  return !blocked.has(text);
};

const hasRealBudget = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  return !/^(面议|未公布|暂未公开|暂无|面议\/未公布|\/|-|—|无)$/i.test(text);
};

/** 工采通/第三方：库内类型对齐列表 Tab 文案 */
const normalizeCategoryLabel = (category, sourceCode = "") => {
  const label = String(category || "").trim() || "公告";
  const source = String(sourceCode || "")
    .trim()
    .toLowerCase();
  if (source !== "easy_prt") return label;
  if (label === "招标采购" || label === "采购公告" || label === "--") return "招标公告";
  if (label === "中标公告" || label === "采购意向" || label === "招标公告") return label;
  return label;
};

const resolveCategoryGroup = (sourceCode, categoryLabel) => {
  const source = String(sourceCode || "")
    .trim()
    .toLowerCase();
  if (source === "kjt" || source === "gxt") return "policy";
  if (source === "quanzhou_hall") return "hall";
  if (source === "quanzhou") return "trade";
  const label = String(categoryLabel || "");
  if (/投诉处理/.test(label)) return "policy";
  if (label === "采购意向" || /采购意向/.test(label)) return "intent";
  if (label === "中标公告" || /中标|成交|合同|废标|终止|结果更正|预留份额/.test(label)) {
    return "win";
  }
  if (label === "招标公告" || label === "招标采购" || /招标|磋商|谈判|询价|更正|单一来源/.test(label)) {
    return "tender";
  }
  return "tender";
};

const formatQuanzhouRegionLabel = (region = "") => {
  let text = String(region || "").trim();
  if (!text) return "";
  text = text.replace(/^福建省\s*[\/／]\s*/u, "");
  text = text.replace(/^福建省/u, "");
  return text.trim();
};

/** 竞价大厅价格：优先用已拼好单位的 budget（如 3200.00元/月），否则 first_value + price_unit */
const formatHallPriceLabel = (item = {}) => {
  const budget = String(item.budget || "").trim().replace(/,/g, "");
  // budget 已含单位（元/万元等）时直接展示
  if (hasRealBudget(budget) && /[元万]/.test(budget)) {
    return budget.replace(/￥/g, "元");
  }
  const amountRaw = String(
    item.firstValue || item.first_value || budget || item.successfulMoney || ""
  )
    .trim()
    .replace(/,/g, "");
  if (!hasRealBudget(amountRaw) || !/\d/.test(amountRaw)) return "";
  let amount = amountRaw.replace(/[元万￥]/g, "").trim();
  if (!amount) return "";
  if (/^\d+\.0+$/.test(amount)) amount = amount.replace(/\.0+$/, "");
  else if (/^\d+\.\d+$/.test(amount)) {
    const num = Number(amount);
    if (Number.isFinite(num)) {
      amount = Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
    }
  }
  const unit =
    String(item.priceUnit || item.price_unit || "元")
      .trim()
      .replace(/￥/g, "元") || "元";
  return `${amount}${unit}`;
};

const decorateNoticeCard = (item = {}) => {
  const regionRaw = String(item.region || "").trim();
  const sourceCode = String(item.sourceCode || item.source || "")
    .trim()
    .toLowerCase();
  const categoryLabel = normalizeCategoryLabel(item.category, sourceCode);
  const isProcurementIntent = /采购意向/.test(categoryLabel);
  const sourceLabel = resolveNoticeSourceLabel(sourceCode, item);
  const isKjt = sourceCode === "kjt";
  const isGxt = sourceCode === "gxt";
  const isEasyPrt = sourceCode === "easy_prt";
  const isQuanzhou = sourceCode === "quanzhou" || sourceCode === "quanzhou_hall";
  const isQuanzhouHall = sourceCode === "quanzhou_hall";
  const isOfficialSource = isKjt || isGxt;
  const buyerRaw = String(item.buyer || "").trim();
  const budgetRaw = String(item.budget || "").trim();
  const buyerOk =
    hasDisplayText(buyerRaw) && !(isEasyPrt && /^(招标采购|采购公告)$/.test(buyerRaw));
  const budgetOk =
    !isQuanzhouHall &&
    !isProcurementIntent &&
    !isOfficialSource &&
    hasRealBudget(budgetRaw) &&
    !(isEasyPrt && /^(招标采购|--|\.00|0\.00)$/.test(budgetRaw));
  const regionForDisplay = isQuanzhou ? formatQuanzhouRegionLabel(regionRaw) : regionRaw;
  const regionLabel = regionForDisplay || (isOfficialSource ? "" : isEasyPrt ? "" : "全国");
  const hallCountdown =
    isQuanzhouHall
      ? buildHallCountdown({
          ...item,
          sourceCode,
          deadline: item.deadline,
          openTime: item.openTime,
          statusName: item.statusName || categoryLabel,
        })
      : null;
  const hallPriceLabel = isQuanzhouHall ? formatHallPriceLabel(item) : "";

  return {
    ...item,
    id: String(item.id || ""),
    title: item.title || "未命名标讯",
    categoryLabel,
    publishTimeLabel: formatPublishLabel(item.publishTime),
    regionLabel,
    buyerLabel: buyerOk ? buyerRaw : "",
    buyerRowLabel: isOfficialSource ? "发布单位" : "采购单位",
    budgetLabel: budgetOk ? budgetRaw : "",
    showBuyer: buyerOk,
    showBudget: budgetOk,
    sourceCode,
    sourceLabel,
    hasAttachment: sourceCode === "plap" ? false : !!item.hasAttachment,
    hallCountdown,
    showHallCountdown: !!(hallCountdown && hallCountdown.show),
    hallPriceLabel,
    showHallPrice: !!hallPriceLabel,
  };
};

module.exports = {
  formatSourceLabel,
  formatDate,
  formatPublishLabel,
  formatQuanzhouRegionLabel,
  formatHallPriceLabel,
  hasDisplayText,
  hasRealBudget,
  normalizeCategoryLabel,
  resolveCategoryGroup,
  resolveNoticeSourceLabel,
  decorateNoticeCard,
  buildHallCountdown,
};
