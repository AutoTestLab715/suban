const { callCloud, ensureAdmin } = require("../../../utils/admin");

const TEXTS = {
  title: "\u6d88\u606f\u901a\u77e5",
  loading: "\u52a0\u8f7d\u4e2d...",
  ready: "\u901a\u77e5\u5df2\u5c31\u7eea",
  pending: "\u901a\u77e5\u672a\u5c31\u7eea",
  readyDesc: "\u7528\u6237\u63d0\u4ea4\u8868\u5355\u540e\u5c06\u81ea\u52a8\u901a\u77e5\u7ba1\u7406\u5458\u90ae\u7bb1",
  pendingDesc: "\u8bf7\u5148\u914d\u7f6e\u53d1\u4ef6\u90ae\u7bb1\u548c\u7ba1\u7406\u5458\u6536\u4ef6\u90ae\u7bb1",
  emailReady: "\u90ae\u4ef6\u901a\u77e5\uff1a\u5df2\u5f00\u542f",
  emailPending: "\u90ae\u4ef6\u901a\u77e5\uff1a\u672a\u5f00\u542f\u6216\u672a\u914d\u7f6e",
  wechatTpl: "\u5fae\u4fe1\u8ba2\u9605\u6a21\u677f",
  noWechatTpl: "\u672a\u914d\u7f6e\u5fae\u4fe1\u8ba2\u9605\u6a21\u677f",
  subscribedAdmins: "\u5df2\u6388\u6743\u7ba1\u7406\u5458",
  emailSection: "\u90ae\u7bb1\u6388\u6743\u914d\u7f6e",
  emailTip: "\u8bf7\u586b\u5199\u53d1\u4ef6\u90ae\u7bb1\u7684 SMTP \u4fe1\u606f\u548c\u7ba1\u7406\u5458\u6536\u4ef6\u90ae\u7bb1\u3002\u63d0\u4ea4\u8868\u5355\u540e\u4e91\u51fd\u6570\u4f1a\u81ea\u52a8\u53d1\u9001\u90ae\u4ef6\u3002",
  enableEmail: "\u5f00\u542f\u90ae\u4ef6\u901a\u77e5",
  smtpHost: "SMTP \u670d\u52a1\u5668",
  smtpPort: "SMTP \u7aef\u53e3",
  ssl: "\u4f7f\u7528 SSL/TLS",
  smtpUser: "\u53d1\u4ef6\u90ae\u7bb1\u8d26\u53f7",
  smtpPass: "\u90ae\u7bb1\u6388\u6743\u7801 / SMTP \u5bc6\u7801",
  fromEmail: "\u53d1\u4ef6\u4eba\u90ae\u7bb1",
  fromName: "\u53d1\u4ef6\u4eba\u540d\u79f0",
  adminEmails: "\u7ba1\u7406\u5458\u6536\u4ef6\u90ae\u7bb1",
  adminEmailsTip: "\u591a\u4e2a\u90ae\u7bb1\u8bf7\u6362\u884c\u3001\u9017\u53f7\u6216\u5206\u53f7\u5206\u9694",
  saveEmail: "\u6388\u6743\u5e76\u4fdd\u5b58\u90ae\u7bb1\u8d26\u53f7",
  testEmail: "\u53d1\u9001\u6d4b\u8bd5\u90ae\u4ef6",
  wechatSection: "\u5fae\u4fe1\u8ba2\u9605\u901a\u77e5\uff08\u53ef\u9009\uff09",
  wechatTip: "\u5fae\u4fe1\u8ba2\u9605\u6d88\u606f\u4ecd\u4fdd\u7559\uff0c\u4f46\u5b83\u53d7\u4e00\u6b21\u6388\u6743\u4e00\u6b21\u53d1\u9001\u7684\u9650\u5236\u3002\u5efa\u8bae\u4ee5\u90ae\u4ef6\u901a\u77e5\u4e3a\u4e3b\u3002",
  manageWechat: "\u524d\u5f80\u8ba2\u9605\u901a\u77e5\u7ba1\u7406 \u2192",
  subscribeAgain: "\u91cd\u65b0\u6388\u6743\u63a5\u6536\u63d0\u9192",
  subscribe: "\u6388\u6743\u63a5\u6536\u63d0\u9192",
  testWechat: "\u53d1\u9001\u5fae\u4fe1\u6d4b\u8bd5\u901a\u77e5",
  savedPass: "\u5df2\u4fdd\u5b58\u6388\u6743\u7801\uff0c\u7559\u7a7a\u5219\u4e0d\u4fee\u6539",
};

