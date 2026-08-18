const { callBiaoxunCloud } = require("../../../utils/admin");
const { buildContentBlocks } = require("../../../utils/biaoxunContent");
const { enableShareMenu } = require("../../../utils/share");
const { safeDecode } = require("../../../utils/string");
const {
  getBiaoxunDetailCache,
  setBiaoxunDetailCache,
  prefetchBiaoxunDetail,
} = require("../../../utils/preload");
const {
  formatDate,
  normalizeCategoryLabel,
  resolveCategoryGroup,
  resolveNoticeSourceLabel,
  formatQuanzhouRegionLabel,
  hasDisplayText,
  hasRealBudget,
} = require("../../../utils/biaoxunDecorate");
const { buildHallCountdown } = require("../../../utils/hallCountdown");

const looksLikeHtml = (value) => /<[a-z][\s\S]*>/i.test(String(value || ""));

const resolveBackCategory = (sourceCode, categoryLabel) =>
  resolveCategoryGroup(sourceCode, categoryLabel);

const guessFileType = (name = "") => {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match ? match[1] : "";
};

const OPENABLE_TYPES = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);
// ponytail: 压缩包不能预览，下载后走转发；需在用户点击手势里调 shareFileMessage
const ARCHIVE_TYPES = new Set(["zip", "rar", "7z", "tar", "gz", "tgz"]);
const isArchiveFile = (name = "") => ARCHIVE_TYPES.has(guessFileType(name));
const ATTACHMENT_CACHE_KEY = "biaoxun_attachment_cache_v1";
const MAX_CACHED_ATTACHMENTS = 60;

const readAttachmentCache = () => {
  try {
    const value = wx.getStorageSync(ATTACHMENT_CACHE_KEY);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
};

const writeAttachmentCache = (cache) => {
  try {
    wx.setStorageSync(ATTACHMENT_CACHE_KEY, cache || {});
    return true;
  } catch (error) {
    console.warn("附件缓存索引保存失败", error);
    return false;
  }
};

const localFileExists = (filePath) => {
  if (!filePath) return false;
  try {
    wx.getFileSystemManager().accessSync(filePath);
    return true;
  } catch (error) {
    return false;
  }
};

const removeSavedFile = (filePath) => {
  if (!filePath) return;
  wx.removeSavedFile({
    filePath,
    fail: () => {},
  });
};

const pruneAttachmentCache = (cache) => {
  const entries = Object.entries(cache || {}).sort(
    (a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0)
  );
  entries.slice(MAX_CACHED_ATTACHMENTS).forEach(([url, record]) => {
    removeSavedFile(record?.filePath);
    delete cache[url];
  });
  return cache;
};

const getCachedAttachment = (url) => {
  const key = String(url || "");
  if (!key) return null;
  const cache = readAttachmentCache();
  const record = cache[key];
  if (!record) return null;
  if (localFileExists(record.filePath)) return record;
  delete cache[key];
  writeAttachmentCache(cache);
  return null;
};

const decorateAttachmentCache = (attachments) => {
  const cache = readAttachmentCache();
  let changed = false;
  const result = (attachments || []).map((file) => {
    const record = cache[file.url];
    const cached = !!(record && localFileExists(record.filePath));
    if (record && !cached) {
      delete cache[file.url];
      changed = true;
    }
    return { ...file, cached };
  });
  if (changed) writeAttachmentCache(cache);
  return result;
};

const saveAttachmentToLocal = ({ tempFilePath, url, name, noticeId }) =>
  new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: ({ savedFilePath }) => {
        if (!savedFilePath) {
          reject(new Error("附件保存到微信失败"));
          return;
        }
        const cache = readAttachmentCache();
        const previous = cache[url];
        const record = {
          filePath: savedFilePath,
          name: name || "附件",
          noticeId: String(noticeId || ""),
          savedAt: Date.now(),
        };
        cache[url] = record;
        pruneAttachmentCache(cache);
        if (!writeAttachmentCache(cache)) {
          delete cache[url];
          removeSavedFile(savedFilePath);
          reject(new Error("附件缓存记录保存失败"));
          return;
        }
        if (previous?.filePath && previous.filePath !== savedFilePath) {
          removeSavedFile(previous.filePath);
        }
        resolve(record);
      },
      fail: reject,
    });
  });

