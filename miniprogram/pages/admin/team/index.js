const {
  callCloud,
  ensureAdmin,
  ADMIN_ROLE_LABELS,
  DEFAULT_AVATAR,
} = require("../../../utils/admin");

const ROLE_OPTIONS = [
  { value: "owner", label: "超级管理员" },
  { value: "editor", label: "编辑员" },
  { value: "viewer", label: "查看员" },
  { value: "exporter", label: "导出员" },
];

Page({
  data: {
    loading: true,
    list: [],
    myRole: "",
    roleOptions: ROLE_OPTIONS,
    roleLabels: ADMIN_ROLE_LABELS,
    defaultAvatar: DEFAULT_AVATAR,
  },

  onShow() {
    ensureAdmin("team").then((result) => {
      if (result) this.loadTeam();
    });
  },

  loadTeam() {
    this.setData({ loading: true });
    callCloud("getAdminTeam")
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }
        const list = (res.result.list || []).map((item) => ({
          ...item,
          roleIndex: ROLE_OPTIONS.findIndex((r) => r.value === (item.adminRole || "owner")),
          roleLabel: ADMIN_ROLE_LABELS[item.adminRole || "owner"] || item.adminRole,
        }));
        this.setData({
          list,
          myRole: res.result.myRole || "",
          loading: false,
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  onRoleChange(e) {
    const { id } = e.currentTarget.dataset;
    const roleIndex = Number(e.detail.value);
    const adminRole = ROLE_OPTIONS[roleIndex]?.value;
    if (!adminRole) return;

    callCloud("updateAdminRole", { userId: id, adminRole }).then((res) => {
      if (res.result?.success) {
        wx.showToast({ title: "已更新", icon: "success" });
        this.loadTeam();
      } else {
        wx.showToast({ title: res.result?.errMsg || "更新失败", icon: "none" });
      }
    });
  },
});
