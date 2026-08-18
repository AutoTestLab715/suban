const { callCloud, callBiaoxunCloud, getLocalUser, hasLoggedOut, trySilentLogin, goLogin } = require("../../utils/admin");
const {
  getPageCache,
  setPageCache,
  applyLatestNotices,
  getLatestNoticesCache,
  setLatestNoticesCache,
  isLatestNoticesFresh,
} = require("../../utils/preload");
const { enableShareMenu, buildHomeShare, toTimeline } = require("../../utils/share");
const { decorateNoticeCard } = require("../../utils/biaoxunDecorate");

/** 首页业务入口：defaultName 为兜底文案；优先按表单 settings.homeServiceKey 绑定，展示名跟表单 title 同步 */
const HOME_FORM_BIND_KEY = "home_service_form_ids_v1";

const MAIN_SERVICES = [
  {
    key: "special",
    defaultName: "专精代为",
    desc: "资质诊断与申报",
    iconClass: "special",
    icon: "/images/home/icons/special.svg",
    formKeys: ["专精代为", "专精特新", "专精"],
  },
  {
    key: "tender",
    defaultName: "标书代为",
    desc: "投标文件专业编制",
    iconClass: "tender",
    icon: "/images/home/icons/tender.svg",
    formKeys: ["标书代为", "标书代写", "标书代办", "代写标书", "标书", "投标", "招标文件"],
  },
  {
    key: "declare",
    defaultName: "证书委托",
    desc: "专项辅导与跟进",
    iconClass: "declare",
    icon: "/images/home/icons/declare.svg",
    formKeys: ["证书委托", "证书"],
  },
];

const QUICK_SERVICES = [
  {
    key: "high",
    defaultName: "高新代为",
    iconClass: "high",
    icon: "/images/home/icons/high.svg",
    formKeys: ["高新代为", "高新代办", "高新"],
  },
  {
    key: "talent",
    defaultName: "人才合作",
    iconClass: "talent",
    icon: "/images/home/icons/talent.svg",
    formKeys: ["人才合作", "人才"],
  },
  {
    key: "notice",
    defaultName: "标讯中心",
    iconClass: "notice",
    icon: "/images/home/icons/notice.svg",
    target: "biaoxun",
  },
  {
    key: "other",
    defaultName: "其他需求",
    iconClass: "other",
    icon: "/images/home/icons/other.svg",
    formKeys: ["其他需求"],
  },
];

const normalizeTitle = (text) => String(text || "").replace(/\s+/g, "").trim();

const getSavedFormIds = () => {
  try {
    const raw = wx.getStorageSync(HOME_FORM_BIND_KEY);
    return raw && typeof raw === "object" ? raw : {};
  } catch (e) {
    return {};
  }
};

const saveFormIdForService = (serviceKey, formId) => {
  if (!serviceKey || !formId) return;
  try {
    const map = getSavedFormIds();
    if (map[serviceKey] === formId) return;
    map[serviceKey] = formId;
    wx.setStorageSync(HOME_FORM_BIND_KEY, map);
  } catch (e) {
    // ignore
  }
};

const withDefaultNames = (list) =>
  list.map((item) => ({
    ...item,
    name: item.defaultName,
    formId: "",
  }));

const findFormByService = (list, service, usedIds = new Set()) => {
  if (!service?.key && !service?.formKeys?.length) return null;
  const forms = (Array.isArray(list) ? list : []).filter((item) => item?._id && !usedIds.has(item._id));
  // 1) 稳定绑定：表单配置里的首页入口
  if (service.key) {
    const bySlot = forms.find((item) => String(item.homeServiceKey || "").trim() === service.key);
    if (bySlot?._id) return bySlot;
  }
  // 2) 本地曾成功绑定过的表单 ID（改名后仍能跟上）
  if (service.key) {
    const savedId = String(getSavedFormIds()[service.key] || "").trim();
    if (savedId) {
      const byId = forms.find((item) => item._id === savedId);
      if (byId?._id) return byId;
    }
  }
  if (!service?.formKeys?.length) return null;
  const keys = [...service.formKeys].sort((a, b) => String(b).length - String(a).length);
  for (const key of keys) {
    const hit = forms.find((item) => normalizeTitle(item?.title) === normalizeTitle(key));
    if (hit?._id) return hit;
  }
  for (const key of keys) {
    const needle = normalizeTitle(key);
    if (!needle) continue;
    const hit = forms.find((item) => normalizeTitle(item?.title).includes(needle));
    if (hit?._id) return hit;
  }
  return null;
};

