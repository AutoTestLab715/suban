const { callCloud, ensureAdmin } = require("../../../utils/admin");

const formatTime = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

Page({
  data: {
    loading: true,
    list: [],
    creating: false,
  },

  onShow() {
    ensureAdmin("config").then((result) => {
      if (result) this.loadList();
    });
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  loadList() {
    this.setData({ loading: true });
    return callCloud("listFormTemplates")
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }
        const list = (res.result.list || []).map((item) => ({
          ...item,
          updateTimeStr: formatTime(item.updateTime),
        }));
        this.setData({ list, loading: false });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  onCreate() {
    wx.showModal({
      title: "新建表单",
      editable: true,
      placeholderText: "请输入表单名称",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ creating: true });
        callCloud("createFormTemplate", { title: (res.content || "新表单").trim() })
          .then((result) => {
            if (result.result?.success) {
              wx.showToast({ title: "创建成功", icon: "success" });
              this.loadList();
            } else {
              wx.showToast({ title: result.result?.errMsg || "创建失败", icon: "none" });
            }
          })
          .finally(() => this.setData({ creating: false }));
      },
    });
  },

  onCopy(e) {
    const { id, title } = e.currentTarget.dataset;
    this.setData({ creating: true });
    callCloud("createFormTemplate", { title: `${title} 副本`, copyFromId: id })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "已复制", icon: "success" });
          this.loadList();
        } else {
          wx.showToast({ title: res.result?.errMsg || "复制失败", icon: "none" });
        }
      })
      .finally(() => this.setData({ creating: false }));
  },

  onSetDefault(e) {
    const { id } = e.currentTarget.dataset;
    callCloud("setDefaultFormTemplate", { templateId: id }).then((res) => {
      if (res.result?.success) {
        wx.showToast({ title: "已设为默认", icon: "success" });
        this.loadList();
      } else {
        wx.showToast({ title: res.result?.errMsg || "设置失败", icon: "none" });
      }
    });
  },

  goEdit(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/admin/template/index?templateId=${id}` });
  },

  goFields(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/admin/fields/index?templateId=${id}` });
  },

  previewForm(e) {
    const { id } = e.currentTarget.dataset;
    getApp().globalData.fillTemplateId = id;
    wx.switchTab({ url: "/pages/fill/index" });
  },
});
