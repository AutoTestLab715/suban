const {
  callCloud,
  callBiaoxunCloud,
  trySilentLogin,
  decorateForm,
  saveUser,
  isAdminUser,
  ADMIN_ROLE_LABELS,
} = require("./admin");

const LATEST_NOTICES_CACHE_KEY = "latestNotices";
const LATEST_NOTICES_STORAGE_KEY = "home_latest_notices_v1";
const LATEST_NOTICES_TTL_MS = 5 * 60 * 1000;

const BIAOXUN_TABS_CACHE_KEY = "biaoxunTabs";
const BIAOXUN_TABS_STORAGE_KEY = "biaoxun_tab_list_cache_v1";
const BIAOXUN_TABS_TTL_MS = 5 * 60 * 1000;
const BIAOXUN_TAB_KEYS = ["tender", "policy", "win", "intent"];

const BIAOXUN_DETAIL_CACHE_KEY = "biaoxunDetails";
const BIAOXUN_DETAIL_TTL_MS = 10 * 60 * 1000;
const BIAOXUN_DETAIL_MAX = 20;

const BIAOXUN_NEXT_PAGE_CACHE_KEY = "biaoxunNextPages";
const BIAOXUN_NEXT_PAGE_TTL_MS = 2 * 60 * 1000;
const BIAOXUN_NEXT_PAGE_MAX = 8;

const TAB_PAGE_URLS = [
  "/pages/index/index",
  "/pages/biaoxun/index",
  "/pages/fill/index",
  "/pages/list/index",
  "/pages/profile/index",
];

const EXTRA_PAGE_URLS = [
  "/pages/forms/index",
  "/pages/login/index",
  "/pages/privacy/index",
  "/pages/register/index",
  "/pages/success/index",
  "/pages/editsubmit/index",
  "/pages/voucher/index",
  "/pages/admin/index/index",
  "/pages/admin/forms/index",
  "/pages/biaoxun/detail/index",
];

const TEMPLATE_CACHE_PREFIX = "formTemplateCache_";
let preloadPromise = null;
let idlePreloadTimer = null;
let preloadStatus = {
  startedAt: 0,
  finishedAt: 0,
  phase: "idle",
  lastError: "",
};

function getAppSafe() {
  try {
    return getApp();
  } catch (e) {
    return null;
  }
}

function getPageCache(key) {
  const app = getAppSafe();
  return app?.globalData?.pageCache?.[key] || null;
}

function setPageCache(key, payload) {
  const app = getAppSafe();
  if (!app) return;
  if (!app.globalData.pageCache) app.globalData.pageCache = {};
  app.globalData.pageCache[key] = {
    ...payload,
    cachedAt: Date.now(),
  };
}

function getPreloadStatus() {
  return { ...preloadStatus };
}

function markPreloadPhase(phase, error = "") {
  preloadStatus.phase = phase;
  if (error) preloadStatus.lastError = String(error || "");
  if (phase === "done") preloadStatus.finishedAt = Date.now();
}

function runWhenIdle(task, delay = 600) {
  if (typeof wx !== "undefined" && typeof wx.requestIdleCallback === "function") {
    try {
      wx.requestIdleCallback(() => {
        try {
          task();
        } catch (e) {
          /* ignore */
        }
      });
      return;
    } catch (e) {
      /* fallback below */
    }
  }
  if (idlePreloadTimer) clearTimeout(idlePreloadTimer);
  idlePreloadTimer = setTimeout(() => {
    idlePreloadTimer = null;
    try {
      task();
    } catch (e) {
      /* ignore */
    }
  }, delay);
}

function preloadPageCode() {
  if (typeof wx.preloadPage !== "function") return;
  [...TAB_PAGE_URLS, ...EXTRA_PAGE_URLS].forEach((url) => {
    wx.preloadPage({
      url,
      fail: () => {},
    });
  });
}

function preloadPublicForms() {
  return callCloud("listPublicForms")
    .then((res) => {
      if (!res.result?.success) return;
      setPageCache("publicForms", { data: res.result.list || [] });
    })
    .catch(() => {});
}

function preloadFormTemplate(templateId = "") {
  return callCloud("getFormTemplate", { templateId: templateId || undefined })
    .then((res) => {
      if (!res.result?.success) return;
      const template = res.result.template;
      const tid = template?._id || templateId || "default";
      setPageCache("formTemplate", {
        templateId: tid,
        response: res.result,
      });
      if (tid) {
        wx.setStorageSync(`${TEMPLATE_CACHE_PREFIX}${tid}`, {
          template,
          cachedAt: Date.now(),
        });
      }
    })
    .catch(() => {});
}

