const { callCloud, ensureAdmin } = require("../../../utils/admin");
const { validateForm, normalizeFormValues } = require("../../../utils/formEngine");

Page({
  data: {
    id: "",
    loading: true,
    saving: false,
    fields: [],
    values: {},
    templateTitle: "",
  },

  onLoad(options) {
    this.setData({ id: options.id });
    ensureAdmin("edit").then((result) => {
      if (result) this.loadDetail();
    });
  },

  loadDetail() {
    this.setData({ loading: true });
    callCloud("getFormDetail", { id: this.data.id })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }

        const item = res.result.data;
        const fields = res.result.templateFields || [];
        const answers = item.answers || {};

        this.setData({
          fields,
          values: normalizeFormValues(fields, answers),
          templateTitle: item.templateTitle || "编辑记录",
          loading: false,
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  onFieldChange(e) {
    const { id, value } = e.detail;
    this.setData({ [`values.${id}`]: value });
  },

  onSave() {
    const validation = validateForm(this.data.fields, this.data.values);
    if (!validation.ok) {
      wx.showToast({ title: validation.errMsg, icon: "none" });
      return;
    }

    this.setData({ saving: true });
    callCloud("updateFormSubmission", {
      id: this.data.id,
      answers: this.data.values,
    })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "已保存", icon: "success" });
          setTimeout(() => wx.navigateBack(), 500);
        } else {
          wx.showToast({ title: res.result?.errMsg || "保存失败", icon: "none" });
        }
      })
      .catch(() => {
        wx.showToast({ title: "保存失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  },
});
