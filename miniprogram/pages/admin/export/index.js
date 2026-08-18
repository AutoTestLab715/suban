const { callCloud, ensureAdmin } = require("../../../utils/admin");

Page({
  data: {
    loading: true,
    exporting: false,
    exportingAttachments: false,
    fields: [],
    selectedMap: {},
    format: "xlsx",
    filter: "all",
    keyword: "",
    templateId: "",
    dateFrom: "",
    dateTo: "",
  },

  onLoad(options) {
    this.setData({
      filter: options.filter || "all",
      keyword: options.keyword ? decodeURIComponent(options.keyword) : "",
      templateId: options.templateId || "",
      dateFrom: options.dateFrom || "",
      dateTo: options.dateTo || "",
    });
  },

  onShow() {
    ensureAdmin("export").then((result) => {
      if (result) this.loadFields();
    });
  },

  loadFields() {
    this.setData({ loading: true });
    callCloud("getFormTemplate", { forAdmin: true })
      .then((res) => {
        const fields = res.result?.template?.fields || [];
        const selectedMap = {};
        fields.forEach((f) => {
          selectedMap[f.id] = true;
        });
        this.setData({ fields, selectedMap, loading: false });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  onToggleField(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({ [`selectedMap.${id}`]: !this.data.selectedMap[id] });
  },

  onSelectAll() {
    const selectedMap = {};
    this.data.fields.forEach((f) => {
      selectedMap[f.id] = true;
    });
    this.setData({ selectedMap });
  },

  onClearAll() {
    const selectedMap = {};
    this.data.fields.forEach((f) => {
      selectedMap[f.id] = false;
    });
    this.setData({ selectedMap });
  },

  onFormatChange(e) {
    this.setData({ format: e.detail.value });
  },

  onExport() {
    const fieldIds = this.data.fields.filter((f) => this.data.selectedMap[f.id]).map((f) => f.id);
    if (!fieldIds.length) {
      wx.showToast({ title: "请至少选择一个字段", icon: "none" });
      return;
    }

    this.setData({ exporting: true });
    callCloud("exportForms", {
      status: this.data.filter,
      keyword: this.data.keyword,
      templateId: this.data.templateId,
      dateFrom: this.data.dateFrom,
      dateTo: this.data.dateTo,
      format: this.data.format,
      fieldIds,
    })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "导出失败", icon: "none" });
          return;
        }
        wx.showLoading({ title: "下载中..." });
        const fileType = res.result.format || this.data.format;
        return wx.cloud
          .downloadFile({ fileID: res.result.fileID })
          .then((dl) => {
            wx.hideLoading();
            return wx.openDocument({ filePath: dl.tempFilePath, fileType, showMenu: true });
          })
          .then(() => {
            wx.showToast({ title: `已导出 ${res.result.count} 条`, icon: "success" });
          });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: "导出失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ exporting: false });
      });
  },

  onExportAttachments() {
    wx.showActionSheet({
      itemList: ["导出链接清单 JSON", "打包 ZIP（最多80个）"],
      success: (res) => {
        const format = res.tapIndex === 1 ? "zip" : "json";
        this.runAttachmentExport(format);
      },
    });
  },

  runAttachmentExport(format) {
    this.setData({ exportingAttachments: true });
    callCloud("exportAttachments", {
      status: this.data.filter,
      keyword: this.data.keyword,
      dateFrom: this.data.dateFrom,
      dateTo: this.data.dateTo,
      format,
    })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "导出失败", icon: "none" });
          return;
        }
        wx.showLoading({ title: "下载中..." });
        const fileType = res.result.format === "zip" ? "zip" : "json";
        return wx.cloud
          .downloadFile({ fileID: res.result.fileID })
          .then((dl) => {
            wx.hideLoading();
            if (format === "zip") {
              wx.showToast({ title: `已打包 ${res.result.count} 个文件`, icon: "success" });
              return wx.openDocument({ filePath: dl.tempFilePath, fileType: "zip", showMenu: true }).catch(() => {
                wx.showModal({
                  title: "ZIP 已生成",
                  content: "请在文件管理中查看，或通过云存储控制台下载",
                  showCancel: false,
                });
              });
            }
            return wx.openDocument({ filePath: dl.tempFilePath, fileType: "json", showMenu: true });
          })
          .then(() => {
            if (format !== "zip") {
              wx.showToast({ title: `已导出 ${res.result.count} 个附件链接`, icon: "success" });
            }
            if (res.result.truncated) {
              wx.showToast({ title: "附件过多，已截断为80个", icon: "none" });
            }
          });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: "导出失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ exportingAttachments: false });
      });
  },
});
