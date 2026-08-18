const crypto = require("crypto");

const PASSWORD_MASK = "********";
const PUBLIC_SENSITIVE_SETTING_KEYS = new Set([
  "accessPassword",
  "accessPasswordHash",
  "accessPasswordSalt",
  "phoneWhitelist",
  "openidWhitelist",
  "paymentMchId",
  "smsWebhookUrl",
  "smsSecret",
  "smsNotifyPhones",
  "tencentSecretId",
  "tencentSecretKey",
  "lastBackupFileId",
  "lastBackupExcelFileId",
]);

const DEFAULT_TEMPLATE = {
  title: "信息提交",
  description: "请填写以下信息，我们会尽快与您联系",
  isDefault: true,
  enabled: true,
  fields: [
    { id: "name", type: "text", label: "姓名", required: true, maxLength: 20, placeholder: "请输入您的姓名" },
    { id: "phone", type: "phone", label: "手机号", required: true, placeholder: "请输入11位手机号" },
    { id: "email", type: "email", label: "邮箱", required: false, placeholder: "选填，便于发送通知" },
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
    privacyText:
      "我们承诺保护您的个人信息，仅用于本次信息收集与后续联系，不会向第三方泄露。提交即表示您同意上述说明。",
    submitButtonText: "提交",
    successTitle: "提交成功",
    successDesc: "我们已收到您的信息，会尽快与您联系",
    notifyEnabled: true,
    notifyConfigId: "",
    notifyTemplateId: "",
  },
};

const ID_CARD_REG = /(^\d{15}$)|(^\d{18}$)|(^\d{17}(\d|X|x)$)/;

const hashFormPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
  const normalized = String(password || "");
  if (!normalized) return { accessPasswordHash: "", accessPasswordSalt: "" };
  return {
    accessPasswordHash: crypto.scryptSync(normalized, salt, 64).toString("hex"),
    accessPasswordSalt: salt,
  };
};

const verifyFormPassword = (template, password) => {
  const settings = template?.settings || {};
  const plainPassword = settings.accessPassword;
  const passwordHash = settings.accessPasswordHash;
  const passwordSalt = settings.accessPasswordSalt;
  if (!plainPassword && !(passwordHash && passwordSalt)) return { ok: true };

  if (passwordHash && passwordSalt) {
    try {
      const actual = Buffer.from(hashFormPassword(password, passwordSalt).accessPasswordHash, "hex");
      const expected = Buffer.from(String(passwordHash), "hex");
      if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
        return { ok: true };
      }
    } catch (e) {
      // 哈希配置异常时按密码校验失败处理
    }
  } else if (String(password || "") === String(plainPassword)) {
    return { ok: true };
  }
  return { ok: false, errMsg: "访问密码错误" };
};

const sanitizeTemplate = (template, forAdmin = false) => {
  if (!template) return template;
  const copy = { ...template };
  if (Array.isArray(copy.fields)) {
    copy.fields = copy.fields.filter((field) => field && field.type !== "location");
  }
  if (copy.settings) {
    copy.settings = { ...copy.settings };
    const hasPassword = !!(
      copy.settings.accessPassword ||
      (copy.settings.accessPasswordHash && copy.settings.accessPasswordSalt)
    );
    copy.settings.needPassword = hasPassword;

    if (forAdmin) {
      if (hasPassword) copy.settings.accessPassword = PASSWORD_MASK;
      delete copy.settings.accessPasswordHash;
      delete copy.settings.accessPasswordSalt;
    } else {
      Object.keys(copy.settings).forEach((key) => {
        const lowerKey = key.toLowerCase();
        const looksSensitive =
          lowerKey.includes("secret") ||
          lowerKey.includes("privatekey") ||
          lowerKey.endsWith("apikey") ||
          lowerKey.endsWith("token");
        if (PUBLIC_SENSITIVE_SETTING_KEYS.has(key) || looksSensitive) {
          delete copy.settings[key];
        }
      });
    }
  }
  return copy;
};

const stableStringify = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
};

const parsePhoneWhitelist = (settings = {}) => {
  const raw = settings.phoneWhitelist;
  if (Array.isArray(raw)) return raw.map((p) => String(p).trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw.split(/[\n,，;；\s]+/).map((p) => p.trim()).filter(Boolean);
  }
  return [];
};

