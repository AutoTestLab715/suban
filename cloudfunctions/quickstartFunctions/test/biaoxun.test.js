const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("../biaoxun");

test("chooseSchema selects a likely bidding table and maps common columns", () => {
  const rows = [
    { TABLE_NAME: "users", COLUMN_NAME: "id", COLUMN_KEY: "PRI", DATA_TYPE: "int" },
    { TABLE_NAME: "users", COLUMN_NAME: "name", COLUMN_KEY: "", DATA_TYPE: "varchar" },
    { TABLE_NAME: "bidding_notices", COLUMN_NAME: "notice_id", COLUMN_KEY: "PRI", DATA_TYPE: "bigint" },
    { TABLE_NAME: "bidding_notices", COLUMN_NAME: "notice_title", COLUMN_KEY: "", DATA_TYPE: "varchar" },
    { TABLE_NAME: "bidding_notices", COLUMN_NAME: "publish_time", COLUMN_KEY: "", DATA_TYPE: "datetime" },
    { TABLE_NAME: "bidding_notices", COLUMN_NAME: "purchaser_name", COLUMN_KEY: "", DATA_TYPE: "varchar" },
    { TABLE_NAME: "bidding_notices", COLUMN_NAME: "notice_content", COLUMN_KEY: "", DATA_TYPE: "longtext" },
  ];
  const tableMap = _test.normalizeColumns(rows);
  const schema = _test.chooseSchema(tableMap, { table: "" }, {});
  assert.equal(schema.table, "bidding_notices");
  assert.equal(schema.fields.id, "notice_id");
  assert.equal(schema.fields.title, "notice_title");
  assert.equal(schema.fields.buyer, "purchaser_name");
  assert.equal(schema.fields.content, "notice_content");
});

test("content mapping prefers longtext body over short description", () => {
  const columns = [
    { name: "description", lower: "description", key: "", dataType: "varchar" },
    { name: "content_html", lower: "content_html", key: "", dataType: "longtext" },
  ];
  assert.equal(_test.findColumn(columns, "content", {}), "content_html");
});

test("configured table and field mapping override automatic detection", () => {
  const rows = [
    { TABLE_NAME: "raw_data", COLUMN_NAME: "pk", COLUMN_KEY: "PRI", DATA_TYPE: "bigint" },
    { TABLE_NAME: "raw_data", COLUMN_NAME: "subject", COLUMN_KEY: "", DATA_TYPE: "varchar" },
    { TABLE_NAME: "raw_data", COLUMN_NAME: "posted", COLUMN_KEY: "", DATA_TYPE: "datetime" },
  ];
  const env = {
    BIAOXUN_COLUMN_ID: "pk",
    BIAOXUN_COLUMN_TITLE: "subject",
    BIAOXUN_COLUMN_PUBLISH_TIME: "posted",
  };
  const schema = _test.chooseSchema(_test.normalizeColumns(rows), { table: "raw_data" }, env);
  assert.equal(schema.fields.id, "pk");
  assert.equal(schema.fields.title, "subject");
  assert.equal(schema.fields.publishTime, "posted");
});


test("known notices schema skips information_schema detection by default", () => {
  const schema = _test.buildConfiguredSchema(
    { table: "notices", autoDetectSchema: false },
    { BIAOXUN_COLUMN_TITLE: "title" }
  );
  assert.equal(schema.table, "notices");
  assert.equal(schema.fields.publishTime, "notice_time");
  assert.equal(schema.fields.category, "notice_type");
  assert.equal(schema.fields.content, "content_html");
  assert.equal(schema.fields.attachments, "attchs");
});

test("工信厅 source resolves to the fixed gxt_zcfg schema", () => {
  assert.equal(_test.normalizeSourceFilter("工信厅"), "gxt");
  assert.equal(_test.normalizeSourceFilter("工业和信息化厅"), "gxt");
  const schema = _test.getGxtSchema({});
  assert.equal(schema.table, "gxt_zcfg");
  assert.equal(schema.fields.id, "id");
  assert.equal(schema.fields.title, "title");
  assert.equal(schema.fields.publishTime, "publish_time");
  assert.equal(schema.fields.buyer, "publisher");
  assert.equal(schema.fields.source, "");
});

test("军队采购网 source resolves to the fixed plap schema", () => {
  assert.equal(_test.normalizeSourceFilter("军队采购网"), "plap");
  assert.equal(_test.normalizeSourceFilter("军采网"), "plap");
  const schema = _test.getPlapSchema({});
  assert.equal(schema.table, "plap");
  assert.equal(schema.fields.publishTime, "publish_time");
  assert.equal(schema.fields.buyer, "purchaser");
  assert.equal(schema.fields.category, "purchase_manner");
  assert.equal(schema.fields.contentText, "content_text");
  assert.equal(schema.fields.source, "");
  assert.equal(_test.formatSourceLabel("plap"), "军队采购网");
});

