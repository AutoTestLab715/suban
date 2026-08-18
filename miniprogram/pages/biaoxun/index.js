const { callBiaoxunCloud } = require("../../utils/admin");
const { enableShareMenu } = require("../../utils/share");
const {
  getTopRegions,
  getRegionChildren,
  getFujianProvinceChildren,
  getRegionOptionsForSource,
  expandRegionsForApi,
} = require("../../utils/fujianRegions");
const { BUSINESS_TYPES, BUSINESS_TYPE_OPTIONS } = require("../../utils/businessTypes");
const { HALL_ASSET_TYPES, HALL_ASSET_TYPE_OPTIONS } = require("../../utils/hallAssetTypes");
const { PARTY_A_OPTIONS } = require("../../utils/partyATypes");
const { AMOUNT_RANGES } = require("../../utils/amountRanges");
const { EXPIRY_RANGES } = require("../../utils/expiryRanges");
const { PROPERTY_FORMAT_OPTIONS } = require("../../utils/propertyFormats");
const { CONTRACT_PERIOD_OPTIONS } = require("../../utils/contractPeriods");
const { ATTACHMENT_OPTIONS } = require("../../utils/attachmentFilters");
const { TURNOVER_OPTIONS } = require("../../utils/turnoverFilters");
const {
  INFO_SOURCE_OPTIONS,
  isValidInfoSourceKey,
  getSourceLabel,
} = require("../../utils/infoSources");
const { safeDecode } = require("../../utils/string");
const { decorateNoticeCard } = require("../../utils/biaoxunDecorate");
const {
  getBiaoxunTabCache,
  setBiaoxunTabCache,
  isBiaoxunTabFresh,
  applyBiaoxunTabCache,
  prefetchBiaoxunDetail,
  prefetchBiaoxunNextPage,
  getBiaoxunNextPageCache,
  clearBiaoxunNextPageCache,
} = require("../../utils/preload");

const FILTER_MENUS = [
  { key: "business", label: "业务类型" },
  { key: "partyA", label: "甲方类型" },
  { key: "amount", label: "金额" },
  { key: "expiry", label: "到期时间" },
  { key: "property", label: "物业业态" },
  { key: "contract", label: "合同周期" },
  { key: "attachment", label: "附件" },
  { key: "turnover", label: "换手率" },
];

/** 竞价大厅：筛选项对齐详情标的类型 */
const HALL_FILTER_MENUS = [{ key: "business", label: "项目类型" }];

const resolveBusinessFilterUi = (category = "") => {
  if (String(category || "").trim() === "hall") {
    return {
      isHallCategory: true,
      filterMenus: HALL_FILTER_MENUS,
      businessTypes: HALL_ASSET_TYPES,
      businessTypeOptions: HALL_ASSET_TYPE_OPTIONS,
      businessSectionTitle: "项目类型",
      filterBusinessEmptyLabel: "项目类型 全部",
    };
  }
  return {
    isHallCategory: false,
    filterMenus: FILTER_MENUS,
    businessTypes: BUSINESS_TYPES,
    businessTypeOptions: BUSINESS_TYPE_OPTIONS,
    businessSectionTitle: "业务类型",
    filterBusinessEmptyLabel: "全部筛选",
  };
};

const CATEGORY_TABS = [
  { key: "tender", label: "招标公告" },
  { key: "policy", label: "政策公开" },
  { key: "win", label: "中标公告" },
  { key: "intent", label: "采购意向" },
];

const QUANZHOU_CATEGORY_TABS = [
  { key: "trade", label: "交易公告" },
  { key: "hall", label: "竞价大厅" },
];

const CATEGORY_LABELS = {
  tender: "招标公告",
  policy: "政策公开",
  win: "中标公告",
  intent: "采购意向",
  trade: "交易公告",
  hall: "竞价大厅",
};

const STANDARD_CATEGORY_KEYS = new Set(["tender", "policy", "win", "intent"]);
const QUANZHOU_CATEGORY_KEYS = new Set(["trade", "hall"]);

/** 相同关键词短时间内复用本地结果，避免重复全库检索 */
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;

const resolveCategoryTabsForSource = (sourceKey = "") =>
  String(sourceKey || "").trim() === "quanzhou" ? QUANZHOU_CATEGORY_TABS : CATEGORY_TABS;

const resolveDefaultCategoryForSource = (sourceKey = "", current = "") => {
  if (String(sourceKey || "").trim() === "quanzhou") {
    return QUANZHOU_CATEGORY_KEYS.has(current) ? current : "trade";
  }
  return STANDARD_CATEGORY_KEYS.has(current) ? current : "tender";
};

// 分类列表内存缓存：切换 Tab 复用已加载数据，下拉刷新强制更新
const DEFAULT_LIST_FILTERS = {
  filterRegions: [],
  filterRegionLabel: "全部",
  filterBusinessTypes: [],
  filterBusinessLabel: "全部筛选",
  filterInfoSource: "all",
  filterPartyAType: "all",
  filterAmountRange: "all",
  filterExpiryRange: "all",
  filterExpiryStartDate: "",
  filterExpiryEndDate: "",
  filterPropertyFormat: "all",
  filterContractPeriod: "all",
  filterAttachment: "all",
  filterTurnover: "all",
  filterStartDate: "",
  filterEndDate: "",
};

const CLEAR_REGION_FILTERS = {
  filterRegions: [],
  filterRegionLabel: "全部",
  draftRegions: [],
  regionPanel: "top",
  regionCity: "",
};

const resolveListSourceKey = (data = {}) => {
  if (data.plapOnly) return "plap";
  const src = String(data.filterInfoSource || "all").trim();
  return src !== "all" ? src : "";
};

const isFujianCityName = (name) => {
  const text = String(name || "").trim();
  if (!text || text === "福建省") return false;
  return getTopRegions().some((item) => item.name === text);
};

const formatRegionLabel = (regions) => {
  const list = Array.isArray(regions) ? regions.filter(Boolean) : [];
  if (!list.length) return "全部";
  if (list.length === 1) return list[0];
  if (list.length === 2) return list.join("、");
  return `${list[0]}等${list.length}地`;
};

const resolveSelectName = (item, regionCity = "") => {
  if (!item) return "";
  if (item.selectName) return item.selectName;
  if (item.isAll && regionCity) return regionCity;
  const name = String(item.name || "").trim();
  if (name.endsWith("全部") && regionCity) return regionCity;
  return name;
};

const decorateRegionList = (list, selected = [], regionCity = "") => {
  const set = new Set((selected || []).filter(Boolean));
  return (list || []).map((item) => {
    const selectName = resolveSelectName(item, regionCity);
    return {
  ...item,
      selectName,
      checked: selectName === "全部" ? set.size === 0 : set.has(selectName),
    };
  });
};

const getTodayValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

