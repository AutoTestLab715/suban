const DRAFT_BOX_KEY = "formDraftBox";
const LEGACY_DRAFT_PREFIX = "formDraft_";
const MAX_DRAFT_COUNT = 5;

const isEmptyValue = (val) => {
  if (val === undefined || val === null || val === "") return true;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === "object") {
    return !Object.values(val).some((v) => v !== undefined && v !== null && v !== "");
  }
  return false;
};

const hasFilledValues = (values = {}) => Object.values(values).some((val) => !isEmptyValue(val));

const formatDraftValue = (field, val) => {
  if (isEmptyValue(val)) return "";
  if (field?.type === "image" && Array.isArray(val)) return `${val.length}张图片`;
  if (field?.type === "file" && Array.isArray(val)) return `${val.length}个文件`;
  if (field?.type === "checkbox" && Array.isArray(val)) return val.join("、");
  if (field?.type === "address" && val && typeof val === "object") {
    return [val.regionText, val.detail].filter(Boolean).join("");
  }
  if (field?.type === "signature" && val) return "已签名";
  if (typeof val === "object") return "已填写";
  return String(val).slice(0, 24);
};

const buildDraftSummary = (fields = [], values = {}) => {
  const parts = [];
  (fields || []).forEach((field) => {
    if (parts.length >= 2) return;
    const text = formatDraftValue(field, values[field.id]);
    if (text) parts.push(`${field.label}：${text}`);
  });
  return parts.join(" · ") || "暂无填写内容";
};

const formatDraftTime = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const createDraftId = () => `d_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

const normalizeDraftItem = (item = {}) => {
  if (!item || typeof item !== "object") return null;
  const templateId = item.templateId || "";
  if (!templateId || !item.values || typeof item.values !== "object") return null;
  if (!hasFilledValues(item.values)) return null;
  return {
    draftId: item.draftId || createDraftId(),
    templateId,
    templateTitle: item.templateTitle || "未命名表单",
    draftName: item.draftName || item.templateTitle || "未命名草稿",
    values: item.values,
    currentSectionId: item.currentSectionId || "",
    currentSectionIndex: Number(item.currentSectionIndex) || 0,
    summary: item.summary || "暂无填写内容",
    updatedAt: item.updatedAt || Date.now(),
  };
};

const readDraftBox = () => {
  const raw = wx.getStorageSync(DRAFT_BOX_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeDraftItem).filter(Boolean);
};

const writeDraftBox = (list) => {
  const trimmed = list
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_DRAFT_COUNT);
  wx.setStorageSync(DRAFT_BOX_KEY, trimmed);
};

const migrateLegacyDrafts = () => {
  const list = readDraftBox();
  let changed = false;

  try {
    const info = wx.getStorageInfoSync();
    (info.keys || []).forEach((key) => {
      if (!key.startsWith(LEGACY_DRAFT_PREFIX)) return;
      const templateId = key.slice(LEGACY_DRAFT_PREFIX.length);
      const values = wx.getStorageSync(key);
      wx.removeStorageSync(key);
      if (!templateId || !values || typeof values !== "object") return;
      if (!hasFilledValues(values)) return;
      list.unshift(
        normalizeDraftItem({
          draftId: createDraftId(),
          templateId,
          templateTitle: "",
          values,
          updatedAt: Date.now(),
          summary: "历史草稿",
        })
      );
      changed = true;
    });
  } catch (e) {
    /* ignore */
  }

  if (changed) writeDraftBox(list);
  return list;
};

const listDrafts = () => {
  migrateLegacyDrafts();
  return readDraftBox().map((item) => ({
    ...item,
    updatedAtText: formatDraftTime(item.updatedAt),
  }));
};

const getDraftById = (draftId) => {
  if (!draftId) return null;
  migrateLegacyDrafts();
  return readDraftBox().find((item) => item.draftId === draftId) || null;
};

const addDraft = ({
  templateId,
  templateTitle = "",
  draftName = "",
  fields = [],
  values = {},
  currentSectionId = "",
  currentSectionIndex = 0,
}) => {
  if (!templateId || !hasFilledValues(values)) {
    return { ok: false, reason: "empty" };
  }

  const trimmedName = String(draftName || templateTitle || "未命名草稿").trim();
  if (!trimmedName) {
    return { ok: false, reason: "empty_name" };
  }

  migrateLegacyDrafts();
  const list = readDraftBox();
  const draft = normalizeDraftItem({
    draftId: createDraftId(),
    templateId,
    templateTitle: templateTitle || "未命名表单",
    draftName: trimmedName.slice(0, 30),
    values: JSON.parse(JSON.stringify(values)),
    currentSectionId,
    currentSectionIndex,
    summary: buildDraftSummary(fields, values),
    updatedAt: Date.now(),
  });

  list.unshift(draft);
  writeDraftBox(list);
  return { ok: true, draftId: draft.draftId, evicted: list.length > MAX_DRAFT_COUNT };
};

const removeDraftById = (draftId) => {
  if (!draftId) return;
  const list = readDraftBox().filter((item) => item.draftId !== draftId);
  writeDraftBox(list);
};

const renameDraft = (draftId, draftName) => {
  const trimmed = String(draftName || "").trim();
  if (!draftId || !trimmed) return false;

  migrateLegacyDrafts();
  const list = readDraftBox();
  const index = list.findIndex((item) => item.draftId === draftId);
  if (index < 0) return false;

  list[index] = {
    ...list[index],
    draftName: trimmed.slice(0, 30),
  };
  writeDraftBox(list);
  return true;
};

const countDrafts = () => listDrafts().length;

const getDraftLimit = () => MAX_DRAFT_COUNT;

module.exports = {
  listDrafts,
  getDraftById,
  addDraft,
  removeDraftById,
  renameDraft,
  countDrafts,
  getDraftLimit,
  hasFilledValues,
  buildDraftSummary,
  formatDraftTime,
};
