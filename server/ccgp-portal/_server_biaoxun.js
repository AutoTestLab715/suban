const mysql = require("mysql2/promise");
const { resolveRegionFilter, resolvePlapRegionFilter } = require("./fujianRegions");
const { normalizeBusinessTypes, resolveBusinessTypeKeywords } = require("./businessTypes");
const { normalizePartyAType, resolvePartyAKeywords } = require("./partyATypes");
const { normalizeAmountRange, resolveAmountRange } = require("./amountRanges");
const { normalizeExpiryRange, resolveExpiryRange } = require("./expiryRanges");
const { normalizePropertyFormat, resolvePropertyFormatKeywords } = require("./propertyFormats");
const { normalizeContractPeriod, resolveContractPeriodKeywords } = require("./contractPeriods");
const { normalizeAttachmentFilter } = require("./attachmentFilters");
const { normalizeTurnoverFilter, resolveTurnoverKeywords } = require("./turnoverFilters");

const DEFAULT_HOST = "47.99.117.191";
const DEFAULT_DATABASE = "biaoxun";
const DEFAULT_TABLE = "notices";
const DEFAULT_GXT_TABLE = "gxt_zcfg";
const DEFAULT_PLAP_TABLE = "plap";
const DEFAULT_EASY_PRT_TABLE = "easy_prt";
const DEFAULT_CCGP_TABLE = "ccgp";
const DEFAULT_GUANGDONG_TABLE = "guangdong";
const DEFAULT_JIANGXI_TABLE = "jiangxi";
const DEFAULT_HUNAN_TABLE = "hunan";
const DEFAULT_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 8;
const SCHEMA_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_QUERY_TIMEOUT = 15000;
const DEFAULT_COUNT_QUERY_TIMEOUT = 25000;
// 关键词安全查询：默认只扫近 N 天（无命中也快结束）；用户自选日期可覆盖
const DEFAULT_SAFE_LOOKBACK_DAYS = 30;
const DEFAULT_SAFE_MAX_EXEC_MS = 3500;
const DEFAULT_SAFE_QUERY_TIMEOUT = 4500;
// 地区安全查询：展开后的 region 取值不超过该阈值时走 (source,region,time) 组合索引
const DEFAULT_SAFE_REGION_INDEX_MAX = 16;


// The production biaoxun database uses the known notices table mapping below.
// Skip information_schema discovery by default to keep cold starts within the function timeout.
const DEFAULT_NOTICE_FIELDS = {
  id: "id",
  title: "title",
  publishTime: "notice_time",
  deadline: "deadline",
  region: "region",
  buyer: "purchaser",
  agency: "agency",
  budget: "budget",
  source: "source",
  url: "url",
  category: "notice_type",
  content: "content_html",
  attachments: "attchs",
};

// 工信厅政策法规独立存放在 gxt_zcfg，不依赖 notices.source 字段。
const DEFAULT_GXT_FIELDS = {
  id: "id",
  title: "title",
  publishTime: "publish_time",
  deadline: "",
  region: "",
  buyer: "publisher",
  agency: "",
  budget: "",
  source: "",
  url: "url",
  category: "category",
  content: "content_html",
  attachments: "attchs",
};

// 军队采购网独立表 plap（www.plap.mil.cn）
const DEFAULT_PLAP_FIELDS = {
  id: "id",
  title: "title",
  publishTime: "publish_time",
  deadline: "",
  region: "region",
  buyer: "purchaser",
  agency: "agency",
  budget: "budget",
  source: "",
  url: "url",
  category: "purchase_manner",
  content: "content_html",
  contentText: "content_text",
  attachments: "attchs",
  projectNo: "project_no",
  noticeType: "notice_type",
  successfulMoney: "successful_money",
};

// 工采通独立表 easy_prt（字段 intentionally 对齐采购网）
const DEFAULT_EASY_PRT_FIELDS = {
  id: "id",
  title: "title",
  publishTime: "notice_time",
  deadline: "deadline",
  region: "region",
  buyer: "purchaser",
  agency: "agency",
  budget: "budget",
  source: "",
  url: "url",
  category: "notice_type",
  content: "content_html",
  contentText: "content_text",
  attachments: "attchs",
  projectNo: "project_no",
};

// 中国政府采购网独立表 ccgp（www.ccgp.gov.cn）
const DEFAULT_CCGP_FIELDS = {
  id: "id",
  title: "title",
  publishTime: "notice_time",
  deadline: "deadline",
  region: "region",
  buyer: "purchaser",
  agency: "agency",
  budget: "budget",
  source: "",
  url: "url",
  category: "notice_type",
  content: "content_html",
  contentText: "content_text",
  attachments: "attchs",
  projectNo: "project_no",
  successfulMoney: "successful_money",
};

// 广东省政府采购网独立表 guangdong
const DEFAULT_GUANGDONG_FIELDS = {
  id: "id",
  title: "title",
  publishTime: "notice_time",
  deadline: "deadline",
  region: "region",
  buyer: "purchaser",
  agency: "agency",
  budget: "budget",
  source: "",
  url: "url",
  category: "notice_type",
  content: "content_html",
  contentText: "content_text",
  attachments: "attchs",
  projectNo: "project_no",
  successfulMoney: "successful_money",
};

// 江西省政府采购网独立表 jiangxi
const DEFAULT_JIANGXI_FIELDS = {
  id: "id",
  title: "title",
  publishTime: "notice_time",
  deadline: "deadline",
  region: "region",
  buyer: "purchaser",
  agency: "agency",
  budget: "budget",
  source: "",
  url: "url",
  category: "notice_type",
  content: "content_html",
  contentText: "content_text",
  attachments: "attchs",
  projectNo: "project_no",
  successfulMoney: "successful_money",
};

// 湖南省政府采购网独立表 hunan
const DEFAULT_HUNAN_FIELDS = {
  id: "id",
  title: "title",
  publishTime: "notice_time",
  deadline: "deadline",
  region: "region",
  buyer: "purchaser",
  agency: "agency",
  budget: "budget",
  source: "",
  url: "url",
  category: "notice_type",
  content: "content_html",
  contentText: "content_text",
  attachments: "attchs",
  projectNo: "project_no",
  successfulMoney: "successful_money",
};

const PLAP_PURCHASE_MANNER = {
  "1": "公开招标",
  "2": "邀请招标",
  "3": "竞争性谈判",
  "4": "询价",
  "5": "单一来源",
};

const formatPlapMoney = (raw) => {
  const text = String(raw || "").replace(/,/g, "").trim();
  if (!text) return "";
  const num = Number(text);
  if (!Number.isFinite(num)) return String(raw).trim();
  if (Number.isInteger(num)) return String(num);
  return String(Math.round(num * 100) / 100);
};

const inferPlapBuyerFromTitle = (title) => {
  const text = String(title || "").trim();
  if (!text) return "";
  const hit = text.match(
    /^((?:[\u4e00-\u9fff]{2,12}(?:省|市|州|区|县|旗))?某(?:部|单位|医院|基地|大队|支队|仓库|中心))/
  );
  return hit ? hit[1] : "";
};

const extractPlapBuyer = (text) => {
  const source = String(text || "");
  const patterns = [
    /采购人[（(]?名称[）)]?\s*[:：]\s*([^\n，,；;]{2,40})/,
    /采购单位\s*[:：]\s*([^\n，,；;]{2,40})/,
    /招\s*标\s*人\s*[:：]\s*([^\n，,；;]{2,40})/,
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (!m) continue;
    const value = String(m[1] || "")
      .replace(/联\s*系.*$/, "")
      .trim();
    if (value && !/^(无|暂无|不详)$/.test(value)) return value.slice(0, 40);
  }
  return "";
};

const extractPlapBudget = (text) => {
  const source = String(text || "");
  const patterns = [
    [/投资金额\s*[:：]?\s*([\d,.]+)\s*万元/, (v) => `${formatPlapMoney(v)}万元`],
    [/投资金额\s*[:：]?\s*([\d,.]+)\s*元/, (v) => formatPlapMoney(v)],
    [/预算约?\s*人民币\s*([\d,.]+)\s*万元/, (v) => `${formatPlapMoney(v)}万元`],
    [/预算[金额]?\s*[:：]?\s*约?\s*([\d,.]+)\s*万元/, (v) => `${formatPlapMoney(v)}万元`],
    [/预算[金额]?\s*[:：]?\s*约?\s*([\d,.]+)\s*元/, (v) => formatPlapMoney(v)],
    [/预中标[（(]?成交[）)]?供应商[\s\S]{0,120}?报价金额\s*[:：]?\s*([\d,.]+)/, (v) => formatPlapMoney(v)],
    [/第一名[：:][^，,]{0,40}报价金额\s*[:：]?\s*([\d,.]+)/, (v) => formatPlapMoney(v)],
  ];
  for (const [re, fmt] of patterns) {
    const m = source.match(re);
    if (m) return fmt(m[1]);
  }
  return "";
};

const enrichPlapOverview = (notice, textSource = "") => {
  const text = String(textSource || "").replace(/\s+/g, " ");
  if (!String(notice.buyer || "").trim()) {
    notice.buyer = extractPlapBuyer(text) || inferPlapBuyerFromTitle(notice.title) || "";
  }
  if (!String(notice.budget || "").trim()) {
    notice.budget = extractPlapBudget(text);
  } else {
    notice.budget = /[万元]/.test(String(notice.budget))
      ? String(notice.budget).trim()
      : formatPlapMoney(notice.budget);
  }
};

const isEasyPrtPlaceholder = (value) => {
  const text = String(value || "").trim();
  return !text || ["--", "招标采购", "采购公告", "无", "暂无", ".00", "0.00"].includes(text);
};

/** 工采通 notice_type 对齐小程序三分类 Tab */
const normalizeEasyPrtCategory = (value) => {
  const text = String(value || "").trim();
  if (text === "中标公告") return "中标公告";
  if (text === "采购意向") return "采购意向";
  if (text === "招标公告") return "招标公告";
  if (!text || isEasyPrtPlaceholder(text)) return "招标公告";
  return text;
};