test("工采通 source resolves to the fixed easy_prt schema", () => {
  assert.equal(_test.normalizeSourceFilter("工采通"), "easy_prt");
  assert.equal(_test.normalizeSourceFilter("easy_prt"), "easy_prt");
  const schema = _test.getEasyPrtSchema({});
  assert.equal(schema.table, "easy_prt");
  assert.equal(schema.fields.publishTime, "notice_time");
  assert.equal(schema.fields.buyer, "purchaser");
  assert.equal(schema.fields.agency, "agency");
  assert.equal(schema.fields.deadline, "deadline");
  assert.equal(schema.fields.projectNo, "project_no");
  assert.equal(schema.fields.source, "");
  assert.equal(_test.formatSourceLabel("easy_prt"), "第三方");
});

test("工采通占位字段会从正文按采购网口径补全", () => {
  const notice = {
    buyer: "招标采购",
    agency: "招标采购",
    projectNo: "招标采购",
    budget: "--",
    category: "招标采购",
  };
  _test.enrichEasyPrtOverview(
    notice,
    [
      "项目编号：FZ2026-001",
      "采购人：福州市某单位",
      "代理机构：某某招标代理有限公司",
      "预算金额：750000元",
      "采购方式：公开招标",
    ].join("\n")
  );
  assert.equal(notice.projectNo, "FZ2026-001");
  assert.equal(notice.buyer, "福州市某单位");
  assert.equal(notice.agency, "某某招标代理有限公司");
  assert.equal(notice.budget, "750000元");
  assert.equal(notice.category, "公开招标");
});

test("军队采购网从正文摘要补全采购单位和预算", () => {
  assert.equal(_test.extractPlapBudget("3、投资金额：367275.51元"), "367275.51");
  assert.equal(_test.extractPlapBudget("预算约人民币 170万元"), "170万元");
  assert.equal(
    _test.extractPlapBudget("预中标（成交）供应商： 河南公司 ，报价金额：124500.00 （元）"),
    "124500"
  );
  assert.equal(_test.extractPlapBuyer("采购单位：某某后勤保障中心"), "某某后勤保障中心");
  const notice = {
    title: "乌兰察布市某部房屋防水改造及外墙维修项目采购结果公示",
    buyer: "",
    budget: "",
  };
  _test.enrichPlapOverview(
    notice,
    "我部进行了询价采购。预中标（成交）供应商：内蒙古顺旭建筑工程有限公司 ，报价金额：84268.75 （元）"
  );
  assert.equal(notice.buyer, "乌兰察布市某部");
  assert.equal(notice.budget, "84268.75");
});

test("htmlToText removes unsafe markup and keeps readable line breaks", () => {
  const result = _test.htmlToText("<h2>公告</h2><script>alert(1)</script><p>第一行<br>第二行&nbsp;&amp;</p>");
  assert.equal(result, "公告\n第一行\n第二行 &");
});

const { listBiaoxun, countBiaoxun, getBiaoxunDetail } = require("../biaoxun");

test("listBiaoxun returns normalized pagination data with parameterized search", async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("COUNT(*)")) return [[{ total: 1 }], []];
      return [[{
        id: 7,
        title: "<b>测试项目</b>",
        publishTime: "2026-07-19 10:00:00",
        deadline: "",
        region: "福州",
        buyer: "测试采购人",
        agency: "",
        budget: "100万元",
        source: "测试平台",
        url: "https://example.test/7",
        category: "招标公告",
      }], []];
    },
  };
  const schema = {
    table: "bidding_notices",
    fields: {
      id: "notice_id",
      title: "notice_title",
      publishTime: "publish_time",
      deadline: "deadline",
      region: "city",
      buyer: "purchaser_name",
      agency: "agency_name",
      budget: "budget",
      source: "source_name",
      url: "detail_url",
      category: "notice_type",
      content: "notice_content",
    },
  };
  const result = await listBiaoxun(
    { page: 1, pageSize: 15, keyword: "测试", source: "zfcg" },
    { executor, config: { database: "biaoxun" }, schema }
  );
  assert.equal(result.success, true);
  assert.equal(result.total, 1);
  assert.equal(result.loaded, 1);
  assert.equal(result.hasMore, false);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /COUNT\(\*\)/);
  assert.doesNotMatch(calls[0].sql, /AS `recent`/);
  assert.match(calls[0].sql, /FORCE INDEX \(idx_notice_time\)|FORCE INDEX \(idx_source_notice_time\)|ORDER BY `publish_time` DESC/);
  assert.match(calls[0].sql, /MAX_EXECUTION_TIME\(/);
  assert.match(calls[0].sql, /LIMIT 8/);
  assert.doesNotMatch(calls[0].sql, /_bx_ids/);
  assert.doesNotMatch(calls[0].sql, /MATCH\(/);
  assert.equal(result.pageSize, 8);
  assert.equal(result.data[0].id, "7");
  assert.equal(result.data[0].title, "测试项目");
  assert.match(calls[0].sql, /`notice_title` LIKE \?/);
  assert.ok(calls[0].params.includes("%测试%"));
  assert.equal(result.safeSearch, true);
  assert.equal(result.lookbackDays, null);
});

