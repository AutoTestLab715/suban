const { getLocalUser, DEFAULT_AVATAR, goPage } = require("../../utils/admin");

Component({
  properties: {
    title: { type: String, value: "" },
    bgColor: { type: String, value: "#0d4a9c" },
    dark: { type: Boolean, value: true },
    showBack: { type: Boolean, value: false },
    showAccount: { type: Boolean, value: true },
    backUrl: { type: String, value: "" },
    alwaysUseBackUrl: { type: Boolean, value: false },
  },

  data: {
    statusBarHeight: 20,
    contentHeight: 44,
    navBarHeight: 64,
    menuRight: 100,
    showBackBtn: false,
    showAccountBtn: true,
    avatarUrl: "",
    defaultAvatar: DEFAULT_AVATAR,
  },

  lifetimes: {
    attached() {
      this.initLayout();
      this.syncNavButtons();
    },
  },

  pageLifetimes: {
    show() {
      const user = getLocalUser();
      this.setData({ avatarUrl: user?.avatarUrl || "" });
    },
  },

  observers: {
    "showBack, showAccount"() {
      this.syncNavButtons();
    },
  },

  methods: {
    initLayout() {
      const sys = wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const statusBarHeight = sys.statusBarHeight || 20;
      const contentHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      const navBarHeight = contentHeight + statusBarHeight;
      const user = getLocalUser();

      this.setData({
        statusBarHeight,
        contentHeight,
        navBarHeight,
        menuRight: sys.windowWidth - menu.left + 8,
        avatarUrl: user?.avatarUrl || "",
      });
    },

    syncNavButtons() {
      const pages = getCurrentPages();
      const canGoBack = pages.length > 1;
      const showBackBtn =
        this.properties.showBack && (canGoBack || !!this.properties.backUrl);
      const showAccountBtn = !showBackBtn && this.properties.showAccount;

      this.setData({ showBackBtn, showAccountBtn });
    },

    onBack() {
      const { backUrl, alwaysUseBackUrl } = this.properties;
      const pages = getCurrentPages();
      // 栈上有上一页时优先 navigateBack，避免对已在栈底的 tab 再 switchTab
      // 触发 "routeDone with a webviewId is not found"
      if (alwaysUseBackUrl && backUrl && pages.length <= 1) {
        goPage(backUrl);
        return;
      }
      if (alwaysUseBackUrl && backUrl && pages.length > 1) {
        wx.navigateBack({
          delta: 1,
          fail: () => goPage(backUrl),
        });
        return;
      }
      wx.navigateBack({
        delta: 1,
        fail: () => {
          if (backUrl) goPage(backUrl);
        },
      });
    },

    onAccount() {
      goPage("/pages/profile/index");
    },
  },
});
