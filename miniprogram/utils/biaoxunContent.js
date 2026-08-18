const decodeEntities = (text) =>
  String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/￥/g, "¥")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const cellText = (html) =>
  decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n+/g, "\n")
      .trim()
  );

const polishHtmlChunk = (html) => {
  const raw = String(html || "").trim();
  if (!raw) return "";
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // 安徽等政采模板用 samp 填值，rich-text 不支持会导致正文空白
    .replace(/<(samp|font|u|mark|kbd|var|code)\b([^>]*)>/gi, "<span$2>")
    .replace(/<\/(samp|font|u|mark|kbd|var|code)>/gi, "</span>")
    .replace(/<img([^>]*?)>/gi, (match, attrs) => {
      if (/style=/i.test(attrs)) {
        return `<img${attrs.replace(/style\s*=\s*(['"])[\s\S]*?\1/i, 'style="max-width:100%;height:auto;"')}>`;
      }
      return `<img${attrs} style="max-width:100%;height:auto;">`;
    })
    // 清理正文里可能携带的字体/字号/颜色等“内联样式”，避免不同来源公告打开后字体不一致。
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/style\s*=\s*(['"])([\s\S]*?)\1/gi, (match, quote, styles) => {
      let s = String(styles || "");
      // 移除常见字体相关片段（保留其它布局类样式，例如 text-align / width 等）
      s = s.replace(/font-family\s*:[^;]+;?/gi, "");
      s = s.replace(/font-size\s*:[^;]+;?/gi, "");
      s = s.replace(/font-weight\s*:[^;]+;?/gi, "");
      s = s.replace(/line-height\s*:[^;]+;?/gi, "");
      s = s.replace(/color\s*:[^;]+;?/gi, "");
      s = s.replace(/letter-spacing\s*:[^;]+;?/gi, "");
      s = s.replace(/background-color\s*:[^;]+;?/gi, "");
      s = s.trim();
      if (!s) return "";
      return `style=${quote}${s}${quote}`;
    })
    .replace(/<font\b[^>]*>/gi, "")
    .replace(/<\/font>/gi, "");
};

/** 军采网正文常包在最外层单格装饰表格里，仅拆最外层，保留内部业务表格供统一表格解析。 */
const unwrapSingleCellTables = (html) => {
  const out = String(html || "").trim();
  if (!out) return out;
  const m = out.match(
    /^<table\b[^>]*>\s*(?:<tbody\b[^>]*>\s*)?<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*(?:<\/tbody>\s*)?<\/table>$/i
  );
  return m ? String(m[1] || "").trim() : out;
};

const prepareNoticeHtml = (html, source = "") => {
  let out = String(html || "").trim();
  if (!out) return "";
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  const sourceCode = String(source || "").trim().toLowerCase();
  if (sourceCode === "plap") {
    // 军采网尽量复用采购网的统一表格处理：仅剥离最外层装饰壳，不提前拆掉内部表格。
    out = unwrapSingleCellTables(out);
    out = out
      .replace(/<\/?div\b[^>]*class="[^"]*pdf(?:css|content)[^"]*"[^>]*>/gi, "")
      .replace(
        /<div\b[^>]*class="[^"]*subtitle[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        (_, inner) => `<p><strong>${String(inner).replace(/<br\s*\/?>/gi, "").trim()}</strong></p>`
      )
      .replace(
        /<div\b[^>]*class="[^"]*textIndent[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        (_, inner) => `<p>${inner}</p>`
      )
      .replace(/<div\b[^>]*>/gi, "")
      .replace(/<\/div>/gi, "")
      .replace(/<p>\s*<\/p>/gi, "")
      .replace(/(<br\s*\/?>\s*){3,}/gi, "<br/><br/>");
  }

  return out.trim();
};