const extractEasyPrtField = (text, labels) => {
  const source = String(text || "");
  if (!source) return "";
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:：]\\s*([^\\n\\r，。；;]{2,120})`);
    const m = source.match(re);
    if (!m) continue;
    const value = String(m[1] || "")
      .replace(/\s+/g, " ")
      .replace(/^[：:\s,，;；]+|[：:\s,，;；]+$/g, "")
      .trim();
    if (value && !isEasyPrtPlaceholder(value)) return value.slice(0, 120);
  }
  return "";
};

// 工采通库字段常占位「招标采购」，详情按采购网口径从正文补全
const enrichEasyPrtOverview = (notice, textSource = "") => {
  const text = String(textSource || "");
  if (isEasyPrtPlaceholder(notice.projectNo)) {
    notice.projectNo = extractEasyPrtField(text, ["项目编号", "招标编号", "采购编号"]).slice(0, 80);
  }
  if (isEasyPrtPlaceholder(notice.buyer)) {
    notice.buyer = extractEasyPrtField(text, ["采购人", "招标人", "采购单位"]).slice(0, 80);
  }
  if (isEasyPrtPlaceholder(notice.agency)) {
    notice.agency = extractEasyPrtField(text, ["代理机构", "招标代理", "采购代理"]).slice(0, 80);
  }
  if (isEasyPrtPlaceholder(notice.budget)) {
    let budget = "";
    const patterns = [
      /(?:采购包)?预算金额（元）\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/,
      /预算(?:金额)?\s*[:：]\s*([0-9]+(?:\.[0-9]+)?\s*万?元?)/,
      /最高限价\s*[:：]\s*([0-9]+(?:\.[0-9]+)?\s*万?元?)/,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        budget = String(m[1] || "").trim();
        break;
      }
    }
    notice.budget = budget.slice(0, 64);
  }
  // category 使用 notice_type（招标公告/中标公告/采购意向），勿用正文「采购方式」覆盖
};

const FIELD_ALIASES = {
  id: ["id", "_id", "uuid", "notice_id", "bid_id", "project_id", "article_id", "info_id", "\u516c\u544a\u7f16\u53f7", "\u9879\u76ee\u7f16\u53f7"],
  title: [
    "title",
    "notice_title",
    "project_title",
    "bid_title",
    "bulletin_title",
    "project_name",
    "name",
    "\u6807\u9898",
    "\u516c\u544a\u6807\u9898",
    "\u9879\u76ee\u540d\u79f0",
  ],
  publishTime: [
    "notice_time",
    "publish_time",
    "publish_date",
    "published_at",
    "pub_time",
    "release_time",
    "release_date",
    "created_at",
    "create_time",
    "add_time",
    "addtime",
    "date",
    "\u53d1\u5e03\u65f6\u95f4",
    "\u53d1\u5e03\u65e5\u671f",
  ],
  deadline: [
    "deadline",
    "bid_deadline",
    "submit_deadline",
    "end_time",
    "end_date",
    "open_time",
    "bid_open_time",
    "\u622a\u6b62\u65f6\u95f4",
    "\u5f00\u6807\u65f6\u95f4",
  ],
  region: ["region", "area", "location", "city", "city_name", "province", "province_name", "district", "address", "\u5730\u533a", "\u57ce\u5e02", "\u7701\u4efd"],
  buyer: [
    "purchaser",
    "purchaser_name",
    "buyer",
    "buyer_name",
    "tenderee",
    "tenderee_name",
    "owner_name",
    "purchase_unit",
    "\u91c7\u8d2d\u4eba",
    "\u91c7\u8d2d\u5355\u4f4d",
    "\u62db\u6807\u4eba",
  ],
  agency: ["agency", "agency_name", "agent", "agent_name", "proxy_name", "\u4ee3\u7406\u673a\u6784", "\u62db\u6807\u4ee3\u7406"],
  budget: [
    "budget",
    "budget_amount",
    "amount",
    "project_amount",
    "estimated_amount",
    "winning_amount",
    "price",
    "\u9884\u7b97",
    "\u9884\u7b97\u91d1\u989d",
    "\u4e2d\u6807\u91d1\u989d",
  ],
  source: ["source", "source_name", "website", "site_name", "platform", "channel", "\u6765\u6e90", "\u6765\u6e90\u7f51\u7ad9"],
  url: ["url", "source_url", "detail_url", "notice_url", "link", "original_url", "source_link", "\u539f\u6587\u94fe\u63a5", "\u94fe\u63a5"],
  category: ["category", "category_name", "type", "notice_type", "bid_type", "business_type", "\u516c\u544a\u7c7b\u578b", "\u5206\u7c7b"],
  content: [
    "content_html",
    "full_content",
    "notice_content",
    "article_content",
    "detail_content",
    "content_text",
    "content",
    "html",
    "body",
    "detail",
    "info_content",
    "article_body",
    "notice_body",
    "\u516c\u544a\u6b63\u6587",
    "\u516c\u544a\u5185\u5bb9",
    "\u6b63\u6587",
    "description",
  ],
  attachments: [
    "attchs",
    "attachs",
    "attachments",
    "attachment",
    "files",
    "annex",
    "annexes",
    "\u9644\u4ef6",
  ],
};

const FIELD_ENV_KEYS = {
  id: "BIAOXUN_COLUMN_ID",
  title: "BIAOXUN_COLUMN_TITLE",
  publishTime: "BIAOXUN_COLUMN_PUBLISH_TIME",
  deadline: "BIAOXUN_COLUMN_DEADLINE",
  region: "BIAOXUN_COLUMN_REGION",
  buyer: "BIAOXUN_COLUMN_BUYER",
  agency: "BIAOXUN_COLUMN_AGENCY",
  budget: "BIAOXUN_COLUMN_BUDGET",
  source: "BIAOXUN_COLUMN_SOURCE",
  url: "BIAOXUN_COLUMN_URL",
  category: "BIAOXUN_COLUMN_CATEGORY",
  content: "BIAOXUN_COLUMN_CONTENT",
  attachments: "BIAOXUN_COLUMN_ATTACHMENTS",
};

const ATTACHMENT_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|wps|png|jpe?g|gif)(\?|#|$)/i;
const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;

const PREFERRED_TABLE_NAMES = [
  "notices",
  "biaoxun",
  "bidding_notices",
  "bidding_info",
  "bid_info",
  "tender_info",
  "zhaobiao",
  "bidding_notice",
  "bid_notices",
  "tender_notices",
  "tenders",
  "notice",
  "projects",
  "project",
  "articles",
];

const SOURCE_LABELS = {
  zfcg: "采购网",
  kjt: "科技厅",
  gxt: "工信厅",
  plap: "军队采购网",
  easy_prt: "第三方",
  ccgp: "政采网",
  guangdong: "广东省政府采购网",
  jiangxi: "江西政府采购网",
  hunan: "湖南政府采购网",
};

/** 采购网公告按业务归类：招标 / 中标 / 采购意向 */
const CATEGORY_GROUPS = {
  tender: {
    key: "tender",
    label: "招标公告",
    // 含：竞争性谈判/磋商、征集、更正、招标等（精确 IN，避免模糊匹配拖慢列表）
    exactTypes: [
      "公开招标采购公告",
      "公开招标公告",
      "招标公告",
      "竞争性磋商公告",
      "磋商公告",
      "竞争性谈判公告",
      "征集公告",
      "采购更正公告",
      "更正公告",
      "询价公告",
      "单一来源采购公告",
      "单一来源公示",
    ],
    // 非采购网：按各表真实类型/代码过滤
    sourceExactTypes: {
      easy_prt: ["招标公告", "招标采购"],
      // 军采网用 notice_type 编码（见 sourceCategoryField）
      plap: ["001011", "001013", "001014", "001031", "00105E"],
      // 中国政府采购网
      ccgp: [
        "公开招标",
        "公开招标公告",
        "邀请招标",
        "竞争性磋商",
        "竞争性谈判",
        "询价公告",
        "单一来源",
        "更正公告",
        "资格预审",
        "其他公告",
      ],
      guangdong: [
        "公开招标采购公告",
        "公开招标公告",
        "竞争性磋商公告",
        "竞争性谈判公告",
        "询价公告",
        "单一来源公示",
        "单一来源采购公告",
        "采购更正公告",
        "更正公告",
        "采购需求",
      ],
      jiangxi: [
        "公开招标采购公告",
        "公开招标公告",
        "竞争性磋商公告",
        "竞争性谈判公告",
        "询价公告",
        "单一来源公示",
        "单一来源采购公告",
        "采购更正公告",
        "更正公告",
        "采购公告",
      ],
      hunan: [
        "采购公告",
        "更正公告",
        "单一来源公示",
        "项目信息",
      ],
    },
    sourceCategoryField: {
      plap: "noticeType",
    },
    // 采购网 notice_type 为空时，按标题关键词兜底归类
    emptyTitleInclude: [
      "竞争性谈判公告",
      "磋商公告",
      "征集公告",
      "更正公告",
      "招标公告",
      "征集",
      "更正",
      "采购公示",
      "进口产品",
      "招标",
      "询价",
      "磋商",
      "谈判",
      "单一来源",
      "框架协议",
    ],
    emptyTitleExclude: [
      "成交结果",
      "成交公示",
      "成交公告",
      "结果公告",
      "终止公告",
      "合同公告",
      "流标",
      "废标",
      "中标",
      "投诉",
    ],
  },
  policy: {
    key: "policy",
    label: "政策公开",
    // 政策类：工信厅/科技厅整表纳入（不再混入采购网投诉处理决定书）
    exactTypes: [],
  },
  win: {
    key: "win",
    label: "中标公告",
    // 含：流标、成交公示/公告、结果公告、中标、终止、合同公告等
    exactTypes: [
      "合同公示",
      "合同公告",
      "合同变更公告",
      "补充合同公告",
      "公开招标中标公告",
      "中标公告",
      "竞争性磋商成交公告",
      "竞争性谈判成交公告",
      "询价成交公告",
      "单一来源成交公告",
      "成交公告",
      "成交公示",
      "结果公告",
      "结果更正公告",
      "废标公告",
      "流标公告",
      "终止公告",
      "中小企业预留份额执行情况公示",
    ],
    sourceExactTypes: {
      easy_prt: ["中标公告"],
      plap: ["001021", "001023", "001006"],
      ccgp: ["中标公告", "成交公告", "终止公告", "废标公告"],
      guangdong: [
        "公开招标中标公告",
        "中标公告",
        "竞争性磋商成交公告",
        "竞争性谈判成交公告",
        "询价成交公告",
        "成交公告",
        "成交公示",
        "结果公告",
        "结果更正公告",
        "合同公示",
        "合同公告",
        "废标公告",
        "流标公告",
        "终止公告",
        "验收结果公告",
        "单一来源成交公告",
      ],
      jiangxi: [
        "公开招标中标公告",
        "中标公告",
        "竞争性磋商成交公告",
        "竞争性谈判成交公告",
        "询价成交公告",
        "成交公告",
        "成交公示",
        "结果公告",
        "结果更正公告",
        "合同公示",
        "合同公告",
        "补充合同公告",
        "废标公告",
        "流标公告",
        "终止公告",
        "单一来源成交公告",
      ],
      hunan: [
        "合同公告",
        "中标(成交)公告",
        "废标(终止)公告",
        "废标(中止)公告",
        "履约验收公告",
      ],
    },
    sourceCategoryField: {
      plap: "noticeType",
    },
    emptyTitleInclude: [
      "流标公告",
      "流标",
      "成交公示",
      "成交公告",
      "成交结果",
      "结果公告",
      "中标公告",
      "中标",
      "终止公告",
      "合同公告",
      "合同公示",
      "合同变更",
      "补充合同",
      "废标",
      "入围成交",
    ],
    emptyTitleExclude: [],
  },
  intent: {
    key: "intent",
    label: "采购意向",
    exactTypes: ["采购意向公告"],
    sourceExactTypes: {
      easy_prt: ["采购意向"],
      // 军采网意向公开编码
      plap: ["59"],
      guangdong: ["采购意向公告"],
      jiangxi: ["采购意向公告"],
      hunan: ["采购意向公开"],
    },
    sourceCategoryField: {
      plap: "noticeType",
    },
  },
};

// 分类 Tab 对应查询来源（多源按发布时间混排）
const CATEGORY_SOURCE_MAP = {
  tender: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "hunan", "plap"],
  policy: ["gxt", "kjt"],
  win: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "hunan", "plap"],
  intent: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "hunan", "plap"],
};

const normalizeSourceFilter = (value) => {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "all" || text === "全部") return "";
  if (text === "zfcg" || text === "采购网" || text === "政府采购网") return "zfcg";
  if (text === "kjt" || text === "科技厅" || text === "科技厅网") return "kjt";
  if (text === "gxt" || text === "工信厅" || text === "工业和信息化厅" || text === "工信厅网") return "gxt";
  if (
    text === "plap" ||
    text === "军队" ||
    text === "军队网" ||
    text === "军采网" ||
    text === "军队采购网"
  ) {
    return "plap";
  }
  if (
    text === "easy_prt" ||
    text === "easyprt" ||
    text === "gct" ||
    text === "工采通" ||
    text === "工采通公告" ||
    text === "第三方"
  ) {
    return "easy_prt";
  }
  if (
    text === "ccgp" ||
    text === "政采网" ||
    text === "中国政采网" ||
    text === "中国政府采购网" ||
    text === "中央政府采购网"
  ) {
    return "ccgp";
  }
  if (
    text === "guangdong" ||
    text === "广东政采网" ||
    text === "广东政府采购网" ||
    text === "广东省政府采购网" ||
    text === "广东省政采网"
  ) {
    return "guangdong";
  }
  if (
    text === "jiangxi" ||
    text === "江西政采网" ||
    text === "江西政府采购网" ||
    text === "江西省政府采购网" ||
    text === "江西省政采网"
  ) {
    return "jiangxi";
  }
  if (
    text === "hunan" ||
    text === "湖南政采网" ||
    text === "湖南政府采购网" ||
    text === "湖南省政府采购网" ||
    text === "湖南省政采网"
  ) {
    return "hunan";
  }
  return text.slice(0, 32);
};

const normalizeCategoryGroup = (value) => {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "all" || text === "全部") return "";
  if (text === "tender" || text === "招标" || text === "招标公告") return "tender";
  if (text === "policy" || text === "政策" || text === "政策公开" || text === "政策法规") return "policy";
  if (text === "win" || text === "中标" || text === "中标公告" || text === "成交") return "win";
  if (text === "intent" || text === "采购意向" || text === "意向") return "intent";
  return "";
};

const resolveListSources = (source, categoryGroup, options = {}) => {
  const explicit = normalizeSourceFilter(source);
  if (explicit) return [explicit];
  const group = normalizeCategoryGroup(categoryGroup);
  if (group && CATEGORY_SOURCE_MAP[group]) {
    const list = [...CATEGORY_SOURCE_MAP[group]];
    if (options.excludePlap) return list.filter((item) => item !== "plap");
    return list;
  }
  return ["zfcg"];
};

const comparePublishTimeDesc = (a, b) => {
  const ta = String((a && a.publishTime) || "");
  const tb = String((b && b.publishTime) || "");
  if (ta !== tb) return tb.localeCompare(ta);
  const sa = `${(a && a.sourceCode) || ""}:${(a && a.id) || ""}`;
  const sb = `${(b && b.sourceCode) || ""}:${(b && b.id) || ""}`;
  return sb.localeCompare(sa);
};

/** 采购网空 notice_type：用标题关键词归入招标/中标（在内存过滤，不进 SQL OR） */
const matchEmptyTitleHeuristic = (title, categoryGroup) => {
  const groupKey = normalizeCategoryGroup(categoryGroup);
  const group = groupKey ? CATEGORY_GROUPS[groupKey] : null;
  if (!group) return false;
  const text = String(title || "");
  if (!text) return false;
  const include = Array.isArray(group.emptyTitleInclude) ? group.emptyTitleInclude : [];
  const exclude = Array.isArray(group.emptyTitleExclude) ? group.emptyTitleExclude : [];
  if (!include.length) return false;
  const hitInclude = include.some((word) => word && text.includes(word));
  if (!hitInclude) return false;
  if (exclude.some((word) => word && text.includes(word))) return false;
  return true;
};

const formatSourceLabel = (value) => {
  const key = String(value || "").trim().toLowerCase();
  return SOURCE_LABELS[key] || String(value || "").trim() || "标讯数据库";
};

let pool = null;
let poolKey = "";
let schemaCache = null;
let schemaCacheAt = 0;

const clampInt = (value, min, max, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const normalizeDateFilter = (value) => {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return text;
};

const normalizeDateRange = ({ startDate = "", endDate = "", date = "" } = {}) => {
  const legacyDate = normalizeDateFilter(date);
  let normalizedStart = normalizeDateFilter(startDate) || legacyDate;
  let normalizedEnd = normalizeDateFilter(endDate) || legacyDate;
  if (normalizedStart && normalizedEnd && normalizedStart > normalizedEnd) {
    [normalizedStart, normalizedEnd] = [normalizedEnd, normalizedStart];
  }
  return { startDate: normalizedStart, endDate: normalizedEnd };
};

const formatDateOnly = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const lookbackStartDate = (days, now = new Date()) => {
  const safeDays = clampInt(days, 1, 3650, DEFAULT_SAFE_LOOKBACK_DAYS);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - safeDays);
  return formatDateOnly(start);
};

const normalizeBeforePublishTime = (value) => {
  const text = String(value || "")
    .trim()
    .replace("T", " ")
    .replace(/\.\d+Z?$/, "");
  if (!text) return "";
  // 接受 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm:ss"
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return text.length === 16 ? `${text}:00` : text.slice(0, 19);
  }
  return "";
};

const isMaxExecutionTimeError = (error) => {
  const code = String(error?.errno || error?.code || "");
  const message = String(error?.message || error || "");
  return code === "3024" || /maximum statement execution time exceeded/i.test(message);
};

const resolveSafeLookbackDays = (env = process.env) =>
  clampInt(env.BIAOXUN_SAFE_LOOKBACK_DAYS, 7, 730, DEFAULT_SAFE_LOOKBACK_DAYS);

const resolveSafeMaxExecMs = (env = process.env) =>
  clampInt(env.BIAOXUN_SAFE_MAX_EXEC_MS, 800, 15000, DEFAULT_SAFE_MAX_EXEC_MS);

const resolveSafeQueryTimeout = (env = process.env) =>
  clampInt(env.BIAOXUN_SAFE_QUERY_TIMEOUT, 1000, 20000, DEFAULT_SAFE_QUERY_TIMEOUT);

const tokenizeKeyword = (value) =>
  String(value || "")
    .replace(/[+\-><()~*@"\\]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 8);

// ponytail: 搜索栏一律安全查询 —— 时间倒序 + LIKE + LIMIT 早停；禁止 MATCH/FULLTEXT
const buildSafeTitleClauses = (titleColumn, keyword) => {
  const parts = tokenizeKeyword(keyword);
  if (!parts.length) return { clauses: [], params: [] };
  return {
    clauses: parts.map(() => `${titleColumn} LIKE ?`),
    params: parts.map((part) => `%${part}%`),
  };
};

const isRetryableQueryError = (error) => {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error?.errMsg || error || "");
  if (code === "PROTOCOL_SEQUENCE_TIMEOUT" || code === "ETIMEDOUT" || code === "ECONNRESET") return true;
  return /timed out|TIME_LIMIT_EXCEEDED|query timeout|PROTOCOL_SEQUENCE_TIMEOUT|Query inactivity timeout/i.test(
    message
  );
};

const runQueryWithRetry = async (executor, queryConfig, params, { retries = 1, timeoutMultiplier = 1.5 } = {}) => {
  let attempt = 0;
  let lastError = null;
  const baseTimeout = Number(queryConfig?.timeout || 0);
  while (attempt <= retries) {
    const isLast = attempt >= retries;
    const nextQuery =
      attempt === 0 || !baseTimeout
        ? queryConfig
        : {
            ...queryConfig,
            timeout: Math.min(Math.round(baseTimeout * Math.pow(timeoutMultiplier, attempt)), 60000),
          };
    try {
      return await executor.query(nextQuery, params);
    } catch (error) {
      lastError = error;
      if (isLast || !isRetryableQueryError(error)) break;
    }
    attempt += 1;
  }
  throw lastError;
};

const assertIdentifier = (value, label) => {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_$\u4e00-\u9fa5]+$/.test(text)) {
    throw new Error(`${label}格式不合法`);
  }
  return text;
};

const quoteIdentifier = (value) => `\`${assertIdentifier(value, "数据库字段").replace(/`/g, "``")}\``;

