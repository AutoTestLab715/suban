const { callCloud, ensureAdmin, decorateForm } = require("../../../utils/admin");

Page({
  data: {
    checkCode: "",
    verifying: false,
    result: null,
    lastSubmission: null,
  },

  onShow() {
    ensureAdmin("checkin");
  },

  onInput(e) {
    this.setData({ checkCode: e.detail.value.toUpperCase() });
  },

  onVerify() {
    const code = this.data.checkCode.trim();
    if (!code) {
      wx.showToast({ title: "请输入签到码", icon: "none" });
      return;
    }

    this.setData({ verifying: true, result: null });
    callCloud("verifyCheckin", { checkCode: code })
      .then((res) => {
        if (res.result?.success) {
          const item = decorateForm(res.result.submission);
          this.setData({
            result: { ok: true, msg: "签到成功" },
            lastSubmission: item,
            checkCode: "",
          });
          wx.showToast({ title: "签到成功", icon: "success" });
        } else if (res.result?.alreadyCheckedIn) {
          const item = decorateForm(res.result.submission);
          this.setData({
            result: { ok: false, msg: res.result.errMsg || "已签到" },
            lastSubmission: item,
          });
          wx.showToast({ title: res.result.errMsg || "已签到", icon: "none" });
        } else {
          this.setData({ result: { ok: false, msg: res.result?.errMsg || "签到失败" }, lastSubmission: null });
          wx.showToast({ title: res.result?.errMsg || "签到失败", icon: "none" });
        }
      })
      .catch(() => {
        wx.showToast({ title: "签到失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ verifying: false });
      });
  },
});
