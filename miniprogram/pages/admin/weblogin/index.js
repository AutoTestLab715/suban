const { callCloud, ensureAdmin, getLocalUser } = require("../../../utils/admin");

Page({
  data: {
    sessionId: "",
    shortCode: "",
    inputCode: "",
    userName: "",
    loading: true,
    confirming: false,
    done: false,
    errorMsg: "",
    pendingList: [],
  },

  onLoad(options) {
    const sessionId = (options.session || options.scene || "").trim();
    const shortCode = (options.code || "").trim();
    this.setData({ sessionId, shortCode });
    this.verifyAdmin(sessionId);
  },

  verifyAdmin(sessionId) {
    ensureAdmin("read")
      .then((result) => {
        if (!result) {
          this.setData({ loading: false, errorMsg: "您不是管理员，无法登录网页后台" });
          return;
        }
        const user = result.user || getLocalUser();
        this.setData({ userName: user?.nickName || "管理员" });
        if (sessionId) {
          this.setData({ loading: false });
          return;
        }
        this.loadPending();
      })
      .catch(() => {
        this.setData({ loading: false, errorMsg: "身份验证失败" });
      });
  },

  loadPending() {
    callCloud("listPendingWebLoginSessions")
      .then((res) => {
        const list = res.result?.list || [];
        this.setData({
          loading: false,
          pendingList: list,
          errorMsg: list.length ? "" : "暂无待确认的网页登录，可在下方输入验证码",
        });
      })
      .catch(() => {
        this.setData({ loading: false, errorMsg: "加载失败" });
      });
  },

  onCodeInput(e) {
    this.setData({ inputCode: (e.detail.value || "").trim() });
  },

  doConfirm(payload) {
    if (this.data.confirming) return;
    this.setData({ confirming: true });
    callCloud("confirmWebLoginSession", payload)
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "确认失败", icon: "none" });
          this.setData({ confirming: false, errorMsg: res.result?.errMsg || "确认失败" });
          return;
        }
        this.setData({ confirming: false, done: true, pendingList: [] });
        wx.showToast({ title: "登录成功", icon: "success" });
      })
      .catch(() => {
        wx.showToast({ title: "确认失败", icon: "none" });
        this.setData({ confirming: false });
      });
  },

  onConfirm() {
    if (!this.data.sessionId) return;
    this.doConfirm({ sessionId: this.data.sessionId });
  },

  onConfirmItem(e) {
    const sessionId = e.currentTarget.dataset.id;
    if (!sessionId) return;
    this.doConfirm({ sessionId });
  },

  onConfirmByCode() {
    const shortCode = this.data.inputCode || this.data.shortCode;
    if (!shortCode || shortCode.length < 6) {
      wx.showToast({ title: "请输入6位验证码", icon: "none" });
      return;
    }
    this.doConfirm({ shortCode });
  },

  onCancel() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: "/pages/admin/index/index" }),
    });
  },
});