test("keyword search always uses safe LIKE path", () => {
  const where = _test.buildListWhere(
    { source: "source", title: "title" },
    { source: "zfcg", keyword: "公告" }
  );
  assert.match(where.sql, /`title` LIKE \?/);
  assert.doesNotMatch(where.sql, /MATCH\(/);
  assert.deepEqual(where.params, ["zfcg", "%公告%"]);
  assert.equal(where.safeSearch, true);
});

test("specific keyword also uses safe LIKE path", () => {
  const where = _test.buildListWhere(
    { source: "source", title: "title" },
    { source: "zfcg", keyword: "搬迁" }
  );
  assert.match(where.sql, /`title` LIKE \?/);
  assert.doesNotMatch(where.sql, /MATCH\(/);
  assert.deepEqual(where.params, ["zfcg", "%搬迁%"]);
  assert.equal(where.safeSearch, true);
});

test("single-character keyword uses safe LIKE path", () => {
  const where = _test.buildListWhere(
    { source: "source", title: "title" },
    { source: "zfcg", keyword: "搬" }
  );
  assert.match(where.sql, /`title` LIKE \?/);
  assert.doesNotMatch(where.sql, /MATCH\(/);
  assert.deepEqual(where.params, ["zfcg", "%搬%"]);
});

test("countBiaoxun returns the complete keyword match count without loading all rows", async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{ total: 123 }], []];
    },
  };
  const schema = {
    table: "notices",
    fields: {
      title: "title",
      buyer: "purchaser",
      agency: "agency",
      region: "region",
      category: "notice_type",
      source: "source",
      publishTime: "notice_time",
    },
  };
  const result = await countBiaoxun(
    { keyword: "test", source: "zfcg", startDate: "2026-07-01", endDate: "2026-07-20" },
    { executor, config: { database: "biaoxun" }, schema }
  );
  assert.equal(result.success, true);
  assert.equal(result.total, 123);
  assert.equal(result.strategy, "sql-title-count-v2");
  assert.ok(Number.isFinite(result.elapsedMs));
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SELECT COUNT\(\*\) AS total/);
  assert.match(calls[0].sql, /`title` LIKE \?/);
  assert.doesNotMatch(calls[0].sql, /MATCH\(/);
  assert.doesNotMatch(calls[0].sql, /`purchaser` LIKE \?/);
  assert.doesNotMatch(calls[0].sql, /`agency` LIKE \?/);
  assert.match(calls[0].sql, /notice_time/);
  assert.deepEqual(calls[0].params, ["zfcg", "2026-07-01", "2026-07-20", "%test%"]);
});

test("listBiaoxun filters by source for 采购网 / 科技厅", async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("COUNT(*)")) return [[{ total: 2 }], []];
      return [[{
        id: "a1",
        title: "科技厅项目",
        publishTime: "2026-07-20 09:00:00",
        deadline: "",
        region: "福建",
        buyer: "某单位",
        agency: "",
        budget: "",
        source: "kjt",
        url: "",
        category: "公告",
      }], []];
    },
  };
  const schema = {
    table: "notices",
    fields: {
      id: "id",
      title: "title",
      publishTime: "notice_time",
      deadline: "",
      region: "region",
      buyer: "purchaser",
      agency: "agency",
      budget: "budget",
      source: "source",
      url: "url",
      category: "notice_type",
      content: "content_html",
    },
  };
  const result = await listBiaoxun(
    { page: 1, pageSize: 20, source: "科技厅" },
    { executor, config: { database: "biaoxun" }, schema }
  );
  assert.equal(result.success, true);
  assert.equal(result.source, "kjt");
  assert.equal(result.sourceName, "科技厅");
  assert.equal(result.data[0].sourceLabel, "科技厅");
  assert.ok(calls.every((call) => call.sql.includes("`source` = ?")));
  assert.ok(calls.every((call) => call.params[0] === "kjt"));
});

test("工信厅列表从 gxt_zcfg 查询且不会对不存在的 source 字段过滤", async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{
        id: "gxt-1",
        title: "福建省工业和信息化厅政策通知",
        publishTime: "2026-07-20 09:00:00",
        deadline: null,
        region: null,
        buyer: "福建省工业和信息化厅",
        agency: null,
        budget: null,
        source: null,
        url: "https://example.test/gxt-1",
        category: "政策法规",
        hasAttachment: 0,
      }], []];
    },
  };
  const result = await listBiaoxun(
    { page: 1, pageSize: 15, source: "工信厅", keyword: "政策" },
    { executor, config: { database: "biaoxun" } }
  );
  assert.equal(result.success, true);
  assert.equal(result.source, "gxt");
  assert.equal(result.sourceName, "工信厅");
  assert.equal(result.data[0].sourceCode, "gxt");
  assert.equal(result.data[0].sourceLabel, "工信厅");
  assert.equal(result.data[0].buyer, "福建省工业和信息化厅");
  assert.match(calls[0].sql, /FROM `gxt_zcfg`/);
  assert.match(calls[0].sql, /`title` LIKE \?/);
  assert.match(calls[0].sql, /FORCE INDEX \(idx_publish_time\)/);
  assert.match(calls[0].sql, /MAX_EXECUTION_TIME\(/);
  assert.doesNotMatch(calls[0].sql, /MATCH\(/);
  assert.doesNotMatch(calls[0].sql, /`source` = \?/);
  assert.ok(calls[0].params.includes("%政策%"));
  assert.equal(calls[0].params.length, 1); // keyword only，无默认近 N 天
});

