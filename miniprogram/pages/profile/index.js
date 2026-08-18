const {
  callCloud,
  saveUser,
  trySilentLogin,
  markLoggedOut,
  uploadAvatar,
  DEFAULT_AVATAR,
  getLocalUser,
  isAdminUser,
  ADMIN_ROLE_LABELS,
  goPage,
  goLogin,
} = require("../../utils/admin");
const {
  getPageCache,
  setPageCache,
  applyUserProfile,
  waitForPreload,
  clearUserPageCache,
} = require("../../utils/preload");
const { enableShareMenu, buildProfileShare, toTimeline } = require("../../utils/share");

Page({
  data: {
    loading: true,
    needLogin: false,
    saving: false,
    isAdmin: false,
    roleLabel: "普通用户",
    adminRoleLabel: "",
    defaultAvatar: DEFAULT_AVATAR,
    backUrl: "/pages/index/index",
    form: {
      nickName: "",
      avatarUrl: "",
      phone: "",
      email: "",
    },
  },

  onLoad() {
    const localUser = getLocalUser();
    const cached = getPageCache("userProfile");
    if (localUser) {
      applyUserProfile(this, { user: localUser });
    } else if (cached) {
      applyUserProfile(this, cached);
    }
  },

  onShow() {
    enableShareMenu();
    const user = getLocalUser();
    this.setData({
      backUrl: isAdminUser(user) ? "/pages/admin/index/index" : "/pages/index/index",
    });
    waitForPreload().finally(() => {
      const cached = getPageCache("userProfile");
      const hasCache = applyUserProfile(this, cached) || !!getLocalUser();
      this.loadProfile(hasCache);
    });
  },

  loadProfile(silent = false) {
    trySilentLogin().then((user) => {
      if (!user) {
        this.setData({
          loading: false,
          needLogin: true,
          form: { nickName: "", avatarUrl: "", phone: "", email: "" },
        });
        return;
      }
      this.setData({ needLogin: false });
      if (!silent) this.setData({ loading: !this.data.form.nickName });
      callCloud("getUserProfile")
        .then((res) => {
          if (res.result?.success) {
            const user = res.result.user;
            saveUser(user);
            setPageCache("userProfile", { user });
            this.setData({
              form: {
                nickName: user.nickName || "",
                avatarUrl: user.avatarUrl || "",
                phone: user.phone || "",
                email: user.email || "",
              },
              isAdmin: isAdminUser(user),
              roleLabel: isAdminUser(user) ? "管理员" : "普通用户",
              adminRoleLabel: isAdminUser(user)
                ? ADMIN_ROLE_LABELS[user.adminRole] || "管理员"
                : "",
              loading: false,
            });
          } else {
            wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
            this.setData({ loading: false });
          }
        })
        .catch(() => {
          wx.showToast({ title: "加载失败", icon: "none" });
          this.setData({ loading: false });
        });
    });
  },

  goLoginTap() {
    goLogin("/pages/profile/index");
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (avatarUrl) {
      this.setData({ "form.avatarUrl": avatarUrl });
    }
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onNicknameBlur(e) {
    const value = (e.detail.value || "").trim();
    if (value) this.setData({ "form.nickName": value });
  },

  validate() {
    const { nickName, email } = this.data.form;
    if (!nickName.trim()) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return false;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      wx.showToast({ title: "邮箱格式不正确", icon: "none" });
      return false;
    }
    return true;
  },

  onSave() {
    if (!this.validate()) return;

    const { nickName, avatarUrl, email } = this.data.form;
    this.setData({ saving: true });

    uploadAvatar(avatarUrl)
      .then((cloudAvatar) =>
        callCloud("updateUserProfile", {
          nickName: nickName.trim(),
          avatarUrl: cloudAvatar,
          email: email.trim(),
        })
      )
      .then((res) => {
        if (res.result?.success) {
          saveUser(res.result.user);
          setPageCache("userProfile", { user: res.result.user });
          wx.showToast({ title: "保存成功", icon: "success" });
        } else {
          wx.showToast({ title: res.result?.errMsg || "保存失败", icon: "none" });
        }
      })
      .catch(() => wx.showToast({ title: "保存失败", icon: "none" }))
      .finally(() => this.setData({ saving: false }));
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出当前账号吗？",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        markLoggedOut();
        clearUserPageCache();
        wx.reLaunch({ url: "/pages/index/index" });
      },
    });
  },

  goAdmin() {
    wx.redirectTo({ url: "/pages/admin/index/index" });
  },

  goUserHome() {
    goPage("/pages/index/index");
  },

  onShareAppMessage() {
    return buildProfileShare();
  },

  onShareTimeline() {
    return toTimeline(buildProfileShare());
  },
});
