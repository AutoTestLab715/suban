const { getSubmissionSummary } = require("./formEngine");

const callCloud = (type, data = {}) =>
  wx.cloud.callFunction({
    name: "quickstartFunctions",
    data: { type, data },
  });

const isCloudTransportError = (error) => {
  const msg = String(error?.errMsg || error?.message || error || "");
  return /Failed to fetch|FUNCTION_NOT_FOUND|FunctionName parameter|errCode:\s*-501000|ERR_CONNECTION|network/i.test(
    msg
  );
};

// 优先走独立云函数 biaoxunApi；部署缺失/网络失败时回退到 quickstartFunctions
const callBiaoxunCloud = (type, data = {}) =>
  wx.cloud
    .callFunction({
      name: "biaoxunApi",
      data: { type, data },
    })
    .catch((error) => {
      if (!isCloudTransportError(error)) return Promise.reject(error);
      console.warn("biaoxunApi 不可用，回退 quickstartFunctions", error);
      return wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: { type, data },
      });
    });

const formatTime = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATUS_MAP = {
  pending: { label: "待处理", class: "status-pending" },
  processed: { label: "已处理", class: "status-processed" },
  rejected: { label: "已拒绝", class: "status-rejected" },
  unpaid: { label: "待支付", class: "status-unpaid" },
};

const AUDIT_ACTION_MAP = {
  update_status: "更新状态",
  edit_submission: "编辑提交",
  delete_submission: "删除提交",
  batch_update_status: "批量更新状态",
  batch_delete: "批量删除",
  update_template: "更新表单配置",
  checkin: "签到核销",
  update_admin_role: "修改管理员角色",
  refund_approve: "批准退款",
  refund_reject: "拒绝退款",
  export_attachments: "导出附件",
  create_template: "创建表单",
  set_default_template: "设置默认表单",
  send_daily_digest: "推送日报",
  auto_daily_digest: "自动推送日报",
  save_email_config: "保存邮箱配置",
  send_test_email: "发送测试邮件",
  export_attachments_zip: "ZIP导出附件",
};

const requestPayment = (submissionId) =>
  callCloud("createPaymentOrder", { submissionId }).then((res) => {
    if (!res.result?.success) {
      return Promise.reject(new Error(res.result?.errMsg || "创建订单失败"));
    }
    const payment = res.result.payment;
    return new Promise((resolve, reject) => {
      wx.requestPayment({
        ...payment,
        success: resolve,
        fail: reject,
      });
    });
  });

const REFUND_STATUS_MAP = {
  pending: "退款申请中",
  approved: "已退款",
  rejected: "退款已拒绝",
};

const decorateForm = (item) => {
  const summary = getSubmissionSummary(item);
  const statusInfo = STATUS_MAP[item.status] || STATUS_MAP.pending;
  const refundLabel = REFUND_STATUS_MAP[item.refundStatus] || "";
  return {
    ...item,
    ...summary,
    email: item.answers?.email || item.email || "",
    createTimeStr: formatTime(item.createTime),
    updateTimeStr: formatTime(item.updateTime),
    statusLabel: refundLabel || statusInfo.label,
    statusClass: item.refundStatus === "pending" ? "status-pending" : statusInfo.class,
    canRefund:
      item.paymentStatus === "paid" &&
      item.refundStatus !== "pending" &&
      item.refundStatus !== "approved",
    canPay: item.status === "unpaid" || item.paymentStatus === "unpaid",
    canEdit: !!item.canEdit,
  };
};

const LOGOUT_FLAG = "userLoggedOut";

const saveUser = (user) => {
  const app = getApp();
  app.globalData.userInfo = user;
  wx.setStorageSync("userInfo", user);
  wx.removeStorageSync(LOGOUT_FLAG);
};

const getLocalUser = () => {
  const app = getApp();
  return app.globalData.userInfo || wx.getStorageSync("userInfo") || null;
};

