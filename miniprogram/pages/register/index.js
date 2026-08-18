const {
  callCloud,
  saveUser,
  getLocalUser,
  finishLoginNavigation,
  hasLoggedOut,
  uploadAvatar,
  DEFAULT_AVATAR,
} = require("../../utils/admin");
const { refreshUserPreload } = require("../../utils/preload");

function isPlaceholderNick(nickName) {
  return /^用户\d{4}$/.test(String(nickName || "").trim());
}

Page({
  data: {
    nickName: "",
    avatarUrl: "",
    defaultAvatar: DEFAULT_AVATAR,
    loading: false,
    setupMode: false,
  },

  onLoad(options) {
    const setupMode = options.setup === "1";
    this.setData({ setupMode });

    if (hasLoggedOut()) return;

    const applyUser = (user) => {
      if (!user) return;
      const nick = user.nickName || "";
      this.setData({
        nickName: isPlaceholderNick(nick) ? "" : nick,
        avatarUrl: user.avatarUrl || "",
      });
    };

    if (setupMode) {
      applyUser(getLocalUser());
      callCloud("checkUser").then((res) => {
        if (res.result?.registered && res.result.user) {
          saveUser(res.result.user);
          applyUser(res.result.user);
        }
      });
      return;
    }

    callCloud("checkUser").then((res) => {
      if (res.result?.registered) {
        saveUser(res.result.user);
        refreshUserPreload(res.result.user);
        finishLoginNavigation(res.result.user);
      }
    });
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (avatarUrl) this.setData({ avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  onNicknameBlur(e) {
    const value = (e.detail.value || "").trim();
    if (value) this.setData({ nickName: value });
  },

  onRegister() {
    const { nickName, avatarUrl } = this.data;
    if (!nickName.trim()) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }

    this.setData({ loading: true });

    uploadAvatar(avatarUrl)
      .then((cloudAvatarUrl) =>
        callCloud("registerUser", {
          nickName: nickName.trim(),
          avatarUrl: cloudAvatarUrl,
        })
      )
      .then((res) => {
        if (res.result?.success && res.result.user) {
          saveUser(res.result.user);
          refreshUserPreload(res.result.user);
          wx.showToast({
            title: this.data.setupMode ? "资料已保存" : res.result.isNew ? "注册成功" : "登录成功",
            icon: "success",
          });
          setTimeout(() => finishLoginNavigation(res.result.user), 400);
        } else {
          const msg = res.result?.errMsg || "注册失败，请重试";
          wx.showModal({ title: "注册失败", content: msg, showCancel: false });
        }
      })
      .catch((e) => {
        const msg = e?.errMsg || e?.message || "网络异常，请检查云函数是否已上传";
        wx.showModal({ title: "注册失败", content: msg, showCancel: false });
      })
      .finally(() => this.setData({ loading: false }));
  },

  goLogin() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: "/pages/index/index" }),
    });
  },
});