Page({
  data: {
    id: "",
    source: "",
    backCategory: "tender",
    detail: null,
    loading: true,
    errorMessage: "",
    downloadingIndex: -1,
    hallCountdown: null,
  },

  onLoad(options) {
    enableShareMenu();
    const id = safeDecode(options.id);
    const source = safeDecode(options.source).trim().toLowerCase();
    const backCategory = resolveBackCategory(source, "");
    this.setData({ id, source, backCategory });
    this.loadDetail();
  },

  onShow() {
    this.resumeHallCountdown();
  },

  onHide() {
    this.clearHallCountdownTimer();
  },

  onUnload() {
    this.clearHallCountdownTimer();
  },

  clearHallCountdownTimer() {
    if (this._hallCdTimer) {
      clearInterval(this._hallCdTimer);
      this._hallCdTimer = null;
    }
  },

  resumeHallCountdown() {
    const detail = this.data.detail;
    if (!detail || detail.sourceCode !== "quanzhou_hall") return;
    this.clearHallCountdownTimer();
    this.tickHallCountdown();
    this._hallCdTimer = setInterval(() => this.tickHallCountdown(), 1000);
  },

  tickHallCountdown() {
    const detail = this.data.detail;
    if (!detail || detail.sourceCode !== "quanzhou_hall") {
      this.clearHallCountdownTimer();
      this.setData({ hallCountdown: null });
      return;
    }
    const hallCountdown = buildHallCountdown(detail);
    this.setData({ hallCountdown });
  },

  applyDetailResult(result = {}) {
    const item = result.data || {};
    const contentHtml = String(item.contentHtml || "").trim();
    const contentText = String(item.contentText || "").trim();
    const contentParagraphs = Array.isArray(item.contentParagraphs)
      ? item.contentParagraphs.filter(Boolean)
      : contentText
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean);
    const sourceCode = String(item.sourceCode || item.source || this.data.source || "")
      .trim()
      .toLowerCase();
    const useRichText = !!(contentHtml && looksLikeHtml(contentHtml));
    let contentBlocks = useRichText
      ? buildContentBlocks(contentHtml, { source: sourceCode })
      : [
          {
            type: "text",
            paragraphs: contentParagraphs.length
              ? contentParagraphs
              : ["暂无公告正文，请通过原文链接进一步查看。"],
          },
        ];
    // 富文本拆块后无可展示内容时，回退纯文本（避免 samp 等标签导致空白）
    const hasRenderableBlock = (contentBlocks || []).some((block) => {
      if (!block) return false;
      if (block.type === "html") return !!String(block.html || "").replace(/<[^>]+>/g, "").trim();
      if (block.type === "text") return Array.isArray(block.paragraphs) && block.paragraphs.some(Boolean);
      if (block.type === "table") return Array.isArray(block.cards) && block.cards.length > 0;
      return false;
    });
    if (useRichText && !hasRenderableBlock && contentParagraphs.length) {
      contentBlocks = [{ type: "text", paragraphs: contentParagraphs }];
    } else if (!hasRenderableBlock) {
      contentBlocks = [
        {
          type: "text",
          paragraphs: ["暂无公告正文，请通过原文链接进一步查看。"],
        },
      ];
    }
    const attachments =
      sourceCode === "plap"
        ? []
        : decorateAttachmentCache(
            Array.isArray(item.attachments)
              ? item.attachments
                  .filter((file) => file && file.url)
                  .map((file) => {
                    const name = file.name || "附件";
                    const ext = guessFileType(name || file.url);
                    return {
                      name,
                      url: file.url,
                      ext,
                      isArchive: isArchiveFile(name || file.url),
                    };
                  })
              : []
          );
    const isKjt = sourceCode === "kjt";
    const isGxt = sourceCode === "gxt";
    const isPlap = sourceCode === "plap";
    const isEasyPrt = sourceCode === "easy_prt";
    const buyerRaw = String(item.buyer || "").trim();
    const agencyRaw = String(item.agency || "").trim();
    const budgetRaw = String(item.budget || "").trim();
    const regionRaw = String(item.region || "").trim();
    const regionLabel =
      sourceCode === "quanzhou" || sourceCode === "quanzhou_hall"
        ? formatQuanzhouRegionLabel(regionRaw)
        : regionRaw;
    let projectNoLabel = String(item.projectNo || "").trim();
    if (!projectNoLabel) {
      const fromTitle = String(item.title || "").match(/\((20\d{2}-[A-Z0-9\-]+)\)/i);
      if (fromTitle) projectNoLabel = fromTitle[1];
    }
    const rawCategory = String(item.category || "").trim();
    let categoryLabel = rawCategory
      ? normalizeCategoryLabel(rawCategory, sourceCode)
      : isKjt || isGxt
        ? "通知公告"
        : isPlap
          ? "采购公告"
          : "招标公告";
    const showBuyer =
      hasDisplayText(buyerRaw) && !(isEasyPrt && /^(招标采购|采购公告)$/.test(buyerRaw));
    const showAgency =
      hasDisplayText(agencyRaw) && !(isEasyPrt && /^(招标采购|采购公告)$/.test(agencyRaw));
    const showBudget =
      !isKjt &&
      !isGxt &&
      hasRealBudget(budgetRaw) &&
      !/采购意向/.test(categoryLabel) &&
      !(isEasyPrt && /^(--|招标采购|\.00|0\.00)$/.test(budgetRaw));
    const showRegion = !!regionLabel;
    const showProjectNo =
      !!projectNoLabel && !(isEasyPrt && /^(招标采购|采购公告)$/.test(projectNoLabel));
    const showManner = isPlap && !!categoryLabel;
    const phoneLabel = String(item.contactPhone || "").trim();
    const phoneDial = String(item.contactPhoneDial || "")
      .replace(/[^\d+]/g, "")
      .trim();
    const showPhone = !!(phoneLabel && phoneDial);
    const showOverview =
      showBuyer ||
      showAgency ||
      showPhone ||
      showRegion ||
      showBudget ||
      showProjectNo ||
      showManner ||
      !!formatDate(item.deadline) ||
      (sourceCode === "quanzhou_hall" && !!formatDate(item.openTime));

    this.setData({
      loading: false,
      errorMessage: "",
      backCategory: resolveBackCategory(sourceCode, categoryLabel),
      detail: {
        ...item,
        title: item.title || "未命名标讯",
        categoryLabel,
        publishTimeLabel: formatDate(item.publishTime),
        deadlineLabel: formatDate(item.deadline),
        openTimeLabel: formatDate(item.openTime),
        statusNameLabel: String(item.statusName || "").trim(),
        deadlineRowLabel: sourceCode === "quanzhou_hall" ? "结束时间" : "投标截止时间",
        showOpenTime: sourceCode === "quanzhou_hall" && !!formatDate(item.openTime),
        regionLabel,
        buyerLabel: showBuyer ? buyerRaw : "",
        agencyLabel: showAgency ? agencyRaw : "",
        budgetLabel: showBudget ? budgetRaw : "",
        projectNoLabel: showProjectNo ? projectNoLabel : "",
        phoneLabel,
        phoneDial,
        buyerRowLabel: isKjt || isGxt ? "发布单位" : "采购单位",
        budgetRowLabel:
          (isPlap || isEasyPrt) && /结果|成交|中标|合同/.test(String(item.title || categoryLabel || ""))
            ? "成交金额"
            : isEasyPrt || !isPlap
              ? "预算"
              : "项目预算",
        showBuyer,
        showAgency,
        showBudget,
        showRegion,
        showProjectNo,
        showManner,
        showPhone,
        showOverview,
        sourceLabel:
          resolveNoticeSourceLabel(sourceCode, item) ||
          result.sourceName ||
          "标讯数据库",
        sourceCode,
        useRichText,
        contentBlocks,
        attachments,
        images: Array.isArray(item.images) ? item.images : [],
        galleryImages: [],
        galleryLoading:
          sourceCode === "quanzhou_hall" &&
          Array.isArray(item.images) &&
          item.images.length > 0,
      },
    });

    if (sourceCode === "quanzhou_hall") {
      this.resumeHallCountdown();
    } else {
      this.clearHallCountdownTimer();
      this.setData({ hallCountdown: null });
    }

    if (sourceCode === "quanzhou_hall" && Array.isArray(item.images) && item.images.length) {
      this.resolveHallGallery(item.images);
    }
  },

  resolveHallGallery(rawImages = []) {
    const id = this.data.id;
    const source = this.data.source || "quanzhou_hall";
    const seq = (this._gallerySeq || 0) + 1;
    this._gallerySeq = seq;
    this.setData({ "detail.galleryLoading": true });
    callBiaoxunCloud("resolveBiaoxunHallImages", { id, source })
      .then((res) => {
        if (seq !== this._gallerySeq) return;
        const result = res.result || {};
        const images = Array.isArray(result.images) ? result.images : [];
        const galleryImages = images
          .map((item) => String(item.url || item.fileID || "").trim())
          .filter(Boolean);
        // 云转存失败时，尝试直链（开发环境可能可用）
        const fallback = !galleryImages.length
          ? (rawImages || []).map((item) => String(item.url || "").trim()).filter(Boolean)
          : galleryImages;
        this.setData({
          "detail.galleryImages": fallback,
          "detail.galleryLoading": false,
        });
      })
      .catch(() => {
        if (seq !== this._gallerySeq) return;
        const fallback = (rawImages || []).map((item) => String(item.url || "").trim()).filter(Boolean);
        this.setData({
          "detail.galleryImages": fallback,
          "detail.galleryLoading": false,
        });
      });
  },

  previewHallImage(e) {
    const current = String(e.currentTarget.dataset.src || "").trim();
    const urls = (this.data.detail && this.data.detail.galleryImages) || [];
    if (!urls.length) return;
    wx.previewImage({
      current: current || urls[0],
      urls,
    });
  },

  loadDetail() {
    if (!this.data.id) {
      this.setData({ loading: false, errorMessage: "标讯编号无效" });
      return;
    }
    const seq = (this._detailSeq || 0) + 1;
    this._detailSeq = seq;

    const cached = getBiaoxunDetailCache(this.data.id, this.data.source);
    if (cached && cached.success && cached.data) {
      this.applyDetailResult(cached);
      // 后台静默刷新，不挡首屏
      prefetchBiaoxunDetail(this.data.id, this.data.source).then((fresh) => {
        if (seq !== this._detailSeq || !fresh?.success || !fresh.data) return;
        this.applyDetailResult(fresh);
      });
      return;
    }

    this.setData({ loading: true, errorMessage: "" });
    callBiaoxunCloud("getBiaoxunDetail", { id: this.data.id, source: this.data.source })
      .then((res) => {
        if (seq !== this._detailSeq) return;
        const result = res.result || {};
        if (!result.success) {
          this.setData({ errorMessage: result.errMsg || "标讯详情加载失败" });
          return;
        }
        setBiaoxunDetailCache(this.data.id, this.data.source, result);
        this.applyDetailResult(result);
      })
      .catch(() => {
        if (seq !== this._detailSeq) return;
        this.setData({ errorMessage: "网络开小差了，请稍后重试" });
      })
      .finally(() => {
        if (seq !== this._detailSeq) return;
        this.setData({ loading: false });
      });
  },

  callPhone() {
    const phoneNumber = this.data.detail?.phoneDial || "";
    if (!phoneNumber) {
      wx.showToast({ title: "暂无联系电话", icon: "none" });
      return;
    }
    wx.makePhoneCall({
      phoneNumber,
      fail: () => wx.showToast({ title: "无法拨打电话", icon: "none" }),
    });
  },

  copySourceUrl() {
    const url = String(this.data.detail?.url || "").trim();
    if (!url) {
      wx.showToast({ title: "暂无原文链接", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "链接已复制", icon: "success" }),
    });
  },

  shareLocalFile(filePath, name) {
    return new Promise((resolve, reject) => {
      if (typeof wx.shareFileMessage !== "function") {
        reject(new Error("当前微信版本不支持转发文件，请升级微信后重试"));
        return;
      }
      let fileName = String(name || "附件").trim() || "附件.zip";
      const ext = guessFileType(fileName) || guessFileType(filePath) || "zip";
      if (!guessFileType(fileName)) fileName = `${fileName}.${ext}`;
      if (fileName.length > 100) {
        fileName = `${fileName.slice(0, 80)}.${ext}`;
      }
      wx.shareFileMessage({
        filePath,
        fileName,
        success: resolve,
        fail: reject,
      });
    });
  },

  openLocalFile(filePath, name) {
    const fileType = guessFileType(name);
    // 压缩包只走转发，绝不 openDocument（否则会弹出系统「打开方式」）
    if (isArchiveFile(name) || isArchiveFile(filePath)) {
      return this.shareLocalFile(filePath, name);
    }
    if (fileType && !OPENABLE_TYPES.has(fileType)) {
      return this.shareLocalFile(filePath, name);
    }
    return new Promise((resolve, reject) => {
      wx.openDocument({
        filePath,
        showMenu: true,
        fileType: fileType || undefined,
        success: resolve,
        fail: reject,
      });
    });
  },

  showAttachmentError(error, url, options = {}) {
    const archive = !!options.archive;
    const message = error?.errMsg || error?.message || "附件处理失败";
    // 用户取消转发不弹错误
    if (/cancel|取消/i.test(String(message))) return;
    wx.showModal({
      title: archive ? "转发未完成" : "无法直接打开",
      content: archive
        ? `${message}\n\n请再点一次附件进行转发；也可复制链接到浏览器下载。`
        : `${message}\n\n可复制附件链接，到浏览器中下载。`,
      confirmText: "复制链接",
      success: (modalRes) => {
        if (modalRes.confirm) {
          wx.setClipboardData({
            data: url,
            success: () => wx.showToast({ title: "链接已复制", icon: "success" }),
          });
        }
      },
    });
  },

  markAttachmentCached(index, cached) {
    const numericIndex = Number(index);
    if (!Number.isInteger(numericIndex) || numericIndex < 0) return;
    this.setData({ [`detail.attachments[${numericIndex}].cached`]: !!cached });
  },

  openCachedAttachment({ url, name, index, record }) {
    const fileName = record.name || name;
    const archive = isArchiveFile(fileName);
    this.setData({ downloadingIndex: Number(index) });
    if (!archive) wx.showLoading({ title: "打开本地文件", mask: true });
    return this.openLocalFile(record.filePath, fileName)
      .then(() => {
        this.markAttachmentCached(index, true);
        if (!archive) wx.showToast({ title: "已从本地打开", icon: "success" });
      })
      .catch((error) => this.showAttachmentError(error, url, { archive }))
      .finally(() => {
        wx.hideLoading();
        this.setData({ downloadingIndex: -1 });
      });
  },

  downloadAttachment(e) {
    const index = Number(e.currentTarget.dataset.index);
    const fromList = (this.data.detail?.attachments || [])[index] || {};
    // ponytail: 长 URL/特殊字符经 data-* 易损坏，以列表项为准
    const url = String(fromList.url || e.currentTarget.dataset.url || "").trim();
    const name = String(fromList.name || e.currentTarget.dataset.name || "附件").trim();
    if (!url || this.data.downloadingIndex >= 0) return;

    const cached = getCachedAttachment(url);
    if (cached) {
      return this.openCachedAttachment({ url, name, index, record: cached });
    }
    this.markAttachmentCached(index, false);

    this.setData({ downloadingIndex: Number(index) });
    wx.showLoading({ title: "准备下载", mask: true });

    let tempFileID = "";
    return callBiaoxunCloud("fetchBiaoxunAttachment", {
      id: this.data.id,
      source: this.data.source,
      url,
      name,
    })
      .then((res) => {
        const result = res.result || {};
        if (!result.success || !result.fileID) {
          return Promise.reject(new Error(result.errMsg || "附件获取失败"));
        }
        tempFileID = result.fileID;
        wx.showLoading({ title: "下载中", mask: true });
        return new Promise((resolve, reject) => {
          wx.cloud.downloadFile({
            fileID: result.fileID,
            success: (downloadRes) => {
              // statusCode 在部分基础库是字符串 "200"，不能用 !== 200 判断
              const code = Number(downloadRes.statusCode == null ? 200 : downloadRes.statusCode);
              if (!downloadRes.tempFilePath || (code && code !== 200 && code !== 206)) {
                reject(new Error(code ? `下载失败(${code})` : "下载失败"));
                return;
              }
              resolve({
                filePath: downloadRes.tempFilePath,
                name: result.name || name,
              });
            },
            fail: (error) => {
              reject(new Error(error?.errMsg || error?.message || "下载失败"));
            },
          });
        });
      })
      .then(({ filePath, name: fileName }) => {
        wx.showLoading({ title: "保存到微信", mask: true });
        return saveAttachmentToLocal({
          tempFilePath: filePath,
          url,
          name: fileName,
          noticeId: this.data.id,
        });
      })
      .then((record) => {
        this.markAttachmentCached(index, true);
        const fileName = record.name || name;
        // 压缩包：保存后立刻转发；失败不走 openDocument，避免系统「打开方式」
        if (isArchiveFile(fileName)) {
          wx.hideLoading();
          return this.shareLocalFile(record.filePath, fileName).catch((error) => {
            if (/cancel|取消/i.test(String(error?.errMsg || error?.message || ""))) return;
            wx.showToast({ title: "已保存，再点一次可转发", icon: "none" });
          });
        }
        wx.showLoading({ title: "打开附件", mask: true });
        return this.openLocalFile(record.filePath, fileName).then(() => {
          wx.showToast({ title: "已保存并打开", icon: "success" });
        });
      })
      .catch((error) => this.showAttachmentError(error, url))
      .finally(() => {
        if (tempFileID) {
          callBiaoxunCloud("cleanupBiaoxunAttachment", { fileID: tempFileID }).catch(() => {});
        }
        wx.hideLoading();
        this.setData({ downloadingIndex: -1 });
      });
  },

  onShareAppMessage() {
    return {
      title: this.data.detail?.title || "标讯详情",
      path: `/pages/biaoxun/detail/index?id=${encodeURIComponent(this.data.id)}&source=${encodeURIComponent(this.data.source || "")}`,
    };
  },

  onShareTimeline() {
    return {
      title: this.data.detail?.title || "标讯详情",
      query: `id=${encodeURIComponent(this.data.id)}&source=${encodeURIComponent(this.data.source || "")}`,
    };
  },
});
