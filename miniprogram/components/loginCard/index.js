const { getPrivacySetting, openPrivacyContract } = require("../../utils/privacy");
const { handleGetPhoneNumber } = require("../../utils/phoneAuth");

Component({
  properties: {
    redirectUrl: { type: String, value: "" },
    brandName: { type: String, value: "速办智库" },
    embedded: { type: Boolean, value: false },
  },

  data: {
    loginLoading: false,
    agreedPrivacy: false,
    privacyContractName: "用户协议与隐私政策",
  },

  lifetimes: {
    attached() {
      getPrivacySetting().then(({ privacyContractName }) => {
        this.setData({ privacyContractName });
      });
    },
  },

  methods: {
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

      const { redirectUrl } = this.properties;
      this.setData({ loginLoading: true });
      handleGetPhoneNumber(e, {
        redirectUrl,
        onSuccess: (user, result) => {
          // 新用户会进入完善资料页，由那边完成后续导航
          if (result?.isNew) return;
          this.triggerEvent("success", { user });
        },
      })
        .catch(() => {})
        .finally(() => this.setData({ loginLoading: false }));
    },
  },
});