const bindServicesToForms = (services, forms, usedIds = new Set()) =>
  services.map((service) => {
    if (!service.formKeys?.length) {
      return {
        ...service,
        name: service.defaultName || service.name,
        formId: "",
      };
    }
    const form = findFormByService(forms, service, usedIds);
    if (form?._id) {
      usedIds.add(form._id);
      saveFormIdForService(service.key, form._id);
    }
    const title = String(form?.title || "").trim();
    return {
      ...service,
      name: title || service.defaultName || service.name,
      formId: form?._id || "",
    };
  });
const loadPublicForms = ({ force = false } = {}) => {
  const cached = getPageCache("publicForms")?.data;
  if (!force && Array.isArray(cached) && cached.length) {
    return Promise.resolve(cached);
  }
  return callCloud("listPublicForms").then((res) => {
    if (!res.result?.success) throw new Error(res.result?.errMsg || "表单加载失败");
    const list = res.result.list || [];
    setPageCache("publicForms", { data: list });
    return list;
  });
};

const decorateNotice = (item) => decorateNoticeCard(item);

Page({
  data: {
    mainServices: withDefaultNames(MAIN_SERVICES),
    quickServices: withDefaultNames(QUICK_SERVICES),
    latestNotices: [],
    latestLoading: true,
    latestError: false,
  },

  onLoad(options) {
    if (options.templateId) {
      getApp().globalData.fillTemplateId = options.templateId;
      wx.switchTab({ url: "/pages/fill/index" });
    }
    // 冷启动先用本地缓存铺底，避免切回首页反复转圈
    applyLatestNotices(this, getLatestNoticesCache(), decorateNotice);
    const cachedForms = getPageCache("publicForms")?.data;
    if (Array.isArray(cachedForms) && cachedForms.length) {
      this.applyServiceForms(cachedForms);
    }
  },

  onShow() {
    enableShareMenu();
    trySilentLogin();
    const cached = getLatestNoticesCache();
    const hasCache = applyLatestNotices(this, cached, decorateNotice);
    // 有未过期缓存时不重复打库（preload 与首页共用同一份缓存）
    this.loadLatestNotices(hasCache, hasCache);
    // 业务入口名称与表单类型 title 同步
    this.syncServiceForms();
  },

  applyServiceForms(forms) {
    const usedIds = new Set();
    this.setData({
      mainServices: bindServicesToForms(MAIN_SERVICES, forms, usedIds),
      quickServices: bindServicesToForms(QUICK_SERVICES, forms, usedIds),
    });
  },

  syncServiceForms() {
    const requestId = (this._serviceFormRequestId || 0) + 1;
    this._serviceFormRequestId = requestId;
    return loadPublicForms({ force: true })
      .then((list) => {
        if (requestId !== this._serviceFormRequestId) return;
        this.applyServiceForms(list);
      })
      .catch((error) => {
        console.warn("首页业务名称同步失败", error);
      });
  },

  onShareAppMessage() {
    return buildHomeShare();
  },

  onShareTimeline() {
    return toTimeline(buildHomeShare());
  },

  loadLatestNotices(silent = false, skipIfFresh = false) {
    if (silent && skipIfFresh && isLatestNoticesFresh(getLatestNoticesCache())) {
      return Promise.resolve();
    }

    const requestId = (this._latestRequestId || 0) + 1;
    this._latestRequestId = requestId;
    if (!silent) {
      this.setData({ latestLoading: true, latestError: false });
    }

    return callBiaoxunCloud("listBiaoxun", {
      page: 1,
      pageSize: 8,
      categoryGroup: "tender",
      excludePlap: true,
    })
      .then((res) => {
        if (requestId !== this._latestRequestId) return;
        const result = res?.result || {};
        if (!result.success) throw new Error(result.errMsg || "标讯加载失败");
        const list = (result.data || []).map(decorateNotice).filter((item) => item.id);
        // 缓存原始接口数据，展示时再 decorate，避免重复字段膨胀
        setLatestNoticesCache(result.data || []);
        this.setData({
          latestNotices: list,
          latestLoading: false,
          latestError: false,
        });
      })
      .catch((error) => {
        if (requestId !== this._latestRequestId) return;
        console.warn("首页最新公告加载失败", error);
        const keepCache = silent && (this.data.latestNotices || []).length > 0;
        this.setData({
          latestLoading: false,
          latestError: keepCache ? false : true,
        });
      });
  },

  goService(e) {
    const target = e.currentTarget.dataset.target || "";
    const key = e.currentTarget.dataset.key || "";
    if (target === "biaoxun") {
      this.goBiaoxun();
      return;
    }
    const service = [...(this.data.mainServices || []), ...(this.data.quickServices || [])].find(
      (item) => item.key === key
    );
    this.openServiceForm(service);
  },

  goBiaoxun() {
    wx.switchTab({ url: "/pages/biaoxun/index" });
  },

  onNoticeCardOpen(e) {
    const id = String(e.detail?.id || "");
    if (!id) return;
    const now = Date.now();
    if (this._openDetailAt && now - this._openDetailAt < 600) return;
    this._openDetailAt = now;
    const source = String(e.detail?.source || "zfcg");
    wx.navigateTo({
      url: `/pages/biaoxun/detail/index?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`,
    });
  },

  openServiceForm(service) {
    if (!service?.formKeys?.length) {
      this.goFill();
      return;
    }

    if (service.formId) {
      this.startFill(service.formId);
      return;
    }

    wx.showLoading({ title: "打开表单", mask: true });
    loadPublicForms({ force: true })
      .then((list) => {
        this.applyServiceForms(list);
        const latest = [...(this.data.mainServices || []), ...(this.data.quickServices || [])].find(
          (item) => item.key === service.key
        );
        const formId = latest?.formId || findFormByService(list, service)?._id;
        if (!formId) {
          wx.showToast({ title: `未找到「${service.name || service.defaultName}」表单`, icon: "none" });
          return;
        }
        this.startFill(formId);
      })
      .catch(() => {
        wx.showToast({ title: "表单加载失败", icon: "none" });
      })
      .finally(() => wx.hideLoading());
  },

  startFill(templateId) {
    if (!templateId) {
      this.goFill();
      return;
    }

    const go = () => {
      getApp().globalData.fillTemplateId = templateId;
      wx.switchTab({ url: "/pages/fill/index" });
    };

    const user = getLocalUser();
    if (user && !hasLoggedOut()) {
      go();
      return;
    }

    trySilentLogin().then((loggedIn) => {
      if (loggedIn) {
        go();
        return;
      }
      this.showLoginModal(`/pages/fill/index?templateId=${templateId}`, templateId);
    });
  },

  goFill() {
    getApp().globalData.formsGuide = true;
    const user = getLocalUser();
    if (user && !hasLoggedOut()) {
      wx.navigateTo({ url: "/pages/forms/index" });
      return;
    }

    trySilentLogin().then((loggedIn) => {
      if (loggedIn) {
        wx.navigateTo({ url: "/pages/forms/index" });
        return;
      }
      this.showLoginModal("/pages/forms/index");
    });
  },

  showLoginModal(redirectUrl = "/pages/forms/index", templateId = "") {
    wx.showModal({
      title: "登录提示",
      content: "登录后可提交业务需求",
      confirmText: "去登录",
      success: (res) => {
        if (!res.confirm) return;
        if (templateId) getApp().globalData.fillTemplateId = templateId;
        goLogin(redirectUrl);
      },
    });
  },
});
