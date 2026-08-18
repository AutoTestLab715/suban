const pad2 = (n) => String(n).padStart(2, "0");

const parseDateTime = (value) => {
  const text = String(value || "")
    .trim()
    .replace("T", " ")
    .replace(/\.\d{3}Z?$/, "");
  if (!text) return null;
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0)
    ).getTime();
  }
  const m2 = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) {
    return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]), 0, 0, 0).getTime();
  }
  const ts = Date.parse(text);
  return Number.isFinite(ts) ? ts : null;
};

const formatCountdownValue = (ms) => {
  let remain = Math.max(0, Number(ms) || 0);
  const sec = Math.floor(remain / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}天 ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
};

const formatMetaTime = (value) => {
  const text = String(value || "")
    .trim()
    .replace("T", " ");
  if (!text) return "";
  return text.length >= 19 ? text.slice(0, 19) : text.length >= 16 ? text.slice(0, 16) : text;
};

/**
 * 对齐网站竞价大厅倒计时：距离开拍 / 距离结束 / 已结束
 */
const buildHallCountdown = (item = {}, now = Date.now()) => {
  const sourceCode = String(item.sourceCode || item.source || "")
    .trim()
    .toLowerCase();
  if (sourceCode !== "quanzhou_hall") return null;

  const openRaw = item.openTime || item.open_time || "";
  const closeRaw = item.deadline || item.closeTime || item.close_time || "";
  const firstRaw = item.firstBidTime || item.first_bid_time || "";
  const status = String(item.statusName || item.status_name || item.category || "").trim();

  const openAt = parseDateTime(openRaw);
  const closeAt = parseDateTime(closeRaw);
  const firstAt = parseDateTime(firstRaw);

  let target = null;
  let label = "";
  if (openAt && now < openAt) {
    target = openAt;
    label = "距离开拍";
  } else if (closeAt && now < closeAt) {
    target = closeAt;
    label = "距离结束";
  } else if (firstAt && now < firstAt && (!openAt || now >= openAt)) {
    target = firstAt;
    label = "距离首报";
  }

  const metaParts = [];
  if (openRaw) metaParts.push(`开拍 ${formatMetaTime(openRaw)}`);
  if (closeRaw) metaParts.push(`结束 ${formatMetaTime(closeRaw)}`);
  if (status) metaParts.push(status);
  const meta = metaParts.join(" · ");

  if (!target) {
    const ended = !!(closeAt && now >= closeAt);
    return {
      show: true,
      ended,
      label: status || (ended ? "竞价状态" : "竞价状态"),
      value: ended ? "已结束" : status || "进行中",
      meta,
      openTime: formatMetaTime(openRaw),
      closeTime: formatMetaTime(closeRaw),
      remainMs: 0,
    };
  }

  const remainMs = Math.max(0, target - now);
  return {
    show: true,
    ended: false,
    label,
    value: formatCountdownValue(remainMs),
    meta,
    openTime: formatMetaTime(openRaw),
    closeTime: formatMetaTime(closeRaw),
    remainMs,
  };
};

module.exports = {
  parseDateTime,
  formatCountdownValue,
  buildHallCountdown,
};
