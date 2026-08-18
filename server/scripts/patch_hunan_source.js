const fs = require("fs");

const paths = [
  "d:/提交表单2/cloudfunctions/biaoxunApi/biaoxun.js",
  "d:/提交表单2/cloudfunctions/quickstartFunctions/biaoxun.js",
  "d:/提交表单2/server/biaoxun-query-api/lib/biaoxun.js",
];

const hunanFields = `// 湖南省政府采购网独立表 hunan
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

`;

for (const p of paths) {
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("DEFAULT_HUNAN_TABLE")) {
    console.log("skip already", p);
    continue;
  }

  s = s.replace(
    'const DEFAULT_JIANGXI_TABLE = "jiangxi";',
    'const DEFAULT_JIANGXI_TABLE = "jiangxi";\nconst DEFAULT_HUNAN_TABLE = "hunan";'
  );

  if (!s.includes("DEFAULT_HUNAN_FIELDS")) {
    s = s.replace(
      "\nconst PLAP_PURCHASE_MANNER = {",
      `\n${hunanFields}const PLAP_PURCHASE_MANNER = {`
    );
  }

  s = s.replace(
    '  jiangxi: "江西政府采购网",\n};',
    '  jiangxi: "江西政府采购网",\n  hunan: "湖南政府采购网",\n};'
  );

  s = s.replace(
    `      jiangxi: [
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
    },
    sourceCategoryField: {
      plap: "noticeType",
    },
    // 采购网 notice_type 为空时，按标题关键词兜底归类`,
    `      jiangxi: [
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
    // 采购网 notice_type 为空时，按标题关键词兜底归类`
  );

  s = s.replace(
    `      jiangxi: [
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
    },
    sourceCategoryField: {
      plap: "noticeType",
    },
    emptyTitleInclude: [
      "流标公告",`,
    `      jiangxi: [
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
      "流标公告",`
  );

  s = s.replace(
    '      jiangxi: ["采购意向公告"],\n    },',
    '      jiangxi: ["采购意向公告"],\n      hunan: ["采购意向公开"],\n    },'
  );

  s = s.replace(
    'tender: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "plap"],',
    'tender: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "hunan", "plap"],'
  );
  s = s.replace(
    'win: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "plap"],',
    'win: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "hunan", "plap"],'
  );
  s = s.replace(
    'intent: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "plap"],',
    'intent: ["zfcg", "easy_prt", "ccgp", "guangdong", "jiangxi", "hunan", "plap"],'
  );

  s = s.replace(
    `  if (
    text === "jiangxi" ||
    text === "江西政采网" ||
    text === "江西政府采购网" ||
    text === "江西省政府采购网" ||
    text === "江西省政采网"
  ) {
    return "jiangxi";
  }
  return text.slice(0, 32);
};`,
    `  if (
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
};`
  );

  s = s.replace(
    `const getJiangxiSchema = (env = process.env) => ({
  table: assertIdentifier(
    String(env.BIAOXUN_JIANGXI_TABLE || DEFAULT_JIANGXI_TABLE).trim(),
    "江西政府采购网数据表"
  ),
  columns: [],
  fields: { ...DEFAULT_JIANGXI_FIELDS },
});

const resolveSchemaForSource`,
    `const getJiangxiSchema = (env = process.env) => ({
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

const resolveSchemaForSource`
  );

  s = s.replace(
    `  if (source === "jiangxi") {
    return dependencies.jiangxiSchema || getJiangxiSchema(dependencies.env || process.env);
  }
  return dependencies.schema || resolveSchema(executor, config, dependencies);
};`,
    `  if (source === "jiangxi") {
    return dependencies.jiangxiSchema || getJiangxiSchema(dependencies.env || process.env);
  }
  if (source === "hunan") {
    return dependencies.hunanSchema || getHunanSchema(dependencies.env || process.env);
  }
  return dependencies.schema || resolveSchema(executor, config, dependencies);
};`
  );

  const pairs = [
    [
      'sourceCode !== "guangdong" && sourceCode !== "jiangxi"',
      'sourceCode !== "guangdong" && sourceCode !== "jiangxi" && sourceCode !== "hunan"',
    ],
    [
      'source === "guangdong" || source === "jiangxi") &&',
      'source === "guangdong" || source === "jiangxi" || source === "hunan") &&',
    ],
    [
      'sourceFilter === "guangdong" || sourceFilter === "jiangxi") &&',
      'sourceFilter === "guangdong" || sourceFilter === "jiangxi" || sourceFilter === "hunan") &&',
    ],
    [
      'sourceFilter === "guangdong" || sourceFilter === "jiangxi") {',
      'sourceFilter === "guangdong" || sourceFilter === "jiangxi" || sourceFilter === "hunan") {',
    ],
    [
      'notice.sourceCode === "guangdong" || notice.sourceCode === "jiangxi") {',
      'notice.sourceCode === "guangdong" || notice.sourceCode === "jiangxi" || notice.sourceCode === "hunan") {',
    ],
    [
      "notice.sourceCode === \"guangdong\" ||\n          notice.sourceCode === \"jiangxi\",",
      "notice.sourceCode === \"guangdong\" ||\n          notice.sourceCode === \"jiangxi\" ||\n          notice.sourceCode === \"hunan\",",
    ],
    [
      "options.sourceFilter !== \"guangdong\" &&\n    options.sourceFilter !== \"jiangxi\";",
      "options.sourceFilter !== \"guangdong\" &&\n    options.sourceFilter !== \"jiangxi\" &&\n    options.sourceFilter !== \"hunan\";",
    ],
    [
      'sourceFilter === "guangdong" || sourceFilter === "jiangxi") return',
      'sourceFilter === "guangdong" || sourceFilter === "jiangxi" || sourceFilter === "hunan") return',
    ],
  ];

  for (const [a, b] of pairs) {
    if (!s.includes(a)) {
      console.log("MISS", p, JSON.stringify(a).slice(0, 80));
    } else {
      s = s.split(a).join(b);
    }
  }

  fs.writeFileSync(p, s);
  console.log(
    "patched",
    p,
    "table=",
    s.includes("DEFAULT_HUNAN_TABLE"),
    "schema=",
    s.includes("getHunanSchema"),
    "label=",
    s.includes("湖南政府采购网")
  );
}