const extractSubmitPhone = (fields = [], answers = {}, user = null, options = {}) => {
  const phoneField = fields.find((f) => f.type === "phone");
  if (phoneField && answers[phoneField.id]) return String(answers[phoneField.id]).trim();
  if (answers.phone) return String(answers.phone).trim();
  // 白名单校验不得回退到可手动修改的资料手机号，避免冒用
  if (options.allowProfilePhone && user?.phone) return String(user.phone).trim();
  return "";
};

const checkPhoneWhitelist = (template, answers, user) => {
  if (!template?.settings?.whitelistEnabled) return { ok: true };

  const list = parsePhoneWhitelist(template.settings);
  if (!list.length) return { ok: false, errMsg: "白名单未配置，请联系管理员" };

  const phone = extractSubmitPhone(template.fields || [], answers, user, { allowProfilePhone: false });
  if (!phone) {
    return {
      ok: false,
      errMsg: template.settings.whitelistDenyMsg || "请填写手机号以验证填写权限",
    };
  }

  if (!list.includes(phone)) {
    return {
      ok: false,
      errMsg: template.settings.whitelistDenyMsg || "您的手机号不在允许填写名单中",
    };
  }

  return { ok: true };
};

const checkGroupAccess = (settings = {}, groupVerified) => {
  if (settings.accessMode !== "group_only") return { ok: true };
  if (groupVerified) return { ok: true };
  return {
    ok: false,
    errMsg: settings.groupOnlyMsg || "仅限微信群内打开小程序填写",
  };
};

const checkOpenidWhitelist = (template, openid) => {
  if (!template?.settings?.openidWhitelistEnabled) return { ok: true };

  const list = parsePhoneWhitelist({ phoneWhitelist: template.settings.openidWhitelist });
  if (!list.length) return { ok: false, errMsg: "OpenID 白名单未配置" };
  if (!openid || !list.includes(openid)) {
    return {
      ok: false,
      errMsg: template.settings.openidWhitelistDenyMsg || "您暂无填写权限，请联系管理员",
    };
  }
  return { ok: true };
};

const filterSubmissions = (
  data,
  { keyword = "", dateFrom = "", dateTo = "", phone = "", typeValue = "", fieldId = "", templateId = "" } = {}
) => {
  let result = data || [];

  if (templateId) {
    result = result.filter((item) => item.templateId === templateId);
  }

  if (keyword.trim()) {
    const kw = keyword.trim().toLowerCase();
    result = result.filter((item) => {
      const summary = getSummaryFromItem(item);
      return JSON.stringify({ ...item, ...summary }).toLowerCase().includes(kw);
    });
  }

  if (phone.trim()) {
    const p = phone.trim();
    result = result.filter((item) => {
      const summary = getSummaryFromItem(item);
      const answers = item.answers || {};
      return (summary.phone || answers.phone || "").includes(p);
    });
  }

  if (typeValue.trim()) {
    const tv = typeValue.trim();
    result = result.filter((item) => {
      const answers = item.answers || {};
      const fid = fieldId || "type";
      const val = answers[fid] || item.type || "";
      return String(val) === tv;
    });
  }

  if (dateFrom) {
    const from = new Date(dateFrom).setHours(0, 0, 0, 0);
    result = result.filter((item) => {
      const t = item.createTime ? new Date(item.createTime).getTime() : 0;
      return t >= from;
    });
  }

  if (dateTo) {
    const to = new Date(dateTo).setHours(23, 59, 59, 999);
    result = result.filter((item) => {
      const t = item.createTime ? new Date(item.createTime).getTime() : 0;
      return t <= to;
    });
  }

  return result;
};

const checkFormSchedule = (template) => {
  const settings = template?.settings || {};
  const now = Date.now();

  if (settings.openAt) {
    const open = new Date(settings.openAt).getTime();
    if (!Number.isNaN(open) && now < open) {
      return { ok: false, errMsg: settings.notOpenMsg || "表单尚未开放，请稍后再试" };
    }
  }

  if (settings.closeAt) {
    const close = new Date(settings.closeAt).getTime();
    if (!Number.isNaN(close) && now > close) {
      return { ok: false, errMsg: settings.closedMsg || "表单已截止收集" };
    }
  }

  return { ok: true };
};

