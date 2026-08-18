const { requestPayment, goPage } = require("../../utils/admin");

Page({
  data: {
    title: "提交成功",
    desc: "",
    needPayment: false,
    submissionId: "",
    paymentAmount: 0,
    checkCode: "",
    formNo: "",
    paying: false,
    paid: false,
    redirectType: "none",
    redirectAppId: "",
    redirectPath: "",
    redirectUrl: "",
  },

  onLoad(options) {
    this.setData({
      title: options.title ? decodeURIComponent(options.title) : "提交成功",
      desc: options.desc ? decodeURIComponent(options.desc) : "",
      needPayment: options.needPayment === "1",
      submissionId: options.submissionId || "",
      paymentAmount: Number(options.amount || 0),
      checkCode: options.checkCode ? decodeURIComponent(options.checkCode) : "",
      formNo: options.formNo ? decodeURIComponent(options.formNo) : "",
      redirectType: options.redirectType || "none",
      redirectAppId: options.redirectAppId ? decodeURIComponent(options.redirectAppId) : "",
      redirectPath: options.redirectPath ? decodeURIComponent(options.redirectPath) : "",
      redirectUrl: options.redirectUrl ? decodeURIComponent(options.redirectUrl) : "",
    });
  },

  onPay() {
    const { submissionId, paying } = this.data;
    if (!submissionId || paying) return;

    this.setData({ paying: true });
    requestPayment(submissionId)
      .then(() => {
        this.setData({
          paid: true,
          needPayment: false,
          title: "支付成功",
          desc: "您的报名已生效，我们会尽快处理",
        });
        wx.showToast({ title: "支付成功", icon: "success" });
      })
      .catch((e) => {
        const msg = e?.errMsg || e?.message || "支付失败";
        if (!msg.includes("cancel")) {
          wx.showToast({ title: msg.replace("requestPayment:fail ", ""), icon: "none" });
        }
      })
      .finally(() => {
        this.setData({ paying: false });
      });
  },

  onRedirect() {
    const { redirectType, redirectAppId, redirectPath, redirectUrl } = this.data;
    if (redirectType === "miniprogram" && redirectAppId) {
      wx.navigateToMiniProgram({
        appId: redirectAppId,
        path: redirectPath || "pages/index/index",
      });
      return;
    }
    if (redirectType === "web" && redirectUrl) {
      wx.setClipboardData({
        data: redirectUrl,
        success: () => wx.showToast({ title: "链接已复制", icon: "success" }),
      });
    }
  },

  goList() {
    goPage("/pages/list/index");
  },

  goForm() {
    goPage("/pages/fill/index");
  },

  goVoucher() {
    const { submissionId } = this.data;
    if (!submissionId) return;
    wx.navigateTo({ url: `/pages/voucher/index?submissionId=${submissionId}` });
  },

  copyFormNo() {
    const { formNo } = this.data;
    if (!formNo) return;
    wx.setClipboardData({
      data: formNo,
      success: () => wx.showToast({ title: "编号已复制", icon: "success" }),
    });
  },
});