const getDbConfig = () => {
  const config = {
    host: String(process.env.BIAOXUN_DB_HOST || DEFAULT_HOST).trim(),
    port: clampInt(process.env.BIAOXUN_DB_PORT, 1, 65535, 3306),
    user: String(process.env.BIAOXUN_DB_USER || "").trim(),
    password: String(process.env.BIAOXUN_DB_PASSWORD || ""),
    database: String(process.env.BIAOXUN_DB_NAME || DEFAULT_DATABASE).trim(),
    table: String(process.env.BIAOXUN_DB_TABLE || DEFAULT_TABLE).trim(),
    connectTimeout: clampInt(process.env.BIAOXUN_DB_TIMEOUT, 1000, 20000, 5000),
    queryTimeout: clampInt(process.env.BIAOXUN_QUERY_TIMEOUT, 500, 30000, DEFAULT_QUERY_TIMEOUT),
    countQueryTimeout: clampInt(
      process.env.BIAOXUN_COUNT_QUERY_TIMEOUT,
      1000,
      90000,
      DEFAULT_COUNT_QUERY_TIMEOUT
    ),
    autoDetectSchema: String(process.env.BIAOXUN_SCHEMA_AUTO_DETECT || "").trim() === "1",
  };

  if (!config.user || !config.password) {
    const error = new Error("标讯数据库账号未配置");
    error.code = "BIAOXUN_CONFIG_MISSING";
    throw error;
  }
  assertIdentifier(config.database, "数据库名");
  if (config.table) assertIdentifier(config.table, "数据表名");
  return config;
};

const getPool = () => {
  const config = getDbConfig();
  const nextKey = [config.host, config.port, config.user, config.database].join("|");
  if (!pool || poolKey !== nextKey) {
    if (pool && typeof pool.end === "function") {
      pool.end().catch(() => {});
    }
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 4,
      queueLimit: 20,
      connectTimeout: config.connectTimeout,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      charset: "utf8mb4",
      timezone: "+08:00",
      dateStrings: true,
      decimalNumbers: false,
    });
    poolKey = nextKey;
    schemaCache = null;
    schemaCacheAt = 0;
  }
  return { pool, config };
};

const normalizeColumns = (rows) => {
  const tableMap = new Map();
  (rows || []).forEach((row) => {
    const tableName = String(row.TABLE_NAME || row.table_name || "");
    const columnName = String(row.COLUMN_NAME || row.column_name || "");
    if (!tableName || !columnName) return;
    if (!tableMap.has(tableName)) tableMap.set(tableName, []);
    tableMap.get(tableName).push({
      name: columnName,
      lower: columnName.toLowerCase(),
      key: String(row.COLUMN_KEY || row.column_key || "").toUpperCase(),
      dataType: String(row.DATA_TYPE || row.data_type || "").toLowerCase(),
    });
  });
  return tableMap;
};

const CONTENT_TYPE_SCORE = {
  longtext: 50,
  mediumtext: 40,
  text: 30,
  blob: 25,
  mediumblob: 25,
  longblob: 25,
  varchar: 5,
  char: 1,
};

const contentColumnScore = (column) => {
  let score = CONTENT_TYPE_SCORE[column.dataType] || 0;
  if (/content|html|body|detail|正文|内容/i.test(column.name)) score += 8;
  if (/summary|digest|intro|abstract|desc|摘要|简介/i.test(column.name)) score -= 12;
  return score;
};

const findColumn = (columns, field, env = process.env) => {
  const configured = String(env[FIELD_ENV_KEYS[field]] || "").trim();
  if (configured) {
    const matched = columns.find((column) => column.lower === configured.toLowerCase());
    if (!matched) throw new Error(`配置的字段 ${configured} 在标讯表中不存在`);
    return matched.name;
  }

  const aliases = FIELD_ALIASES[field] || [];
  if (field === "content") {
    const matched = [];
    aliases.forEach((alias) => {
      const hit = columns.find((column) => column.lower === alias.toLowerCase());
      if (hit && !matched.some((item) => item.lower === hit.lower)) matched.push(hit);
    });
    // 再补捞未列入别名、但明显是正文的大字段
    columns.forEach((column) => {
      if (matched.some((item) => item.lower === column.lower)) return;
      if (!/content|html|body|正文|内容/i.test(column.name)) return;
      if (/title|name|url|link|time|date|phone|id$/i.test(column.name)) return;
      matched.push(column);
    });
    if (!matched.length) return "";
    matched.sort((a, b) => contentColumnScore(b) - contentColumnScore(a));
    return matched[0].name;
  }

  for (const alias of aliases) {
    const matched = columns.find((column) => column.lower === alias.toLowerCase());
    if (matched) return matched.name;
  }
  return "";
};

const buildFieldMap = (columns, env = process.env) => {
  const map = {};
  Object.keys(FIELD_ALIASES).forEach((field) => {
    map[field] = findColumn(columns, field, env);
  });
  if (!map.id) {
    const primary = columns.find((column) => column.key === "PRI");
    if (primary) map.id = primary.name;
  }
  return map;
};

const scoreTable = (tableName, columns, env = process.env) => {
  let map;
  try {
    map = buildFieldMap(columns, env);
  } catch (e) {
    return { score: -1, map: {}, reason: e.message };
  }
  if (!map.title || !map.id) return { score: -1, map };

  let score = 20;
  if (map.publishTime) score += 7;
  if (map.content) score += 5;
  if (map.url) score += 4;
  if (map.buyer) score += 3;
  if (map.region) score += 3;
  if (map.category) score += 2;
  const preferredIndex = PREFERRED_TABLE_NAMES.indexOf(tableName.toLowerCase());
  if (preferredIndex >= 0) score += 20 - preferredIndex;
  if (/bid|tender|notice|project|article|招标|标讯|公告/i.test(tableName)) score += 6;
  return { score, map };
};