const parseTableRows = (tableHtml) => {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(tableHtml))) {
    const cells = [];
    const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(trMatch[1]))) {
      cells.push({
        tag: String(cellMatch[1] || "").toLowerCase(),
        text: cellText(cellMatch[3]),
        colspan: Number((String(cellMatch[2] || "").match(/colspan\s*=\s*['"]?(\d+)/i) || [])[1] || 1),
      });
    }
    if (cells.some((cell) => cell.text)) rows.push(cells);
  }
  return rows;
};

const flattenOfficialKvPairs = (rows) => {
  const pairs = [];
  rows.forEach((row) => {
    let i = 0;
    while (i < row.length) {
      const cell = row[i];
      const next = row[i + 1];
      if (cell.tag === "th" && next) {
        pairs.push({
          label: cell.text || "项目",
          value: next.text || "—",
        });
        i += 2;
        continue;
      }
      // 兜底：按两两一组
      if (next) {
        pairs.push({
          label: cell.text || "项目",
          value: next.text || "—",
        });
        i += 2;
      } else {
        if (cell.text) {
          pairs.push({ label: "说明", value: cell.text });
        }
        i += 1;
      }
    }
  });
  return pairs.filter((pair) => pair.label || (pair.value && pair.value !== "—"));
};

const isOfficialKvTable = (tableHtml, rows) => {
  if (/official-kv-table/i.test(tableHtml)) return true;
  if (!rows.length) return false;
  // 泉州竞价/官网 KV：多数行为 th+td 或 th+td+th+td
  const patterned = rows.filter((row) => {
    if (row.length === 2 && row[0].tag === "th") return true;
    if (row.length === 4 && row[0].tag === "th" && row[2].tag === "th") return true;
    if (row.length >= 2 && row[0].tag === "th") return true;
    return false;
  });
  return patterned.length >= Math.max(1, Math.ceil(rows.length * 0.6));
};

const isTwoColumnKvTable = (rows) =>
  rows.length >= 1 &&
  rows.every((row) => row.length === 2) &&
  rows.some((row) => row[0] && row[0].tag === "th");

const isLayoutTable = (tableHtml, rows) => {
  if (!rows.length) return false;
  if (rows.length === 1 && rows[0].length === 1) return true;
  if (rows.every((row) => row.length === 1) && /<(div|p|h[1-6]|br)\b/i.test(tableHtml)) {
    return true;
  }
  return false;
};

const extractFormTitle = (html) => {
  const raw = String(html || "");
  const match = raw.match(
    /<div[^>]*class=['"][^'"]*form-title[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i
  );
  if (!match) return { title: "", html: raw };
  const title = cellText(match[1]);
  const cleaned = raw
    .replace(match[0], "")
    .replace(/<div[^>]*class=['"][^'"]*official-section[^'"]*['"][^>]*>\s*<\/div>/gi, "")
    .replace(/<div[^>]*class=['"][^'"]*official-section[^'"]*['"][^>]*>\s*$/i, "")
    .replace(/^\s*<\/div>\s*$/gi, "")
    .trim();
  return { title, html: cleaned };
};

const stripEmptyWrappers = (html) => {
  let out = String(html || "")
    .replace(/<div[^>]*class=['"][^'"]*official-section[^'"]*['"][^>]*>/gi, "")
    .replace(/^\s*<\/div>\s*/i, "")
    .replace(/\s*<\/div>\s*$/i, "")
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/(<br\s*\/?>\s*){2,}/gi, "<br/>")
    .trim();
  if (!cellText(out)) return "";
  return out;
};

const polishKvValue = (label, value) => {
  let text = String(value || "").trim();
  if (!text || text === "—") return "—";
  if (/区划|地区|所在地|坐落|地址/.test(String(label || ""))) {
    text = text.replace(/^福建省\s*[\/／]\s*/u, "").replace(/^福建省/u, "").trim() || text;
  }
  return text;
};

const buildTableBlock = (tableHtml, titleHint = "") => {
  const rows = parseTableRows(tableHtml);
  if (!rows.length) {
    return { type: "html", html: polishHtmlChunk(tableHtml) };
  }

  // 单列装饰表：按正文富文本处理，避免整篇变成「第 1 项」卡片
  if (isLayoutTable(tableHtml, rows)) {
    const inner = tableHtml.match(/<td\b[^>]*>([\s\S]*)<\/td>/i);
    return { type: "html", html: polishHtmlChunk(inner ? inner[1] : tableHtml) };
  }

  // 官网/泉州竞价：th+td 并排 KV 表；普通两列键值表同样处理
  if (
    isOfficialKvTable(tableHtml, rows) ||
    isTwoColumnKvTable(rows) ||
    rows.every((row) => row.length === 2)
  ) {
    const pairs = flattenOfficialKvPairs(rows).map((pair) => ({
      label: pair.label || "项目",
      value: polishKvValue(pair.label, pair.value),
    }));
    if (!pairs.length) {
      return { type: "html", html: polishHtmlChunk(tableHtml) };
    }
    const isOfficial = isOfficialKvTable(tableHtml, rows);
    return {
      type: "table",
      mode: isOfficial ? "official-kv" : "kv",
      title: titleHint || (isOfficial ? "详细信息" : "表格信息"),
      cards: [
        {
          index: 1,
          pairs,
        },
      ],
    };
  }

  const plainRows = rows.map((row) => row.map((cell) => cell.text));
  const hasHeader = /<th[\s>]/i.test(tableHtml) || plainRows.length > 1;
  const headers = hasHeader ? plainRows[0] : plainRows[0].map((_, i) => `列${i + 1}`);
  const body = hasHeader ? plainRows.slice(1) : plainRows;
  const cards = (body.length ? body : [headers]).map((row, index) => ({
    index: index + 1,
    pairs: row.map((value, i) => ({
      label: headers[i] || `列${i + 1}`,
      value: value || "—",
    })),
  }));

  return {
    type: "table",
    mode: "cards",
    title: titleHint || "标的明细",
    headers,
    cards,
  };
};

/**
 * 将正文 HTML 拆成富文本片段 + 移动端友好表格卡片
 */
const buildContentBlocks = (html, options = {}) => {
  const source = prepareNoticeHtml(html, options.source);
  if (!source) return [];

  const blocks = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let lastIndex = 0;
  let match;
  let tableIndex = 0;

  while ((match = tableRe.exec(source))) {
    let before = source.slice(lastIndex, match.index).trim();
    const extracted = extractFormTitle(before);
    before = stripEmptyWrappers(extracted.html);
    if (before) {
      blocks.push({ type: "html", html: polishHtmlChunk(before) });
    }
    const tableBlock = buildTableBlock(match[0], extracted.title);
    if (tableBlock.type === "table") {
      tableIndex += 1;
      if (!extracted.title && tableIndex > 1 && tableBlock.title === "标的明细") {
        tableBlock.title = `标的明细 ${tableIndex}`;
      }
    }
    blocks.push(tableBlock);
    lastIndex = match.index + match[0].length;
  }

  const afterRaw = source.slice(lastIndex).trim();
  const after = stripEmptyWrappers(afterRaw);
  if (after) {
    blocks.push({ type: "html", html: polishHtmlChunk(after) });
  }

  if (!blocks.length) {
    return [{ type: "html", html: polishHtmlChunk(source) }];
  }
  return blocks;
};

module.exports = {
  buildContentBlocks,
  prepareNoticeHtml,
  unwrapSingleCellTables,
  cellText,
  parseTableRows,
  isOfficialKvTable,
  flattenOfficialKvPairs,
};