function preloadMySubmissions() {
  return callCloud("getMyForms", { page: 1, pageSize: 10 })
    .then((res) => {
      if (!res.result?.success) return;
      const data = res.result.data || [];
      const pageSize = Number(res.result.pageSize || 10);
      const hasExplicitTotal = Number.isFinite(Number(res.result.total));
      const total = hasExplicitTotal ? Number(res.result.total) : data.length;
      setPageCache("mySubmissions", {
        data,
        total,
        page: 1,
        pageSize,
        hasMore: hasExplicitTotal ? total > pageSize : data.length >= pageSize,
      });
    })
    .catch(() => {});
}

function preloadUserProfile(user) {
  return callCloud("getUserProfile")
    .then((res) => {
      if (!res.result?.success) return;
      const profileUser = res.result.user;
      saveUser(profileUser);
      setPageCache("userProfile", { user: profileUser });
      return profileUser;
    })
    .catch(() => null);
}

function preloadAdminHome() {
  return Promise.all([
    callCloud("getAllForms", { status: "all", page: 1, pageSize: 10 }),
    callCloud("getFormStats"),
  ])
    .then(([listRes, statsRes]) => {
      if (!listRes.result?.success) return;
      setPageCache("adminHome", {
        list: listRes.result.data || [],
        total: listRes.result.total || 0,
        stats: statsRes?.result?.success ? statsRes.result.stats : null,
      });
    })
    .catch(() => {});
}

function readLatestNoticesStorage() {
  try {
    const value = wx.getStorageSync(LATEST_NOTICES_STORAGE_KEY);
    if (!value || !Array.isArray(value.data) || !value.data.length) return null;
    return value;
  } catch (error) {
    return null;
  }
}

function writeLatestNoticesStorage(data) {
  try {
    wx.setStorageSync(LATEST_NOTICES_STORAGE_KEY, {
      data: Array.isArray(data) ? data : [],
      cachedAt: Date.now(),
    });
  } catch (error) {
    // 本地缓存写失败不影响主流程
  }
}

function getLatestNoticesCache() {
  return getPageCache(LATEST_NOTICES_CACHE_KEY) || readLatestNoticesStorage();
}

function setLatestNoticesCache(list) {
  const data = Array.isArray(list) ? list : [];
  setPageCache(LATEST_NOTICES_CACHE_KEY, { data });
  writeLatestNoticesStorage(data);
}

function isLatestNoticesFresh(cached) {
  const cachedAt = Number(cached?.cachedAt || 0);
  if (!cachedAt) return false;
  return Date.now() - cachedAt < LATEST_NOTICES_TTL_MS;
}

function preloadTenderListShared() {
  const cachedNotices = getLatestNoticesCache();
  const cachedTenderTab = getBiaoxunTabCache("tender", false);
  const noticesFresh = isLatestNoticesFresh(cachedNotices);
  const tabFresh = isBiaoxunTabFresh(cachedTenderTab);
  if (noticesFresh && tabFresh) return Promise.resolve();

  return callBiaoxunCloud("listBiaoxun", {
    page: 1,
    pageSize: 8,
    categoryGroup: "tender",
    excludePlap: true,
  })
    .then((res) => {
      if (!res.result?.success) return;
      const data = res.result.data || [];
      if (!data.length) return;
      if (!noticesFresh) setLatestNoticesCache(data);
      if (!tabFresh) {
        setBiaoxunTabCache("tender", false, {
          list: data,
          page: 1,
          hasMore: !!res.result.hasMore,
          nextBeforePublishTime: String(res.result.nextBeforePublishTime || ""),
          sourceName: String(res.result.sourceName || ""),
          searchedKeyword: "",
          searchHint: String(res.result.searchHint || ""),
        });
      }
    })
    .catch(() => {});
}

function runCriticalPreload() {
  markPreloadPhase("critical");
  return preloadTenderListShared();
}

function biaoxunTabSlot(category, plapOnly = false) {
  const key = String(category || "tender").trim() || "tender";
  return `${key}|${plapOnly ? "plapOnly" : "mixed"}|default`;
}

function readBiaoxunTabsStorage() {
  try {
    const value = wx.getStorageSync(BIAOXUN_TABS_STORAGE_KEY);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value.buckets && typeof value.buckets === "object" ? value.buckets : value;
  } catch (error) {
    return {};
  }
}

