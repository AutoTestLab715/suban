const PRIVACY_POLICY_NAME = "用户协议与隐私政策";

function getPrivacySetting() {
  return new Promise((resolve) => {
    if (typeof wx.getPrivacySetting !== "function") {
      resolve({ needAuthorization: false, privacyContractName: PRIVACY_POLICY_NAME });
      return;
    }
    wx.getPrivacySetting({
      success: (res) => {
        resolve({
          needAuthorization: !!res.needAuthorization,
          privacyContractName: PRIVACY_POLICY_NAME,
        });
      },
      fail: () => resolve({ needAuthorization: false, privacyContractName: PRIVACY_POLICY_NAME }),
    });
  });
}

function openPrivacyPage() {
  wx.navigateTo({
    url: "/pages/privacy/index",
    fail: () => wx.showToast({ title: "暂无法打开隐私政策", icon: "none" }),
  });
}

function openPrivacyContract() {
  openPrivacyPage();
}

function isPrivacyAuthorized(detail) {
  return (detail || {}).errMsg === "agreePrivacyAuthorization:ok";
}

module.exports = {
  getPrivacySetting,
  openPrivacyContract,
  openPrivacyPage,
  isPrivacyAuthorized,
};
