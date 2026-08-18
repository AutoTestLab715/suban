const { callCloud, saveUser, saveLoginRedirect, finishLoginNavigation } = require("./admin");
const { refreshUserPreload } = require("./preload");

function goProfileSetup() {
  wx.redirectTo({
    url: "/pages/register/index?setup=1",
    fail: () => {
      wx.navigateTo({ url: "/pages/register/index?setup=1" });
    },
  });
}

function loginByPhoneCode(code, options = {}) {
  const { redirectUrl = "", onSuccess } = options;
  if (!code) {
    return Promise.reject(new Error("missing_code"));
  }
  if (redirectUrl) saveLoginRedirect(redirectUrl);

  return callCloud("phoneLogin", { code }).then((res) => {
    if (!res.result?.success) {
      const err = new Error(res.result?.errMsg || "登录失败");
      err.result = res.result;
      throw err;
    }
    saveUser(res.result.user);
    refreshUserPreload(res.result.user);

    // 新用户先完善头像/昵称（可使用微信昵称）
    if (res.result.isNew) {
      if (typeof onSuccess === "function") {
        onSuccess(res.result.user, res.result);
      }
      goProfileSetup();
      return res.result.user;
    }

    if (typeof onSuccess === "function") {
      onSuccess(res.result.user, res.result);
    } else {
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => finishLoginNavigation(res.result.user), 400);
    }
    return res.result.user;
  });
}

function handleGetPhoneNumber(e, options = {}) {
  const { code, errMsg } = e.detail || {};
  if (!code) {
    if (errMsg && (errMsg.includes("deny") || errMsg.includes("cancel"))) {
      return Promise.resolve(null);
    }
    wx.showToast({ title: "需要授权手机号才能登录", icon: "none" });
    return Promise.resolve(null);
  }
  return loginByPhoneCode(code, options).catch((err) => {
    wx.showToast({ title: err.message || "登录失败", icon: "none" });
    return null;
  });
}

module.exports = {
  loginByPhoneCode,
  handleGetPhoneNumber,
};