test("军队采购网列表从 plap 查询", async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{
        id: "plap_1",
        title: "乌兰察布市某部房屋防水项目采购结果公示",
        publishTime: "2026-08-03 18:00:00",
        region: "北京",
        buyer: "",
        budget: "",
        source: null,
        category: "1",
        hasAttachment: 0,
        contentSnippet: "预中标（成交）供应商：测试公司 ，报价金额：954000.00 （元）",
      }], []];
    },
  };
  const result = await listBiaoxun(
    { page: 1, pageSize: 10, source: "军队采购网" },
    { executor, config: { database: "biaoxun" } }
  );
  assert.equal(result.success, true);
  assert.equal(result.source, "plap");
  assert.equal(result.sourceName, "军队采购网");
  assert.equal(result.data[0].sourceCode, "plap");
  assert.equal(result.data[0].sourceLabel, "军队采购网");
  assert.equal(result.data[0].category, "公开招标");
  assert.equal(result.data[0].buyer, "乌兰察布市某部");
  assert.equal(result.data[0].budget, "954000");
  assert.match(calls[0].sql, /FROM `plap`/);
  assert.match(calls[0].sql, /FORCE INDEX \(idx_publish_time\)/);
  assert.match(calls[0].sql, /MAX_EXECUTION_TIME\(/);
  // 安全列表不再扫 content_text 摘要
  assert.doesNotMatch(calls[0].sql, /LEFT\(`content_text`, 1800\)/);
  assert.equal(result.lookbackDays, null);
  assert.doesNotMatch(calls[0].sql, /`source` = \?/);
});

test("分类空查询不默认截近 N 天但仍限时 LIMIT", async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[], []];
    },
  };
  const schema = {
    table: "notices",
    fields: {
      id: "id",
      title: "title",
      publishTime: "notice_time",
      region: "region",
      buyer: "purchaser",
      budget: "budget",
      source: "source",
      category: "notice_type",
    },
  };
  const result = await listBiaoxun(
    { page: 1, categoryGroup: "tender" },
    { executor, config: { database: "biaoxun", queryTimeout: 15000 }, schema }
  );
  assert.equal(result.success, true);
  assert.equal(result.lookbackDays, null);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((call) => /MAX_EXECUTION_TIME\(/.test(call.sql)));
  assert.ok(calls.every((call) => /LIMIT \d+/.test(call.sql)));
  assert.ok(calls.every((call) => !/OFFSET/.test(call.sql)));
  assert.ok(calls.every((call) => !/`notice_time` >= \?/.test(call.sql)));
});