function writeBiaoxunTabsStorage(buckets) {
  try {
    wx.setStorageSync(BIAOXUN_TABS_STORAGE_KEY, {
      buckets: buckets || {},
      updatedAt: Date.now(),
    });
  } catch (error) {
    // 本地缓存写失败不影响主流程
  }
}

function getBiaoxunTabCache(category, plapOnly = false) {
  const slot = biaoxunTabSlot(category, plapOnly);
  const mem = getPageCache(BIAOXUN_TABS_CACHE_KEY)?.buckets?.[slot];
  if (mem && Array.isArray(mem.list) && mem.list.length) return mem;
  const stored = readBiaoxunTabsStorage()[slot];
  if (stored && Array.isArray(stored.list) && stored.list.length) return stored;
  return null;
}

function setBiaoxunTabCache(category, plapOnly, payload = {}) {
  const list = Array.isArray(payload.list) ? payload.list.slice(0, 30) : [];
  if (!list.length) return;
  const slot = biaoxunTabSlot(category, plapOnly);
  const entry = {
    list,
    page: Number(payload.page || 1),
    hasMore: !!payload.hasMore,
    nextBeforePublishTime: String(payload.nextBeforePublishTime || ""),
    sourceName: String(payload.sourceName || ""),
    searchedKeyword: String(payload.searchedKeyword || ""),
    searchHint: String(payload.searchHint || ""),
    searchTotal: Number(payload.searchTotal || 0),
    searchTotalKnown: !!payload.searchTotalKnown,
    savedAt: Date.now(),
    cachedAt: Date.now(),
  };
  const app = getAppSafe();
  if (app) {
    if (!app.globalData.pageCache) app.globalData.pageCache = {};
    const current = app.globalData.pageCache[BIAOXUN_TABS_CACHE_KEY] || { buckets: {} };
    current.buckets = { ...(current.buckets || {}), [slot]: entry };
    current.cachedAt = Date.now();
    app.globalData.pageCache[BIAOXUN_TABS_CACHE_KEY] = current;
  }
  const buckets = { ...readBiaoxunTabsStorage(), [slot]: entry };
  writeBiaoxunTabsStorage(buckets);
}

function isBiaoxunTabFresh(cached) {
  const cachedAt = Number(cached?.cachedAt || cached?.savedAt || 0);
  if (!cachedAt) return false;
  return Date.now() - cachedAt < BIAOXUN_TABS_TTL_MS;
}

function applyBiaoxunTabCache(page, cached, decorate) {
  if (!cached || !Array.isArray(cached.list) || !cached.list.length) return false;
  const decorateFn = typeof decorate === "function" ? decorate : (item) => item;
  const list = cached.list
    .map((item) => (item && item.categoryLabel ? item : decorateFn(item)))
    .filter((item) => item && item.id);
  if (!list.length) return false;
  page.setData({
    list,
    page: Number(cached.page || 1),
    hasMore: !!cached.hasMore,
    nextBeforePublishTime: String(cached.nextBeforePublishTime || ""),
    sourceName: cached.sourceName || page.data.sourceName || "",
    searchedKeyword: String(cached.searchedKeyword || ""),
    searchHint: String(cached.searchHint || ""),
    searchTotal: Number(cached.searchTotal || 0),
    searchTotalKnown: !!cached.searchTotalKnown,
    loading: false,
    loadingMore: false,
    errorMessage: "",
  });
  return true;
}

function detailCacheKey(id, source = "") {
  return `${String(id || "").trim()}::${String(source || "").trim().toLowerCase()}`;
}

function getDetailBuckets() {
  const cached = getPageCache(BIAOXUN_DETAIL_CACHE_KEY);
  return cached && cached.buckets && typeof cached.buckets === "object" ? cached.buckets : {};
}

function setDetailBuckets(buckets) {
  setPageCache(BIAOXUN_DETAIL_CACHE_KEY, { buckets });
}

function getBiaoxunDetailCache(id, source = "") {
  const key = detailCacheKey(id, source);
  if (!key || key === "::") return null;
  const record = getDetailBuckets()[key];
  if (!record || !record.result) return null;
  const cachedAt = Number(record.cachedAt || 0);
  if (!cachedAt || Date.now() - cachedAt > BIAOXUN_DETAIL_TTL_MS) return null;
  return record.result;
}

