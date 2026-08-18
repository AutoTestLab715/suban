const enableShareMenu = () => {
  if (typeof wx.showShareMenu !== "function") return;
  wx.showShareMenu({
    withShareTicket: true,
    menus: ["shareAppMessage", "shareTimeline"],
  });
};

const buildHomeShare = () => ({
  title: "速办智库 · 企业资质办理与标讯查询",
  path: "/pages/index/index",
});

const buildBiaoxunShare = () => ({
  title: "速办智库 · 标讯中心",
  path: "/pages/biaoxun/index",
});

const buildFillShare = (templateId = "") => ({
  title: "速办智库 · 在线咨询填写",
  path: templateId ? `/pages/fill/index?templateId=${encodeURIComponent(templateId)}` : "/pages/fill/index",
});

const buildListShare = () => ({
  title: "速办智库 · 我的提交",
  path: "/pages/list/index",
});

const buildProfileShare = () => ({
  title: "速办智库",
  path: "/pages/profile/index",
});

const toTimeline = (share) => ({
  title: share.title,
  query: String(share.path || "").replace(/^\/?pages\/[^?]+\??/, ""),
});

module.exports = {
  enableShareMenu,
  buildHomeShare,
  buildBiaoxunShare,
  buildFillShare,
  buildListShare,
  buildProfileShare,
  toTimeline,
};