test("combined source and Chinese keyword search matches title only", () => {
  const where = _test.buildListWhere(
    {
      source: "source",
      publishTime: "notice_time",
      title: "title",
      buyer: "buyer",
      agency: "agency",
      region: "region",
      category: "category",
    },
    {
      source: "采购网",
      keyword: "  福州\n  项目  ",
      startDate: "2026-07-01",
      endDate: "2026-07-20",
    }
  );
  assert.match(where.sql, /`source` = \?/);
  assert.match(where.sql, /`notice_time` >= \?/);
  assert.match(where.sql, /DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.match(where.sql, /`title` LIKE \?/);
  assert.doesNotMatch(where.sql, /MATCH\(/);
  assert.doesNotMatch(where.sql, /`buyer` LIKE \?/);
  assert.doesNotMatch(where.sql, /`agency` LIKE \?/);
  assert.doesNotMatch(where.sql, /`region` LIKE \?/);
  assert.doesNotMatch(where.sql, /CONVERT\(/);
  assert.deepEqual(where.params, [
    "zfcg",
    "2026-07-01",
    "2026-07-20",
    "%福州%",
    "%项目%",
  ]);
});

test("safe search uses timed LIKE path, 10 per page, allows pull-up paging", async () => {
  const where = _test.buildListWhere({ title: "title", source: "source" }, { source: "zfcg", keyword: "公告" });
  assert.match(where.sql, /`title` LIKE \?/);
  assert.doesNotMatch(where.sql, /MATCH\(/);
  assert.equal(where.safeSearch, true);
  assert.deepEqual(where.params, ["zfcg", "%公告%"]);

  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [
        Array.from({ length: 11 }, (_, i) => ({
          id: i + 1,
          title: `测试公告${i}`,
          publishTime: "2026-07-19 10:00:00",
          deadline: "",
          region: "福州",
          buyer: "",
          agency: "",
          budget: "",
          source: "zfcg",
          url: "",
          category: "招标公告",
          hasAttachment: 0,
        })),
        [],
      ];
    },
  };
  const schema = {
    table: "notices",
    fields: {
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
    },
  };
  const page1 = await listBiaoxun(
    { page: 1, pageSize: 50, keyword: "公告", source: "zfcg" },
    { executor, config: { database: "biaoxun" }, schema }
  );
  assert.equal(page1.success, true);
  assert.equal(page1.page, 1);
  assert.equal(page1.pageSize, 8);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.total, null);
  assert.equal(page1.safeSearch, true);
  assert.equal(page1.data.length, 8);
  assert.equal(page1.nextBeforePublishTime, "2026-07-19 10:00:00");
  assert.match(calls[0].sql, /MAX_EXECUTION_TIME\(/);
  assert.match(calls[0].sql, /LIMIT 8/);
  assert.doesNotMatch(calls[0].sql, /OFFSET/);
  assert.match(calls[0].sql, /FORCE INDEX \(idx_source_notice_time\)/);
  assert.doesNotMatch(calls[0].sql, /`notice_time` >= \?/);
  assert.equal(page1.lookbackDays, null);
  assert.doesNotMatch(calls[0].sql, /MATCH\(/);
  assert.doesNotMatch(calls[0].sql, /_bx_ids/);

  const page2 = await listBiaoxun(
    {
      page: 2,
      pageSize: 99,
      keyword: "公告",
      source: "zfcg",
      beforePublishTime: page1.nextBeforePublishTime,
    },
    { executor, config: { database: "biaoxun" }, schema }
  );
  assert.equal(page2.page, 2);
  assert.equal(page2.pageSize, 8);
  assert.equal(page2.hasMore, true);
  assert.match(calls[1].sql, /`notice_time` < \?/);
  assert.match(calls[1].sql, /LIMIT 8/);
  assert.doesNotMatch(calls[1].sql, /OFFSET/);
});

test("keyset cursor is applied in where builder", () => {
  const where = _test.buildListWhere(
    { source: "source", title: "title", publishTime: "notice_time" },
    { source: "zfcg", keyword: "物业", beforePublishTime: "2026-07-19 10:00:00" }
  );
  assert.match(where.sql, /`notice_time` < \?/);
  assert.ok(where.params.includes("2026-07-19 10:00:00"));
});
test("compound keyword also uses safe LIKE path", () => {
  const where = _test.buildListWhere(
    { source: "source", title: "title" },
    { source: "zfcg", keyword: "物业服务" }
  );
  assert.match(where.sql, /`title` LIKE \?/);
  assert.doesNotMatch(where.sql, /MATCH\(/);
  assert.deepEqual(where.params, ["zfcg", "%物业服务%"]);
  assert.equal(where.safeSearch, true);
});

test("keyword with filters never emits MATCH/FULLTEXT", () => {
  const where = _test.buildListWhere(
    {
      source: "source",
      title: "title",
      category: "notice_type",
      region: "region",
      buyer: "purchaser",
      publishTime: "notice_time",
      attachments: "attchs",
      content: "content_html",
    },
    {
      source: "zfcg",
      keyword: "福州",
      categoryGroup: "tender",
      region: "福州",
      businessTypes: ["wuye"],
      attachmentFilter: "has",
    }
  );
  assert.doesNotMatch(where.sql, /MATCH\s*\(/i);
  assert.doesNotMatch(where.sql, /AGAINST\s*\(/i);
  assert.doesNotMatch(where.sql, /FULLTEXT/i);
  assert.doesNotMatch(where.sql, /content_html/);
  assert.match(where.sql, /`title` LIKE \?/);
  assert.match(where.sql, /notice_type` IN \(/);
  assert.match(where.sql, /JSON_LENGTH\(`attchs`\)/);
  assert.equal(where.safeSearch, true);
});

test("date filter rejects invalid calendar dates", () => {
  const where = _test.buildListWhere(
    { publishTime: "notice_time" },
    { startDate: "2026-02-30", endDate: "bad-date" }
  );
  assert.equal(where.sql, "");
  assert.deepEqual(where.params, []);
});
test("date range automatically normalizes reversed boundaries", () => {
  const where = _test.buildListWhere(
    { publishTime: "notice_time" },
    { startDate: "2026-07-20", endDate: "2026-07-01" }
  );
  assert.deepEqual(where.params, ["2026-07-01", "2026-07-20"]);
});

test("getBiaoxunDetail converts stored HTML into readable plain text", async () => {
  const executor = {
    async query(sql, params) {
      assert.match(sql, /WHERE `notice_id` = \?/);
      assert.deepEqual(params, ["9"]);
      return [[{
        id: 9,
        title: "公告详情",
        publishTime: "2026-07-19 10:00:00",
        deadline: "",
        region: "福建",
        buyer: "采购人",
        agency: "代理机构",
        budget: "",
        source: "平台",
        url: "",
        category: "采购公告",
        content: "<p>第一段</p><p>第二段</p>",
      }], []];
    },
  };
  const schema = {
    table: "bidding_notices",
    fields: {
      id: "notice_id",
      title: "notice_title",
      publishTime: "publish_time",
      deadline: "",
      region: "region",
      buyer: "buyer",
      agency: "agency",
      budget: "",
      source: "source",
      url: "",
      category: "category",
      content: "content",
    },
  };
  const result = await getBiaoxunDetail(
    { id: "9" },
    { executor, config: { database: "biaoxun" }, schema }
  );
  assert.equal(result.success, true);
  assert.equal(result.data.contentText, "第一段\n第二段");
  assert.ok(result.data.contentHtml.includes("第一段"));
  assert.deepEqual(result.data.contentParagraphs, ["第一段", "第二段"]);
  assert.equal("content" in result.data, false);
});

test("工信厅详情按来源查询 gxt_zcfg 并标记为工信厅", async () => {
  const executor = {
    async query(sql, params) {
      assert.match(sql, /FROM `gxt_zcfg`/);
      assert.match(sql, /WHERE `id` = \?/);
      assert.deepEqual(params, ["gxt-2"]);
      return [[{
        id: "gxt-2",
        title: "政策解读",
        publishTime: "2026-07-21 10:00:00",
        deadline: null,
        region: null,
        buyer: "福建省工业和信息化厅",
        agency: null,
        budget: null,
        source: null,
        url: "https://example.test/gxt-2",
        category: "政策法规",
        content: "<p>工信厅正文</p>",
      }], []];
    },
  };
  const result = await getBiaoxunDetail(
    { id: "gxt-2", source: "gxt" },
    { executor, config: { database: "biaoxun" } }
  );
  assert.equal(result.success, true);
  assert.equal(result.data.sourceCode, "gxt");
  assert.equal(result.data.sourceLabel, "工信厅");
  assert.equal(result.data.buyer, "福建省工业和信息化厅");
  assert.equal(result.data.contentText, "工信厅正文");
});

test("政策公开分类映射到工信厅+科技厅，且不按 notice_type 过滤", () => {
  assert.equal(_test.normalizeCategoryGroup("政策公开"), "policy");
  assert.deepEqual(_test.resolveListSources("", "policy"), ["gxt", "kjt"]);
  assert.deepEqual(_test.resolveListSources("", "tender"), ["zfcg", "easy_prt", "plap"]);
  assert.deepEqual(_test.resolveListSources("", "win"), ["zfcg", "easy_prt", "plap"]);
  assert.deepEqual(_test.resolveListSources("", "intent"), ["zfcg", "easy_prt", "plap"]);
  assert.deepEqual(_test.resolveListSources("", "intent", { excludePlap: true }), [
    "zfcg",
    "easy_prt",
  ]);
  const where = _test.buildListWhere(
    { category: "notice_type", title: "title" },
    { categoryGroup: "policy", source: "gxt" }
  );
  assert.doesNotMatch(where.sql, /notice_type/);
  assert.equal(where.categoryGroup, "policy");
  assert.equal(where.categoryGroupLabel, "政策公开");
});

test("工采通招标按招标采购过滤，军采网按 notice_type 编码过滤", () => {
  const easyWhere = _test.buildListWhere(
    { category: "notice_type", title: "title" },
    { source: "easy_prt", categoryGroup: "tender" }
  );
  assert.match(easyWhere.sql, /notice_type` IN \(/);
  assert.ok(easyWhere.params.includes("招标采购"));

  const plapTender = _test.buildListWhere(
    { category: "purchase_manner", noticeType: "notice_type", title: "title" },
    { source: "plap", categoryGroup: "tender" }
  );
  assert.match(plapTender.sql, /notice_type` IN \(/);
  assert.ok(plapTender.params.includes("001011"));
  assert.ok(plapTender.params.includes("00105E"));

  const plapWin = _test.buildListWhere(
    { category: "purchase_manner", noticeType: "notice_type", title: "title" },
    { source: "plap", categoryGroup: "win" }
  );
  assert.ok(plapWin.params.includes("001021"));
  assert.ok(plapWin.params.includes("001006"));
  assert.ok(!plapWin.params.includes("001011"));
});

test("政策公开采购网稀有类型走 type 索引，多类型招标仍走时间索引", () => {
  assert.equal(_test.resolveExactTypeCount("zfcg", "policy"), 0);
  assert.ok(_test.resolveExactTypeCount("zfcg", "tender") > 2);
  assert.equal(
    _test.pickListIndexHint(
      { table: "notices" },
      "zfcg",
      { exactTypeCount: _test.resolveExactTypeCount("zfcg", "tender") }
    ),
    " FORCE INDEX (idx_source_notice_time)"
  );
  assert.equal(
    _test.pickListIndexHint({ table: "notices" }, "zfcg", { exactTypeCount: 1 }),
    " FORCE INDEX (idx_source_type_time)"
  );
  // 地区/关键词安全查询：即使类型很少也强制时间索引早停
  assert.equal(
    _test.pickListIndexHint(
      { table: "notices" },
      "zfcg",
      { exactTypeCount: 1, safeQuery: true }
    ),
    " FORCE INDEX (idx_source_notice_time)"
  );
  // 纯地区、展开取值少：走 source+region+time 组合索引
  assert.equal(
    _test.pickListIndexHint(
      { table: "notices" },
      "zfcg",
      { safeQuery: true, regionOnly: true, regionValueCount: 3 }
    ),
    " FORCE INDEX (idx_source_region_time)"
  );
  assert.equal(
    _test.pickListIndexHint(
      { table: "plap" },
      "plap",
      { safeQuery: true, regionOnly: true, regionValueCount: 2 }
    ),
    " FORCE INDEX (idx_region_publish_time)"
  );
  // 福建省整省展开过多：回退时间索引早停
  assert.equal(
    _test.pickListIndexHint(
      { table: "notices" },
      "zfcg",
      { safeQuery: true, regionOnly: true, regionValueCount: 80 }
    ),
    " FORCE INDEX (idx_source_notice_time)"
  );
  assert.equal(_test.resolveExactTypeCount("kjt", "policy"), 0);
  assert.equal(
    _test.pickListIndexHint({ table: "notices" }, "kjt", { exactTypeCount: 0 }),
    " FORCE INDEX (idx_source_notice_time)"
  );
  assert.equal(
    _test.pickListIndexHint({ table: "gxt_zcfg" }, "gxt", { exactTypeCount: 0 }),
    " FORCE INDEX (idx_publish_time)"
  );
});

test("region filter uses safe query path", async () => {
  const where = _test.buildListWhere(
    { source: "source", region: "region", title: "title", publishTime: "notice_time" },
    { source: "zfcg", regions: ["晋安区"], categoryGroup: "tender" }
  );
  assert.match(where.sql, /`region` IN \(/);
  assert.equal(where.safeSearch, true);
  assert.equal(where.region, "晋安区");

  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [
        [
          {
            id: 1,
            title: "福州项目",
            publishTime: "2026-08-01 10:00:00",
            region: "鼓楼区",
            source: "zfcg",
          },
        ],
        [],
      ];
    },
  };
  const schema = {
    table: "notices",
    fields: {
      title: "notice_title",
      region: "region",
      category: "notice_type",
      source: "source",
      publishTime: "notice_time",
    },
  };
  const result = await listBiaoxun(
    { page: 1, regions: ["晋安区"], source: "zfcg", categoryGroup: "tender" },
    { executor, config: { database: "biaoxun", queryTimeout: 15000 }, schema }
  );
  assert.equal(result.success, true);
  assert.equal(result.safeSearch, true);
  assert.ok(calls.length >= 1);
  const main = calls.find((item) => /`region` IN \(/.test(item.sql)) || calls[0];
  assert.match(main.sql, /FORCE INDEX \(idx_source_region_time\)/);
  assert.match(main.sql, /MAX_EXECUTION_TIME\(/);
  assert.match(main.sql, /LIMIT /);
  assert.doesNotMatch(main.sql, /COUNT\(\*\)/);
  assert.doesNotMatch(main.sql, /FORCE INDEX \(idx_source_type_time\)/);
});

test("plap region maps Fujian city to province for fast filter", () => {
  const where = _test.buildListWhere(
    { source: "source", region: "region" },
    { source: "plap", regions: ["福州市"] }
  );
  assert.match(where.sql, /`region` IN \(/);
  assert.ok(where.params.includes("福建省"));
  assert.ok(where.params.includes("福建"));
  assert.equal(where.safeSearch, true);
});

test("军队采购网不做附件功能", () => {
  assert.equal(
    _test.buildHasAttachmentPredicate({ attachments: "attchs" }, "plap"),
    ""
  );
  assert.match(
    _test.buildHasAttachmentExpression({ attachments: "attchs" }, "plap"),
    /0 AS `hasAttachment`/
  );
  const hasFilter = _test.buildListWhere(
    { title: "title", attachments: "attchs" },
    { source: "plap", attachmentFilter: "has" }
  );
  assert.match(hasFilter.sql, /1 = 0/);

  const notice = _test.normalizeNotice(
    {
      id: "1",
      title: "测试公告",
      source: "plap",
      attachments: JSON.stringify([{ name: "a.pdf", url: "https://example.com/a.pdf" }]),
      hasAttachment: 1,
      content: '<a href="https://example.com/b.pdf">附件下载</a>',
    },
    true,
    "plap"
  );
  assert.deepEqual(notice.attachments, []);
  assert.equal(notice.hasAttachment, false);
});

test("采购网空类型按标题兜底归类招标/中标", () => {
  const tender = _test.buildListWhere(
    { category: "notice_type", title: "title", source: "source" },
    { source: "zfcg", categoryGroup: "tender", categoryTypeMode: "exact" }
  );
  assert.match(tender.sql, /notice_type` IN \(/);
  assert.doesNotMatch(tender.sql, /TRIM\(`notice_type`\) = ''/);
  assert.doesNotMatch(tender.sql, /`title` LIKE \?/);

  const empty = _test.buildListWhere(
    { category: "notice_type", title: "title", source: "source" },
    { source: "zfcg", categoryGroup: "tender", categoryTypeMode: "empty" }
  );
  assert.match(empty.sql, /TRIM\(`notice_type`\) = ''/);
  assert.ok(_test.matchEmptyTitleHeuristic("进口产品采购公示", "tender"));
  assert.ok(_test.matchEmptyTitleHeuristic("框架协议入围成交结果公告", "win"));
  assert.equal(_test.matchEmptyTitleHeuristic("框架协议入围成交结果公告", "tender"), false);

  // 政策公开不再混入采购网；显式选采购网时也应无结果
  const policyZfcg = _test.buildListWhere(
    { category: "notice_type", title: "title", source: "source" },
    { source: "zfcg", categoryGroup: "policy" }
  );
  assert.match(policyZfcg.sql, /1 = 0/);
  assert.ok(!policyZfcg.params.includes("投诉处理决定书"));
});

test("full library search picks ccgp first and up to 3 tables", () => {
  const pool = [
    { table: "anhui", source: "anhui", tableSourceKey: "anhui" },
    { table: "ccgp", source: "ccgp", tableSourceKey: "ccgp" },
    { table: "guangdong", source: "guangdong", tableSourceKey: "guangdong" },
    { table: "hunan", source: "hunan", tableSourceKey: "hunan" },
    { table: "notices", source: "zfcg", tableSourceKey: "zfcg" },
  ];
  const picked = _test.pickRandomFullSearchSources(pool, 3);
  assert.equal(picked.length, 3);
  assert.equal(picked[0].source, "ccgp");
  assert.ok(new Set(picked.map((item) => item.table)).size === 3);
});

test("isAllSourcesListRequest when source is all/empty", () => {
  assert.equal(_test.isAllSourcesListRequest({ source: "" }), true);
  assert.equal(_test.isAllSourcesListRequest({ source: "all" }), true);
  assert.equal(_test.isAllSourcesListRequest({ source: "ccgp" }), false);
});

test("isFullLibraryKeywordSearch only when keyword and source all", () => {
  assert.equal(_test.isFullLibraryKeywordSearch({ keyword: "物业", source: "" }), true);
  assert.equal(_test.isFullLibraryKeywordSearch({ keyword: "物业", source: "all" }), true);
  assert.equal(_test.isFullLibraryKeywordSearch({ keyword: "物业", source: "ccgp" }), false);
  assert.equal(_test.isFullLibraryKeywordSearch({ keyword: "", source: "" }), false);
});

test("filterPoolForCategory limits policy tab to gxt tables", () => {
  const pool = [
    { table: "ccgp", source: "ccgp", tableSourceKey: "ccgp" },
    { table: "gxt_zcfg", source: "gxt", tableSourceKey: "gxt" },
    { table: "notices", source: "zfcg", tableSourceKey: "zfcg" },
  ];
  const filtered = _test.filterPoolForCategory(pool, "policy");
  assert.deepEqual(filtered.map((item) => item.source), ["gxt"]);
});

test("orderIntegratedPool puts ccgp then zfcg first", () => {
  const pool = [
    { table: "anhui", source: "anhui", tableSourceKey: "anhui" },
    { table: "ccgp", source: "ccgp", tableSourceKey: "ccgp" },
    { table: "notices", source: "zfcg", tableSourceKey: "zfcg" },
  ];
  const ordered = _test.orderIntegratedPool(pool);
  assert.deepEqual(ordered.map((item) => item.source), ["ccgp", "zfcg", "anhui"]);
});

test("addDaysToDateString steps back one day", () => {
  assert.equal(_test.addDaysToDateString("2026-08-17", -1), "2026-08-16");
});

test("buildTableSourceMap includes zhejiang/hainan and other province tables", () => {
  const tableSourceMap = _test.buildTableSourceMap();
  assert.equal(tableSourceMap.zhejiang, "zhejiang");
  assert.equal(tableSourceMap.sichuan, "sichuan");
  assert.equal(tableSourceMap.hainan, "hainan");
  assert.equal(tableSourceMap.guizhou, "guizhou");
  assert.equal(tableSourceMap.hubei, "hubei");
  assert.ok(tableSourceMap.ccgp === "ccgp");
  assert.ok(tableSourceMap.notices === "zfcg" || tableSourceMap[Object.keys(tableSourceMap).find((k) => tableSourceMap[k] === "zfcg")]);
});
