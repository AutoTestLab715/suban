const FIELD_TYPES = [
  "text",
  "textarea",
  "phone",
  "email",
  "number",
  "select",
  "radio",
  "checkbox",
  "date",
  "time",
  "image",
  "file",
  "address",
  "signature",
  "idcard",
  "amount",
  "rating",
];

const { FORM_PRIVACY_SUMMARY } = require("./privacyPolicy");

const FIELD_TYPE_OPTIONS = [
  { type: "text", label: "单行文本" },
  { type: "textarea", label: "多行文本" },
  { type: "phone", label: "手机号" },
  { type: "email", label: "邮箱" },
  { type: "number", label: "数字" },
  { type: "amount", label: "金额输入" },
  { type: "idcard", label: "身份证号" },
  { type: "select", label: "下拉选择" },
  { type: "radio", label: "单选" },
  { type: "checkbox", label: "多选" },
  { type: "date", label: "日期" },
  { type: "time", label: "时间" },
  { type: "image", label: "图片上传" },
  { type: "file", label: "文件上传" },
  { type: "address", label: "地址选择" },
  { type: "signature", label: "手写签名" },
  { type: "rating", label: "星级评分" },
];

const FIELD_TYPE_LABELS = FIELD_TYPE_OPTIONS.reduce((map, item) => {
  map[item.type] = item.label;
  return map;
}, {});

const DEFAULT_TEMPLATE = {
  title: "信息提交",
  description: "请填写以下信息，我们会尽快与您联系",
  submitText: "提交",
  footerText: "",
  fields: [
    {
      id: "name",
      type: "text",
      label: "姓名",
      required: true,
      maxLength: 20,
      placeholder: "请输入您的姓名",
    },
    {
      id: "phone",
      type: "phone",
      label: "手机号",
      required: true,
      placeholder: "请输入11位手机号",
    },
    {
      id: "email",
      type: "email",
      label: "邮箱",
      required: false,
      placeholder: "选填，便于发送通知",
    },
    {
      id: "type",
      type: "select",
      label: "类型",
      required: true,
      options: ["咨询", "建议", "投诉", "合作", "其他"],
      placeholder: "请选择提交类型",
    },
    {
      id: "content",
      type: "textarea",
      label: "留言内容",
      required: true,
      maxLength: 500,
      placeholder: "请描述您的需求或问题...",
    },
  ],
  settings: {
    submitLimit: "none",
    allowEditSubmission: true,
    needPrivacy: true,
    privacyTitle: "隐私保护提示",
    privacyText: FORM_PRIVACY_SUMMARY,
    submitButtonText: "提交",
    successTitle: "提交成功",
    successDesc: "我们已收到您的信息，会尽快与您联系",
  },
};

const initFormValues = (fields = []) => {
  const values = {};
  fields.forEach((field) => {
    if (field.type === "checkbox" || field.type === "image" || field.type === "file") {
      values[field.id] = [];
    } else if (field.type === "address") {
      values[field.id] = { region: [], regionText: "", detail: "" };
    } else if (field.type === "rating") {
      values[field.id] = 0;
    } else if (field.type === "signature") {
      values[field.id] = "";
    } else {
      values[field.id] = "";
    }
  });
  return values;
};

const ID_CARD_REG = /(^\d{15}$)|(^\d{18}$)|(^\d{17}(\d|X|x)$)/;

const validateIdCard = (value) => ID_CARD_REG.test(String(value || "").trim());

