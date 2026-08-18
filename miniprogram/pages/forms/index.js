const { callCloud, trySilentLogin, goLogin, getLocalUser, hasLoggedOut } = require("../../utils/admin");
const {
  getPageCache,
  setPageCache,
  applyPublicForms,
  waitForPreload,
} = require("../../utils/preload");

Page({
  data: {
    loading: true,
    list: [],
    showGuide: false,
  },

  onLoad() {
    applyPublicForms(this, getPageCache("publicForms"));
  },

  onShow() {
    const app = getApp();
    const showGuide = !!app.globalData.formsGuide;
    if (showGuide) {
      app.globalData.formsGuide = false;
    }
    this.setData({ showGuide });

    waitForPreload().finally(() => {
      const cached = getPageCache("publicForms");
      const hasCache = applyPublicForms(this, cached);
      this.loadList(hasCache);
    });
  },

  onPullDownRefresh() {
    this.loadList(false).finally(() => wx.stopPullDownRefresh());
  },

  loadList(silent = false) {
    if (!silent) this.setData({ loading: true });
    return callCloud("listPublicForms")
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }
        this.setData({ list: res.result.list || [] });
        setPageCache("publicForms", { data: res.result.list || [] });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  goForm(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;

    const startFill = () => {
      getApp().globalData.fillTemplateId = id;
      wx.switchTab({ url: "/pages/fill/index" });
    };

    const user = getLocalUser();
    if (user && !hasLoggedOut()) {
      startFill();
      return;
    }

    trySilentLogin().then((loggedIn) => {
      if (loggedIn) {
        startFill();
        return;
      }
      wx.showModal({
        title: "登录提示",
        content: "请登录后再填写表单",
        cancelText: "暂不登录",
        confirmText: "立即登录",
        confirmColor: "#0c3d7a",
        success: (res) => {
          if (!res.confirm) return;
          getApp().globalData.fillTemplateId = id;
          goLogin(`/pages/fill/index?templateId=${id}`);
        },
      });
    });
  },
});
