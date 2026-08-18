// app.js
const { startPreload, refreshPreloadOnReconnect } = require("./utils/preload");

App({
  onLaunch: function (options) {
    this.globalData = {
      env: "cloud1-d6gwfgkmmfaec9cd2",
      userInfo: null,
      launchScene: options?.scene || 0,
      networkConnected: true,
      fillTemplateId: "",
      biaoxunPendingSource: "",
      biaoxunPendingCategory: "",
      biaoxunPendingKeyword: "",
      formsGuide: false,
      pageCache: {},
      preloadPromise: null,
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
      // 冷启动：页面代码 + 标讯/首页关键数据预加载
      startPreload();
    }

    wx.getNetworkType({
      success: (res) => {
        this.globalData.networkConnected = res.networkType !== "none";
      },
    });

    wx.onNetworkStatusChange((res) => {
      const wasOffline = !this.globalData.networkConnected;
      this.globalData.networkConnected = res.isConnected;
      if (res.isConnected && wasOffline) {
        this.globalData.networkReconnectedAt = Date.now();
        // 断网恢复后重新预热关键缓存
        refreshPreloadOnReconnect();
      }
    });
  },

  onShow() {
    // 预加载仅在冷启动或距上次完成超过 5 分钟时重跑，避免每次回前台都打库
    if (wx.cloud) startPreload();
  },
});