const matchShowIf = (showIf, values = {}) => {
  if (!showIf?.fieldId) return true;
  const current = values[showIf.fieldId];
  const target = showIf.value;
  const op = showIf.operator || "eq";
  const strCurrent = Array.isArray(current) ? current.join(",") : String(current ?? "");
  const strTarget = String(target ?? "");

  switch (op) {
    case "neq":
      if (Array.isArray(current)) return !current.includes(target);
      return strCurrent !== strTarget;
    case "contains":
      if (Array.isArray(current)) return current.some((v) => String(v).includes(strTarget));
      return strCurrent.includes(strTarget);
    case "notContains":
      if (Array.isArray(current)) return !current.some((v) => String(v).includes(strTarget));
      return !strCurrent.includes(strTarget);
    case "empty":
      if (Array.isArray(current)) return current.length === 0;
      return !strCurrent.trim();
    case "notEmpty":
      if (Array.isArray(current)) return current.length > 0;
      return !!strCurrent.trim();
    case "eq":
    default:
      if (Array.isArray(current)) return current.includes(target);
      if (Array.isArray(target)) return target.includes(strCurrent);
      return strCurrent === strTarget;
  }
};

const isFieldVisible = (field, values = {}) => {
  if (!field?.showIf?.fieldId) return true;
  return matchShowIf(field.showIf, values);
};

const getVisibleFields = (fields = [], values = {}) =>
  fields.filter((field) => isFieldVisible(field, values));

const SHARE_ACCESS_SCENES = new Set([
  1007, 1008, 1044, 1036, 1154, 1155, 1167, 1179, 1184, 1195, 1208, 1271, 1286,
]);

const FRIEND_ONLY_SCENES = new Set([1007]);

const checkFriendAccess = (settings = {}, scene) => {
  if (settings.accessMode !== "friend_only") return { ok: true };
  if (FRIEND_ONLY_SCENES.has(Number(scene))) return { ok: true };
  return {
    ok: false,
    message: settings.friendOnlyMsg || "仅限微信好友私聊分享进入填写",
  };
};

const checkShareAccess = (settings = {}, scene) => {
  if (settings.accessMode !== "share_only") return { ok: true };
  if (SHARE_ACCESS_SCENES.has(Number(scene))) return { ok: true };
  return {
    ok: false,
    message: settings.shareOnlyMsg || "请通过好友分享或扫码进入，不支持直接搜索访问",
  };
};

const checkGroupAccess = (settings = {}, groupVerified) => {
  if (settings.accessMode !== "group_only") return { ok: true };
  if (groupVerified) return { ok: true };
  return {
    ok: false,
    message: settings.groupOnlyMsg || "仅限微信群内打开小程序填写",
  };
};

const getScheduleStatus = (settings = {}) => {
  const now = Date.now();
  if (settings.openAt) {
    const open = new Date(settings.openAt).getTime();
    if (!Number.isNaN(open) && now < open) {
      return { open: false, message: settings.notOpenMsg || "表单尚未开放" };
    }
  }
  if (settings.closeAt) {
    const close = new Date(settings.closeAt).getTime();
    if (!Number.isNaN(close) && now > close) {
      return { open: false, message: settings.closedMsg || "表单已截止" };
    }
  }
  return { open: true, message: "" };
};