const matchShowIf = (showIf, answers = {}) => {
  if (!showIf?.fieldId) return true;
  const current = answers[showIf.fieldId];
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

const isFieldVisible = (field, answers = {}) => {
  if (!field?.showIf?.fieldId) return true;
  return matchShowIf(field.showIf, answers);
};

const buildFieldStats = (fields = [], submissions = []) => {
  const stats = [];
  fields.forEach((field) => {
    if (["number", "amount", "rating"].includes(field.type)) {
      const nums = submissions
        .map((s) => Number(s.answers?.[field.id]))
        .filter((n) => !Number.isNaN(n));
      if (!nums.length) return;
      const sum = nums.reduce((a, b) => a + b, 0);
      stats.push({
        fieldId: field.id,
        label: field.label || field.id,
        type: field.type,
        count: nums.length,
        sum: Math.round(sum * 100) / 100,
        avg: Math.round((sum / nums.length) * 100) / 100,
        min: Math.min(...nums),
        max: Math.max(...nums),
      });
    }
    if (["select", "radio", "checkbox"].includes(field.type)) {
      const votes = {};
      (field.options || []).forEach((o) => {
        votes[o] = 0;
      });
      submissions.forEach((s) => {
        const v = s.answers?.[field.id];
        if (Array.isArray(v)) {
          v.forEach((x) => {
            votes[x] = (votes[x] || 0) + 1;
          });
        } else if (v !== undefined && v !== null && v !== "") {
          votes[v] = (votes[v] || 0) + 1;
        }
      });
      stats.push({
        fieldId: field.id,
        label: field.label || field.id,
        type: field.type,
        votes: Object.entries(votes)
          .map(([option, count]) => ({ option, count }))
          .sort((a, b) => b.count - a.count),
      });
      const last = stats[stats.length - 1];
      const voteTotal = last.votes.reduce((s, v) => s + v.count, 0);
      if (voteTotal) {
        last.votes.forEach((v) => {
          v.percent = Math.round((v.count / voteTotal) * 100);
        });
      }
    }
  });
  return stats;
};

const detectAnomalies = (submissions = [], threshold = 3) => {
  const hourAgo = Date.now() - 3600000;
  const byOpenid = {};
  submissions.forEach((item) => {
    const t = item.createTime ? new Date(item.createTime).getTime() : 0;
    if (t < hourAgo) return;
    const oid = item.openid || item._openid || "unknown";
    byOpenid[oid] = (byOpenid[oid] || 0) + 1;
  });
  return Object.entries(byOpenid)
    .filter(([, count]) => count >= threshold)
    .map(([openid, count]) => ({
      openid: `${openid.slice(0, 8)}…`,
      count,
      reason: "1 小时内多次提交",
    }));
};

const getVisibleFields = (fields = [], answers = {}) =>
  fields.filter((field) => isFieldVisible(field, answers));

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
    if (field.required && !String(value || "").trim()) return `${label}为必填项`;
    return "";
  }

  const strVal = Array.isArray(value) ? value.join(",") : String(value ?? "").trim();

  if (field.required) {
    if (field.type === "checkbox" && (!value || value.length === 0)) return `${label}为必填项`;
    if (field.type === "rating" && (!value || Number(value) < 1)) return `请完成${label}评分`;
    if (field.type !== "checkbox" && field.type !== "rating" && !strVal) return `${label}为必填项`;
  }

  if (!strVal && field.type !== "rating") return "";

  if (field.maxLength && strVal.length > field.maxLength) return `${label}不能超过${field.maxLength}字`;
  if (field.type === "phone" && strVal && !/^1[3-9]\d{9}$/.test(strVal)) return "手机号格式不正确";
  if (field.type === "idcard" && strVal && !ID_CARD_REG.test(strVal)) return "身份证号格式不正确";
  if (field.type === "amount" && strVal) {
    if (!/^\d+(\.\d{1,2})?$/.test(strVal)) return `${label}金额格式不正确`;
    const num = Number(strVal);
    if (field.min !== undefined && num < field.min) return `${label}不能小于${field.min}`;
    if (field.max !== undefined && num > field.max) return `${label}不能大于${field.max}`;
  }
  if (field.type === "email" && strVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) return "邮箱格式不正确";
  if (field.type === "number" && strVal) {
    const num = Number(strVal);
    if (Number.isNaN(num)) return `${label}必须是数字`;
    if (field.min !== undefined && num < field.min) return `${label}不能小于${field.min}`;
    if (field.max !== undefined && num > field.max) return `${label}不能大于${field.max}`;
  }
  if (field.pattern && strVal) {
    try {
      if (!new RegExp(field.pattern).test(strVal)) return field.patternMsg || `${label}格式不正确`;
    } catch (e) {
      /* ignore */
    }
  }
  return "";
};