function setBiaoxunDetailCache(id, source, result) {
  if (!id || !result) return;
  const key = detailCacheKey(id, source);
  const buckets = { ...getDetailBuckets(), [key]: { result, cachedAt: Date.now() } };
  const entries = Object.entries(buckets).sort(
    (a, b) => Number(b[1]?.cachedAt || 0) - Number(a[1]?.cachedAt || 0)
  );
  const limited = Object.fromEntries(entries.slice(0, BIAOXUN_DETAIL_MAX));
  setDetailBuckets(limited);
}

const pendingDetailPrefetch = Object.create(null);

function prefetchBiaoxunDetail(id, source = "") {
  const noticeId = String(id || "").trim();
  if (!noticeId) return Promise.resolve(null);
  const sourceCode = String(source || "").trim().toLowerCase();
  if (getBiaoxunDetailCache(noticeId, sourceCode)) return Promise.resolve(getBiaoxunDetailCache(noticeId, sourceCode));
  const key = detailCacheKey(noticeId, sourceCode);
  if (pendingDetailPrefetch[key]) return pendingDetailPrefetch[key];

  pendingDetailPrefetch[key] = callBiaoxunCloud("getBiaoxunDetail", {
    id: noticeId,
    source: sourceCode,
  })
    .then((res) => {
      const result = res?.result || {};
      if (!result.success || !result.data) return null;
      setBiaoxunDetailCache(noticeId, sourceCode, result);
      return result;
    })
    .catch(() => null)
    .finally(() => {
      delete pendingDetailPrefetch[key];
    });

  return pendingDetailPrefetch[key];
}

function getNextPageBuckets() {
  const cached = getPageCache(BIAOXUN_NEXT_PAGE_CACHE_KEY);
  return cached && cached.buckets && typeof cached.buckets === "object" ? cached.buckets : {};
}

function setNextPageBuckets(buckets) {
  setPageCache(BIAOXUN_NEXT_PAGE_CACHE_KEY, { buckets });
}

function getBiaoxunNextPageCache(cacheKey) {
  const key = String(cacheKey || "");
  if (!key) return null;
  const record = getNextPageBuckets()[key];
  if (!record || !record.result) return null;
  const cachedAt = Number(record.cachedAt || 0);
  if (!cachedAt || Date.now() - cachedAt > BIAOXUN_NEXT_PAGE_TTL_MS) return null;
  return record.result;
}

function setBiaoxunNextPageCache(cacheKey, result) {
  const key = String(cacheKey || "");
  if (!key || !result) return;
  const buckets = {
    ...getNextPageBuckets(),
    [key]: { result, cachedAt: Date.now() },
  };
  const entries = Object.entries(buckets).sort(
    (a, b) => Number(b[1]?.cachedAt || 0) - Number(a[1]?.cachedAt || 0)
  );
  setNextPageBuckets(Object.fromEntries(entries.slice(0, BIAOXUN_NEXT_PAGE_MAX)));
}

function clearBiaoxunNextPageCache(cacheKey) {
  const key = String(cacheKey || "");
  if (!key) {
    setNextPageBuckets({});
    return;
  }
  const buckets = { ...getNextPageBuckets() };
  delete buckets[key];
  setNextPageBuckets(buckets);
}

const pendingNextPagePrefetch = Object.create(null);

function prefetchBiaoxunNextPage(cacheKey, requestData = {}) {
  const key = String(cacheKey || "");
  if (!key) return Promise.resolve(null);
  if (getBiaoxunNextPageCache(key)) return Promise.resolve(getBiaoxunNextPageCache(key));
  if (pendingNextPagePrefetch[key]) return pendingNextPagePrefetch[key];
  if (!String(requestData.beforePublishTime || "").trim()) return Promise.resolve(null);

  pendingNextPagePrefetch[key] = callBiaoxunCloud("listBiaoxun", requestData)
    .then((res) => {
      const result = res?.result || {};
      if (!result.success) return null;
      setBiaoxunNextPageCache(key, result);
      return result;
    })
    .catch(() => null)
    .finally(() => {
      delete pendingNextPagePrefetch[key];
    });

  return pendingNextPagePrefetch[key];
}

function runSecondaryPreload(user) {
  markPreloadPhase("secondary");
  const tasks = [preloadPublicForms(), preloadFormTemplate("")];
  if (user) {
    tasks.push(preloadMySubmissions(), preloadUserProfile(user));
    if (isAdminUser(user)) tasks.push(preloadAdminHome());
  }
  return Promise.all(tasks);
}