const validateField = (field, value) => {
  const label = field.label || field.id;

  if (field.type === "image") {
    const list = Array.isArray(value) ? value : [];
    if (field.required && list.length === 0) return `${label}为必填项`;
    const max = field.maxCount || 9;
    if (list.length > max) return `${label}最多上传${max}张`;
    return "";
  }

  if (field.type === "file") {
    const list = Array.isArray(value) ? value : [];
    if (field.required && list.length === 0) return `${label}为必填项`;
    const max = field.maxCount || 3;
    if (list.length > max) return `${label}最多上传${max}个文件`;
    return "";
  }

  if (field.type === "address") {
    const obj = value && typeof value === "object" ? value : {};
    if (field.required && !obj.regionText) return `请选择${label}所在地区`;
    if (field.required && !String(obj.detail || "").trim()) return `请填写${label}详细地址`;
    return "";
  }

  if (field.type === "signature") {
    const str = String(value || "").trim();
    if (field.required && !str) return `请完成${label}签名`;
    return "";
  }

  const strVal = Array.isArray(value) ? value.join(",") : String(value ?? "").trim();

  if (field.required) {
    if (field.type === "checkbox" && (!value || value.length === 0)) {
      return `${label}为必填项`;
    }
    if (field.type === "rating" && (!value || Number(value) < 1)) {
      return `请完成${label}评分`;
    }
    if (field.type !== "checkbox" && field.type !== "rating" && !strVal) {
      return `${label}为必填项`;
    }
  }

  if (!strVal && field.type !== "rating") return "";

  if (field.maxLength && strVal.length > field.maxLength) {
    return `${label}不能超过${field.maxLength}字`;
  }

  if (field.minLength && strVal.length < field.minLength) {
    return `${label}至少${field.minLength}字`;
  }

  if (field.type === "phone" && strVal && !/^1[3-9]\d{9}$/.test(strVal)) {
    return "手机号格式不正确";
  }

  if (field.type === "idcard" && strVal && !validateIdCard(strVal)) {
    return "身份证号格式不正确";
  }

  if (field.type === "amount" && strVal) {
    if (!/^\d+(\.\d{1,2})?$/.test(strVal)) return `${label}金额格式不正确（最多两位小数）`;
    const num = Number(strVal);
    if (field.min !== undefined && num < field.min) return `${label}不能小于${field.min}元`;
    if (field.max !== undefined && num > field.max) return `${label}不能大于${field.max}元`;
  }

  if (field.type === "email" && strVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
    return "邮箱格式不正确";
  }

  if (field.type === "number" && strVal) {
    const num = Number(strVal);
    if (Number.isNaN(num)) return `${label}必须是数字`;
    if (field.min !== undefined && num < field.min) return `${label}不能小于${field.min}`;
    if (field.max !== undefined && num > field.max) return `${label}不能大于${field.max}`;
  }

  if (field.pattern && strVal) {
    try {
      const reg = new RegExp(field.pattern);
      if (!reg.test(strVal)) return field.patternMsg || `${label}格式不正确`;
    } catch (e) {
      // ignore invalid pattern
    }
  }

  return "";
};

const getEffectiveSections = (template = {}) => {
  const sections = template.sections;
  if (Array.isArray(sections) && sections.length) return sections;
  return [{ id: "default", title: "表单内容" }];
};

const getDefaultSectionId = (template = {}) => getEffectiveSections(template)[0]?.id || "default";

const getSectionVisibleFields = (fields = [], sectionId, values = {}, template = {}) => {
  const sid = sectionId || getDefaultSectionId(template);
  return getVisibleFields(fields, values).filter(
    (field) => (field.sectionId || getDefaultSectionId(template)) === sid
  );
};

const resolveJumpSection = (sections, currentSectionId, fields = [], values = {}, template = {}) => {
  const sid = currentSectionId || getDefaultSectionId(template);
  const sectionFields = fields.filter(
    (field) => (field.sectionId || getDefaultSectionId(template)) === sid
  );
  for (let i = 0; i < sectionFields.length; i++) {
    const field = sectionFields[i];
    const rules = field.jumpRules || [];
    const val = values[field.id];
    for (let j = 0; j < rules.length; j++) {
      const rule = rules[j];
      if (String(val ?? "") === String(rule.value ?? "")) return rule.sectionId;
    }
  }
  const idx = sections.findIndex((s) => s.id === sid);
  return sections[idx + 1]?.id || null;
};

const validateForm = (fields = [], values = {}, options = {}) => {
  const visibleFields = options.sectionId
    ? getSectionVisibleFields(fields, options.sectionId, values, options.template)
    : getVisibleFields(fields, values);
  for (let i = 0; i < visibleFields.length; i++) {
    const field = visibleFields[i];
    const err = validateField(field, values[field.id]);
    if (err) return { ok: false, errMsg: err };
  }
  return { ok: true };
};