const validateAnswers = (fields, answers) => {
  const visibleFields = getVisibleFields(fields, answers);
  for (let i = 0; i < visibleFields.length; i++) {
    const field = visibleFields[i];
    const err = validateField(field, answers[field.id]);
    if (err) return { ok: false, errMsg: err };
  }
  return { ok: true };
};

const getSummaryFromItem = (item) => {
  if (item.answers) {
    const a = item.answers;
    return {
      name: a.name || "匿名",
      phone: item.phone || a.phone || "",
      type: a.type || item.templateTitle || "表单",
      content: a.content || a.message || Object.values(a).find((v) => typeof v === "string" && v.length > 5) || "—",
    };
  }
  return {
    name: item.name || "—",
    phone: item.phone || "",
    type: item.type || "—",
    content: item.content || "—",
  };
};

const formatSubmissionStatus = (status) => {
  const map = {
    pending: "待处理",
    processed: "已处理",
    rejected: "已拒绝",
    unpaid: "待支付",
  };
  return map[status] || status || "待处理";
};

const formatFieldValue = (field, val) => {
  if (val === undefined || val === null || val === "") return "";
  if (field.type === "image" && Array.isArray(val)) return `${val.length}张图片`;
  if (field.type === "file" && Array.isArray(val)) {
    return val.map((item) => item.name || "文件").join("、");
  }
  if (field.type === "address" && val && typeof val === "object") {
    return [val.regionText, val.detail].filter(Boolean).join(" ");
  }
  if (field.type === "amount" && val) return `¥${val}`;
  if (field.type === "signature" && val) return "已签名";
  if (Array.isArray(val) && field.type !== "image") return val.join("、");
  if (field.type === "rating" && val) return `${val}星`;
  return String(val);
};

const findAnswerByPatterns = (answers = {}, fields = [], patterns = []) => {
  for (const field of fields) {
    const label = String(field.label || "");
    const id = String(field.id || "");
    if (patterns.some((p) => label.includes(p) || id.toLowerCase().includes(p.toLowerCase()))) {
      const val = answers[id];
      if (val != null && val !== "") {
        if (typeof val === "object") return formatFieldValue(field, val);
        return String(val);
      }
    }
  }
  for (const [key, val] of Object.entries(answers)) {
    if (patterns.some((p) => key.toLowerCase().includes(p.toLowerCase()))) {
      if (val != null && val !== "") {
        if (typeof val === "object") return JSON.stringify(val).slice(0, 20);
        return String(val);
      }
    }
  }
  return "";
};

const extractNotifyValuesFromAnswers = (answers = {}, template = {}, submissionId = "") => {
  const summary = getSummaryFromItem({ answers, templateTitle: template.title });
  const fields = template.fields || [];
  const company =
    findAnswerByPatterns(answers, fields, ["企业", "公司", "单位", "company", "corp"]) ||
    summary.type ||
    template.title ||
    "个人咨询";
  const number = submissionId
    ? String(submissionId).replace(/\D/g, "").slice(-8) || String(Date.now()).slice(-8)
    : String(Date.now()).slice(-8);

  return {
    name: summary.name || "匿名",
    phone: summary.phone,
    company,
    number,
    detail: summary.phone || summary.type || summary.content || template.title || "表单提交",
    type: summary.type,
    content: summary.content,
  };
};

const sanitizeExcelCell = (value) => {
  const text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) return `'${text}`;
  return text;
};

