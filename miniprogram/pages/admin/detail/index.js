const { callCloud, decorateForm, ensureAdmin } = require("../../../utils/admin");
const { buildAnswerRows } = require("../../../utils/formEngine");

Page({
  data: {
    id: "",
    detail: null,
    answerRows: [],
    remark: "",
    adminGrade: 0,
    updating: false,
    savingRemark: false,
    processingRefund: false,
  },

  onLoad(options) {
    this.setData({ id: options.id });
    this.verifyAndLoad();
  },

  onShow() {
    // 避免从相册/其他页面返回时覆盖未保存的备注
  },

  verifyAndLoad() {
    ensureAdmin("read").then((result) => {
      if (result) this.loadDetail();
    });
  },

  loadDetail() {
    callCloud("getFormDetail", { id: this.data.id })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }

        const item = res.result.data;
        const fields = res.result.templateFields || [];
        const answers = item.answers || {
          name: item.name,
          phone: item.phone,
          email: item.email,
          type: item.type,
          content: item.content,
        };

        this.setData({
          detail: decorateForm(item),
          answerRows: buildAnswerRows(fields, answers),
          remark: item.remark || "",
          adminGrade: item.adminGrade || 0,
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
      });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  onGradeTap(e) {
    const grade = Number(e.currentTarget.dataset.grade);
    this.setData({ adminGrade: grade });
    callCloud("updateFormStatus", {
      id: this.data.id,
      adminGrade: grade,
    }).then((res) => {
      if (res.result?.success) {
        wx.showToast({ title: "标注已保存", icon: "success" });
      }
    });
  },

  saveRemark() {
    this.setData({ savingRemark: true });
    callCloud("updateFormStatus", { id: this.data.id, remark: this.data.remark })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "备注已保存", icon: "success" });
        } else {
          wx.showToast({ title: res.result?.errMsg || "保存失败", icon: "none" });
        }
      })
      .catch(() => {
        wx.showToast({ title: "保存失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ savingRemark: false });
      });
  },

  callPhone() {
    const phone = this.data.detail?.phone || this.data.detail?.answers?.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone, fail: () => {} });
  },

  copyPhone() {
    const phone = this.data.detail?.phone || this.data.detail?.answers?.phone;
    if (!phone) return;
    wx.setClipboardData({
      data: phone,
      success: () => wx.showToast({ title: "已复制", icon: "success" }),
    });
  },

  previewImage(e) {
    const { fieldId, index } = e.currentTarget.dataset;
    const row = this.data.answerRows.find((r) => r.fieldId === fieldId);
    if (!row?.rawValue?.length) return;
    wx.previewImage({
      urls: row.rawValue,
      current: row.rawValue[Number(index) || 0],
    });
  },

  previewSignature(e) {
    const { src } = e.currentTarget.dataset;
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  },

  openFile(e) {
    const { fileId } = e.currentTarget.dataset;
    if (!fileId) return;
    wx.showLoading({ title: "打开中..." });
    wx.cloud
      .downloadFile({ fileID: fileId })
      .then((res) =>
        wx.openDocument({
          filePath: res.tempFilePath,
          showMenu: true,
        })
      )
      .catch(() => {
        wx.showToast({ title: "无法打开文件", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  goEdit() {
    wx.navigateTo({ url: `/pages/admin/edit/index?id=${this.data.id}` });
  },

  markRejected() {
    this.updateStatus("rejected");
  },

  markProcessed() {
    this.updateStatus("processed");
  },

  markPending() {
    this.updateStatus("pending");
  },

  updateStatus(status) {
    this.setData({ updating: true });
    callCloud("updateFormStatus", { id: this.data.id, status })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "已更新", icon: "success" });
          this.loadDetail();
        } else {
          wx.showToast({ title: res.result?.errMsg || "更新失败", icon: "none" });
        }
      })
      .catch(() => {
        wx.showToast({ title: "更新失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ updating: false });
      });
  },

  processRefund(action) {
    wx.showModal({
      title: action === "approve" ? "确认退款" : "拒绝退款",
      content:
        action === "approve"
          ? "将调用微信退款接口，款项原路退回。确定继续？"
          : "确定拒绝该退款申请？",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ processingRefund: true });
        callCloud("processRefund", { id: this.data.id, action })
          .then((result) => {
            if (result.result?.success) {
              wx.showToast({ title: action === "approve" ? "退款成功" : "已拒绝", icon: "success" });
              this.loadDetail();
            } else {
              wx.showToast({ title: result.result?.errMsg || "操作失败", icon: "none" });
            }
          })
          .catch(() => wx.showToast({ title: "操作失败", icon: "none" }))
          .finally(() => this.setData({ processingRefund: false }));
      },
    });
  },

  approveRefund() {
    this.processRefund("approve");
  },

  rejectRefund() {
    this.processRefund("reject");
  },

  onDelete() {
    wx.showModal({
      title: "确认删除",
      content: "删除后无法恢复，确定要删除这条记录吗？",
      confirmColor: "#ff4d4f",
      success: (res) => {
        if (!res.confirm) return;

        callCloud("deleteFormSubmission", { id: this.data.id })
          .then((result) => {
            if (result.result?.success) {
              wx.showToast({ title: "已删除", icon: "success" });
              setTimeout(() => wx.navigateBack(), 500);
            } else {
              wx.showToast({ title: result.result?.errMsg || "删除失败", icon: "none" });
            }
          })
          .catch(() => {
            wx.showToast({ title: "删除失败", icon: "none" });
          });
      },
    });
  },
});