const clearUser = () => {
  const app = getApp();
  app.globalData.userInfo = null;
  wx.removeStorageSync("userInfo");
};

const markLoggedOut = () => {
  clearUser();
  wx.setStorageSync(LOGOUT_FLAG, true);
};

const hasLoggedOut = () => !!wx.getStorageSync(LOGOUT_FLAG);

const DEFAULT_AVATAR =
  "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0";

const uploadAvatar = (filePath) => {
  if (!filePath) return Promise.resolve("");
  if (filePath.startsWith("cloud://") || filePath.startsWith("https://")) {
    return Promise.resolve(filePath);
  }
  const ext = /\.(\w+)$/.test(filePath) ? filePath.match(/\.(\w+)$/)[0] : ".jpg";
  return wx.cloud
    .uploadFile({
      cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`,
      filePath,
    })
    .then((res) => res.fileID)
    .catch(() => "");
};

const isAdminUser = (user) => user?.role === "admin";

const TAB_PAGES = [
  "/pages/index/index",
  "/pages/biaoxun/index",
  "/pages/fill/index",
  "/pages/list/index",
  "/pages/profile/index",
];

const parseQuery = (query = "") => {
  const params = {};
  String(query || "")
    .split("&")
    .forEach((pair) => {
      if (!pair) return;
      const [k, v] = pair.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    });
  return params;
};

const goPage = (url) => {
  const [path, query = ""] = String(url || "").split("?");
  if (query) {
    const params = parseQuery(query);
    try {
      const app = getApp();
      if (path === "/pages/fill/index" && params.templateId) {
        app.globalData.fillTemplateId = params.templateId;
      }
      // switchTab 不支持 query，经 globalData 回传给标讯页
      if (path === "/pages/biaoxun/index") {
        if (params.source) app.globalData.biaoxunPendingSource = params.source;
        if (params.category) app.globalData.biaoxunPendingCategory = params.category;
        if (params.keyword) app.globalData.biaoxunPendingKeyword = params.keyword;
      }
    } catch (e) {
      /* ignore */
    }
  }

  if (TAB_PAGES.includes(path)) {
    // switchTab 禁止带 query，否则易触发 routeDone webviewId not found
    wx.switchTab({ url: path });
  } else if (path === "/pages/forms/index") {
    wx.navigateTo({ url });
  } else {
    wx.redirectTo({ url });
  }
};

let loginNavLockAt = 0;
let silentLoginPromise = null;
let finishNavLockAt = 0;

const goLogin = (redirectUrl = "") => {
  const now = Date.now();
  if (now - loginNavLockAt < 800) return;
  loginNavLockAt = now;
  if (redirectUrl) saveLoginRedirect(redirectUrl);

  const query = redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : "";
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (current?.route === "pages/login/index") return;

  wx.navigateTo({
    url: `/pages/login/index${query}`,
    fail: () => {
      wx.redirectTo({ url: `/pages/login/index${query}` });
    },
  });
};

const routeByRole = (user) => {
  if (isAdminUser(user)) {
    wx.redirectTo({ url: "/pages/admin/index/index" });
  } else {
    goPage("/pages/index/index");
  }
};

const LOGIN_REDIRECT_KEY = "loginRedirect";

const saveLoginRedirect = (url) => {
  if (url) wx.setStorageSync(LOGIN_REDIRECT_KEY, url);
};

const consumeLoginRedirect = () => {
  const url = wx.getStorageSync(LOGIN_REDIRECT_KEY) || "";
  wx.removeStorageSync(LOGIN_REDIRECT_KEY);
  return url;
};

const trySilentLogin = () => {
  if (hasLoggedOut()) return Promise.resolve(null);
  if (silentLoginPromise) return silentLoginPromise;

  silentLoginPromise = callCloud("checkUser")
    .then((res) => {
      if (!res.result?.success || !res.result.registered) {
        if (getLocalUser()) clearUser();
        return null;
      }
      if (res.result.user) {
        saveUser(res.result.user);
        return res.result.user;
      }
      return callCloud("loginUser").then((loginRes) => {
        if (!loginRes.result?.success) return null;
        saveUser(loginRes.result.user);
        return loginRes.result.user;
      });
    })
    .catch(() => null)
    .finally(() => {
      silentLoginPromise = null;
    });

  return silentLoginPromise;
};

const finishLoginNavigation = (user) => {
  const now = Date.now();
  if (now - finishNavLockAt < 1200) return;
  finishNavLockAt = now;

  const redirect = consumeLoginRedirect();
  if (redirect) {
    goPage(redirect);
    return;
  }
  routeByRole(user);
};

const ensureLogin = (options = {}) => {
  const redirectUrl = options.redirectUrl || "";
  const autoGoLogin = options.autoGoLogin !== false;
  if (redirectUrl) saveLoginRedirect(redirectUrl);

  return trySilentLogin().then((user) => {
    if (user) return { success: true, registered: true, user };
    if (autoGoLogin) goLogin(redirectUrl);
    return null;
  });
};

const ADMIN_ROLE_LABELS = {
  owner: "超级管理员",
  editor: "编辑员",
  viewer: "查看员",
  exporter: "导出员",
};

const ADMIN_PERMISSIONS = {
  owner: ["read", "edit", "delete", "export", "config", "checkin", "team"],
  editor: ["read", "edit", "export", "checkin"],
  viewer: ["read"],
  exporter: ["read", "export"],
};

const canAdmin = (perm, permissions = []) => permissions.includes(perm);

const ensureAdmin = (requiredPerm = "read") => {
  if (hasLoggedOut()) {
    wx.showToast({ title: "请先登录", icon: "none" });
    goPage("/pages/profile/index");
    return Promise.resolve(null);
  }

  return trySilentLogin().then((silentUser) => {
    if (!silentUser) {
      wx.showToast({ title: "请先登录", icon: "none" });
      goPage("/pages/profile/index");
      return null;
    }
    return proceedAdmin(silentUser, requiredPerm, {
      success: true,
      registered: true,
      user: silentUser,
    });
  });
};

const proceedAdmin = (user, requiredPerm, baseResult) => {
  if (!isAdminUser(user)) {
    wx.showToast({ title: "无管理员权限", icon: "none" });
    goPage("/pages/index/index");
    return null;
  }
  saveUser(user);
  return callCloud("checkAdmin").then((res) => {
    if (!res.result?.success || !res.result.isAdmin) {
      wx.showToast({ title: "请先登录管理员账号", icon: "none" });
      goPage("/pages/profile/index");
      return null;
    }
    const permissions = res.result.permissions || ADMIN_PERMISSIONS.owner;
    if (requiredPerm && !canAdmin(requiredPerm, permissions)) {
      wx.showToast({ title: "无此操作权限", icon: "none" });
      wx.navigateBack({
        delta: 1,
        fail: () => wx.redirectTo({ url: "/pages/admin/index/index" }),
      });
      return null;
    }
    return {
      ...baseResult,
      user,
      adminRole: res.result.adminRole || user.adminRole || "owner",
      permissions,
    };
  });
};

module.exports = {
  callCloud,
  callBiaoxunCloud,
  formatTime,
  decorateForm,
  STATUS_MAP,
  AUDIT_ACTION_MAP,
  requestPayment,
  saveUser,
  getLocalUser,
  clearUser,
  markLoggedOut,
  hasLoggedOut,
  uploadAvatar,
  DEFAULT_AVATAR,
  routeByRole,
  isAdminUser,
  ensureLogin,
  trySilentLogin,
  saveLoginRedirect,
  finishLoginNavigation,
  ensureAdmin,
  canAdmin,
  goPage,
  goLogin,
  ADMIN_ROLE_LABELS,
  ADMIN_PERMISSIONS,
};
