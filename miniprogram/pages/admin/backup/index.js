const { callCloud, ensureAdmin } = require("../../../utils/admin");

const formatTime = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

Page({
  data: {
    loading: true,
    backing: false,
    list: [],
  },

  onShow() {
    ensureAdmin("export").then((result) => {
      if (result) this.loadList();
    });
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  loadList() {
    this.setData({ loading: true });
    return callCloud("listBackups")
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }
        const list = (res.result.list || []).map((item) => ({
          ...item,
          createTimeStr: formatTime(item.createTime),
          sourceLabel: item.source === "scheduled" ? "自动" : "手动",
          hasExcel: !!item.excelFileID,
        }));
        this.setData({ list });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  onBackupNow() {
    if (this.data.backing) return;
    this.setData({ backing: true });
    callCloud("backupFormData")
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({
            title: `已备份 ${res.result.count || 0} 条`,
            icon: "success",
          });
          this.loadList();
        } else {
          wx.showToast({ title: res.result?.errMsg || "备份失败", icon: "none" });
        }
      })
      .catch(() => {
        wx.showToast({ title: "备份失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ backing: false });
      });
  },

  onDownloadExcel(e) {
    const { fileid } = e.currentTarget.dataset;
    if (!fileid) {
      wx.showToast({ title: "暂无 Excel 文件", icon: "none" });
      return;
    }
    this.downloadAndOpen(fileid, "xlsx", "Excel");
  },

  onDownloadJson(e) {
    const { fileid } = e.currentTarget.dataset;
    if (!fileid) return;
    this.downloadAndOpen(fileid, "json", "JSON");
  },

  onCopyLink(e) {
    const { fileid } = e.currentTarget.dataset;
    if (!fileid) return;
    wx.showLoading({ title: "获取链接..." });
    wx.cloud
      .getTempFileURL({ fileList: [fileid] })
      .then((res) => {
        const url = res.fileList?.[0]?.tempFileURL;
        if (!url) {
          wx.showToast({ title: "链接获取失败", icon: "none" });
          return;
        }
        wx.setClipboardData({
          data: url,
          success: () => wx.showToast({ title: "下载链接已复制", icon: "success" }),
        });
      })
      .catch(() => {
        wx.showToast({ title: "获取失败", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  },

  downloadAndOpen(fileID, fileType, label) {
    wx.showLoading({ title: "下载中..." });
    wx.cloud
      .downloadFile({ fileID })
      .then((res) =>
        wx.openDocument({
          filePath: res.tempFilePath,
          fileType,
          showMenu: true,
        })
      )
      .then(() => {
        wx.showToast({ title: `${label} 已打开`, icon: "success" });
      })
      .catch(() => {
        wx.showToast({ title: "下载或打开失败", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  },
});