const getSubmissionSummary = (item) => {
  if (item.answers) {
    const a = item.answers;
    return {
      name: a.name || a.nickName || "匿名用户",
      phone: a.phone || "",
      type: a.type || item.templateTitle || "表单",
      content:
        a.content ||
        a.message ||
        Object.values(a)
          .filter((v) => v && typeof v === "string")
          .slice(0, 1)
          .join("") ||
        "—",
    };
  }
  return {
    name: item.name || "—",
    phone: item.phone || "",
    type: item.type || "—",
    content: item.content || "—",
  };
};

const formatAnswerDisplay = (field, value) => {
  if (value === undefined || value === null || value === "") return "—";
  if (field?.type === "image" && Array.isArray(value)) return value.length ? `${value.length} 张图片` : "—";
  if (field?.type === "file" && Array.isArray(value)) {
    return value.length ? value.map((f) => f.name || "文件").join("、") : "—";
  }
  if (field?.type === "address" && value && typeof value === "object") {
    const text = [value.regionText, value.detail].filter(Boolean).join(" ");
    return text || "—";
  }
  if (field?.type === "amount" && value) return `¥${value}`;
  if (field?.type === "signature" && value) return "已签名";
  if (field?.type === "checkbox" && Array.isArray(value)) return value.join("、") || "—";
  if (field?.type === "rating") return `${value} 星`;
  if (Array.isArray(value)) return value.join("、");
  return String(value);
};

const buildAnswerRows = (fields = [], answers = {}) => {
  const rows = fields.map((field) => ({
    label: field.label,
    value: formatAnswerDisplay(field, answers[field.id]),
    fieldId: field.id,
    fieldType: field.type,
    rawValue: answers[field.id],
  }));

  Object.keys(answers || {}).forEach((key) => {
    if (!fields.find((f) => f.id === key)) {
      rows.push({
        label: key,
        value: formatAnswerDisplay(null, answers[key]),
        fieldId: key,
        fieldType: "text",
        rawValue: answers[key],
      });
    }
  });

  return rows;
};

const submissionsToCSV = (submissions = [], fields = []) => {
  const headers = ["提交时间", "状态", ...fields.map((f) => f.label), "备注"];
  const lines = [headers.join(",")];

  submissions.forEach((item) => {
    const time = item.createTime ? new Date(item.createTime).toLocaleString("zh-CN") : "";
    const status = item.status === "processed" ? "已处理" : "待处理";
    const cells = fields.map((f) => {
      const val = formatAnswerDisplay(f, (item.answers || {})[f.id]);
      return `"${String(val).replace(/"/g, '""')}"`;
    });
    lines.push([`"${time}"`, `"${status}"`, ...cells, `"${(item.remark || "").replace(/"/g, '""')}"`].join(","));
  });

  return lines.join("\n");
};

const normalizeFormValues = (fields = [], values = {}) => {
  const next = { ...values };
  fields.forEach((field) => {
    if (field.type === "address") {
      if (!next[field.id] || typeof next[field.id] !== "object") {
        next[field.id] = { region: [], regionText: "", detail: "" };
      }
    }
  });
  return next;
};

const createEmptyField = (type = "text") => ({
  id: `field_${Date.now()}`,
  type,
  label: "新字段",
  required: false,
  placeholder: type === "address" ? "街道、门牌号等" : "",
  options: ["选项1", "选项2"],
  maxCount: type === "image" ? 3 : 1,
  maxLength: type === "textarea" ? 500 : 140,
});

module.exports = {
  FIELD_TYPES,
  FIELD_TYPE_OPTIONS,
  FIELD_TYPE_LABELS,
  DEFAULT_TEMPLATE,
  initFormValues,
  normalizeFormValues,
  isFieldVisible,
  getVisibleFields,
  checkShareAccess,
  checkFriendAccess,
  checkGroupAccess,
  getEffectiveSections,
  getDefaultSectionId,
  getSectionVisibleFields,
  resolveJumpSection,
  getScheduleStatus,
  validateIdCard,
  validateField,
  validateForm,
  getSubmissionSummary,
  formatAnswerDisplay,
  buildAnswerRows,
  submissionsToCSV,
  createEmptyField,
};
