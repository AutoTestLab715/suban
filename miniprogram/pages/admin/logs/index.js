const { callCloud, ensureAdmin, formatTime, AUDIT_ACTION_MAP } = require("../../../utils/admin");

const formatDetail = (detail = {}) => {
  const parts = [];
  if (detail.status) parts.push(`状态→${detail.status}`);
  if (detail.count) parts.push(`${detail.count}条`);
  if (detail.title) parts.push(detail.title);
  if (detail.fieldCount) parts.push(`${detail.fieldCount}个字段`);
  return parts.join(" · ");
};

Page({
  data: {
    list: [],
    loading: true,
    page: 1,
    hasMore: true,
  },

  onShow() {
    ensureAdmin("read").then((result) => {
      if (result) this.loadLogs(true);
    });
  },

  onPullDownRefresh() {
    this.loadLogs(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadLogs(false);
    }
  },

  loadLogs(reset) {
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true });

    return callCloud("getAuditLogs", { page, pageSize: 30 })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }

        const rows = (res.result.list || []).map((item) => ({
          ...item,
          actionLabel: AUDIT_ACTION_MAP[item.action] || item.action,
          detailText: formatDetail(item.detail),
          timeStr: formatTime(item.createTime),
        }));

        this.setData({
          list: reset ? rows : [...this.data.list, ...rows],
          page,
          hasMore: rows.length >= 30,
          loading: false,
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },
});
