const { callCloud, ensureAdmin } = require("../../../utils/admin");

Page({
  data: {
    loading: true,
    saving: false,
    testingId: "",
    list: [],
    platformTemplates: [],
    editorPlatforms: [],
    showEditor: false,
    editingId: "",
    formName: "",
    formPlatformIndex: 0,
    formEnabled: true,
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
    return callCloud("listNotifyTemplates")
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          this.setData({ loading: false });
          return;
        }
        this.setData({
          list: res.result.list || [],
          platformTemplates: res.result.platformTemplates || [],
          loading: false,
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  onAdd() {
    const { platformTemplates, list } = this.data;
    if (!platformTemplates.length) {
      wx.showToast({ title: "请先在微信公众平台添加订阅消息模板", icon: "none" });
      return;
    }
    const usedIds = new Set((list || []).map((item) => item.platformTemplateId));
    const available = platformTemplates.filter((item) => !usedIds.has(item.priTmplId));
    if (!available.length) {
      wx.showToast({ title: "公众平台模板已全部添加", icon: "none" });
      return;
    }
    this.setData({
      showEditor: true,
      editingId: "",
      editorPlatforms: available,
      formName: available[0].title || "通知模板",
      formPlatformIndex: 0,
      formEnabled: true,
    });
  },

  onEdit(e) {
    const { id } = e.currentTarget.dataset;
    const item = (this.data.list || []).find((row) => row._id === id);
    if (!item) return;
    const formPlatformIndex = Math.max(
      0,
      (this.data.platformTemplates || []).findIndex((row) => row.priTmplId === item.platformTemplateId)
    );
    this.setData({
      showEditor: true,
      editingId: id,
      editorPlatforms: this.data.platformTemplates,
      formName: item.name,
      formPlatformIndex,
      formEnabled: item.enabled !== false,
    });
  },

  onCloseEditor() {
    this.setData({ showEditor: false });
  },

  onFormNameInput(e) {
    this.setData({ formName: e.detail.value });
  },

  onPlatformChange(e) {
    this.setData({ formPlatformIndex: Number(e.detail.value) || 0 });
  },

  onFormEnabledChange(e) {
    this.setData({ formEnabled: !!e.detail.value });
  },

  onSaveEditor() {
    const { editingId, formName, formPlatformIndex, editorPlatforms, formEnabled, saving } = this.data;
    if (saving) return;
    const platform = editorPlatforms[formPlatformIndex];
    if (!platform) {
      wx.showToast({ title: "请选择公众平台模板", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    callCloud("saveNotifyTemplate", {
      id: editingId || undefined,
      name: (formName || platform.title || "通知模板").trim(),
      platformTemplateId: platform.priTmplId,
      enabled: formEnabled,
    })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "保存成功", icon: "success" });
          this.setData({ showEditor: false });
          this.loadList();
        } else {
          wx.showToast({ title: res.result?.errMsg || "保存失败", icon: "none" });
        }
      })
      .finally(() => this.setData({ saving: false }));
  },

  onDelete(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: "删除模板",
      content: `确定删除「${name || "通知模板"}」吗？`,
      success: (res) => {
        if (!res.confirm) return;
        callCloud("deleteNotifyTemplate", { id }).then((result) => {
          if (result.result?.success) {
            wx.showToast({ title: "已删除", icon: "success" });
            this.loadList();
          } else {
            wx.showToast({ title: result.result?.errMsg || "删除失败", icon: "none" });
          }
        });
      },
    });
  },

  onSubscribe(e) {
    const { id } = e.currentTarget.dataset;
    const tmplId = id;
    if (!tmplId) {
      wx.showToast({ title: "模板无效", icon: "none" });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        if (res[tmplId] !== "accept") {
          wx.showToast({ title: "未授权将无法收到通知", icon: "none" });
          return;
        }
        callCloud("saveNotifySubscription", { templateId: tmplId }).then((result) => {
          if (result.result?.success) {
            wx.showToast({ title: "授权成功", icon: "success" });
            this.loadList();
          }
        });
      },
      fail: () => wx.showToast({ title: "授权失败", icon: "none" }),
    });
  },

  onTest(e) {
    const { id } = e.currentTarget.dataset;
    const item = (this.data.list || []).find((row) => row._id === id);
    if (!item) return;
    if (!item.subscribed) {
      wx.showToast({ title: "请先授权该模板", icon: "none" });
      return;
    }
    this.setData({ testingId: id });
    callCloud("sendTestAdminNotify", { notifyConfigId: id })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "测试通知已发送", icon: "success" });
        } else {
          wx.showModal({
            title: "发送失败",
            content: res.result?.errMsg || "请检查模板配置",
            showCancel: false,
          });
        }
      })
      .finally(() => this.setData({ testingId: "" }));
  },

  goFormNotify() {
    wx.navigateTo({ url: "/pages/admin/notify/index" });
  },
});