Page({
  data: {
    statusBarHeight: 20,
    tabBarLift: 0,
    keyword: "",
    searchedKeyword: "",
    categoryTabs: CATEGORY_TABS,
    activeCategory: "tender",
    filterRegions: [],
    filterRegionLabel: "全部",
    draftRegions: [],
    filterBusinessTypes: [],
    filterBusinessLabel: "全部筛选",
    filterInfoSource: "all",
    filterPartyAType: "all",
    filterAmountRange: "all",
    filterExpiryRange: "all",
    filterExpiryStartDate: "",
    filterExpiryEndDate: "",
    filterPropertyFormat: "all",
    filterContractPeriod: "all",
    filterAttachment: "all",
    filterTurnover: "all",
    filterStartDate: "",
    filterEndDate: "",
    today: "",
    regionPanel: "top",
    regionCity: "",
    regionList: [],
    showRegionPicker: false,
    showFilterPanel: false,
    showInfoSourcePanel: false,
    pageScrollLocked: false,
    infoSourceMaskTop: 0,
    infoSourcePanelTop: 0,
    filterMenu: "business",
    filterScrollInto: "",
    isHallCategory: false,
    filterMenus: FILTER_MENUS,
    businessTypes: BUSINESS_TYPES,
    businessTypeOptions: BUSINESS_TYPE_OPTIONS,
    businessSectionTitle: "业务类型",
    filterBusinessEmptyLabel: "全部筛选",
    partyAOptions: PARTY_A_OPTIONS,
    amountRanges: AMOUNT_RANGES,
    expiryRanges: EXPIRY_RANGES,
    propertyFormatOptions: PROPERTY_FORMAT_OPTIONS,
    contractPeriodOptions: CONTRACT_PERIOD_OPTIONS,
    attachmentOptions: ATTACHMENT_OPTIONS,
    turnoverOptions: TURNOVER_OPTIONS,
    infoSourceOptions: INFO_SOURCE_OPTIONS,
    draftBusinessTypes: [],
    draftPartyAType: "all",
    draftAmountRange: "all",
    draftExpiryRange: "all",
    draftExpiryStartDate: "",
    draftExpiryEndDate: "",
    draftPropertyFormat: "all",
    draftContractPeriod: "all",
    draftAttachment: "all",
    draftTurnover: "all",
    list: [],
    searchTotal: 0,
    searchTotalKnown: false,
    nextBeforePublishTime: "",
    allSourcesDay: "",
    allSourcesTableIndex: 0,
    searchHint: "",
    page: 1,
    pageSize: 8,
    hasMore: false,
    loading: true,
    loadingMore: false,
    refreshing: false,
    showSearchProgress: false,
    searchProgress: 0,
    errorMessage: "",
    sourceName: "招标公告",
    plapOnly: false,
  },

  onLoad(options) {
    enableShareMenu();
    const sys = wx.getSystemInfoSync();
    // Tab 页 windowHeight 通常已扣除底部菜单；仅未扣除时再抬起弹层，避免悬空留缝
    const screenH = Number(sys.screenHeight || 0);
    const windowH = Number(sys.windowHeight || 0);
    const delta = screenH > 0 && windowH > 0 ? screenH - windowH : 0;
    const tabBarLift = delta >= 40 ? 0 : 48;
    const patch = {
      statusBarHeight: sys.statusBarHeight || 20,
      tabBarLift,
      today: getTodayValue(),
      regionList: getRegionOptionsForSource(""),
    };
    if (options.keyword) patch.keyword = safeDecode(options.keyword);
    if (isValidInfoSourceKey(options.source) && options.source !== "all") {
      patch.filterInfoSource = options.source;
      patch.sourceName = getSourceLabel(options.source, patch.sourceName);
      patch.regionList = getRegionOptionsForSource(options.source);
      patch.categoryTabs = resolveCategoryTabsForSource(options.source);
    }
    if (
      STANDARD_CATEGORY_KEYS.has(options.category) ||
      QUANZHOU_CATEGORY_KEYS.has(options.category)
    ) {
      patch.activeCategory = options.category;
    }
    // 兼容旧分享链接：政策类来源落到政策公开
    if (["kjt", "gxt"].includes(options.source) || ["kjt", "gxt"].includes(options.tab)) {
      patch.activeCategory = "policy";
    }
    const sourceKey = patch.filterInfoSource || this.data.filterInfoSource || "all";
    if (!patch.categoryTabs) {
      patch.categoryTabs = resolveCategoryTabsForSource(sourceKey === "all" ? "" : sourceKey);
    }
    const activeCategory = resolveDefaultCategoryForSource(
      sourceKey === "all" ? "" : sourceKey,
      patch.activeCategory || this.data.activeCategory || "tender"
    );
    patch.activeCategory = activeCategory;
    Object.assign(patch, resolveBusinessFilterUi(activeCategory));
    patch.filterBusinessLabel = resolveBusinessFilterUi(activeCategory).filterBusinessEmptyLabel;
    if (sourceKey && sourceKey !== "all") {
      patch.sourceName = getSourceLabel(sourceKey, CATEGORY_LABELS[activeCategory] || "标讯");
    } else {
      patch.sourceName = CATEGORY_LABELS[activeCategory] || "招标公告";
    }
    this.setData(patch);

    const hasKeyword = !!String(patch.keyword || this.data.keyword || "").trim();
    const tabCache = !hasKeyword ? getBiaoxunTabCache(activeCategory, false) : null;
    const hasCache = applyBiaoxunTabCache(this, tabCache, decorateNoticeCard);
    if (hasCache) this.hydrateMemoryCacheFromTab(activeCategory, false, tabCache);
    // 实际拉数交给 onShow.refreshLatestOnOpen，避免 onLoad+onShow 双请求
  },

  onShow() {
    // switchTab 无法带 query，从详情返回时经 globalData 恢复分类
    let pending = null;
    try {
      const app = getApp();
      const category = app.globalData.biaoxunPendingCategory;
      const keyword = app.globalData.biaoxunPendingKeyword;
      const source = app.globalData.biaoxunPendingSource;
      if (category || keyword || source) {
        pending = { category, keyword, source };
        app.globalData.biaoxunPendingSource = "";
        app.globalData.biaoxunPendingCategory = "";
        app.globalData.biaoxunPendingKeyword = "";
      }
    } catch (e) {
      /* ignore */
    }
    if (pending) {
      const patch = {};
      let needReload = false;
      let nextCategory = this.data.activeCategory;
      if (
        STANDARD_CATEGORY_KEYS.has(pending.category) ||
        QUANZHOU_CATEGORY_KEYS.has(pending.category)
      ) {
        nextCategory = pending.category;
      } else if (["kjt", "gxt"].includes(pending.source)) {
        nextCategory = "policy";
      }
      if (nextCategory && nextCategory !== this.data.activeCategory) {
        patch.activeCategory = nextCategory;
        patch.sourceName = CATEGORY_LABELS[nextCategory] || this.data.sourceName;
        needReload = true;
      }
      if (pending.keyword && pending.keyword !== this.data.keyword) {
        patch.keyword = pending.keyword;
        needReload = true;
      }
      if (
        pending.source &&
        pending.source !== "all" &&
        isValidInfoSourceKey(pending.source) &&
        pending.source !== this.data.filterInfoSource
      ) {
        patch.filterInfoSource = pending.source;
        patch.categoryTabs = resolveCategoryTabsForSource(pending.source);
        nextCategory = resolveDefaultCategoryForSource(pending.source, nextCategory);
        patch.activeCategory = nextCategory;
        patch.sourceName = getSourceLabel(
          pending.source,
          CATEGORY_LABELS[nextCategory] || this.data.sourceName
        );
        patch.regionList = getRegionOptionsForSource(pending.source);
        Object.assign(patch, CLEAR_REGION_FILTERS);
        needReload = true;
      } else if (QUANZHOU_CATEGORY_KEYS.has(nextCategory)) {
        patch.categoryTabs = QUANZHOU_CATEGORY_TABS;
        if ((this.data.filterInfoSource || "all") !== "quanzhou") {
          patch.filterInfoSource = "quanzhou";
          patch.sourceName = getSourceLabel("quanzhou", CATEGORY_LABELS[nextCategory]);
          patch.regionList = getRegionOptionsForSource("quanzhou");
          needReload = true;
        }
      }
      if (patch.activeCategory || nextCategory !== this.data.activeCategory) {
        const cat = patch.activeCategory || nextCategory;
        Object.assign(patch, resolveBusinessFilterUi(cat));
        if (needReload) {
          patch.filterBusinessTypes = [];
          patch.filterBusinessLabel = resolveBusinessFilterUi(cat).filterBusinessEmptyLabel;
        }
      }
      if (needReload) {
        const nextData = { ...this.data, ...patch };
        const hasKeyword = !!String(nextData.keyword || "").trim();
        const category = nextData.activeCategory || "tender";
        const tabCache = !hasKeyword
          ? getBiaoxunTabCache(category, !!nextData.plapOnly)
          : null;
        this.setData(patch, () => {
          const hasCache = applyBiaoxunTabCache(this, tabCache, decorateNoticeCard);
          if (hasCache) this.hydrateMemoryCacheFromTab(category, !!nextData.plapOnly, tabCache);
          this.loadList(hasCache, false, 0, { skipIfFresh: false, force: true });
        });
        return;
      }
      if (Object.keys(patch).length) this.setData(patch);
    }

    // 切回标讯 Tab：有缓存先铺底，再静默强制拉最新
    if (this.isDefaultListState() || !(this.data.list || []).length) {
      const tabCache = getBiaoxunTabCache(
        this.data.activeCategory || "tender",
        !!this.data.plapOnly
      );
      if (!(this.data.list || []).length) {
        const hasCache = applyBiaoxunTabCache(this, tabCache, decorateNoticeCard);
        if (hasCache) {
          this.hydrateMemoryCacheFromTab(
            this.data.activeCategory || "tender",
            !!this.data.plapOnly,
            tabCache
          );
        }
      }
    }
    this.refreshLatestOnOpen();
  },

  refreshLatestOnOpen() {
    if (this.isPageGestureLocked()) return;
    if (this._openingRefreshTimer) {
      clearTimeout(this._openingRefreshTimer);
      this._openingRefreshTimer = null;
    }
    this._openingRefreshTimer = setTimeout(() => {
      this._openingRefreshTimer = null;
      const category = this.data.activeCategory || "tender";
      const hasList = (this.data.list || []).length > 0;
      const tabFresh =
        this.isDefaultListState() &&
        isBiaoxunTabFresh(getBiaoxunTabCache(category, !!this.data.plapOnly));

      if (tabFresh && hasList) {
        return;
      }
      if (!hasList) {
        this.loadList(false, false, 0, { skipIfFresh: false, force: true });
        return;
      }
      this.loadList(true, false, 0, { skipIfFresh: false, force: true });
    }, 80);
  },

  isListRequestBusy() {
    return !!(this._requestPending || this._queuedLoadList || this._scheduledRetry);
  },

  waitUntilListIdle() {
    if (!this.isListRequestBusy()) return Promise.resolve();
    return new Promise((resolve) => {
      if (!this._listIdleWaiters) this._listIdleWaiters = [];
      this._listIdleWaiters.push(resolve);
    });
  },

  notifyListIdle() {
    if (this.isListRequestBusy()) return;
    const waiters = this._listIdleWaiters;
    if (!waiters || !waiters.length) return;
    this._listIdleWaiters = [];
    waiters.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        // ignore
      }
    });
  },

  finishPullDownRefresh(startedAt = Date.now()) {
    const delay = Math.max(0, 480 - (Date.now() - startedAt));
    const done = () => {
      if (this.data.refreshing) this.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    };
    if (delay) setTimeout(done, delay);
    else done();
  },

  onPullDownRefresh() {
    if (this.isPageGestureLocked()) {
      wx.stopPullDownRefresh();
      return;
    }
    const startedAt = Date.now();
    const hasList = (this.data.list || []).length > 0;
    if (hasList) {
      this.setData({ refreshing: true, errorMessage: "" });
    }
    // 已有请求在飞时 loadList 会排队并立刻 resolve，必须等到真正空闲再收动画
    this.loadList(hasList, false, 0, { skipIfFresh: false, force: true });
    this.waitUntilListIdle().finally(() => this.finishPullDownRefresh(startedAt));
  },

  onReachBottom() {
    if (this.isPageGestureLocked()) return;
    this.loadList(true, true);
  },

  /** 列表就绪后静默预取下一页，减少上拉等待 */
  prefetchNextPageIfNeeded() {
    if (this.isPageGestureLocked()) return;
    if (String(this.data.keyword || "").trim()) return;
    if ((this.data.filterInfoSource || "all") === "all" && !this.data.filterStartDate && !this.data.filterEndDate) {
      return;
    }
    if (!this.data.hasMore) return;
    const beforePublishTime = String(this.data.nextBeforePublishTime || "").trim();
    if (!beforePublishTime) return;
    const cacheKey = `${this.buildListCacheKey()}\u0001next\u0001${beforePublishTime}`;
    if (getBiaoxunNextPageCache(cacheKey)) return;

    const keyword = String(this.data.keyword || "").trim();
    const categoryGroup = this.currentCategoryGroup();
    const plapOnly = !!this.data.plapOnly;
    const source =
      plapOnly && categoryGroup !== "policy"
        ? "plap"
        : this.data.filterInfoSource && this.data.filterInfoSource !== "all"
          ? this.data.filterInfoSource
          : "";
    if ((plapOnly || source === "plap") && categoryGroup === "policy") return;

    const regions = expandRegionsForApi(this.data.filterRegions);
    prefetchBiaoxunNextPage(cacheKey, {
      keyword,
      source,
      excludePlap: !plapOnly && source !== "plap",
      categoryGroup,
      regions,
      region: regions[0] || "",
      businessTypes: this.data.filterBusinessTypes || [],
      partyAType:
        this.data.filterPartyAType && this.data.filterPartyAType !== "all"
          ? this.data.filterPartyAType
          : "",
      amountRange:
        this.data.filterAmountRange && this.data.filterAmountRange !== "all"
          ? this.data.filterAmountRange
          : "",
      expiryRange:
        this.data.filterExpiryRange && this.data.filterExpiryRange !== "all"
          ? this.data.filterExpiryRange
          : "",
      expiryStartDate: this.data.filterExpiryStartDate || "",
      expiryEndDate: this.data.filterExpiryEndDate || "",
      propertyFormat:
        this.data.filterPropertyFormat && this.data.filterPropertyFormat !== "all"
          ? this.data.filterPropertyFormat
          : "",
      contractPeriod:
        this.data.filterContractPeriod && this.data.filterContractPeriod !== "all"
          ? this.data.filterContractPeriod
          : "",
      attachmentFilter:
        this.data.filterAttachment && this.data.filterAttachment !== "all"
          ? this.data.filterAttachment
          : "",
      turnoverFilter:
        this.data.filterTurnover && this.data.filterTurnover !== "all"
          ? this.data.filterTurnover
          : "",
      page: 1,
      pageSize: this.data.pageSize,
      startDate: this.data.filterStartDate,
      endDate: this.data.filterEndDate,
      beforePublishTime,
    });
  },

  /** 列表加载后最多预取 1 条详情，避免启动时批量打库 */
  prefetchVisibleDetails() {
    const list = this.data.list || [];
    const item = list.find((row) => row?.id);
    if (!item?.id) return;
    prefetchBiaoxunDetail(item.id, item.sourceCode || item.source || "");
  },

  isPageGestureLocked() {
    return !!(
      this.data.showInfoSourcePanel ||
      this.data.showFilterPanel ||
      this.data.showRegionPicker
    );
  },

  syncPageScrollLock() {
    const locked = this.isPageGestureLocked();
    if (this.data.pageScrollLocked !== locked) {
      this.setData({ pageScrollLocked: locked });
    }
  },

  onUnload() {
    this.clearSearchProgressTimer();
    if (this._openingRefreshTimer) {
      clearTimeout(this._openingRefreshTimer);
      this._openingRefreshTimer = null;
    }
    if (this._categorySwitchTimer) {
      clearTimeout(this._categorySwitchTimer);
      this._categorySwitchTimer = null;
    }
    this._requestPending = false;
    this._queuedLoadList = null;
    this._scheduledRetry = false;
    this.notifyListIdle();
  },

  clearSearchProgressTimer() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
    if (this._progressFinishTimer) {
      clearTimeout(this._progressFinishTimer);
      this._progressFinishTimer = null;
    }
    if (this._searchWatchdog) {
      clearTimeout(this._searchWatchdog);
      this._searchWatchdog = null;
    }
  },

  startSearchProgress(keyword) {
    this.clearSearchProgressTimer();
    if (!keyword) {
      this.setData({ showSearchProgress: false, searchProgress: 0 });
      return;
    }
    this.setData({ showSearchProgress: true, searchProgress: 8 });
    // 伪进度缓慢爬到 99%，真正结束时再到 100%；避免长时间停在某一固定值像卡住
    this._progressTimer = setInterval(() => {
      const cur = Number(this.data.searchProgress || 0);
      if (cur >= 99) return;
      const remain = 99 - cur;
      const step = cur < 70 ? Math.max(1.2, remain * 0.09) : Math.max(0.15, remain * 0.04);
      this.setData({ searchProgress: Math.min(99, Math.round((cur + step) * 10) / 10) });
    }, 200);
  },

  finishSearchProgress() {
    return new Promise((resolve) => {
      if (this._progressTimer) {
        clearInterval(this._progressTimer);
        this._progressTimer = null;
      }
      if (this._searchWatchdog) {
        clearTimeout(this._searchWatchdog);
        this._searchWatchdog = null;
      }
      if (!this.data.showSearchProgress) {
        resolve();
        return;
      }
      this.setData({ searchProgress: 100 });
      this._progressFinishTimer = setTimeout(() => {
        this._progressFinishTimer = null;
        this.setData({ showSearchProgress: false, searchProgress: 0 });
        resolve();
      }, 80);
    });
  },

  abortSearchProgress() {
    this.clearSearchProgressTimer();
    this.setData({ showSearchProgress: false, searchProgress: 0 });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    const keyword = String(this.data.keyword || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (this._searchDebounceTimer) {
      clearTimeout(this._searchDebounceTimer);
      this._searchDebounceTimer = null;
    }
    if (keyword && keyword.length < 2) {
      wx.showToast({ title: "请至少输入 2 个字", icon: "none" });
      return;
    }
    if (keyword) {
      const cacheKey = this.buildListCacheKey({ ...this.data, keyword });
      const cached = this.readListCache(cacheKey);
      if (
        cached &&
        cached.searchedKeyword === keyword &&
        Date.now() - Number(cached.savedAt || 0) < SEARCH_CACHE_TTL_MS
      ) {
        this.applyListCachePayload(cached);
        return;
      }
      this.startSearchProgress(keyword);
    } else {
      this.abortSearchProgress();
    }
    this.setData(
      {
        keyword,
        ...(keyword
          ? {
              loading: true,
              searchedKeyword: keyword,
              searchTotal: 0,
              searchTotalKnown: false,
              searchHint: "",
            }
          : {}),
      },
      () => {
        this._searchDebounceTimer = setTimeout(() => {
          this._searchDebounceTimer = null;
          this.loadList(false, false, 0);
        }, 50);
      }
    );
  },

  clearSearch() {
    if (this._searchDebounceTimer) {
      clearTimeout(this._searchDebounceTimer);
      this._searchDebounceTimer = null;
    }
    this.setData({ keyword: "" }, () => this.loadList(false, false, 0));
  },

  currentCategoryGroup() {
    return this.data.activeCategory || "tender";
  },

  buildListCacheKey(data = this.data) {
    const keyword = String(data.keyword || "").trim();
    const category = data.activeCategory || "tender";
    const business = Array.isArray(data.filterBusinessTypes)
      ? [...data.filterBusinessTypes].sort().join(",")
      : "";
    return [
      category,
      keyword,
      Array.isArray(data.filterRegions) ? [...data.filterRegions].sort().join(",") : "",
      business,
      data.filterInfoSource || "all",
      data.filterPartyAType || "all",
      data.filterAmountRange || "all",
      data.filterExpiryRange || "all",
      data.filterExpiryStartDate || "",
      data.filterExpiryEndDate || "",
      data.filterPropertyFormat || "all",
      data.filterContractPeriod || "all",
      data.filterAttachment || "all",
      data.filterTurnover || "all",
      data.filterStartDate || "",
      data.filterEndDate || "",
      data.allSourcesDay || "",
      String(data.allSourcesTableIndex || 0),
      data.plapOnly ? "plapOnly" : "mixed",
    ].join("\u0001");
  },

  isDefaultListState(data = this.data) {
    const keyword = String(data.keyword || "").trim();
    if (keyword) return false;
    if ((data.filterRegions || []).length) return false;
    if ((data.filterBusinessTypes || []).length) return false;
    if ((data.filterInfoSource || "all") !== "all") return false;
    if ((data.filterPartyAType || "all") !== "all") return false;
    if ((data.filterAmountRange || "all") !== "all") return false;
    if ((data.filterExpiryRange || "all") !== "all") return false;
    if (data.filterExpiryStartDate || data.filterExpiryEndDate) return false;
    if ((data.filterPropertyFormat || "all") !== "all") return false;
    if ((data.filterContractPeriod || "all") !== "all") return false;
    if ((data.filterAttachment || "all") !== "all") return false;
    if ((data.filterTurnover || "all") !== "all") return false;
    if (data.filterStartDate || data.filterEndDate) return false;
    return true;
  },

  ensureListCache() {
    if (!this._listCache) this._listCache = Object.create(null);
    return this._listCache;
  },

  hydrateMemoryCacheFromTab(category, plapOnly, tabCache) {
    if (!tabCache || !Array.isArray(tabCache.list) || !tabCache.list.length) return;
    const key = this.buildListCacheKey({
      ...this.data,
      ...DEFAULT_LIST_FILTERS,
      activeCategory: category,
      keyword: "",
      filterBusinessTypes: [],
      plapOnly: !!plapOnly,
    });
    const list = tabCache.list
      .map((item) => (item && item.categoryLabel ? item : decorateNoticeCard(item)))
      .filter((item) => item && item.id);
    if (!list.length) return;
    this.ensureListCache()[key] = {
      list,
      page: Number(tabCache.page || 1),
      hasMore: !!tabCache.hasMore,
      nextBeforePublishTime: String(tabCache.nextBeforePublishTime || ""),
      sourceName: String(tabCache.sourceName || CATEGORY_LABELS[category] || ""),
      searchedKeyword: "",
      searchHint: String(tabCache.searchHint || ""),
      searchTotal: Number(tabCache.searchTotal || 0),
      searchTotalKnown: !!tabCache.searchTotalKnown,
      savedAt: Number(tabCache.savedAt || tabCache.cachedAt || Date.now()),
    };
  },

  saveListCache() {
    const list = this.data.list || [];
    if (!list.length) return;
    const key = this.buildListCacheKey();
    const payload = {
      list,
      page: this.data.page || 1,
      hasMore: !!this.data.hasMore,
      nextBeforePublishTime: this.data.nextBeforePublishTime || "",
      allSourcesDay: this.data.allSourcesDay || "",
      allSourcesTableIndex: Number(this.data.allSourcesTableIndex || 0),
      sourceName: this.data.sourceName || "",
      searchedKeyword: this.data.searchedKeyword || "",
      searchHint: this.data.searchHint || "",
      searchTotal: this.data.searchTotal || 0,
      searchTotalKnown: !!this.data.searchTotalKnown,
      savedAt: Date.now(),
    };
    this.ensureListCache()[key] = payload;
    // 默认筛选的四个分类写入用户本地缓存，供冷启动/切页复用
    if (this.isDefaultListState()) {
      setBiaoxunTabCache(this.data.activeCategory || "tender", !!this.data.plapOnly, payload);
    }
  },

  readListCache(key) {
    const hit = this.ensureListCache()[key];
    if (hit && Array.isArray(hit.list) && hit.list.length) return hit;
    return null;
  },

  readTabPersistentCache(category, plapOnly) {
    if ((this.data.filterInfoSource || "all") !== "all") return null;
    const tabCache = getBiaoxunTabCache(category, plapOnly);
    if (!tabCache) return null;
    this.hydrateMemoryCacheFromTab(category, plapOnly, tabCache);
    const key = this.buildListCacheKey({
      ...this.data,
      ...DEFAULT_LIST_FILTERS,
      activeCategory: category,
      keyword: "",
      filterBusinessTypes: [],
      plapOnly: !!plapOnly,
    });
    return this.readListCache(key);
  },

  invalidateListCache(key) {
    if (!this._listCache) return;
    if (key) delete this._listCache[key];
    else this._listCache = Object.create(null);
  },

  applyListCachePayload(cached, extraPatch = {}) {
    if (!cached || !Array.isArray(cached.list) || !cached.list.length) return false;
    this.setData({
      ...extraPatch,
      list: cached.list,
      page: cached.page || 1,
      hasMore: !!cached.hasMore,
      nextBeforePublishTime: cached.nextBeforePublishTime || "",
      allSourcesDay: cached.allSourcesDay || "",
      allSourcesTableIndex: Number(cached.allSourcesTableIndex || 0),
      searchedKeyword: cached.searchedKeyword || "",
      searchHint: cached.searchHint || "",
      searchTotal: cached.searchTotal || 0,
      searchTotalKnown: !!cached.searchTotalKnown,
      sourceName: cached.sourceName || extraPatch.sourceName || this.data.sourceName,
      loading: false,
      loadingMore: false,
      errorMessage: "",
    });
    setTimeout(() => {
      this.prefetchVisibleDetails();
    }, 800);
    return true;
  },

  silentRefreshLatest() {
    return this.loadList(true, false, 0, { skipIfFresh: false, force: true });
  },

  businessLabel(types, category = "") {
    const selected = Array.isArray(types) ? types : [];
    const ui = resolveBusinessFilterUi(category || this.data.activeCategory);
    if (!selected.length) return ui.filterBusinessEmptyLabel;
    if (selected.length === 1) {
      const hit = (ui.businessTypes || []).find((item) => item.key === selected[0]);
      if (!hit) return ui.filterBusinessEmptyLabel;
      return ui.isHallCategory ? `项目类型 ${hit.label}` : hit.label;
    }
    return ui.isHallCategory ? `项目类型 ${selected.length}` : `筛选 ${selected.length}`;
  },

  applyBusinessFilterUi(category = "", extra = {}) {
    const ui = resolveBusinessFilterUi(category);
    return {
      ...ui,
      filterBusinessLabel: this.businessLabel(
        extra.filterBusinessTypes != null
          ? extra.filterBusinessTypes
          : this.data.filterBusinessTypes,
        category
      ),
      ...extra,
    };
  },

  switchCategory(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeCategory) return;
    // 离开前缓存当前分类已加载结果
    this.saveListCache();

    // 切换分类立即作废在飞请求，避免堆积堵塞
    this._requestSeq = (this._requestSeq || 0) + 1;
    this._requestPending = false;
    this._queuedLoadList = null;
    this._scheduledRetry = false;
    this.notifyListIdle();
    if (this._categorySwitchTimer) {
      clearTimeout(this._categorySwitchTimer);
      this._categorySwitchTimer = null;
    }

    const nextBase = {
      activeCategory: key,
      sourceName: this.data.plapOnly
        ? "军队采购网"
        : (() => {
            const src = this.data.filterInfoSource || "all";
            if (src !== "all") {
              const hit = INFO_SOURCE_OPTIONS.find((item) => item.key === src);
              return hit ? hit.label : CATEGORY_LABELS[key] || "标讯";
            }
            return CATEGORY_LABELS[key] || "标讯";
          })(),
      ...DEFAULT_LIST_FILTERS,
      filterInfoSource: this.data.filterInfoSource || "all",
      filterBusinessTypes: [],
      ...this.applyBusinessFilterUi(key, { filterBusinessTypes: [] }),
      regionList: getRegionOptionsForSource(resolveListSourceKey(this.data)),
      regionPanel: "top",
      regionCity: "",
      showRegionPicker: false,
      showFilterPanel: false,
      errorMessage: "",
      loadingMore: false,
    };
    const cacheKey = this.buildListCacheKey({
      ...this.data,
      ...nextBase,
      filterBusinessTypes: [],
    });
    const skipCache = !!this.data.plapOnly && key === "policy";
    let cached = skipCache ? null : this.readListCache(cacheKey);
    if (!cached && !skipCache) {
      cached = this.readTabPersistentCache(key, !!this.data.plapOnly);
    }

    const silentForceRefresh = () => {
      this._categorySwitchTimer = setTimeout(() => {
        this._categorySwitchTimer = null;
        // 保留刚展示的缓存列表，静默拉最新后再替换
        this.silentRefreshLatest();
      }, 80);
    };

    if (cached) {
      this.setData({
        ...nextBase,
        list: cached.list,
        page: cached.page || 1,
        hasMore: !!cached.hasMore,
      nextBeforePublishTime: cached.nextBeforePublishTime || "",
      allSourcesDay: cached.allSourcesDay || "",
      allSourcesTableIndex: Number(cached.allSourcesTableIndex || 0),
      searchedKeyword: cached.searchedKeyword || "",
        searchHint: cached.searchHint || "",
        searchTotal: cached.searchTotal || 0,
        searchTotalKnown: !!cached.searchTotalKnown,
        sourceName: cached.sourceName || nextBase.sourceName,
        loading: false,
      });
      silentForceRefresh();
      return;
    }

    this.setData(
      {
        ...nextBase,
        list: [],
        page: 1,
        hasMore: false,
        nextBeforePublishTime: "",
        loading: true,
      },
      () => {
        this._categorySwitchTimer = setTimeout(() => {
          this._categorySwitchTimer = null;
          this.loadList(false, false, 0, { skipIfFresh: false, force: true });
        }, 80);
      }
    );
  },

  openFilterPanel(e) {
    const menu =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.menu) ||
      "business";
    this.openFilterWithMenu(menu);
  },

  openFilterWithMenu(menu) {
    const allowed = {
      business: 1,
      partyA: 1,
      amount: 1,
      expiry: 1,
      property: 1,
      contract: 1,
      attachment: 1,
      turnover: 1,
    };
    const key = allowed[menu] ? menu : "business";
    this.setData(
      {
        showFilterPanel: true,
        showRegionPicker: false,
        showInfoSourcePanel: false,
        filterMenu: key,
        filterScrollInto: "",
        draftBusinessTypes: [...(this.data.filterBusinessTypes || [])],
        draftPartyAType: this.data.filterPartyAType || "all",
        draftAmountRange: this.data.filterAmountRange || "all",
        draftExpiryRange: this.data.filterExpiryRange || "all",
        draftExpiryStartDate: this.data.filterExpiryStartDate || "",
        draftExpiryEndDate: this.data.filterExpiryEndDate || "",
        draftPropertyFormat: this.data.filterPropertyFormat || "all",
        draftContractPeriod: this.data.filterContractPeriod || "all",
        draftAttachment: this.data.filterAttachment || "all",
        draftTurnover: this.data.filterTurnover || "all",
      },
      () => {
        this.syncPageScrollLock();
        this.scrollFilterTo(key);
      }
    );
  },

  scrollFilterTo(key) {
    if (!key) return;
    // 先清空再设置，确保重复点击同一项也会滚动
    this.setData({ filterScrollInto: "" }, () => {
      setTimeout(() => {
        if (!this.data.showFilterPanel) return;
        this.setData({
          filterMenu: key,
          filterScrollInto: `sec-${key}`,
        });
      }, 30);
    });
  },

  closeFilterPanel() {
    this.setData({ showFilterPanel: false, filterScrollInto: "" }, () => this.syncPageScrollLock());
  },

  switchFilterMenu(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.scrollFilterTo(key);
  },

  toggleDraftBusiness(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === "all") {
      this.setData({ draftBusinessTypes: [] });
      return;
    }
    // 竞价大厅标的类型：官网为单选
    if (this.data.isHallCategory || this.data.activeCategory === "hall") {
      const current = (this.data.draftBusinessTypes || [])[0];
      this.setData({ draftBusinessTypes: current === key ? [] : [key] });
      return;
    }
    const selected = [...(this.data.draftBusinessTypes || [])];
    const index = selected.indexOf(key);
    if (index >= 0) selected.splice(index, 1);
    else selected.push(key);
    this.setData({ draftBusinessTypes: selected });
  },

  clearDraftBusiness() {
    this.setData({ draftBusinessTypes: [] });
  },

  pickInfoSource(e) {
    const key = e.currentTarget.dataset.key || "all";
    const same = key === (this.data.filterInfoSource || "all");
    if (same) {
      this.setData({ showInfoSourcePanel: false }, () => this.syncPageScrollLock());
      return;
    }
    const hit = INFO_SOURCE_OPTIONS.find((item) => item.key === key);
    const nextCategory = resolveDefaultCategoryForSource(
      key === "all" ? "" : key,
      this.data.activeCategory
    );
    const sourceName =
      key === "all"
        ? CATEGORY_LABELS[nextCategory] || "标讯"
        : hit
          ? hit.label
          : "标讯";
    const nextPatch = {
      filterInfoSource: key,
      activeCategory: nextCategory,
      categoryTabs: resolveCategoryTabsForSource(key === "all" ? "" : key),
      sourceName,
      showInfoSourcePanel: false,
      regionList: getRegionOptionsForSource(
        this.data.plapOnly ? "plap" : key && key !== "all" ? key : ""
      ),
      ...CLEAR_REGION_FILTERS,
      filterBusinessTypes: [],
      ...resolveBusinessFilterUi(nextCategory),
      filterBusinessLabel: resolveBusinessFilterUi(nextCategory).filterBusinessEmptyLabel,
    };
    const cacheKey = this.buildListCacheKey({
      ...this.data,
      ...nextPatch,
    });
    const cached = this.readListCache(cacheKey);

    if (cached) {
      // 先展示该信息源本地缓存，再静默拉最新
      this.applyListCachePayload(cached, nextPatch);
      this.syncPageScrollLock();
      this.silentRefreshLatest();
      return;
    }

    this.setData(
      {
        ...nextPatch,
        list: [],
        page: 1,
        hasMore: false,
        nextBeforePublishTime: "",
        loading: true,
        errorMessage: "",
      },
      () => {
        this.syncPageScrollLock();
        this.loadList(false, false, 0, { skipIfFresh: false, force: true });
      }
    );
  },

  toggleInfoSourcePanel() {
    if (this.data.showInfoSourcePanel) {
      this.setData({ showInfoSourcePanel: false }, () => this.syncPageScrollLock());
      return;
    }
    const query = wx.createSelectorQuery();
    query.select(".info-source-wrap").boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      const bottom = rect && rect.bottom ? Number(rect.bottom) : 160;
      this.setData(
        {
          showInfoSourcePanel: true,
          infoSourceMaskTop: bottom,
          infoSourcePanelTop: bottom + 6,
          showRegionPicker: false,
          showFilterPanel: false,
        },
        () => this.syncPageScrollLock()
      );
    });
  },

  closeInfoSourcePanel() {
    if (!this.data.showInfoSourcePanel) return;
    this.setData({ showInfoSourcePanel: false }, () => this.syncPageScrollLock());
  },

  pickDraftPartyA(e) {
    const key = e.currentTarget.dataset.key || "all";
    this.setData({ draftPartyAType: key });
  },

  pickDraftAmount(e) {
    const key = e.currentTarget.dataset.key || "all";
    this.setData({ draftAmountRange: key });
  },

  pickDraftExpiry(e) {
    const key = e.currentTarget.dataset.key || "all";
    const patch = { draftExpiryRange: key };
    if (key !== "custom") {
      patch.draftExpiryStartDate = "";
      patch.draftExpiryEndDate = "";
    }
    this.setData(patch);
  },

  onDraftExpiryStartChange(e) {
    const value = String(e.detail.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const patch = {
      draftExpiryRange: "custom",
      draftExpiryStartDate: value,
    };
    if (!this.data.draftExpiryEndDate || this.data.draftExpiryEndDate < value) {
      patch.draftExpiryEndDate = value;
    }
    this.setData(patch);
  },

  onDraftExpiryEndChange(e) {
    const value = String(e.detail.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const patch = {
      draftExpiryRange: "custom",
      draftExpiryEndDate: value,
    };
    if (!this.data.draftExpiryStartDate || this.data.draftExpiryStartDate > value) {
      patch.draftExpiryStartDate = value;
    }
    this.setData(patch);
  },

  pickDraftProperty(e) {
    const key = e.currentTarget.dataset.key || "all";
    this.setData({ draftPropertyFormat: key });
  },

  pickDraftContract(e) {
    const key = e.currentTarget.dataset.key || "all";
    this.setData({ draftContractPeriod: key });
  },

  pickDraftAttachment(e) {
    const key = e.currentTarget.dataset.key || "all";
    this.setData({ draftAttachment: key });
  },

  pickDraftTurnover(e) {
    const key = e.currentTarget.dataset.key || "all";
    this.setData({ draftTurnover: key });
  },

  resetFilterDraft() {
    this.setData(
      {
        draftBusinessTypes: [],
        draftPartyAType: "all",
        draftAmountRange: "all",
        draftExpiryRange: "all",
        draftExpiryStartDate: "",
        draftExpiryEndDate: "",
        draftPropertyFormat: "all",
        draftContractPeriod: "all",
        draftAttachment: "all",
        draftTurnover: "all",
        filterMenu: "business",
        filterScrollInto: "",
      },
      () => this.scrollFilterTo("business")
    );
  },

  confirmFilterPanel() {
    const businessTypes = [...(this.data.draftBusinessTypes || [])];
    this.setData(
      {
        filterBusinessTypes: businessTypes,
        filterBusinessLabel: this.businessLabel(businessTypes),
        filterPartyAType: this.data.draftPartyAType || "all",
        filterAmountRange: this.data.draftAmountRange || "all",
        filterExpiryRange: this.data.draftExpiryRange || "all",
        filterExpiryStartDate:
          this.data.draftExpiryRange === "custom" ? this.data.draftExpiryStartDate || "" : "",
        filterExpiryEndDate:
          this.data.draftExpiryRange === "custom" ? this.data.draftExpiryEndDate || "" : "",
        filterPropertyFormat: this.data.draftPropertyFormat || "all",
        filterContractPeriod: this.data.draftContractPeriod || "all",
        filterAttachment: this.data.draftAttachment || "all",
        filterTurnover: this.data.draftTurnover || "all",
        showFilterPanel: false,
        filterScrollInto: "",
      },
      () => {
        this.syncPageScrollLock();
    this.loadList(false, false);
      }
    );
  },

  openRegionPicker() {
    const source = resolveListSourceKey(this.data);
    const draftRegions = [...(this.data.filterRegions || [])];
    const topList = decorateRegionList(
      [{ name: "全部", hasChildren: false, selectName: "全部" }, ...getRegionOptionsForSource(source)],
      draftRegions
    );
    this.setData(
      {
        showRegionPicker: true,
        showFilterPanel: false,
        showInfoSourcePanel: false,
        regionPanel: "top",
        regionCity: "",
        draftRegions,
        regionList: topList,
      },
      () => this.syncPageScrollLock()
    );
  },

  closePickers() {
    this.setData(
      {
        showRegionPicker: false,
        regionPanel: "top",
        regionCity: "",
        draftRegions: [...(this.data.filterRegions || [])],
      },
      () => this.syncPageScrollLock()
    );
  },

  backRegionPanel() {
    const draftRegions = this.data.draftRegions || [];
    // 福州市/厦门市… 二级返回福建省；福建省返回全国
    if (isFujianCityName(this.data.regionCity)) {
      this.setData({
        regionPanel: "city",
        regionCity: "福建省",
        regionList: decorateRegionList(getFujianProvinceChildren(), draftRegions, "福建省"),
      });
      return;
    }
    const source = resolveListSourceKey(this.data);
    const topList = decorateRegionList(
      [{ name: "全部", hasChildren: false, selectName: "全部" }, ...getRegionOptionsForSource(source)],
      draftRegions
    );
    this.setData({
      regionPanel: "top",
      regionCity: "",
      regionList: topList,
    });
  },

  // 点名称：有下级则进入细分，否则勾选
  pickRegion(e) {
    const name = e.currentTarget.dataset.name || "全部";
    const hasChildren = String(e.currentTarget.dataset.children || "") === "1";
    const draftRegions = this.data.draftRegions || [];
    if (hasChildren) {
      const nextCity = name;
      const nextList =
        name === "福建省" ? getFujianProvinceChildren() : getRegionChildren(name);
      this.setData({
        regionPanel: "city",
        regionCity: nextCity,
        regionList: decorateRegionList(nextList, draftRegions, nextCity),
      });
      return;
    }
    this.toggleRegionCheck(e);
  },

  // 点右侧勾选框：多选切换
  toggleRegionCheck(e) {
    const selectName = String(e.currentTarget.dataset.select || e.currentTarget.dataset.name || "").trim();
    if (!selectName) return;
    let draftRegions = [...(this.data.draftRegions || [])];
    if (selectName === "全部") {
      draftRegions = [];
    } else {
      const idx = draftRegions.indexOf(selectName);
      if (idx >= 0) draftRegions.splice(idx, 1);
      else draftRegions.push(selectName);
    }
    const list = decorateRegionList(this.data.regionList, draftRegions, this.data.regionCity);
    this.setData({ draftRegions, regionList: list });
  },

  resetRegionDraft() {
    const source = resolveListSourceKey(this.data);
    const topList = decorateRegionList(
      [{ name: "全部", hasChildren: false, selectName: "全部" }, ...getRegionOptionsForSource(source)],
      []
    );
    this.setData({
      draftRegions: [],
      regionPanel: "top",
      regionCity: "",
      regionList: topList,
    });
  },

  confirmRegionPicker() {
    const filterRegions = [...(this.data.draftRegions || [])];
    this.setData(
      {
        filterRegions,
        filterRegionLabel: formatRegionLabel(filterRegions),
        showRegionPicker: false,
        regionPanel: "top",
        regionCity: "",
      },
      () => this.loadList(false, false)
    );
  },

  onStartDateChange(e) {
    const value = String(e.detail.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const patch = {
      filterStartDate: value,
      showRegionPicker: false,
    };
    if (!this.data.filterEndDate || this.data.filterEndDate < value) {
      patch.filterEndDate = value;
    }
    this.setData(patch, () => this.loadList(false, false));
  },

  onEndDateChange(e) {
    const value = String(e.detail.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const patch = {
      filterEndDate: value,
      showRegionPicker: false,
    };
    if (!this.data.filterStartDate || this.data.filterStartDate > value) {
      patch.filterStartDate = value;
    }
    this.setData(patch, () => this.loadList(false, false));
  },

  clearAllFilters() {
    this.setData(
      {
        keyword: "",
        ...DEFAULT_LIST_FILTERS,
        draftRegions: [],
        showRegionPicker: false,
        showFilterPanel: false,
        showInfoSourcePanel: false,
      },
      () => {
        this.syncPageScrollLock();
        this.loadList(false, false);
      }
    );
  },

  noop() {},

  retryLoad() {
    this.loadList(false, false);
  },

  loadList(silent = false, append = false, retryCount = 0, options = {}) {
    // 搜索请求允许覆盖尚未完成的旧请求，旧结果通过 requestSeq 自动丢弃；
    // 只有上拉分页需要防止重复并发加载。
    if (append && (this._requestPending || this.data.loadingMore)) {
      return Promise.resolve();
    }
    // 某些情况下服务端 hasMore 可能为 false，但仍返回 nextBeforePublishTime 游标。
    // 仅当「无游标」时才直接认为没有更多，避免上拉卡死。
    if (
      append &&
      !this.data.hasMore &&
      !String(this.data.nextBeforePublishTime || "").trim()
    ) {
      return Promise.resolve();
    }

    // 非分页加载时，若已有请求在飞，直接排队最后一次，避免连续点击/筛选导致并发堆叠。
    if (!append && this._requestPending) {
      this._queuedLoadList = { silent: !!silent, append: false, retryCount: 0, options };
      const keyword = String(this.data.keyword || "").trim();
      if (!silent && keyword) this.startSearchProgress(keyword);
      return this.waitUntilListIdle();
    }

    const keyword = String(this.data.keyword || "").trim();
    const categoryGroup = this.currentCategoryGroup();
    const plapOnly = !!this.data.plapOnly;
    const appendDepth = Math.max(0, Number(options.appendDepth || 0));

    if (!append && !options.force && keyword) {
      const cacheKey = this.buildListCacheKey();
      const cached = this.readListCache(cacheKey);
      if (
        cached &&
        cached.searchedKeyword === keyword &&
        Date.now() - Number(cached.savedAt || 0) < SEARCH_CACHE_TTL_MS
      ) {
        this.applyListCachePayload(cached);
        if (!silent) this.finishSearchProgress();
        return Promise.resolve();
      }
    }

    // 默认列表且本地缓存未过期：直接复用，不重复请求（下拉 force 除外）
    if (
      !append &&
      !options.force &&
      options.skipIfFresh &&
      this.isDefaultListState() &&
      isBiaoxunTabFresh(getBiaoxunTabCache(categoryGroup, plapOnly)) &&
      (this.data.list || []).length > 0
    ) {
      this.setData({ loading: false, loadingMore: false, errorMessage: "" });
      return Promise.resolve();
    }
    // 政策公开仅工信厅/科技厅；军队采购网模式下不查 plap，避免与中标列表混同
    const source =
      plapOnly && categoryGroup !== "policy"
        ? "plap"
        : this.data.filterInfoSource && this.data.filterInfoSource !== "all"
          ? this.data.filterInfoSource
          : "";
    if ((plapOnly || source === "plap") && categoryGroup === "policy") {
      if (this._searchWatchdog) {
        clearTimeout(this._searchWatchdog);
        this._searchWatchdog = null;
      }
      this._requestPending = false;
      this.setData({
        loading: false,
        loadingMore: false,
        list: [],
        page: 1,
        hasMore: false,
        nextBeforePublishTime: "",
        searchedKeyword: keyword,
        searchTotal: 0,
        searchTotalKnown: false,
        searchHint: "军队采购网暂无政策公开，可关闭开关查看工信厅/科技厅政策",
        sourceName: "军队采购网",
        errorMessage: "",
      });
      this.notifyListIdle();
      return Promise.resolve();
    }
    const regions = expandRegionsForApi(this.data.filterRegions);
    const businessTypes = this.data.filterBusinessTypes || [];
    const partyAType =
      this.data.filterPartyAType && this.data.filterPartyAType !== "all"
        ? this.data.filterPartyAType
        : "";
    const amountRange =
      this.data.filterAmountRange && this.data.filterAmountRange !== "all"
        ? this.data.filterAmountRange
        : "";
    const expiryRange =
      this.data.filterExpiryRange && this.data.filterExpiryRange !== "all"
        ? this.data.filterExpiryRange
        : "";
    const expiryStartDate = this.data.filterExpiryStartDate || "";
    const expiryEndDate = this.data.filterExpiryEndDate || "";
    const propertyFormat =
      this.data.filterPropertyFormat && this.data.filterPropertyFormat !== "all"
        ? this.data.filterPropertyFormat
        : "";
    const contractPeriod =
      this.data.filterContractPeriod && this.data.filterContractPeriod !== "all"
        ? this.data.filterContractPeriod
        : "";
    const attachmentFilter =
      this.data.filterAttachment && this.data.filterAttachment !== "all"
        ? this.data.filterAttachment
        : "";
    const turnoverFilter =
      this.data.filterTurnover && this.data.filterTurnover !== "all"
        ? this.data.filterTurnover
        : "";
    const startDate = this.data.filterStartDate;
    const endDate = this.data.filterEndDate;
    // 翻页只用键集游标，不用大 page/OFFSET
    const page = 1;
    const isAllSourcesBrowse =
      source === "" &&
      !keyword &&
      !startDate &&
      !endDate &&
      (this.data.filterInfoSource || "all") === "all";
    const beforePublishTime = append ? String(this.data.nextBeforePublishTime || "").trim() : "";
    const allSourcesDay = append ? String(this.data.allSourcesDay || "").trim() : "";
    const allSourcesTableIndex = append ? Number(this.data.allSourcesTableIndex || 0) : 0;
    if (append && !beforePublishTime && !isAllSourcesBrowse) {
      this.setData({ hasMore: false, loadingMore: false });
      return Promise.resolve();
    }
    if (append && !beforePublishTime && isAllSourcesBrowse && !this.data.hasMore) {
      this.setData({ loadingMore: false });
      return Promise.resolve();
    }

    // 上拉优先吃预取下一页缓存，命中则秒开
    if (append && beforePublishTime && !isAllSourcesBrowse) {
      const nextCacheKey = `${this.buildListCacheKey()}\u0001next\u0001${beforePublishTime}`;
      const cachedNext = getBiaoxunNextPageCache(nextCacheKey);
      if (cachedNext && cachedNext.success) {
        clearBiaoxunNextPageCache(nextCacheKey);
        const incoming = (cachedNext.data || []).map(decorateNoticeCard);
        const existing = this.data.list || [];
        const merged = [...existing];
        const seen = new Set(existing.map((item) => item.id));
        incoming.forEach((item) => {
          if (!seen.has(item.id)) {
            merged.push(item);
            seen.add(item.id);
          }
        });
        const nextCursor = String(cachedNext.nextBeforePublishTime || "").trim();
        const effectiveHasMore = !!cachedNext.hasMore || !!nextCursor;
        this.setData(
          {
            list: merged,
            page: Number(this.data.page || 1) + 1,
            hasMore: effectiveHasMore,
            nextBeforePublishTime: nextCursor,
            loadingMore: false,
            errorMessage: "",
          },
          () => {
            this.saveListCache();
            if (append) this.prefetchNextPageIfNeeded();
            this.prefetchVisibleDetails();
            if (
              merged.length === existing.length &&
              effectiveHasMore &&
              nextCursor &&
              appendDepth < 2
            ) {
              this.loadList(true, true, 0, {
                ...options,
                appendDepth: appendDepth + 1,
              });
            }
          }
        );
        return Promise.resolve();
      }
    }

    const seq = (this._requestSeq || 0) + 1;
    this._requestSeq = seq;
    this._requestPending = true;
    const currentSeq = seq;
    let scheduledRetry = false;
    let requestOk = false;
    const showLoading = !silent && !append;
    if (showLoading) this.startSearchProgress(keyword);
    this.setData({
      loading: showLoading,
      loadingMore: append,
      errorMessage: "",
      showRegionPicker: false,
      showFilterPanel: false,
      // 静默刷新保留现有列表与游标，避免切 Tab 时画面被清空
      ...(!append && !silent
        ? {
            list: keyword ? [] : this.data.list,
            searchedKeyword: keyword,
            searchTotal: 0,
            searchTotalKnown: false,
            nextBeforePublishTime: "",
            searchHint: "",
            ...(isAllSourcesBrowse ? { allSourcesDay: "", allSourcesTableIndex: 0 } : {}),
          }
        : {}),
    });

    const requestPromise = callBiaoxunCloud("listBiaoxun", {
      keyword,
      source,
      excludePlap: !plapOnly && source !== "plap",
      categoryGroup,
      regions,
      region: regions[0] || "",
      businessTypes,
      partyAType,
      amountRange,
      expiryRange,
      expiryStartDate,
      expiryEndDate,
      propertyFormat,
      contractPeriod,
      attachmentFilter,
      turnoverFilter,
      page,
      pageSize: this.data.pageSize,
      startDate,
      endDate,
      beforePublishTime,
      ...(isAllSourcesBrowse
        ? {
            allSourcesDay: append ? allSourcesDay : "",
            allSourcesTableIndex: append ? allSourcesTableIndex : 0,
          }
        : {}),
    });

    // 安全查询已限时窗，看门狗与安全超时对齐
    const SEARCH_TIMEOUT_MS = 12000;
    const guardedPromise = new Promise((resolve, reject) => {
      this._searchWatchdog = setTimeout(() => {
        this._searchWatchdog = null;
        if (seq !== this._requestSeq) return;
        reject({ errMsg: "标讯查询超时，请稍后重试" });
      }, SEARCH_TIMEOUT_MS);
      requestPromise.then(
        (res) => {
          if (this._searchWatchdog) {
            clearTimeout(this._searchWatchdog);
            this._searchWatchdog = null;
          }
          resolve(res);
        },
        (err) => {
          if (this._searchWatchdog) {
            clearTimeout(this._searchWatchdog);
            this._searchWatchdog = null;
          }
          reject(err);
        }
      );
    });

    return guardedPromise
      .then((res) => {
        if (seq !== this._requestSeq) return;
        const result = res.result || {};
        if (!result.success) {
          const rawMessage = String(result.errMsg || "");
          const shouldRetry =
            !append &&
            retryCount < 1 &&
            (result.retryable ||
              /-504003|timed out|TIME_LIMIT_EXCEEDED|PROTOCOL_SEQUENCE_TIMEOUT|query timeout/i.test(rawMessage)) &&
            !/FunctionName parameter|FUNCTION_NOT_FOUND/i.test(rawMessage);

          if (shouldRetry) {
            scheduledRetry = true;
            this._scheduledRetry = true;
            setTimeout(() => {
              this._scheduledRetry = false;
              if (this._requestSeq !== currentSeq) {
                this.notifyListIdle();
                return;
              }
              this.loadList(silent, append, retryCount + 1);
            }, 600);
          return;
        }

          // 分页/已有列表时不要整页“加载失败”，保留现有数据并 toast。
          if (append || (this.data.list || []).length > 0) {
            wx.showToast({ title: "加载失败，稍后重试", icon: "none" });
            return;
          }

          this.setData({
            searchTotalKnown: false,
            errorMessage: rawMessage || "标讯加载失败",
          });
          return;
        }
        requestOk = true;
        const incoming = (result.data || []).map(decorateNoticeCard);
        const existing = append ? this.data.list : [];
        const merged = [...existing];
        const seen = new Set(existing.map((item) => item.id));
        incoming.forEach((item) => {
          if (!seen.has(item.id)) {
            merged.push(item);
            seen.add(item.id);
          }
        });
        const appendedCount = merged.length - existing.length;
        const totalKnown = result.total !== null && result.total !== undefined;
        const nextCursor = String(result.nextBeforePublishTime || "").trim();
        let effectiveHasMore = !!result.hasMore || !!nextCursor;
        if (append && appendedCount === 0) effectiveHasMore = false;
        this.setData(
          {
          list: merged,
            page: append ? Number(this.data.page || 1) + 1 : 1,
            hasMore: effectiveHasMore,
          searchedKeyword: keyword,
            sourceName: plapOnly
              ? "军队采购网"
              : result.sourceName || CATEGORY_LABELS[categoryGroup] || "标讯",
          errorMessage: "",
            nextBeforePublishTime: nextCursor,
            searchHint: String(result.searchHint || "").trim(),
            ...(isAllSourcesBrowse
              ? {
                  allSourcesDay: String(result.allSourcesDay || "").trim(),
                  allSourcesTableIndex: Number(result.allSourcesTableIndex || 0),
                }
              : {}),
            ...(keyword && totalKnown
              ? {
                  searchTotal: Number(result.total || 0),
                  searchTotalKnown: true,
                }
              : {}),
          },
          () => {
            this.saveListCache();
            if (append) this.prefetchNextPageIfNeeded();
            this.prefetchVisibleDetails();
            if (
              append &&
              appendedCount === 0 &&
              effectiveHasMore &&
              nextCursor &&
              appendDepth < 2
            ) {
              this.loadList(true, true, 0, {
                ...options,
                appendDepth: appendDepth + 1,
              });
            }
          }
        );
      })
      .catch((error) => {
        if (seq !== this._requestSeq) return;
        console.error("标讯搜索请求失败", error);
        const message = String(error?.errMsg || error?.message || "");

        const shouldRetry =
          !append &&
          retryCount < 1 &&
          /-504003|timed out|TIME_LIMIT_EXCEEDED|PROTOCOL_SEQUENCE_TIMEOUT|query timeout/i.test(message) &&
          !/FunctionName parameter|FUNCTION_NOT_FOUND/i.test(message);

        if (shouldRetry) {
          scheduledRetry = true;
          this._scheduledRetry = true;
          setTimeout(() => {
            this._scheduledRetry = false;
            if (this._requestSeq !== currentSeq) {
              this.notifyListIdle();
              return;
            }
            this.loadList(silent, append, retryCount + 1);
          }, 700);
          return;
        }

        if (append || (this.data.list || []).length > 0) {
          wx.showToast({ title: "加载失败，稍后重试", icon: "none" });
          return;
        }

        this.setData({
          searchTotalKnown: false,
          errorMessage: message.includes("FunctionName parameter")
            ? "标讯云函数尚未部署，请先上传并部署 biaoxunApi"
            : /超时|timed out|TIME_LIMIT_EXCEEDED/i.test(message)
              ? "标讯查询超时，请稍后重试"
            : "网络开小差了，请稍后重试",
        });
      })
      .finally(() => {
        if (seq === this._requestSeq) {
          if (scheduledRetry) {
            // 自动重试必须先释放锁，否则重试会被当前请求自己拦截。
            this._requestPending = false;
            return;
          }
            const finish = () => {
              this._requestPending = false;
          this.setData({ loading: false, loadingMore: false });
              const queued = this._queuedLoadList;
              this._queuedLoadList = null;
              if (queued) {
                this.loadList(
                  queued.silent,
                  false,
                  queued.retryCount || 0,
                  queued.options || {}
                );
              } else {
                this.notifyListIdle();
              }
            };
            // 软失败（toast 保留旧列表）不能把进度条跑到 100%
            if (this.data.showSearchProgress) {
              if (requestOk) this.finishSearchProgress().then(finish);
              else {
                this.abortSearchProgress();
                finish();
              }
            } else {
              finish();
            }
        }
      });
  },

  onNoticeCardOpen(e) {
    const id = String(e.detail?.id || "");
    if (!id) return;
    const now = Date.now();
    if (this._openDetailAt && now - this._openDetailAt < 600) return;
    this._openDetailAt = now;
    const source = String(e.detail?.source || e.detail?.sourceCode || "");
    wx.navigateTo({
      url: `/pages/biaoxun/detail/index?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`,
    });
  },

  onShareAppMessage() {
    const keyword = String(this.data.searchedKeyword || "").trim();
    const categoryGroup = this.currentCategoryGroup();
    const label = CATEGORY_LABELS[categoryGroup] || "标讯";
    const query = [];
    if (keyword) query.push(`keyword=${encodeURIComponent(keyword)}`);
    if (categoryGroup) query.push(`category=${encodeURIComponent(categoryGroup)}`);
    return {
      title: keyword ? `${label}：${keyword}` : `速办智库 · ${label}`,
      path: query.length ? `/pages/biaoxun/index?${query.join("&")}` : "/pages/biaoxun/index",
    };
  },

  onShareTimeline() {
    const keyword = String(this.data.searchedKeyword || "").trim();
    const categoryGroup = this.currentCategoryGroup();
    const label = CATEGORY_LABELS[categoryGroup] || "标讯";
    const query = [];
    if (keyword) query.push(`keyword=${encodeURIComponent(keyword)}`);
    if (categoryGroup) query.push(`category=${encodeURIComponent(categoryGroup)}`);
    return {
      title: keyword ? `${label}：${keyword}` : `速办智库 · ${label}`,
      query: query.join("&"),
    };
  },
});
