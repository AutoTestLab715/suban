const {
  trySilentLogin,
  finishLoginNavigation,
  saveLoginRedirect,
  getLocalUser,
  hasLoggedOut,
} = require("../../utils/admin");
const { handleGetPhoneNumber } = require("../../utils/phoneAuth");
const { getPrivacySetting, openPrivacyContract } = require("../../utils/privacy");

Page({
  data: {
    redirectUrl: "/pages/fill/index",
    agreedPrivacy: false,
    loginLoading: false,
    privacyContractName: "用户协议与隐私政策",
  },

  onLoad(options) {
    const redirectUrl = options.redirect
      ? decodeURIComponent(options.redirect)
      : "/pages/fill/index";
    this.setData({ redirectUrl });
    saveLoginRedirect(redirectUrl);

    getPrivacySetting().then(({ privacyContractName }) => {
      this.setData({ privacyContractName });
    });
  },

  onShow() {
    if (this.data.loginLoading) return;
    if (hasLoggedOut()) return;
    trySilentLogin().then((loggedIn) => {
      if (loggedIn && !this.data.loginLoading) finishLoginNavigation(loggedIn);
    });
  },

  toggleAgree() {
    this.setData({ agreedPrivacy: !this.data.agreedPrivacy });
  },

  openPrivacy() {
    openPrivacyContract();
  },

  onGetPhoneNumber(e) {
    if (!this.data.agreedPrivacy) {
      wx.showToast({ title: "请先同意隐私政策", icon: "none" });
      return;
    }
    if (this.data.loginLoading) return;

    this.setData({ loginLoading: true });
    handleGetPhoneNumber(e, {
      redirectUrl: this.data.redirectUrl,
      onSuccess: (_user, result) => {
        // 新用户已跳转完善资料页，此处不再继续导航
        if (result?.isNew) return;
        finishLoginNavigation(getLocalUser());
      },
    }).finally(() => {
      this.setData({ loginLoading: false });
    });
  },
});