function runDataPreload(user) {
  return runCriticalPreload()
    .then(() =>
      new Promise((resolve) => {
        runWhenIdle(() => {
          runSecondaryPreload(user).finally(resolve);
        }, 400);
      })
    )
    .then(() => {
      markPreloadPhase("done");
    });
}

const PRELOAD_COOLDOWN_MS = 5 * 60 * 1000;

function startPreload(options = {}) {
  const force = !!options.force;
  if (preloadPromise && !force) return preloadPromise;
  if (
    !force &&
    preloadStatus.finishedAt &&
    Date.now() - preloadStatus.finishedAt < PRELOAD_COOLDOWN_MS
  ) {
    return preloadPromise || Promise.resolve();
  }

  preloadStatus.startedAt = Date.now();
  preloadStatus.finishedAt = 0;
  preloadStatus.lastError = "";
  markPreloadPhase("boot");

  preloadPromise = Promise.resolve()
    .then(() => {
      preloadPageCode();
      return trySilentLogin();
    })
    .then((user) => runDataPreload(user))
    .catch((error) => {
      markPreloadPhase("error", error?.errMsg || error?.message || error);
    });

  const app = getAppSafe();
  if (app) app.globalData.preloadPromise = preloadPromise;
  return preloadPromise;
}

function waitForPreload() {
  return preloadPromise || startPreload();
}

function refreshUserPreload(user) {
  if (!user) return startPreload({ force: true });
  return runDataPreload(user);
}

function refreshPreloadOnReconnect() {
  const app = getAppSafe();
  if (!app?.globalData?.networkConnected) return Promise.resolve();
  return startPreload({ force: true });
}

function applyMySubmissions(page, cached) {
  if (!cached || cached.data === undefined) return false;
  const selectedIds = page.data.selectedIds || [];
  const list = (cached.data || []).map((item) => ({
    ...decorateForm(item),
    selected: selectedIds.includes(item._id),
  }));
  const allSelected =
    list.length > 0 && list.every((item) => selectedIds.includes(item._id));
  page.setData({
    list,
    allSelected,
    loading: false,
    needLogin: false,
    total: Number(cached.total || list.length),
    page: Number(cached.page || 1),
    pageSize: Number(cached.pageSize || 10),
    hasMore: cached.hasMore === undefined
      ? Number(cached.total || list.length) > Number(cached.pageSize || 10)
      : !!cached.hasMore,
  });
  return true;
}

function applyPublicForms(page, cached) {
  if (!cached || cached.data === undefined) return false;
  page.setData({ list: cached.data || [], loading: false });
  return true;
}

function applyLatestNotices(page, cached, decorate) {
  if (!cached || !Array.isArray(cached.data) || !cached.data.length) return false;
  const decorateFn = typeof decorate === "function" ? decorate : (item) => item;
  const list = cached.data.map(decorateFn).filter((item) => item && item.id);
  if (!list.length) return false;
  page.setData({
    latestNotices: list,
    latestLoading: false,
    latestError: false,
  });
  return true;
}

function applyUserProfile(page, cached) {
  if (!cached?.user) return false;
  const user = cached.user;
  page.setData({
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
    needLogin: false,
  });
  return true;
}

function clearUserPageCache() {
  const app = getAppSafe();
  if (!app?.globalData?.pageCache) return;
  delete app.globalData.pageCache.mySubmissions;
  delete app.globalData.pageCache.userProfile;
  delete app.globalData.pageCache.adminHome;
}

module.exports = {
  startPreload,
  waitForPreload,
  refreshUserPreload,
  refreshPreloadOnReconnect,
  getPreloadStatus,
  getPageCache,
  setPageCache,
  clearUserPageCache,
  applyMySubmissions,
  applyPublicForms,
  applyUserProfile,
  applyLatestNotices,
  getLatestNoticesCache,
  setLatestNoticesCache,
  isLatestNoticesFresh,
  getBiaoxunTabCache,
  setBiaoxunTabCache,
  isBiaoxunTabFresh,
  applyBiaoxunTabCache,
  biaoxunTabSlot,
  prefetchBiaoxunDetail,
  getBiaoxunDetailCache,
  setBiaoxunDetailCache,
  prefetchBiaoxunNextPage,
  getBiaoxunNextPageCache,
  setBiaoxunNextPageCache,
  clearBiaoxunNextPageCache,
};