const chooseSchema = (tableMap, config, env = process.env) => {
  if (config.table) {
    const pair = [...tableMap.entries()].find(([name]) => name.toLowerCase() === config.table.toLowerCase());
    if (!pair) throw new Error(`标讯数据表 ${config.table} 不存在`);
    const map = buildFieldMap(pair[1], env);
    if (!map.id || !map.title) {
      throw new Error("标讯表至少需要唯一编号字段和标题字段");
    }
    return { table: pair[0], columns: pair[1], fields: map };
  }

  const ranked = [...tableMap.entries()]
    .map(([table, columns]) => ({ table, columns, ...scoreTable(table, columns, env) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.table.localeCompare(b.table));
  if (!ranked.length) {
    throw new Error("未找到可识别的标讯数据表，请配置 BIAOXUN_DB_TABLE 和字段映射");
  }
  return { table: ranked[0].table, columns: ranked[0].columns, fields: ranked[0].map };
};

const buildConfiguredSchema = (config, env = process.env) => {
  if (config.autoDetectSchema) return null;
  const fields = { ...DEFAULT_NOTICE_FIELDS };
  Object.entries(FIELD_ENV_KEYS).forEach(([field, envKey]) => {
    const configured = String(env[envKey] || "").trim();
    if (configured) fields[field] = assertIdentifier(configured, `${field}??`);
  });
  if (!fields.id || !fields.title) return null;
  return { table: config.table || DEFAULT_TABLE, columns: [], fields };
};

const resolveSchema = async (executor, config, options = {}) => {
  const configured = buildConfiguredSchema(config, options.env || process.env);
  if (configured) return configured;
  const now = Date.now();
  if (!options.force && schemaCache && now - schemaCacheAt < SCHEMA_CACHE_MS) return schemaCache;
  const [rows] = await executor.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_KEY, DATA_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [config.database]
  );
  const tableMap = normalizeColumns(rows);
  schemaCache = chooseSchema(tableMap, config, options.env || process.env);
  schemaCacheAt = now;
  return schemaCache;
};

const getGxtSchema = (env = process.env) => ({
  table: assertIdentifier(String(env.BIAOXUN_GXT_TABLE || DEFAULT_GXT_TABLE).trim(), "工信厅数据表"),
  columns: [],
  fields: { ...DEFAULT_GXT_FIELDS },
});

const getPlapSchema = (env = process.env) => ({
  table: assertIdentifier(String(env.BIAOXUN_PLAP_TABLE || DEFAULT_PLAP_TABLE).trim(), "军队采购网数据表"),
  columns: [],
  fields: { ...DEFAULT_PLAP_FIELDS },
});

const getEasyPrtSchema = (env = process.env) => ({
  table: assertIdentifier(String(env.BIAOXUN_EASY_PRT_TABLE || DEFAULT_EASY_PRT_TABLE).trim(), "工采通数据表"),
  columns: [],
  fields: { ...DEFAULT_EASY_PRT_FIELDS },
});

const getCcgpSchema = (env = process.env) => ({
  table: assertIdentifier(String(env.BIAOXUN_CCGP_TABLE || DEFAULT_CCGP_TABLE).trim(), "中国政府采购网数据表"),
  columns: [],
  fields: { ...DEFAULT_CCGP_FIELDS },
});

const getGuangdongSchema = (env = process.env) => ({
  table: assertIdentifier(
    String(env.BIAOXUN_GUANGDONG_TABLE || DEFAULT_GUANGDONG_TABLE).trim(),
    "广东省政府采购网数据表"
  ),
  columns: [],
  fields: { ...DEFAULT_GUANGDONG_FIELDS },
});

const getJiangxiSchema = (env = process.env) => ({
  table: assertIdentifier(
    String(env.BIAOXUN_JIANGXI_TABLE || DEFAULT_JIANGXI_TABLE).trim(),
    "江西政府采购网数据表"
  ),
  columns: [],
  fields: { ...DEFAULT_JIANGXI_FIELDS },
});

const getHunanSchema = (env = process.env) => ({
  table: assertIdentifier(
    String(env.BIAOXUN_HUNAN_TABLE || DEFAULT_HUNAN_TABLE).trim(),
    "湖南政府采购网数据表"
  ),
  columns: [],
  fields: { ...DEFAULT_HUNAN_FIELDS },
});

const resolveSchemaForSource = async (executor, config, source, dependencies = {}) => {
  if (source === "gxt") return dependencies.gxtSchema || getGxtSchema(dependencies.env || process.env);
  if (source === "plap") return dependencies.plapSchema || getPlapSchema(dependencies.env || process.env);
  if (source === "easy_prt") {
    return dependencies.easyPrtSchema || getEasyPrtSchema(dependencies.env || process.env);
  }
  if (source === "ccgp") {
    return dependencies.ccgpSchema || getCcgpSchema(dependencies.env || process.env);
  }
  if (source === "guangdong") {
    return dependencies.guangdongSchema || getGuangdongSchema(dependencies.env || process.env);
  }
  if (source === "jiangxi") {
    return dependencies.jiangxiSchema || getJiangxiSchema(dependencies.env || process.env);
  }
  if (source === "hunan") {
    return dependencies.hunanSchema || getHunanSchema(dependencies.env || process.env);
  }
  return dependencies.schema || resolveSchema(executor, config, dependencies);
};

const selectExpression = (column, alias) =>
  column ? `${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}` : `NULL AS ${quoteIdentifier(alias)}`;

const buildHasAttachmentPredicate = (fields, source = "", { scanContent = false } = {}) => {
  // ponytail: 列表默认只看 attchs；扫 content_html LIKE 在换页机器上太贵
  // 军队采购网不做附件功能
  const sourceCode = normalizeSourceFilter(source);
  if (sourceCode === "plap") return "";
  const checks = [];
  if (fields.attachments) {
    const attachments = quoteIdentifier(fields.attachments);
    checks.push(`(${attachments} IS NOT NULL AND JSON_LENGTH(${attachments}) > 0)`);
  }
  if (scanContent && fields.content && sourceCode !== "kjt" && sourceCode !== "gxt" && sourceCode !== "easy_prt" && sourceCode !== "ccgp" && sourceCode !== "guangdong" && sourceCode !== "jiangxi" && sourceCode !== "hunan") {
    const content = quoteIdentifier(fields.content);
    checks.push(
      `(${content} LIKE '%annAttachment%' OR ${content} LIKE '%合同附件%' OR ${content} LIKE '%相关附件%')`
    );
  }
  return checks.length ? `(${checks.join(" OR ")})` : "";
};

const buildHasAttachmentExpression = (fields, source = "", options = {}) => {
  const predicate = buildHasAttachmentPredicate(fields, source, options);
  if (!predicate) return `0 AS ${quoteIdentifier("hasAttachment")}`;
  // 列表用轻量判断，避免 JSON_LENGTH 扫大字段
  if (!options.scanContent && fields.attachments) {
    const attachments = quoteIdentifier(fields.attachments);
    return `(CASE WHEN ${attachments} IS NOT NULL AND LENGTH(${attachments}) > 2 THEN 1 ELSE 0 END) AS ${quoteIdentifier("hasAttachment")}`;
  }
  return `(CASE WHEN ${predicate} THEN 1 ELSE 0 END) AS ${quoteIdentifier("hasAttachment")}`;
};

const buildSelectList = (fields, includeContent = false, source = "", options = {}) => {
  // 列表页不取 agency/deadline/url/content，减少回表与网络体积
  const names = includeContent
    ? ["id", "title", "publishTime", "deadline", "region", "buyer", "agency", "budget", "source", "url", "category"]
    : ["id", "title", "publishTime", "region", "buyer", "budget", "source", "category"];
  if (includeContent && fields.projectNo) names.push("projectNo");
  if (includeContent && fields.noticeType) names.push("noticeType");
  if (includeContent && fields.successfulMoney) names.push("successfulMoney");
  const selects = names.map((field) => selectExpression(fields[field], field));
  // 安全列表跳过正文摘要，避免 LEFT(content_text) 拖慢混排；详情页仍会补全
  if (
    !includeContent &&
    !options.light &&
    (source === "plap" || source === "easy_prt" || source === "ccgp" || source === "guangdong" || source === "jiangxi" || source === "hunan") &&
    fields.contentText
  ) {
    selects.push(
      `LEFT(${quoteIdentifier(fields.contentText)}, 1800) AS ${quoteIdentifier("contentSnippet")}`
    );
  }
  if (includeContent) {
    selects.push(selectExpression(fields.content, "content"));
    // 军队采购网不做附件：不取 attchs，也不做有附件判断
    if (source !== "plap") {
      if (fields.attachments) selects.push(selectExpression(fields.attachments, "attachments"));
      selects.push(buildHasAttachmentExpression(fields, source, { scanContent: true }));
    } else {
      selects.push(`0 AS ${quoteIdentifier("hasAttachment")}`);
    }
  } else {
    selects.push(buildHasAttachmentExpression(fields, source, { scanContent: false }));
  }
  return selects.join(",\n       ");
};

const buildListWhere = (
  fields,
  {
    keyword = "",
    source = "",
    categoryGroup = "",
    categoryTypeMode = "exact",
    region = "",
    regions = [],
    businessTypes = [],
    partyAType = "",
    amountRange = "",
    expiryRange = "",
    expiryStartDate = "",
    expiryEndDate = "",
    propertyFormat = "",
    contractPeriod = "",
    attachmentFilter = "",
    turnoverFilter = "",
    startDate = "",
    endDate = "",
    date = "",
    beforePublishTime = "",
  } = {}
) => {
  const clauses = [];
  const params = [];

  const sourceFilter = normalizeSourceFilter(source);
  if (sourceFilter && fields.source) {
    clauses.push(`${quoteIdentifier(fields.source)} = ?`);
    params.push(sourceFilter);
  }

  const groupKey = normalizeCategoryGroup(categoryGroup);
  const group = groupKey ? CATEGORY_GROUPS[groupKey] : null;
  const typeMode = String(categoryTypeMode || "exact").toLowerCase() === "empty" ? "empty" : "exact";
  if (group) {
    const sourceTypes =
      sourceFilter && group.sourceExactTypes && Array.isArray(group.sourceExactTypes[sourceFilter])
        ? group.sourceExactTypes[sourceFilter].filter(Boolean)
        : null;
    const fieldKey =
      (sourceFilter && group.sourceCategoryField && group.sourceCategoryField[sourceFilter]) ||
      "category";
    const typeColumnName = fields[fieldKey] || (fieldKey === "category" ? fields.category : "");
    const defaultExactTypes = Array.isArray(group.exactTypes) ? group.exactTypes.filter(Boolean) : [];
    const exactTypes =
      sourceTypes && sourceTypes.length
        ? sourceTypes
        : groupKey === "policy"
          ? []
          : defaultExactTypes;

    // 政策：仅工信厅/科技厅整表；军采网/第三方/采购网不进此 Tab
    if (groupKey === "policy") {
      if (sourceFilter && sourceFilter !== "gxt" && sourceFilter !== "kjt") {
        clauses.push("1 = 0");
      }
    } else if (typeMode === "empty") {
      // 空类型单独查：只限制空 notice_type，标题归类在 Node 侧，避免 OR+LIKE 打爆索引
      if (!typeColumnName || sourceFilter !== "zfcg") {
        clauses.push("1 = 0");
      } else {
        const categoryColumn = quoteIdentifier(typeColumnName);
        clauses.push(`(${categoryColumn} IS NULL OR TRIM(${categoryColumn}) = '')`);
      }
    } else if (sourceFilter && group.sourceExactTypes && sourceTypes && !sourceTypes.length) {
      clauses.push("1 = 0");
    } else if (exactTypes.length && typeColumnName) {
      const categoryColumn = quoteIdentifier(typeColumnName);
      clauses.push(`${categoryColumn} IN (${exactTypes.map(() => "?").join(", ")})`);
      params.push(...exactTypes);
    } else if (sourceFilter && group.sourceExactTypes && !sourceTypes && !exactTypes.length) {
      clauses.push("1 = 0");
    }
  }

  // 政采网部分 notice_time 被解析成未来日期，混排会霸榜，先挡住异常值
  if ((sourceFilter === "ccgp" || sourceFilter === "guangdong" || sourceFilter === "jiangxi" || sourceFilter === "hunan") && fields.publishTime) {
    clauses.push(
      `(${quoteIdentifier(fields.publishTime)} IS NULL OR ${quoteIdentifier(fields.publishTime)} <= NOW())`
    );
  }

  const regionLabels = normalizeRegionLabels(region, regions);

  let appliedRegion = "";
  if (fields.region && regionLabels.length) {
    const regionColumn = quoteIdentifier(fields.region);
    if (sourceFilter === "easy_prt" || sourceFilter === "ccgp" || sourceFilter === "guangdong" || sourceFilter === "jiangxi" || sourceFilter === "hunan") {
      // 工采通/政采网 region 多为「省名」或「省 市 …」，省/市用包含匹配
      const patterns = [];
      regionLabels.forEach((label) => {
        const text = String(label || "").trim();
        if (!text) return;
        patterns.push(`%${text}%`);
        const short = text.replace(
          /(壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/g,
          ""
        );
        if (short && short !== text) patterns.push(`%${short}%`);
      });
      if (patterns.length) {
        const likeSql = patterns.map(() => `${regionColumn} LIKE ?`).join(" OR ");
        clauses.push(`(${likeSql})`);
        params.push(...patterns);
        appliedRegion = regionLabels.join(",");
      }
    } else {
      const regionValueSet = new Set();
      const expandRegion = sourceFilter === "plap" ? resolvePlapRegionFilter : resolveRegionFilter;
      regionLabels.forEach((label) => {
        expandRegion(label).forEach((value) => regionValueSet.add(value));
      });
      const regionValues = Array.from(regionValueSet);
      if (regionValues.length) {
        const placeholders = regionValues.map(() => "?").join(", ");
        clauses.push(`${regionColumn} IN (${placeholders})`);
        params.push(...regionValues);
        appliedRegion = regionLabels.join(",");
      }
    }
  }

  const selectedBusinessTypes = normalizeBusinessTypes(businessTypes);
  const businessKeywords = resolveBusinessTypeKeywords(selectedBusinessTypes);
  if (fields.title && businessKeywords.length) {
    const titleColumn = quoteIdentifier(fields.title);
    const businessSql = businessKeywords.map(() => `${titleColumn} LIKE ?`).join(" OR ");
    clauses.push(`(${businessSql})`);
    params.push(...businessKeywords.map((word) => `%${word}%`));
  }

  const selectedPartyAType = normalizePartyAType(partyAType);
  const partyAKeywords = resolvePartyAKeywords(selectedPartyAType);
  if (fields.buyer && partyAKeywords.length) {
    const buyerColumn = quoteIdentifier(fields.buyer);
    const partyASql = partyAKeywords.map(() => `${buyerColumn} LIKE ?`).join(" OR ");
    clauses.push(`(${partyASql})`);
    params.push(...partyAKeywords.map((word) => `%${word}%`));
  }

  const selectedAmountRange = normalizeAmountRange(amountRange);
  const amountMeta = resolveAmountRange(selectedAmountRange);
  if (fields.budget && amountMeta) {
    const budgetColumn = quoteIdentifier(fields.budget);
    // 仅处理看起来含数字的金额；含「万」按万元，否则按元转万元。
    const budgetWanExpr = `(CASE
      WHEN ${budgetColumn} IS NULL OR TRIM(${budgetColumn}) = '' THEN NULL
      WHEN ${budgetColumn} NOT REGEXP '[0-9]' THEN NULL
      WHEN ${budgetColumn} LIKE '%万%' THEN CAST(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${budgetColumn}, '万元', ''), '万', ''), '元', ''), ',', ''), ' ', '')
        AS DECIMAL(18,4)
      )
      ELSE CAST(
        REPLACE(REPLACE(REPLACE(REPLACE(${budgetColumn}, '元', ''), '￥', ''), ',', ''), ' ', '')
        AS DECIMAL(18,4)
      ) / 10000
    END)`;
    if (amountMeta.minWan != null) {
      clauses.push(`${budgetWanExpr} >= ?`);
      params.push(amountMeta.minWan);
    }
    if (amountMeta.maxWan != null) {
      clauses.push(`${budgetWanExpr} < ?`);
      params.push(amountMeta.maxWan);
    }
  }

  const selectedExpiryRange = normalizeExpiryRange(expiryRange);
  const expiryMeta = resolveExpiryRange(selectedExpiryRange, {
    customStart: expiryStartDate,
    customEnd: expiryEndDate,
  });
  if (fields.deadline && expiryMeta) {
    const deadlineColumn = quoteIdentifier(fields.deadline);
    if (expiryMeta.startDate) {
      clauses.push(`${deadlineColumn} >= ?`);
      params.push(expiryMeta.startDate);
    }
    if (expiryMeta.endDate) {
      clauses.push(`${deadlineColumn} <= ?`);
      params.push(expiryMeta.endDate);
    }
  }

  const selectedPropertyFormat = normalizePropertyFormat(propertyFormat);
  const propertyKeywords = resolvePropertyFormatKeywords(selectedPropertyFormat);
  if (fields.title && propertyKeywords.length) {
    const titleColumn = quoteIdentifier(fields.title);
    const propertySql = propertyKeywords.map(() => `${titleColumn} LIKE ?`).join(" OR ");
    clauses.push(`(${propertySql})`);
    params.push(...propertyKeywords.map((word) => `%${word}%`));
  }

  const selectedContractPeriod = normalizeContractPeriod(contractPeriod);
  const contractKeywords = resolveContractPeriodKeywords(selectedContractPeriod);
  if (fields.title && contractKeywords.length) {
    const titleColumn = quoteIdentifier(fields.title);
    const contractSql = contractKeywords.map(() => `${titleColumn} LIKE ?`).join(" OR ");
    clauses.push(`(${contractSql})`);
    params.push(...contractKeywords.map((word) => `%${word}%`));
  }

  const selectedAttachmentFilter = normalizeAttachmentFilter(attachmentFilter);
  if (selectedAttachmentFilter === "has") {
    // ponytail: 筛选「有附件」只看 attchs JSON，不扫 content_html
    const attachmentPredicate = buildHasAttachmentPredicate(fields, sourceFilter, { scanContent: false });
    if (attachmentPredicate) clauses.push(attachmentPredicate);
    else clauses.push("1 = 0");
  }

  const selectedTurnoverFilter = normalizeTurnoverFilter(turnoverFilter);
  const turnoverKeywords = resolveTurnoverKeywords(selectedTurnoverFilter);
  if (fields.title && turnoverKeywords.length) {
    const titleColumn = quoteIdentifier(fields.title);
    const turnoverSql = turnoverKeywords.map(() => `${titleColumn} LIKE ?`).join(" OR ");
    clauses.push(`(${turnoverSql})`);
    params.push(...turnoverKeywords.map((word) => `%${word}%`));
  }

  const dateRange = normalizeDateRange({ startDate, endDate, date });
  if (fields.publishTime && dateRange.startDate) {
    const publishTime = quoteIdentifier(fields.publishTime);
    clauses.push(`${publishTime} >= ?`);
    params.push(dateRange.startDate);
  }
  if (fields.publishTime && dateRange.endDate) {
    const publishTime = quoteIdentifier(fields.publishTime);
    clauses.push(`${publishTime} < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(dateRange.endDate);
  }
  const beforeTime = normalizeBeforePublishTime(beforePublishTime);
  if (fields.publishTime && beforeTime) {
    // 键集分页：用上一页最后一条时间继续往旧翻，避免大 OFFSET
    clauses.push(`${quoteIdentifier(fields.publishTime)} < ?`);
    params.push(beforeTime);
  }

  const text = String(keyword || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  let safeSearch = false;
  if (text) {
    if (fields.title) {
      const titleColumn = quoteIdentifier(fields.title);
      const safe = buildSafeTitleClauses(titleColumn, text);
      clauses.push(...safe.clauses);
      params.push(...safe.params);
      safeSearch = true;
    } else {
      // 未识别到标题字段时不允许退化为无条件全表查询。
      clauses.push("1 = 0");
    }
  }
  // 地区筛选与关键词同属安全查询：时间索引早停 + LIMIT，不做全库精确统计
  if (appliedRegion) safeSearch = true;

  return {
    sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
    safeSearch,
    beforePublishTime: beforeTime,
    categoryGroup: groupKey,
    categoryGroupLabel: group ? group.label : "",
    region: appliedRegion,
    businessTypes: selectedBusinessTypes,
    partyAType: selectedPartyAType,
    amountRange: selectedAmountRange,
    expiryRange: selectedExpiryRange,
    propertyFormat: selectedPropertyFormat,
    contractPeriod: selectedContractPeriod,
    attachmentFilter: selectedAttachmentFilter,
    turnoverFilter: selectedTurnoverFilter,
  };
};

/** @deprecated 兼容旧测试命名 */
const normalizeScalar = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "bigint") return value.toString();
  return String(value).trim();
};

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const htmlToText = (value) => {
  const raw = normalizeScalar(value);
  if (!raw) return "";
  return decodeEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/?(table|thead|tbody|tfoot)[^>]*>/gi, "\n")
      .replace(/<\/tr\s*>/gi, "\n")
      .replace(/<\/t[dh]\s*>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/** 清洗后供小程序 rich-text 使用的 HTML */
const sanitizeHtmlForRichText = (value) => {
  const raw = normalizeScalar(value);
  if (!raw) return "";
  if (!/<[a-z][\s\S]*>/i.test(raw)) {
    return `<div>${escapeHtml(raw).replace(/\n/g, "<br/>")}</div>`;
  }
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<\/?(html|head|body|meta|link)[^>]*>/gi, "")
    .replace(/<table([^>]*)>/gi, '<table$1 style="width:100%;border-collapse:collapse;font-size:13px;">')
    .replace(/<(td|th)([^>]*)>/gi, '<$1$2 style="border:1px solid #d7dee8;padding:8px 6px;word-break:break-word;vertical-align:top;">')
    .replace(/<img([^>]*?)>/gi, (match, attrs) => {
      if (/style=/i.test(attrs)) {
        return `<img${attrs.replace(/style\s*=\s*(['"])[\s\S]*?\1/i, 'style="max-width:100%;height:auto;"')}>`;
      }
      return `<img${attrs} style="max-width:100%;height:auto;">`;
    })
    .slice(0, 500000)
    .trim();
};

const splitParagraphs = (text) => {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!normalized) return [];
  return normalized
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2000);
};

const guessAttachmentName = (url, fallback = "附件") => {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname || "");
    const base = pathname.split("/").filter(Boolean).pop() || "";
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base.slice(0, 200);
  } catch (e) {
    /* ignore */
  }
  return fallback;
};

const normalizeAttachmentItem = (item, baseUrl = "") => {
  if (!item) return null;
  if (typeof item === "string") {
    const url = item.trim();
    if (!/^https?:\/\//i.test(url)) return null;
    return { url, name: guessAttachmentName(url) };
  }
  const rawUrl = String(item.url || item.href || item.link || item.fileUrl || "").trim();
  const filePath = String(item.file || item.path || "").trim();
  const url = toAbsoluteUrl(rawUrl, baseUrl) || toAbsoluteUrl(filePath, baseUrl);
  if (!/^https?:\/\//i.test(url)) return null;
  const name =
    String(item.name || item.filename || item.fileName || item.title || "").trim() ||
    guessAttachmentName(url);
  return { url, name: name.slice(0, 200) };
};

const parseAttachmentsJson = (value, baseUrl = "") => {
  let raw = value;
  if (raw == null || raw === "") return [];
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text || text === "null" || text === "[]") return [];
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeAttachmentItem(item, baseUrl)).filter(Boolean);
};

const isAttachmentAnchor = (tagHtml, url, name) => {
  if (/annAttachment|class\s*=\s*["'][^"']*attach/i.test(tagHtml)) return true;
  if (/附件|文件集|合同扫描|下载/i.test(tagHtml) || /附件|文件集/.test(name)) return true;
  return ATTACHMENT_EXT_RE.test(url) || ATTACHMENT_EXT_RE.test(name);
};

const toAbsoluteUrl = (rawUrl, baseUrl = "") => {
  const candidate = decodeEntities(String(rawUrl || "")).trim();
  if (!candidate) return "";
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (/^\/\//.test(candidate)) return `https:${candidate}`;
  try {
    if (!baseUrl) return "";
    return new URL(candidate, String(baseUrl || "").trim()).toString();
  } catch (e) {
    return "";
  }
};

const extractUrlFromOnclick = (text, baseUrl = "") => {
  const value = String(text || "");
  if (!value) return "";
  const directMatch = value.match(/https?:\/\/[^"')\s]+/i);
  if (directMatch) return directMatch[0];
  const quotedMatch = value.match(/['"]([^'"]+\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|wps)(?:\?[^'"]*)?)['"]/i);
  if (quotedMatch) return toAbsoluteUrl(quotedMatch[1], baseUrl);
  const relativeMatch = value.match(/['"]([^'"]*download[^'"]*)['"]/i);
  if (relativeMatch) return toAbsoluteUrl(relativeMatch[1], baseUrl);
  return "";
};

const extractAttachmentsFromHtml = (html, options = {}) => {
  const baseUrl = String(options.baseUrl || "").trim();
  const relaxed = !!options.relaxed;
  const list = [];
  const re = /<a\b([^>]*)href\s*=\s*(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    const attrsRaw = `${match[1] || ""} ${match[4] || ""}`;
    const hrefRaw = decodeEntities(match[3] || "").trim();
    const attrUrlMatch = attrsRaw.match(/\b(?:data-url|data-href|href)\s*=\s*(['"])(.*?)\1/i);
    const onclickMatch = attrsRaw.match(/\bonclick\s*=\s*(['"])([\s\S]*?)\1/i);
    const url =
      toAbsoluteUrl(hrefRaw, baseUrl) ||
      toAbsoluteUrl(attrUrlMatch ? attrUrlMatch[2] : "", baseUrl) ||
      extractUrlFromOnclick(onclickMatch ? onclickMatch[2] : "", baseUrl);
    const name = htmlToText(match[5] || "").slice(0, 200) || guessAttachmentName(url);
    const tagHtml = `${attrsRaw}${match[5] || ""}`;
    if (!/^https?:\/\//i.test(url)) continue;
    if (!relaxed && !isAttachmentAnchor(tagHtml, url, name)) continue;
    list.push({ url, name });
  }
  return list;
};

const dedupeAttachments = (items) => {
  const seen = new Set();
  const result = [];
  (items || []).forEach((item) => {
    const normalized = normalizeAttachmentItem(item);
    if (!normalized) return;
    if (seen.has(normalized.url)) return;
    seen.add(normalized.url);
    result.push(normalized);
  });
  return result.slice(0, 30);
};

const stripAttachmentAnchors = (html) =>
  String(html || "").replace(
    /<a\b([^>]*)href\s*=\s*(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi,
    (full, pre, quote, href, post, inner) => {
      const url = decodeEntities(href || "").trim();
      const name = htmlToText(inner || "").slice(0, 200) || guessAttachmentName(url, "");
      const tagHtml = `${pre || ""}${post || ""}${inner || ""}`;
      if (!/^https?:\/\//i.test(url) || !isAttachmentAnchor(tagHtml, url, name)) return full;
      return name ? `<span>${escapeHtml(name)}</span>` : "";
    }
  );

const normalizePhoneDisplay = (raw) =>
  String(raw || "")
    .replace(/[－—]/g, "-")
    .replace(/\s+/g, "")
    .trim();

const toDialNumber = (display) => normalizePhoneDisplay(display).replace(/[^\d+]/g, "");

const isValidPhoneDial = (dial) => {
  const value = String(dial || "");
  if (/^1[3-9]\d{9}$/.test(value)) return true;
  if (/^0\d{9,11}$/.test(value)) return true;
  if (/^400\d{7}$/.test(value)) return true;
  return false;
};

/** 从公告正文提取联系电话（表无独立字段） */
const extractContactPhone = (html, text) => {
  const sourceHtml = String(html || "");
  const sourceText = String(text || "").trim() || htmlToText(sourceHtml);
  const candidates = [];

  const push = (raw, priority) => {
    const display = normalizePhoneDisplay(htmlToText(raw));
    const dial = toDialNumber(display);
    if (!isValidPhoneDial(dial)) return;
    if (candidates.some((item) => item.dial === dial)) return;
    candidates.push({
      display: display.includes("-") ? display : dial,
      dial,
      priority,
    });
  };

  let match;
  const classRe = /purchaserLinkTel[^>]*>([\s\S]*?)<\//gi;
  while ((match = classRe.exec(sourceHtml))) {
    push(match[1], 1);
  }

  const htmlLabelRe =
    /联系(?:方式|电话)\s*[:：]?\s*(?:<[^>]+>\s*)*([0-9\-－—\s]{7,20})/gi;
  while ((match = htmlLabelRe.exec(sourceHtml))) {
    push(match[1], 2);
  }

  const textLabelRe = /联系(?:方式|电话)\s*[:：]?\s*([0-9\-－—\s]{7,20})/g;
  while ((match = textLabelRe.exec(sourceText))) {
    push(match[1], 3);
  }

  if (!candidates.length) {
    const near = sourceText.match(/联系[\s\S]{0,40}?(1[3-9]\d{9})/);
    if (near) push(near[1], 4);
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.priority - b.priority);
  return { display: candidates[0].display, dial: candidates[0].dial };
};

const normalizeNotice = (row, includeContent = false, sourceOverride = "") => {
  const rawAttachments = row ? row.attachments : undefined;
  const rawHasAttachment = row ? row.hasAttachment : undefined;
  const notice = {};
  Object.keys(row || {}).forEach((key) => {
    if (key === "attachments" || key === "hasAttachment") return;
    notice[key] = normalizeScalar(row[key]);
  });
  if (sourceOverride && !notice.source) notice.source = sourceOverride;
  notice.title = htmlToText(notice.title).slice(0, 300);
  notice.sourceCode = String(notice.source || "").trim().toLowerCase();
  notice.sourceLabel = formatSourceLabel(notice.sourceCode || notice.source);
  if (notice.sourceCode === "plap") {
    const manner = String(notice.category || "").trim();
    notice.category = PLAP_PURCHASE_MANNER[manner] || (/[\u4e00-\u9fff]/.test(manner) ? manner : "公告");
    const projectNo = String(notice.projectNo || "").trim();
    if (!projectNo) {
      const fromTitle = String(notice.title || "").match(/\((20\d{2}-[A-Z0-9\-]+)\)/i);
      if (fromTitle) notice.projectNo = fromTitle[1];
    }
    if (!String(notice.budget || "").trim() && String(notice.successfulMoney || "").trim()) {
      notice.budget = String(notice.successfulMoney).trim();
    }
    const snippet = includeContent
      ? ""
      : String(notice.contentSnippet || "");
    // 详情在正文清洗后再补全；列表用摘要立刻补全外显字段
    if (!includeContent) {
      enrichPlapOverview(notice, snippet);
      delete notice.contentSnippet;
    }
  }

  if (notice.sourceCode === "easy_prt") {
    // 占位字段先清空，再按采购网口径从正文补全
    if (isEasyPrtPlaceholder(notice.buyer)) notice.buyer = "";
    if (isEasyPrtPlaceholder(notice.agency)) notice.agency = "";
    if (isEasyPrtPlaceholder(notice.projectNo)) notice.projectNo = "";
    if (isEasyPrtPlaceholder(notice.budget)) notice.budget = "";
    const snippet = includeContent ? "" : String(notice.contentSnippet || "");
    if (!includeContent) {
      enrichEasyPrtOverview(notice, snippet);
      delete notice.contentSnippet;
    }
    notice.category = normalizeEasyPrtCategory(notice.category);
  }

  if (notice.sourceCode === "ccgp" || notice.sourceCode === "guangdong" || notice.sourceCode === "jiangxi" || notice.sourceCode === "hunan") {
    const regionRaw = String(notice.region || "").trim();
    if (!regionRaw || /^(采购人|采购单位|招标人)\s*[:：]/.test(regionRaw)) {
      notice.region = "";
    }
    if (!String(notice.buyer || "").trim()) notice.buyer = "";
    if (!String(notice.agency || "").trim()) notice.agency = "";
    if (!String(notice.projectNo || "").trim()) notice.projectNo = "";
    if (!String(notice.budget || "").trim()) {
      const money = String(notice.successfulMoney || "").trim();
      notice.budget = money || "";
    }
    if (!includeContent) delete notice.contentSnippet;
  }

  const fromJson = notice.sourceCode === "plap" ? [] : parseAttachmentsJson(rawAttachments, notice.url);
  const resolveHasAttachment = () => {
    if (notice.sourceCode === "plap") return false;
    if (rawHasAttachment !== undefined && rawHasAttachment !== null) {
      return Number(rawHasAttachment) > 0;
    }
    return fromJson.length > 0;
  };

  if (includeContent) {
    const rawContent = notice.content || "";
    const sanitized = sanitizeHtmlForRichText(rawContent);
    notice.contentHtml = stripAttachmentAnchors(sanitized);
    notice.contentText = htmlToText(rawContent).slice(0, 200000);
    notice.contentParagraphs = splitParagraphs(notice.contentText);
    if (notice.sourceCode === "plap") {
      enrichPlapOverview(notice, notice.contentText);
      notice.attachments = [];
      notice.hasAttachment = false;
    } else if (notice.sourceCode === "easy_prt") {
      enrichEasyPrtOverview(notice, notice.contentText);
    } else if (notice.sourceCode === "ccgp" || notice.sourceCode === "guangdong" || notice.sourceCode === "jiangxi" || notice.sourceCode === "hunan") {
      if (!String(notice.budget || "").trim() && String(notice.successfulMoney || "").trim()) {
        notice.budget = String(notice.successfulMoney).trim();
      }
    }
    if (notice.sourceCode !== "plap") {
      const htmlAttachments = extractAttachmentsFromHtml(rawContent, {
        baseUrl: notice.url,
        // 科技厅/工信厅/工采通常见相对链接和脚本触发下载，放宽识别规则
        relaxed:
          notice.sourceCode === "kjt" ||
          notice.sourceCode === "gxt" ||
          notice.sourceCode === "easy_prt" ||
          notice.sourceCode === "ccgp" ||
          notice.sourceCode === "guangdong" ||
          notice.sourceCode === "jiangxi" ||
          notice.sourceCode === "hunan",
      });
      // 服务器库里已有 attchs 时，以 attchs 为准，避免把正文里的普通下载链接误识别成大量附件。
      notice.attachments = dedupeAttachments(fromJson.length ? fromJson : htmlAttachments);
      notice.hasAttachment = notice.attachments.length > 0;
    }
    const phone = extractContactPhone(rawContent, notice.contentText);
    if (phone) {
      notice.contactPhone = phone.display;
      notice.contactPhoneDial = phone.dial;
    }
    delete notice.content;
  } else {
    notice.hasAttachment = resolveHasAttachment();
  }
  return notice;
};

const pickListIndexHint = (schema, sourceFilter, options = {}) => {
  // 空搜/分类 Tab 都按时间倒序取前 N 条：强制时间索引可 early-stop。
  // 多 notice_type IN 勿走 idx_source_type_time（易跳跃扫描/filesort）。
  // 极少类型精确过滤（≤2）走 type 索引，避免在时间索引上过滤稀有类型扫大量行。
  const regionValueCount = clampInt(options.regionValueCount, 0, 10000, 0);
  const regionIndexMax = clampInt(options.regionIndexMax, 1, 64, DEFAULT_SAFE_REGION_INDEX_MAX);
  const useRegionIndex =
    !!options.regionOnly &&
    regionValueCount > 0 &&
    regionValueCount <= regionIndexMax &&
    options.sourceFilter !== "easy_prt" &&
    options.sourceFilter !== "ccgp" &&
    options.sourceFilter !== "guangdong" &&
    options.sourceFilter !== "jiangxi" &&
    options.sourceFilter !== "hunan";

  if (
    schema.table === DEFAULT_GXT_TABLE ||
    schema.table === DEFAULT_PLAP_TABLE
  ) {
    if (schema.table === DEFAULT_PLAP_TABLE && useRegionIndex) {
      return " FORCE INDEX (idx_region_publish_time)";
    }
    return " FORCE INDEX (idx_publish_time)";
  }
  if (schema.table === DEFAULT_EASY_PRT_TABLE || schema.table === DEFAULT_CCGP_TABLE) {
    return " FORCE INDEX (idx_notice_time)";
  }
  if (schema.table !== DEFAULT_TABLE) return "";
  if (options.safeQuery) {
    if (useRegionIndex && sourceFilter) return " FORCE INDEX (idx_source_region_time)";
    if (sourceFilter) return " FORCE INDEX (idx_source_notice_time)";
    return " FORCE INDEX (idx_notice_time)";
  }
  const exactTypeCount = clampInt(options.exactTypeCount, 0, 100, 0);
  if (sourceFilter && exactTypeCount > 0 && exactTypeCount <= 2) {
    return " FORCE INDEX (idx_source_type_time)";
  }
  if (sourceFilter) return " FORCE INDEX (idx_source_notice_time)";
  return " FORCE INDEX (idx_notice_time)";
};

const resolveSafeRegionIndexMax = (env = process.env) =>
  clampInt(env.BIAOXUN_SAFE_REGION_INDEX_MAX, 1, 64, DEFAULT_SAFE_REGION_INDEX_MAX);

const normalizeRegionLabels = (region = "", regions = []) => {
  const labels = [];
  const push = (value) => {
    const label = String(value || "").trim();
    if (!label || label === "全部" || labels.includes(label)) return;
    labels.push(label);
  };
  if (Array.isArray(regions)) regions.forEach(push);
  push(region);
  return labels;
};

const countExpandedRegionValues = (regionLabels = [], sourceFilter = "") => {
  if (!Array.isArray(regionLabels) || !regionLabels.length) return 0;
  if (sourceFilter === "easy_prt" || sourceFilter === "ccgp" || sourceFilter === "guangdong" || sourceFilter === "jiangxi" || sourceFilter === "hunan") return regionLabels.length;
  const expandRegion = sourceFilter === "plap" ? resolvePlapRegionFilter : resolveRegionFilter;
  const set = new Set();
  regionLabels.forEach((label) => {
    expandRegion(label).forEach((value) => set.add(value));
  });
  return set.size;
};

const hasTitleLikeListFilters = (input = {}) => {
  const keyword = String(input.keyword || "").trim();
  if (keyword) return true;
  const businessTypes = normalizeBusinessTypes(input.businessTypes || []);
  if (resolveBusinessTypeKeywords(businessTypes).length) return true;
  const turnoverFilter = normalizeTurnoverFilter(input.turnoverFilter || "");
  if (resolveTurnoverKeywords(turnoverFilter).length) return true;
  return false;
};

/** 与 buildListWhere 的 exactTypes 口径对齐，供索引选择 */
const resolveExactTypeCount = (sourceFilter, categoryGroup) => {
  const groupKey = normalizeCategoryGroup(categoryGroup);
  const group = groupKey ? CATEGORY_GROUPS[groupKey] : null;
  if (!group) return 0;
  const sourceTypes =
    sourceFilter && group.sourceExactTypes && Array.isArray(group.sourceExactTypes[sourceFilter])
      ? group.sourceExactTypes[sourceFilter].filter(Boolean)
      : null;
  if (sourceTypes) return sourceTypes.length;
  if (groupKey === "policy") return 0;
  const defaultExactTypes = Array.isArray(group.exactTypes) ? group.exactTypes.filter(Boolean) : [];
  return defaultExactTypes.length;
};

const listBiaoxunSingle = async (input = {}, dependencies = {}) => {
  const keyword = String(input.keyword || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const resolved = dependencies.executor
    ? { pool: dependencies.executor, config: dependencies.config || getDbConfig() }
    : getPool();
  const executor = resolved.pool;
  const config = resolved.config;
  const env = dependencies.env || process.env;
  const sourceFilter = normalizeSourceFilter(input.source);
  const schema = await resolveSchemaForSource(executor, config, sourceFilter, dependencies);
  const page = clampInt(input.page, 1, 100000, 1);
  const pageSize = DEFAULT_PAGE_SIZE;
  const beforePublishTime = normalizeBeforePublishTime(input.beforePublishTime);
  // 翻页一律键集；禁止大 OFFSET 全库扫
  const useKeyset = !!beforePublishTime || page <= 1;
  const offset = 0;
  const userDateRange = normalizeDateRange({
    startDate: input.startDate,
    endDate: input.endDate,
    date: input.date,
  });
  // 不做默认近 N 天截断；仅用户自选日期生效
  const dateRange = {
    startDate: userDateRange.startDate,
    endDate: userDateRange.endDate,
  };
  const categoryGroup = input.categoryGroup || input.category || "";
  const groupKey = normalizeCategoryGroup(categoryGroup);
  const group = groupKey ? CATEGORY_GROUPS[groupKey] : null;
  const regionLabels = normalizeRegionLabels(input.region || "", input.regions || []);
  const hasRegionFilter = regionLabels.length > 0;
  const regionValueCount = countExpandedRegionValues(regionLabels, sourceFilter);
  const regionOnly = hasRegionFilter && !hasTitleLikeListFilters(input);
  // 关键词/地区：安全查询（时间/地区索引早停 + MAX_EXECUTION_TIME + LIMIT）
  const useSafeQuery = !!(keyword || hasRegionFilter);
  const orderColumn = schema.fields.publishTime || schema.fields.id;
  const tableSql = quoteIdentifier(schema.table);
  const orderSql = orderColumn ? ` ORDER BY ${quoteIdentifier(orderColumn)} DESC` : "";
  const selectSql = buildSelectList(schema.fields, false, sourceFilter, { light: true });
  const fetchLimit = clampInt(input.fetchLimit, 1, pageSize + 1, pageSize + 1);
  const exactTypeCount = resolveExactTypeCount(sourceFilter, categoryGroup);
  const regionIndexMax = resolveSafeRegionIndexMax(env);
  const indexHint = pickListIndexHint(schema, sourceFilter, {
    exactTypeCount,
    safeQuery: useSafeQuery,
    regionOnly,
    regionValueCount,
    regionIndexMax,
    sourceFilter,
  });
  const maxExecMs = resolveSafeMaxExecMs(env);
  const optimizerHint = maxExecMs ? `/*+ MAX_EXECUTION_TIME(${maxExecMs}) */ ` : "";
  const queryTimeout = Math.min(config.queryTimeout, resolveSafeQueryTimeout(env));

  const runPagedQuery = async (extraWhere = {}) => {
    const listWhere = buildListWhere(schema.fields, {
      keyword,
      source: sourceFilter,
      categoryGroup,
      region: input.region || "",
      regions: Array.isArray(input.regions) ? input.regions : [],
      businessTypes: input.businessTypes || [],
      partyAType: input.partyAType || "",
      amountRange: input.amountRange || "",
      expiryRange: input.expiryRange || "",
      expiryStartDate: input.expiryStartDate || "",
      expiryEndDate: input.expiryEndDate || "",
      propertyFormat: input.propertyFormat || "",
      contractPeriod: input.contractPeriod || "",
      attachmentFilter: input.attachmentFilter || "",
      turnoverFilter: input.turnoverFilter || "",
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      beforePublishTime: useKeyset ? beforePublishTime : "",
      ...extraWhere,
    });
    const listSql = `SELECT ${optimizerHint}${selectSql}
         FROM ${tableSql}${indexHint}${listWhere.sql}${orderSql}
        LIMIT ${fetchLimit}`;
    const query = dependencies.executor ? listSql : { sql: listSql, timeout: queryTimeout };
    try {
      const [rows] = dependencies.executor
        ? await executor.query(query, listWhere.params)
        : await runQueryWithRetry(executor, query, listWhere.params, {
            retries: 0,
            timeoutMultiplier: 1.6,
          });
      return { rows: rows || [], timedOut: false, listWhere };
    } catch (error) {
      if (isMaxExecutionTimeError(error)) {
        return { rows: [], timedOut: true, listWhere };
      }
      throw error;
    }
  };

  // 主路径：精确类型 IN + 时间索引 LIMIT，不做全表扫描
  const primary = await runPagedQuery({ categoryTypeMode: "exact" });
  let rawRows = primary.rows;
  let timedOut = primary.timedOut;
  const listWhere = primary.listWhere;

  // 采购网空类型：单独轻量查询后在内存归类，避免 SQL OR+LIKE
  const needEmptyFill =
    !keyword &&
    !hasRegionFilter &&
    sourceFilter === "zfcg" &&
    (groupKey === "tender" || groupKey === "win") &&
    Array.isArray(group?.emptyTitleInclude) &&
    group.emptyTitleInclude.length > 0;
  if (needEmptyFill && !timedOut) {
    const emptyFetchLimit = Math.min(40, Math.max(fetchLimit * 3, 20));
    const emptyWhere = buildListWhere(schema.fields, {
      keyword: "",
      source: sourceFilter,
      categoryGroup,
      categoryTypeMode: "empty",
      region: input.region || "",
      regions: Array.isArray(input.regions) ? input.regions : [],
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      beforePublishTime: useKeyset ? beforePublishTime : "",
    });
    const emptySql = `SELECT ${optimizerHint}${selectSql}
         FROM ${tableSql}${indexHint}${emptyWhere.sql}${orderSql}
        LIMIT ${emptyFetchLimit}`;
    const emptyQuery = dependencies.executor ? emptySql : { sql: emptySql, timeout: queryTimeout };
    try {
      const [emptyRows] = dependencies.executor
        ? await executor.query(emptyQuery, emptyWhere.params)
        : await runQueryWithRetry(executor, emptyQuery, emptyWhere.params, { retries: 0 });
      const matched = (emptyRows || []).filter((row) =>
        matchEmptyTitleHeuristic(row.title || row.notice_title, groupKey)
      );
      const seen = new Set(rawRows.map((row) => String(row.id)));
      matched.forEach((row) => {
        const id = String(row.id);
        if (seen.has(id)) return;
        seen.add(id);
        rawRows.push(row);
      });
      rawRows.sort((a, b) => comparePublishTimeDesc(
        { publishTime: a.publishTime, sourceCode: sourceFilter, id: a.id },
        { publishTime: b.publishTime, sourceCode: sourceFilter, id: b.id }
      ));
      rawRows = rawRows.slice(0, fetchLimit);
    } catch (error) {
      if (isMaxExecutionTimeError(error)) {
        timedOut = timedOut || true;
      } else {
        throw error;
      }
    }
  }

  const hasMore = !timedOut && rawRows.length > pageSize;
  const pageRows = hasMore ? rawRows.slice(0, pageSize) : rawRows;
  const loaded = pageRows.length;
  const total = hasMore || timedOut ? null : beforePublishTime ? null : loaded;
  const nextBeforePublishTime = pageRows.length
    ? normalizeBeforePublishTime(pageRows[pageRows.length - 1].publishTime)
    : "";
  const emptyHint = "";
  return {
    success: true,
    data: pageRows.map((row) => normalizeNotice(row, false, sourceFilter)),
    _mergeCandidates: rawRows.map((row) => normalizeNotice(row, false, sourceFilter)),
    total,
    loaded,
    page,
    pageSize,
    hasMore,
    safeSearch: useSafeQuery,
    lookbackDays: null,
    timedOut,
    nextBeforePublishTime,
    searchHint: timedOut
      ? hasRegionFilter
        ? "查询超时，请缩小地区范围或加上日期筛选"
        : "查询超时，请换更具体的词或加上日期/地区筛选"
      : emptyHint,
    source: sourceFilter || "all",
    sourceName: group
      ? group.label
      : sourceFilter
        ? formatSourceLabel(sourceFilter)
        : "标讯数据库",
    categoryGroup: groupKey || "",
    categoryGroupLabel: group ? group.label : listWhere.categoryGroupLabel || "",
    region: listWhere.region || "",
    businessTypes: listWhere.businessTypes || [],
    partyAType: listWhere.partyAType || "",
    amountRange: listWhere.amountRange || "",
    expiryRange: listWhere.expiryRange || "",
    propertyFormat: listWhere.propertyFormat || "",
    contractPeriod: listWhere.contractPeriod || "",
    attachmentFilter: listWhere.attachmentFilter || "",
    turnoverFilter: listWhere.turnoverFilter || "",
    filterStartDate: dateRange.startDate,
    filterEndDate: dateRange.endDate,
  };
};

const listBiaoxun = async (input = {}, dependencies = {}) => {
  const categoryGroup = input.categoryGroup || input.category || "";
  const sources = resolveListSources(input.source, categoryGroup, {
    excludePlap: !!input.excludePlap,
  });
  if (sources.length <= 1) {
    const result = await listBiaoxunSingle(
      { ...input, source: sources[0] || input.source || "" },
      dependencies
    );
    delete result._mergeCandidates;
    return result;
  }

  const pageSize = DEFAULT_PAGE_SIZE;
  const page = clampInt(input.page, 1, 100000, 1);
  const settled = await Promise.allSettled(
    sources.map((source) =>
      listBiaoxunSingle(
        {
          ...input,
          source,
          // 各源多取 1 条，混排后判断 hasMore
          fetchLimit: pageSize + 1,
        },
        dependencies
      )
    )
  );

  const results = [];
  let timedOut = false;
  settled.forEach((item) => {
    if (item.status !== "fulfilled") {
      timedOut = true;
      return;
    }
    const part = item.value;
    results.push(part);
    if (part.timedOut) timedOut = true;
  });

  const merged = [];
  results.forEach((part) => {
    (part._mergeCandidates || part.data || []).forEach((row) => merged.push(row));
  });
  merged.sort(comparePublishTimeDesc);
  const hasMore = merged.length > pageSize;
  const pageRows = hasMore ? merged.slice(0, pageSize) : merged;
  const beforePublishTime = normalizeBeforePublishTime(input.beforePublishTime);
  const loaded = pageRows.length;
  const total = hasMore || timedOut ? null : beforePublishTime ? null : loaded;
  const nextBeforePublishTime = pageRows.length
    ? normalizeBeforePublishTime(pageRows[pageRows.length - 1].publishTime)
    : "";
  const groupKey = normalizeCategoryGroup(categoryGroup);
  const group = groupKey ? CATEGORY_GROUPS[groupKey] : null;
  const keyword = String(input.keyword || "").trim();
  const hasRegionFilter = normalizeRegionLabels(input.region || "", input.regions || []).length > 0;
  const useSafeQuery = !!(keyword || hasRegionFilter);
  const base = results[0] || {};
  // 多源部分超时但仍有结果时不提示超时，避免政策公开被采购网稀有类型拖成“失败感”
  const showTimeoutHint = timedOut && pageRows.length === 0;
  return {
    success: true,
    data: pageRows,
    total,
    loaded,
    page,
    pageSize,
    hasMore,
    safeSearch: useSafeQuery,
    lookbackDays: null,
    timedOut,
    nextBeforePublishTime,
    searchHint: showTimeoutHint
      ? hasRegionFilter
        ? "查询超时，请缩小地区范围或加上日期筛选"
        : "查询超时，请换更具体的词或加上日期/地区筛选"
      : "",
    source: "all",
    sourceName: group ? group.label : "标讯数据库",
    sources,
    categoryGroup: groupKey || "",
    categoryGroupLabel: group ? group.label : "",
    region: base.region || "",
    businessTypes: base.businessTypes || [],
    partyAType: base.partyAType || "",
    amountRange: base.amountRange || "",
    expiryRange: base.expiryRange || "",
    propertyFormat: base.propertyFormat || "",
    contractPeriod: base.contractPeriod || "",
    attachmentFilter: base.attachmentFilter || "",
    turnoverFilter: base.turnoverFilter || "",
    filterStartDate: base.filterStartDate || "",
    filterEndDate: base.filterEndDate || "",
  };
};

const countBiaoxun = async (input = {}, dependencies = {}) => {
  const startedAt = Date.now();
  const resolved = dependencies.executor
    ? { pool: dependencies.executor, config: dependencies.config || getDbConfig() }
    : getPool();
  const executor = resolved.pool;
  const config = resolved.config;
  const sourceFilter = normalizeSourceFilter(input.source);
  const schema = await resolveSchemaForSource(executor, config, sourceFilter, dependencies);
  const keyword = String(input.keyword || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!keyword) return { success: true, total: 0 };

  const dateRange = normalizeDateRange({
    startDate: input.startDate,
    endDate: input.endDate,
    date: input.date,
  });
  const where = buildListWhere(schema.fields, {
    keyword,
    source: sourceFilter,
    categoryGroup: input.categoryGroup || input.category || "",
    region: input.region || "",
    regions: Array.isArray(input.regions) ? input.regions : [],
    businessTypes: input.businessTypes || [],
    partyAType: input.partyAType || "",
    amountRange: input.amountRange || "",
    expiryRange: input.expiryRange || "",
    expiryStartDate: input.expiryStartDate || "",
    expiryEndDate: input.expiryEndDate || "",
    propertyFormat: input.propertyFormat || "",
    contractPeriod: input.contractPeriod || "",
    attachmentFilter: input.attachmentFilter || "",
    turnoverFilter: input.turnoverFilter || "",
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });
  const countSql = `SELECT COUNT(*) AS total
       FROM ${quoteIdentifier(schema.table)}${where.sql}`;
  const query = dependencies.executor
    ? countSql
    : { sql: countSql, timeout: config.countQueryTimeout || config.queryTimeout };
  const [rows] = dependencies.executor
    ? await executor.query(query, where.params)
    : await runQueryWithRetry(executor, query, where.params, { retries: 1, timeoutMultiplier: 1.5 });
  return {
    success: true,
    total: Number(rows?.[0]?.total || 0),
    strategy: "sql-title-count-v2",
    elapsedMs: Date.now() - startedAt,
    source: sourceFilter || "all",
    categoryGroup: where.categoryGroup || "",
    categoryGroupLabel: where.categoryGroupLabel || "",
    region: where.region || "",
    businessTypes: where.businessTypes || [],
    partyAType: where.partyAType || "",
    amountRange: where.amountRange || "",
    expiryRange: where.expiryRange || "",
    propertyFormat: where.propertyFormat || "",
    contractPeriod: where.contractPeriod || "",
    attachmentFilter: where.attachmentFilter || "",
    turnoverFilter: where.turnoverFilter || "",
    filterStartDate: dateRange.startDate,
    filterEndDate: dateRange.endDate,
  };
};

const getBiaoxunDetail = async (input = {}, dependencies = {}) => {
  const id = String(input.id || "").trim();
  if (!id || id.length > 200) return { success: false, errMsg: "标讯编号无效" };
  const resolved = dependencies.executor
    ? { pool: dependencies.executor, config: dependencies.config || getDbConfig() }
    : getPool();
  const executor = resolved.pool;
  const config = resolved.config;
  const sourceFilter = normalizeSourceFilter(input.source);
  const schema = await resolveSchemaForSource(executor, config, sourceFilter, dependencies);
  const selectSql = buildSelectList(schema.fields, true, sourceFilter);
  const detailSql = `SELECT ${selectSql}
       FROM ${quoteIdentifier(schema.table)}
      WHERE ${quoteIdentifier(schema.fields.id)} = ?
      LIMIT 1`;
  const detailQuery = dependencies.executor ? detailSql : { sql: detailSql, timeout: config.queryTimeout };
  const [rows] = await executor.query(detailQuery, [id]);
  if (!rows || !rows.length) return { success: false, errMsg: "标讯不存在或已下线" };
  const data = normalizeNotice(rows[0], true, sourceFilter);
  return {
    success: true,
    data,
    sourceName: data.sourceLabel || "标讯数据库",
  };
};

const guessFileExtension = (name, url, contentType = "") => {
  const fromName = String(name || "").match(/\.([a-z0-9]{2,5})$/i);
  if (fromName) return `.${fromName[1].toLowerCase()}`;
  try {
    const pathname = new URL(url).pathname || "";
    const fromUrl = pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (fromUrl) return `.${fromUrl[1].toLowerCase()}`;
  } catch (e) {
    /* ignore */
  }
  const type = String(contentType || "").toLowerCase();
  if (type.includes("pdf")) return ".pdf";
  if (type.includes("zip")) return ".zip";
  if (type.includes("word") || type.includes("msword")) return ".doc";
  if (type.includes("sheet") || type.includes("excel")) return ".xls";
  return ".bin";
};

const downloadRemoteBuffer = (url, redirectsLeft = 3) =>
  new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(new Error("附件地址无效"));
      return;
    }
    if (!/^https?:$/i.test(parsed.protocol)) {
      reject(new Error("仅支持 HTTP/HTTPS 附件"));
      return;
    }
    const client = parsed.protocol === "https:" ? require("https") : require("http");
    const host = parsed.hostname || "";
    const referer = host.includes("fujian.gov.cn") || host.includes("czt.fujian")
      ? `${parsed.protocol}//${host}/`
      : undefined;
    const req = client.get(
      url,
      {
        timeout: 45000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
          ...(referer ? { Referer: referer } : {}),
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          downloadRemoteBuffer(nextUrl, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`附件下载失败(${status})`));
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > MAX_ATTACHMENT_BYTES) {
            req.destroy();
            reject(new Error("附件过大，请通过原文链接下载"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: String(res.headers["content-type"] || ""),
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("附件下载超时"));
    });
    req.on("error", (error) => reject(error));
  });

/**
 * 云端拉取外部附件并转存到临时云存储，供小程序 wx.cloud.downloadFile 使用。
 * 上架后不能直链 downloadFile（外链域名不在合法域名列表）。
 */
const fetchBiaoxunAttachment = async (input = {}, dependencies = {}) => {
  const id = String(input.id || "").trim();
  const url = String(input.url || "").trim();
  const source = normalizeSourceFilter(input.source);
  if (source === "plap") return { success: false, errMsg: "军队采购网不支持附件下载" };
  if (!id || id.length > 200) return { success: false, errMsg: "标讯编号无效" };
  if (!/^https:\/\//i.test(url)) return { success: false, errMsg: "仅支持 HTTPS 附件地址" };

  const detail = dependencies.detailLoader
    ? await dependencies.detailLoader({ id, source })
    : await getBiaoxunDetail({ id, source }, dependencies);
  if (!detail.success) return detail;
  const matched = (detail.data.attachments || []).find((item) => {
    const itemUrl = String(item?.url || "").trim();
    if (!itemUrl) return false;
    if (itemUrl === url) return true;
    try {
      return decodeURIComponent(itemUrl) === decodeURIComponent(url);
    } catch (error) {
      return false;
    }
  });
  if (!matched) return { success: false, errMsg: "附件不存在或不属于该公告" };

  const cloudApi = dependencies.cloud;
  if (!cloudApi || typeof cloudApi.uploadFile !== "function") {
    return { success: false, errMsg: "云存储不可用" };
  }

  try {
    const { buffer, contentType } = await downloadRemoteBuffer(url);
    if (!buffer || !buffer.length) return { success: false, errMsg: "附件内容为空" };
    const ext = guessFileExtension(matched.name, url, contentType);
    const day = new Date().toISOString().slice(0, 10);
    // ponytail: 云路径只用短 ascii，避免超长中文文件名导致转存/二次下载异常
    const cloudPath = `biaoxun-tmp/${day}/${String(id).slice(0, 32)}_${Date.now()}${ext || ".bin"}`;
    const upload = await cloudApi.uploadFile({
      cloudPath,
      fileContent: buffer,
    });
    if (!upload || !upload.fileID) return { success: false, errMsg: "附件转存失败" };
    return {
      success: true,
      fileID: upload.fileID,
      name: matched.name,
      size: buffer.length,
    };
  } catch (error) {
    console.error("fetchBiaoxunAttachment failed", error);
    return { success: false, errMsg: error.message || "附件下载失败" };
  }
};

const cleanupBiaoxunAttachment = async (input = {}, dependencies = {}) => {
  const fileID = String(input.fileID || "").trim();
  if (!fileID.startsWith("cloud://")) return { success: false, errMsg: "文件无效" };
  const cloudApi = dependencies.cloud;
  if (!cloudApi || typeof cloudApi.deleteFile !== "function") {
    return { success: false, errMsg: "云存储不可用" };
  }
  try {
    await cloudApi.deleteFile({ fileList: [fileID] });
    return { success: true };
  } catch (error) {
    console.error("cleanupBiaoxunAttachment failed", error);
    return { success: false, errMsg: error.message || "清理失败" };
  }
};

const formatBiaoxunError = (error) => {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");
  console.error("biaoxun database error", code, message);
  if (code === "BIAOXUN_CONFIG_MISSING") {
    return "标讯数据源尚未配置，请先设置云函数数据库账号和密码";
  }
  if (/Access denied|ER_ACCESS_DENIED_ERROR/i.test(message)) return "标讯数据库账号或权限不正确";
  if (/ETIMEDOUT|ECONNREFUSED|PROTOCOL_CONNECTION_LOST|PROTOCOL_SEQUENCE_TIMEOUT|connect timeout|Query inactivity timeout/i.test(`${code} ${message}`)) {
    return "标讯查询超时，请稍后重试或缩小筛选范围";
  }
  if (/doesn't exist|不存在|未找到可识别|字段/.test(message)) return message;
  return "标讯数据加载失败，请稍后重试";
};

const closePool = async () => {
  if (pool && typeof pool.end === "function") await pool.end();
  pool = null;
  poolKey = "";
  schemaCache = null;
  schemaCacheAt = 0;
};

module.exports = {
  listBiaoxun,
  countBiaoxun,
  getBiaoxunDetail,
  fetchBiaoxunAttachment,
  cleanupBiaoxunAttachment,
  formatBiaoxunError,
  closePool,
  getPool,
  _test: {
    normalizeColumns,
    buildFieldMap,
    buildConfiguredSchema,
    scoreTable,
    chooseSchema,
    buildListWhere,
    buildSafeTitleClauses,
    tokenizeKeyword,
    lookbackStartDate,
    normalizeBeforePublishTime,
    normalizeRegionLabels,
    countExpandedRegionValues,
    hasTitleLikeListFilters,
    resolveSafeRegionIndexMax,
    pickListIndexHint,
    resolveExactTypeCount,
    normalizeSourceFilter,
    normalizeCategoryGroup,
    resolveListSources,
    comparePublishTimeDesc,
    matchEmptyTitleHeuristic,
    CATEGORY_SOURCE_MAP,
    getGxtSchema,
    getPlapSchema,
    getEasyPrtSchema,
    getCcgpSchema,
    enrichPlapOverview,
    enrichEasyPrtOverview,
    extractPlapBudget,
    extractPlapBuyer,
    resolveSchemaForSource,
    normalizeDateFilter,
    normalizeDateRange,
    formatSourceLabel,
    htmlToText,
    sanitizeHtmlForRichText,
    splitParagraphs,
    normalizeNotice,
    buildHasAttachmentPredicate,
    buildHasAttachmentExpression,
    findColumn,
    parseAttachmentsJson,
    extractAttachmentsFromHtml,
    dedupeAttachments,
    stripAttachmentAnchors,
    extractContactPhone,
  },
};
