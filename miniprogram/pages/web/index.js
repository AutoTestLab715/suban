Page({
  data: {
    url: "",
    title: "详情",
  },

  onLoad(options) {
    const url = options.url ? decodeURIComponent(options.url) : "";
    const title = options.title ? decodeURIComponent(options.title) : "原文";
    if (!url) {
      wx.showToast({ title: "链接无效", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.setData({ url, title });
    wx.setNavigationBarTitle({ title: title.slice(0, 12) || "原文" });
  },

  onWebError() {
    const url = this.data.url;
    wx.showModal({
      title: "无法打开原文",
      content: "该网站域名可能未加入小程序业务域名。可复制链接后在微信中打开。",
      confirmText: "复制链接",
      success: (res) => {
        if (!res.confirm || !url) return;
        wx.setClipboardData({
          data: url,
          success: () => wx.showToast({ title: "链接已复制", icon: "success" }),
        });
      },
    });
  },
});