const buildCSV = (submissions, fields) => {
  const headers = ["表单编号", "提交时间", "状态", ...fields.map((f) => f.label), "备注"];
  const lines = [headers.join(",")];
  submissions.forEach((item) => {
    const time = item.createTime ? new Date(item.createTime).toLocaleString("zh-CN") : "";
    const status = formatSubmissionStatus(item.status);
    const answers = item.answers || {};
    const cells = fields.map((f) => {
      const val = sanitizeExcelCell(formatFieldValue(f, answers[f.id]));
      return `"${val.replace(/"/g, '""')}"`;
    });
    lines.push([
      `"${sanitizeExcelCell(item.formNo || "").replace(/"/g, '""')}"`,
      `"${time}"`,
      `"${status}"`,
      ...cells,
      `"${sanitizeExcelCell(item.remark || "").replace(/"/g, '""')}"`,
    ].join(","));
  });
  return "\ufeff" + lines.join("\n");
};

const buildExcel = (submissions, fields) => {
  const XLSX = require("xlsx");
  const headers = ["表单编号", "提交时间", "状态", ...fields.map((f) => f.label), "备注"];
  const rows = [headers];
  submissions.forEach((item) => {
    const time = item.createTime ? new Date(item.createTime).toLocaleString("zh-CN") : "";
    const status = formatSubmissionStatus(item.status);
    const answers = item.answers || {};
    const cells = fields.map((f) => sanitizeExcelCell(formatFieldValue(f, answers[f.id])));
    rows.push([
      sanitizeExcelCell(item.formNo || ""),
      time,
      status,
      ...cells,
      sanitizeExcelCell(item.remark || ""),
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "提交数据");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

const buildBackupExcel = (submissions, fields) => {
  const XLSX = require("xlsx");
  const headers = ["表单编号", "提交时间", "状态", "表单名称", ...fields.map((f) => f.label), "备注"];
  const rows = [headers];
  submissions.forEach((item) => {
    const time = item.createTime ? new Date(item.createTime).toLocaleString("zh-CN") : "";
    const status = formatSubmissionStatus(item.status);
    const answers = item.answers || {};
    const cells = fields.map((f) => sanitizeExcelCell(formatFieldValue(f, answers[f.id])));
    rows.push([
      sanitizeExcelCell(item.formNo || ""),
      time,
      status,
      sanitizeExcelCell(item.templateTitle || ""),
      ...cells,
      sanitizeExcelCell(item.remark || ""),
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "备份数据");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

const checkShareAccess = (settings, scene) => {
  if (settings?.accessMode !== "share_only") return { ok: true };
  const allowed = new Set([
    1007, 1008, 1044, 1036, 1154, 1155, 1167, 1179, 1184, 1195, 1208, 1271, 1286,
  ]);
  if (allowed.has(Number(scene))) return { ok: true };
  return {
    ok: false,
    errMsg: settings.shareOnlyMsg || "请通过好友分享或扫码进入，不支持直接搜索访问",
  };
};

const checkFriendAccess = (settings, scene) => {
  if (settings?.accessMode !== "friend_only") return { ok: true };
  if (Number(scene) === 1007) return { ok: true };
  return {
    ok: false,
    errMsg: settings.friendOnlyMsg || "仅限微信好友私聊分享进入填写",
  };
};

const canUserEditSubmission = (item, settings = {}) => {
  if (settings.allowEditSubmission === false) return false;
  if (!item) return false;
  if (item.status === "rejected" || item.status === "unpaid") return false;
  if (item.paymentStatus === "unpaid") return false;
  if (item.refundStatus === "pending" || item.refundStatus === "approved") return false;
  return item.status === "pending" || item.status === "processed";
};

const formatSubscribeFieldValue = (fieldKey, rawValue) => {
  const key = String(fieldKey || "").toLowerCase();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const chineseDateTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  if (key.startsWith("date")) {
    if (rawValue) return String(rawValue).slice(0, 20);
    return `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日`;
  }
  if (key.startsWith("time")) {
    if (rawValue && String(rawValue).includes("年")) return String(rawValue).slice(0, 32);
    return chineseDateTime;
  }
  if (key.startsWith("number")) {
    const digits = String(rawValue || "")
      .replace(/\D/g, "")
      .slice(0, 32);
    return digits || String(Date.now()).slice(-8);
  }
  if (key.startsWith("phone")) {
    return String(rawValue || "00000000000").slice(0, 17);
  }
  const text = rawValue != null && rawValue !== "" ? String(rawValue) : "—";
  return text.slice(0, 20);
};

const parseTemplateFields = (content = "") => {
  const fields = [];
  const labeled = /([^:\n]{0,20}?)\s*\{\{(\w+)\.DATA\}\}/g;
  let match = labeled.exec(content);
  while (match) {
    fields.push({ label: (match[1] || "").trim(), key: match[2] });
    match = labeled.exec(content);
  }
  if (fields.length) return fields;

  const keys = [...String(content).matchAll(/\{\{(\w+)\.DATA\}\}/g)].map((item) => item[1]);
  return keys.map((key) => ({ label: "", key }));
};

const inferSubscribeFieldValue = (field, values, index) => {
  const label = String(field.label || "");
  const key = String(field.key || "");
  const keyLower = key.toLowerCase();
  const labelText = label.replace(/\{\{.*?\}\}/g, "");

  if (keyLower.startsWith("time") || keyLower.startsWith("date") || /时间|日期/.test(labelText)) {
    return formatSubscribeFieldValue(key, values.time);
  }
  if (keyLower.startsWith("number") || /编号|单号|留言号/.test(labelText)) {
    return formatSubscribeFieldValue(key, values.number);
  }
  if (keyLower.startsWith("phone") || /手机|电话/.test(labelText)) {
    return formatSubscribeFieldValue(key, values.phone || values.detail);
  }
  if (/姓名|名称|用户|提交人|昵称|联系人/.test(labelText) && !/企业|公司/.test(labelText)) {
    return formatSubscribeFieldValue(key, values.name);
  }
  if (/企业|公司|单位/.test(labelText)) {
    return formatSubscribeFieldValue(key, values.company || values.detail);
  }
  if (keyLower.startsWith("thing")) {
    const allFields = parseTemplateFields(values._content || "");
    const thingKeys = allFields
      .filter((f) => String(f.key).toLowerCase().startsWith("thing"))
      .map((f) => f.key);
    const thingIndex = thingKeys.indexOf(key);
    const fieldMeta = allFields.find((f) => f.key === key);
    const metaLabel = String(fieldMeta?.label || "");
    if (/企业|公司|单位/.test(metaLabel)) {
      return formatSubscribeFieldValue(key, values.company || values.detail);
    }
    if (/姓名|名称|用户|提交人|昵称|联系人/.test(metaLabel)) {
      return formatSubscribeFieldValue(key, values.name);
    }
    if (thingIndex <= 0) return formatSubscribeFieldValue(key, values.name);
    return formatSubscribeFieldValue(key, values.company || values.detail || values.name);
  }
  if (keyLower.startsWith("enum")) {
    return formatSubscribeFieldValue(key, values.detail || values.name || "已提交");
  }
  if (index === 0) return formatSubscribeFieldValue(key, values.name);
  return formatSubscribeFieldValue(key, values.detail || values.name || "—");
};

const buildSubscribeMessageDataAuto = (templateContent = "", values = {}) => {
  const payload = { ...values, _content: templateContent };
  const fields = parseTemplateFields(templateContent);
  const data = {};
  fields.forEach((field, index) => {
    data[field.key] = { value: inferSubscribeFieldValue(field, payload, index) };
  });
  return data;
};

module.exports = {
  DEFAULT_TEMPLATE,
  validateAnswers,
  getSummaryFromItem,
  buildCSV,
  buildExcel,
  buildBackupExcel,
  formatSubmissionStatus,
  filterSubmissions,
  checkFormSchedule,
  matchShowIf,
  isFieldVisible,
  getVisibleFields,
  buildFieldStats,
  detectAnomalies,
  verifyFormPassword,
  hashFormPassword,
  sanitizeTemplate,
  stableStringify,
  checkPhoneWhitelist,
  parsePhoneWhitelist,
  extractSubmitPhone,
  checkShareAccess,
  checkFriendAccess,
  checkGroupAccess,
  checkOpenidWhitelist,
  canUserEditSubmission,
  formatSubscribeFieldValue,
  parseTemplateFields,
  buildSubscribeMessageDataAuto,
  extractNotifyValuesFromAnswers,
};