Page({
  data: {
    t: TEXTS,
    loading: true,
    savingEmail: false,
    testingEmail: false,
    testing: false,
    platformTemplateId: "",
    platformTemplateTitle: "",
    subscribed: false,
    subscribedAdminCount: 0,
    emailReady: false,
    ready: false,
    email: {
      enabled: true,
      smtpHost: "",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "",
      smtpPass: "",
      hasPassword: false,
      passwordMask: "",
      fromEmail: "",
      fromName: "\u8868\u5355\u901a\u77e5",
      adminEmails: "",
    },
  },

  onShow() {
    ensureAdmin("config").then((result) => {
      if (result) this.loadStatus();
    });
  },

  onPullDownRefresh() {
    this.loadStatus().finally(() => wx.stopPullDownRefresh());
  },

  loadStatus() {
    this.setData({ loading: true });
    return callCloud("getAdminNotifyStatus")
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "\u52a0\u8f7d\u5931\u8d25", icon: "none" });
          this.setData({ loading: false });
          return;
        }
        const r = res.result;
        const emailConfig = r.emailConfig || {};
        const emailReady = !!r.emailReady;
        const wechatReady = !!r.platformTemplateId && !!r.subscribed;
        this.setData({
          platformTemplateId: r.platformTemplateId || "",
          platformTemplateTitle: r.platformTemplateTitle || "",
          subscribed: !!r.subscribed,
          subscribedAdminCount: r.subscribedAdminCount || 0,
          emailReady,
          ready: emailReady || wechatReady,
          email: {
            ...this.data.email,
            ...emailConfig,
            smtpPass: "",
            smtpPort: emailConfig.smtpPort || 465,
            smtpSecure: emailConfig.smtpSecure !== false,
            enabled: emailConfig.enabled !== false,
          },
          loading: false,
        });
      })
      .catch(() => {
        wx.showToast({ title: "\u52a0\u8f7d\u5931\u8d25", icon: "none" });
        this.setData({ loading: false });
      });
  },

  onEmailInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ [`email.${key}`]: e.detail.value });
  },

  onEmailSwitch(e) {
    this.setData({ "email.enabled": !!e.detail.value });
  },

  onSecureSwitch(e) {
    const secure = !!e.detail.value;
    const next = { "email.smtpSecure": secure };
    if (!this.data.email.smtpPort || Number(this.data.email.smtpPort) === (secure ? 587 : 465)) {
      next["email.smtpPort"] = secure ? 465 : 587;
    }
    this.setData(next);
  },

  onSaveEmail() {
    const email = this.data.email;
    this.setData({ savingEmail: true });
    callCloud("saveAdminEmailConfig", email)
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "\u4fdd\u5b58\u6210\u529f", icon: "success" });
          this.loadStatus();
        } else {
          wx.showModal({
            title: "\u4fdd\u5b58\u5931\u8d25",
            content: res.result?.errMsg || "\u8bf7\u68c0\u67e5\u90ae\u7bb1\u914d\u7f6e",
            showCancel: false,
          });
        }
      })
      .catch(() => wx.showToast({ title: "\u4fdd\u5b58\u5931\u8d25", icon: "none" }))
      .finally(() => this.setData({ savingEmail: false }));
  },

  onTestEmail() {
    this.setData({ testingEmail: true });
    callCloud("sendTestAdminEmail")
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "\u6d4b\u8bd5\u90ae\u4ef6\u5df2\u53d1\u9001", icon: "success" });
        } else {
          wx.showModal({
            title: "\u53d1\u9001\u5931\u8d25",
            content: res.result?.errMsg || "\u8bf7\u68c0\u67e5 SMTP \u914d\u7f6e\u548c\u6388\u6743\u7801",
            showCancel: false,
          });
        }
      })
      .catch(() => wx.showToast({ title: "\u53d1\u9001\u5931\u8d25", icon: "none" }))
      .finally(() => this.setData({ testingEmail: false }));
  },

  goNotifyManage() {
    wx.navigateTo({ url: "/pages/admin/notifymanage/index" });
  },

  onSubscribe() {
    const tmplId = this.data.platformTemplateId;
    if (!tmplId) {
      wx.showToast({ title: "\u8bf7\u5148\u5728\u8ba2\u9605\u901a\u77e5\u7ba1\u7406\u4e2d\u6dfb\u52a0\u6a21\u677f", icon: "none" });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        if (res[tmplId] !== "accept") {
          wx.showToast({ title: "\u672a\u6388\u6743\u5c06\u65e0\u6cd5\u6536\u5230\u5fae\u4fe1\u901a\u77e5", icon: "none" });
          return;
        }
        callCloud("saveNotifySubscription", { templateId: tmplId }).then((result) => {
          if (result.result?.success) {
            wx.showToast({ title: "\u6388\u6743\u6210\u529f", icon: "success" });
            this.loadStatus();
          }
        });
      },
      fail: () => wx.showToast({ title: "\u6388\u6743\u5931\u8d25", icon: "none" }),
    });
  },

  onTestNotify() {
    this.setData({ testing: true });
    callCloud("sendTestAdminNotify")
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "\u5fae\u4fe1\u6d4b\u8bd5\u901a\u77e5\u5df2\u53d1\u9001", icon: "success" });
        } else {
          wx.showModal({
            title: "\u53d1\u9001\u5931\u8d25",
            content: res.result?.errMsg || "\u8bf7\u68c0\u67e5\u6a21\u677f\u914d\u7f6e",
            showCancel: false,
          });
        }
      })
      .finally(() => this.setData({ testing: false }));
  },
});
