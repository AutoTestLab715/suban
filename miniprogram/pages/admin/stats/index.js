const { callCloud, ensureAdmin } = require("../../../utils/admin");

Page({
  data: {
    loading: true,
    stats: { total: 0, pending: 0, processed: 0, todayCount: 0, weekCount: 0, refundPending: 0 },
    dailyTrend: [],
    typeBreakdown: [],
    fieldStats: [],
    anomalies: [],
    dailyDigest: "",
    sendingDigest: false,
    pieStyle: "",
  },

  onShow() {
    ensureAdmin("read").then((result) => {
      if (result) this.loadAnalytics();
    });
  },

  onPullDownRefresh() {
    this.loadAnalytics().finally(() => wx.stopPullDownRefresh());
  },

  loadAnalytics() {
    this.setData({ loading: true });
    return callCloud("getFormAnalytics")
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }
        this.setData({
          stats: res.result.stats || {},
          dailyTrend: res.result.dailyTrend || [],
          typeBreakdown: res.result.typeBreakdown || [],
          fieldStats: res.result.fieldStats || [],
          anomalies: res.result.anomalies || [],
          dailyDigest: res.result.dailyDigest || "",
          pieStyle: this.buildPieStyle(res.result.typeBreakdown || []),
          loading: false,
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  buildPieStyle(typeBreakdown) {
    const colors = ["#0d4a9c", "#2563eb", "#059669", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#64748b"];
    const total = typeBreakdown.reduce((sum, item) => sum + (item.count || 0), 0);
    if (!total) return "conic-gradient(#e2e8f0 0deg 360deg)";

    let current = 0;
    const parts = typeBreakdown.slice(0, 8).map((item, index) => {
      const deg = ((item.count || 0) / total) * 360;
      const start = current;
      current += deg;
      return `${colors[index % colors.length]} ${start}deg ${current}deg`;
    });
    return `conic-gradient(${parts.join(", ")})`;
  },

  copyDigest() {
    const text = this.data.dailyDigest;
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "摘要已复制", icon: "success" }),
    });
  },

  sendDigest() {
    wx.showModal({
      title: "推送日报",
      content: "将向已订阅消息的管理员发送今日运营摘要，确定继续？",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ sendingDigest: true });
        callCloud("sendDailyDigest")
          .then((result) => {
            if (result.result?.success) {
              wx.showToast({ title: `已推送 ${result.result.sent} 人`, icon: "success" });
            } else {
              wx.showToast({ title: result.result?.errMsg || "推送失败", icon: "none" });
            }
          })
          .catch(() => wx.showToast({ title: "推送失败", icon: "none" }))
          .finally(() => this.setData({ sendingDigest: false }));
      },
    });
  },
});
