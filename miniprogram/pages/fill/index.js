const { callCloud, trySilentLogin, goPage, goLogin, getLocalUser, hasLoggedOut } = require("../../utils/admin");
const { getPageCache, setPageCache, waitForPreload } = require("../../utils/preload");
const { getDeviceId } = require("../../utils/device");
const { enableShareMenu } = require("../../utils/share");
const {
  initFormValues,
  validateForm,
  getScheduleStatus,
  normalizeFormValues,
  checkShareAccess,
  checkFriendAccess,
  checkGroupAccess,
  getEffectiveSections,
  getSectionVisibleFields,
  resolveJumpSection,
} = require("../../utils/formEngine");
const {
  listDrafts,
  getDraftById,
  addDraft,
  removeDraftById,
  renameDraft,
  countDrafts,
  getDraftLimit,
  hasFilledValues,
} = require("../../utils/draftBox");

const ACCESS_PREFIX = "formAccess_";
const OFFLINE_QUEUE = "formOfflineQueue";
const TEMPLATE_CACHE_PREFIX = "formTemplateCache_";
const MAX_OFFLINE_SUBMISSIONS = 20;

const createClientRequestId = () =>
  `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

Page({
  data: {
    loading: true,
    template: null,
    fields: [],
    values: {},
    submitting: false,
    showPrivacy: false,
    privacyAccepted: false,
    formClosed: false,
    closedMessage: "",
    quotaFull: false,
    quotaRemaining: null,
    whitelistEnabled: false,
    coverImage: "",
    logoImage: "",
    accessBlocked: false,
    accessBlockedMsg: "",
    footerText: "",
    uploadSettings: {},
    themeColor: "#0d4a9c",
    showPassword: false,
    passwordInput: "",
    passwordVerified: false,
    showCaptcha: false,
    captchaId: "",
    captchaQuestion: "",
    captchaAnswer: "",
    offlineMode: false,
    pagedForm: false,
    sections: [],
    currentSectionId: "",
    currentSectionIndex: 0,
    displayFields: [],
    isLastSection: true,
    oaName: "",
    oaArticleUrl: "",
    showTip: false,
    tipTitle: "",
    tipContent: "",
    draftCount: 0,
    showDraftBox: false,
    draftList: [],
    draftLimit: 5,
    needLogin: false,
    needChooseForm: false,
  },

  onLoad(options) {
    this._templateId = options.templateId || "";
  },

  onShow() {
    enableShareMenu();
    const app = getApp();
    const pendingId = app.globalData.fillTemplateId || "";
    const templateChanged = !!(pendingId && pendingId !== (this._templateId || ""));
    if (pendingId) {
      this._templateId = pendingId;
      app.globalData.fillTemplateId = "";
    }

    // 未指定表单：停留在本页展示引导，禁止自动跳转表单中心（否则返回会再次弹回，形成死循环）
    if (!this._templateId) {
      this.setData({
        needChooseForm: true,
        loading: false,
        template: null,
        fields: [],
        displayFields: [],
        passwordVerified: false,
      });
      return;
    }

    this.setData({ needChooseForm: false });

    waitForPreload().finally(() => {
      trySilentLogin().then((user) => {
        this.setData({ needLogin: !user });

        const targetId = this._templateId || "";
        const cache = getPageCache("formTemplate");
        const cacheMatches =
          cache?.response?.template &&
          (!targetId || cache.templateId === targetId);
        if (cacheMatches && (!this.data.template || templateChanged)) {
          this.applyTemplateResponse(cache.response, false);
        }

        const reconnectedAt = app.globalData.networkReconnectedAt || 0;
        const reconnected = reconnectedAt && reconnectedAt !== this._lastReconnectHandled;
        const shouldLoad = reconnected || templateChanged || !this.data.template;

        if (!shouldLoad) {
          this.flushOfflineQueue();
          this.refreshDraftMeta();
          return;
        }

        if (reconnected) {
          this._lastReconnectHandled = reconnectedAt;
          this.setData({ offlineMode: false });
        }
        const silent = !!this.data.template && !templateChanged;
        this.loadTemplate({ silent, preserveValues: silent || reconnected });
        this.flushOfflineQueue();
      });
    });
  },

  goLoginTap() {
    const tid = this._templateId || this.data.template?._id || "";
    const redirect = tid ? `/pages/fill/index?templateId=${tid}` : "/pages/forms/index";
    goLogin(redirect);
  },

  goChooseForm() {
    getApp().globalData.formsGuide = true;
    wx.navigateTo({ url: "/pages/forms/index" });
  },

  onShareAppMessage() {
    const title = this.data.template?.title || "咨询填写";
    const templateId = this.data.template?._id || this._templateId || "";
    const path = templateId ? `/pages/fill/index?templateId=${templateId}` : "/pages/fill/index";
    return {
      title: `邀请您填写：${title}`,
      path,
    };
  },

  onShareTimeline() {
    const title = this.data.template?.title || "咨询填写";
    const templateId = this.data.template?._id || this._templateId || "";
    return {
      title: `邀请您填写：${title}`,
      query: templateId ? `templateId=${encodeURIComponent(templateId)}` : "",
    };
  },

  applyTemplateResponse(res, offlineMode = false, options = {}) {
    const preserveValues = !!options.preserveValues;
    const template = res.template;
    const fields = template.fields || [];
    const values = preserveValues && this.data.values
      ? normalizeFormValues(fields, { ...initFormValues(fields), ...this.data.values })
      : normalizeFormValues(fields, initFormValues(fields));
    const app = getApp();
    const schedule = getScheduleStatus(template.settings || {});
    const shareAccess = checkShareAccess(template.settings || {}, app.globalData.launchScene);
    const friendAccess = checkFriendAccess(template.settings || {}, app.globalData.launchScene);
    const needPassword = template.settings?.needPassword;
    const templateId = template._id;
    const accessKey = `${ACCESS_PREFIX}${templateId}`;
    const passwordVerified =
      !needPassword ||
      (this._verifiedPasswordTemplateId === templateId && !!this._formPassword);

    // 清理旧版遗留的本地明文密码，访问授权只在当前页面会话内有效。
    try {
      wx.removeStorageSync(accessKey);
      wx.removeStorageSync(`${accessKey}_pwd`);
    } catch (e) {}
    if (needPassword && !passwordVerified) {
      this._formPassword = "";
      this._verifiedPasswordTemplateId = "";
    }
    const sections = getEffectiveSections(template);
    const pagedForm = !!template.settings?.pagedForm && sections.length > 0;
    const keepSection =
      preserveValues &&
      pagedForm &&
      sections.some((s) => s.id === this.data.currentSectionId);
    const currentSectionId = keepSection
      ? this.data.currentSectionId
      : sections[0]?.id || "default";
    const currentSectionIndex = Math.max(
      0,
      sections.findIndex((s) => s.id === currentSectionId)
    );

    if (!offlineMode && templateId) {
      wx.setStorageSync(`${TEMPLATE_CACHE_PREFIX}${templateId}`, {
        template,
        cachedAt: Date.now(),
      });
      setPageCache("formTemplate", {
        templateId,
        response: {
          template,
          quotaFull: !!res.quotaFull,
          quotaRemaining: res.quotaRemaining,
        },
      });
    }

    this.setData({
      template,
      fields,
      values,
      loading: false,
      offlineMode,
      formClosed: !schedule.open,
      closedMessage: schedule.message,
      quotaFull: !!res.quotaFull,
      quotaRemaining: res.quotaRemaining,
      whitelistEnabled: !!template.settings?.whitelistEnabled,
      coverImage: template.settings?.coverImage || "",
      logoImage: template.settings?.logoImage || "",
      accessBlocked: !shareAccess.ok || !friendAccess.ok,
      accessBlockedMsg: shareAccess.message || friendAccess.message || "",
      footerText: template.settings?.footerText || "",
      uploadSettings: {
        uploadMaxSizeMB: template.settings?.uploadMaxSizeMB || 10,
        uploadAllowedExts: template.settings?.uploadAllowedExts || "jpg,jpeg,png,pdf,doc,docx",
      },
      themeColor: template.settings?.themeColor || "#0d4a9c",
      passwordVerified,
      showPassword: needPassword && !passwordVerified,
      pagedForm,
      sections,
      currentSectionId,
      currentSectionIndex,
      displayFields: pagedForm
        ? getSectionVisibleFields(fields, currentSectionId, values, template)
        : fields,
      isLastSection: !pagedForm || currentSectionIndex >= sections.length - 1,
      oaName: template.settings?.oaName || "",
      oaArticleUrl: template.settings?.oaArticleUrl || "",
    });
    if (!preserveValues) {
      this._groupVerified = false;
      if (template.settings?.accessMode === "group_only") {
        this.verifyGroupAccess(template.settings);
      } else {
        this.applyPendingDraft();
        this.refreshDraftMeta();
      }
    } else {
      this.refreshDraftMeta();
    }
  },

  loadTemplateFromCache() {
    const cacheKey = `${TEMPLATE_CACHE_PREFIX}${this._templateId || "default"}`;
    const cached = wx.getStorageSync(cacheKey);
    if (!cached?.template) return false;
    this.applyTemplateResponse(
      {
        template: cached.template,
        quotaFull: false,
        quotaRemaining: null,
      },
      true
    );
    return true;
  },

  loadTemplate(options = {}) {
    const silent = !!options.silent;
    const preserveValues = !!options.preserveValues;
    const app = getApp();
    if (!app.globalData.env) {
      this.setData({
        loading: false,
        showTip: true,
        tipTitle: "环境未配置",
        tipContent: "请在 miniprogram/app.js 中正确配置 env 云环境 ID。",
      });
      return;
    }

    if (!silent) this.setData({ loading: true });

    callCloud("getFormTemplate", { templateId: this._templateId || undefined })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          if (this.loadTemplateFromCache()) {
            wx.showToast({ title: "已加载离线缓存", icon: "none" });
          } else {
            this.setData({ loading: false });
          }
          return;
        }
        this.applyTemplateResponse(res.result, false, { preserveValues });
      })
      .catch((e) => {
        if (this.loadTemplateFromCache()) {
          wx.showToast({ title: "网络不可用，已加载离线缓存", icon: "none" });
        } else {
          this.handleCloudError(e);
        }
        this.setData({ loading: false });
      });
  },

  refreshDisplayFields(values = this.data.values) {
    const isLastSection = this.computeIsLastSection();
    if (!this.data.pagedForm) {
      this.setData({ displayFields: this.data.fields, isLastSection: true });
      return;
    }
    this.setData({
      displayFields: getSectionVisibleFields(
        this.data.fields,
        this.data.currentSectionId,
        values,
        this.data.template
      ),
      isLastSection,
    });
  },

  computeIsLastSection() {
    const { sections, currentSectionId } = this.data;
    const idx = sections.findIndex((s) => s.id === currentSectionId);
    return idx >= sections.length - 1;
  },

  onFieldChange(e) {
    const { id, value } = e.detail;
    const values = { ...this.data.values, [id]: value };
    this.setData({ [`values.${id}`]: value });
    this.refreshDisplayFields(values);
  },

  onPrevSection() {
    const { sections, currentSectionIndex } = this.data;
    if (currentSectionIndex <= 0) return;
    const prev = sections[currentSectionIndex - 1];
    this.setData({
      currentSectionIndex: currentSectionIndex - 1,
      currentSectionId: prev.id,
      isLastSection: false,
    });
    this.refreshDisplayFields();
  },

  onNextSection() {
    const validation = validateForm(this.data.fields, this.data.values, {
      sectionId: this.data.currentSectionId,
      template: this.data.template,
    });
    if (!validation.ok) {
      wx.showToast({ title: validation.errMsg, icon: "none" });
      return;
    }

    const nextId = resolveJumpSection(
      this.data.sections,
      this.data.currentSectionId,
      this.data.fields,
      this.data.values,
      this.data.template
    );
    if (!nextId) {
      this.onSubmit();
      return;
    }
    const nextIndex = this.data.sections.findIndex((s) => s.id === nextId);
    const isLast = nextIndex >= this.data.sections.length - 1;
    this.setData({
      currentSectionId: nextId,
      currentSectionIndex: nextIndex >= 0 ? nextIndex : this.data.currentSectionIndex + 1,
      isLastSection: isLast,
    });
    this.refreshDisplayFields();
  },

  openOaArticle() {
    const { oaArticleUrl, oaName } = this.data;
    if (!oaArticleUrl) return;
    wx.navigateTo({
      url: `/pages/web/index?url=${encodeURIComponent(oaArticleUrl)}&title=${encodeURIComponent(oaName || "详情")}`,
      fail: () => {
        wx.setClipboardData({
          data: oaArticleUrl,
          success: () => wx.showToast({ title: "链接已复制", icon: "success" }),
        });
      },
    });
  },

  verifyGroupAccess(settings) {
    wx.getGroupEnterInfo({
      success: () => {
        this._groupVerified = true;
        this.setData({ accessBlocked: false, accessBlockedMsg: "" });
        this.applyPendingDraft();
        this.refreshDraftMeta();
      },
      fail: () => {
        const groupAccess = checkGroupAccess(settings, false);
        this._groupVerified = false;
        this.setData({
          accessBlocked: !groupAccess.ok,
          accessBlockedMsg: groupAccess.message || "",
        });
      },
    });
  },

  saveOfflineSubmission(payload) {
    if (payload.formPassword || payload.captchaId) {
      wx.showToast({
        title: "含密码或验证码的表单请联网后重试",
        icon: "none",
      });
      return;
    }
    const stored = wx.getStorageSync(OFFLINE_QUEUE);
    const queue = Array.isArray(stored) ? stored : [];
    const item = {
      ...payload,
      clientRequestId: payload.clientRequestId || createClientRequestId(),
      savedAt: Date.now(),
    };
    const existingIndex = queue.findIndex(
      (queued) => queued.clientRequestId && queued.clientRequestId === item.clientRequestId
    );
    if (existingIndex >= 0) queue[existingIndex] = item;
    else queue.push(item);
    wx.setStorageSync(OFFLINE_QUEUE, queue.slice(-MAX_OFFLINE_SUBMISSIONS));
    wx.showToast({ title: "已离线保存，联网后自动提交", icon: "none" });
  },

  refreshDraftMeta() {
    this.setData({
      draftCount: countDrafts(),
      draftLimit: getDraftLimit(),
    });
  },

  applyPendingDraft() {
    if (!this._pendingDraftId) return;
    const draft = getDraftById(this._pendingDraftId);
    this._pendingDraftId = "";
    if (draft) this.applyDraftRecord(draft, true);
  },

  applyDraftRecord(record, showToast = false) {
    if (!record?.values) return;
    const values = normalizeFormValues(this.data.fields, record.values);
    const patch = { values };

    if (this.data.pagedForm && record.currentSectionId) {
      const sectionIndex = this.data.sections.findIndex((item) => item.id === record.currentSectionId);
      patch.currentSectionId = record.currentSectionId;
      patch.currentSectionIndex = sectionIndex >= 0 ? sectionIndex : record.currentSectionIndex || 0;
      patch.isLastSection = patch.currentSectionIndex >= this.data.sections.length - 1;
    }

    this.setData(patch, () => {
      this.refreshDisplayFields(values);
      if (showToast) {
        wx.showToast({ title: "已填入草稿内容", icon: "success" });
      }
    });
  },

  async flushOfflineQueue() {
    if (!getLocalUser() || hasLoggedOut() || this._flushingOfflineQueue) return;
    const stored = wx.getStorageSync(OFFLINE_QUEUE);
    if (!Array.isArray(stored) || !stored.length) return;

    this._flushingOfflineQueue = true;
    try {
      while (true) {
        const current = wx.getStorageSync(OFFLINE_QUEUE);
        if (!Array.isArray(current) || !current.length) break;

        let item = current[0];
        if (!item.clientRequestId) {
          item = { ...item, clientRequestId: createClientRequestId() };
          current[0] = item;
          wx.setStorageSync(OFFLINE_QUEUE, current);
        }

        const res = await callCloud("submitForm", item);
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "离线提交失败", icon: "none" });
          break;
        }

        const latest = wx.getStorageSync(OFFLINE_QUEUE);
        if (Array.isArray(latest)) {
          const index = latest.findIndex(
            (queued) => queued.clientRequestId === item.clientRequestId
          );
          if (index >= 0) latest.splice(index, 1);
          wx.setStorageSync(OFFLINE_QUEUE, latest);
        }
        wx.showToast({ title: "离线数据已提交", icon: "success" });
      }
    } catch (e) {
      wx.showToast({ title: "离线提交失败，请稍后重试", icon: "none" });
    } finally {
      this._flushingOfflineQueue = false;
    }
  },

  onSaveDraftTap() {
    const { template, values } = this.data;
    const templateId = template?._id;
    if (!templateId || !hasFilledValues(values)) {
      wx.showToast({ title: "请先填写内容", icon: "none" });
      return;
    }

    const defaultName = template?.title || "未命名草稿";
    wx.showModal({
      title: "保存草稿",
      editable: true,
      placeholderText: "请输入草稿名称",
      content: defaultName,
      success: (res) => {
        if (!res.confirm) return;
        const draftName = (res.content || "").trim();
        if (!draftName) {
          wx.showToast({ title: "名称不能为空", icon: "none" });
          return;
        }
        this.saveDraftWithName(draftName);
      },
    });
  },

  saveDraftWithName(draftName) {
    const { template, fields, values, currentSectionId, currentSectionIndex } = this.data;
    const templateId = template?._id;
    if (!templateId || !hasFilledValues(values)) {
      wx.showToast({ title: "请先填写内容", icon: "none" });
      return;
    }

    const result = addDraft({
      templateId,
      templateTitle: template.title,
      draftName,
      fields,
      values,
      currentSectionId,
      currentSectionIndex,
    });

    if (!result.ok) {
      wx.showToast({
        title: result.reason === "empty_name" ? "名称不能为空" : "保存失败，请先填写内容",
        icon: "none",
      });
      return;
    }

    this.refreshDraftMeta();
    const atLimit = countDrafts() >= getDraftLimit();
    wx.showToast({
      title: atLimit ? `已保存（最多${getDraftLimit()}份，最早一份已移除）` : "已存入草稿箱",
      icon: "success",
    });
  },

  onOpenDraftBox() {
    this.setData({
      showDraftBox: true,
      draftList: listDrafts(),
      draftCount: countDrafts(),
      draftLimit: getDraftLimit(),
    });
  },

  onCloseDraftBox() {
    this.setData({ showDraftBox: false });
  },

  onApplyDraft(e) {
    const { draftId } = e.currentTarget.dataset;
    const draft = getDraftById(draftId);
    if (!draft) {
      wx.showToast({ title: "草稿不存在", icon: "none" });
      this.setData({ draftList: listDrafts(), draftCount: countDrafts() });
      return;
    }

    if (draft.templateId === this.data.template?._id) {
      this.applyDraftRecord(draft, true);
      this.setData({ showDraftBox: false });
      return;
    }

    const app = getApp();
    this._pendingDraftId = draftId;
    app.globalData.fillTemplateId = draft.templateId;
    this._templateId = draft.templateId;
    this.setData({ showDraftBox: false, loading: true });
    this.loadTemplate();
  },

  onDeleteDraft(e) {
    const { draftId, title } = e.currentTarget.dataset;
    wx.showModal({
      title: "删除草稿",
      content: `确定删除「${title || "该草稿"}」吗？`,
      success: (res) => {
        if (!res.confirm) return;
        removeDraftById(draftId);
        this.refreshDraftMeta();
        this.setData({
          draftList: listDrafts(),
          draftCount: countDrafts(),
        });
        wx.showToast({ title: "已删除", icon: "success" });
      },
    });
  },

  onRenameDraft(e) {
    const { draftId, name } = e.currentTarget.dataset;
    wx.showModal({
      title: "编辑草稿名称",
      editable: true,
      placeholderText: "请输入草稿名称",
      content: name || "",
      success: (res) => {
        if (!res.confirm) return;
        const nextName = (res.content || "").trim();
        if (!nextName) {
          wx.showToast({ title: "名称不能为空", icon: "none" });
          return;
        }
        const ok = renameDraft(draftId, nextName);
        if (!ok) {
          wx.showToast({ title: "重命名失败", icon: "none" });
          return;
        }
        this.setData({ draftList: listDrafts() });
        wx.showToast({ title: "名称已更新", icon: "success" });
      },
    });
  },

  onPasswordInput(e) {
    this.setData({ passwordInput: e.detail.value });
  },

  onVerifyPassword() {
    const { passwordInput, template } = this.data;
    if (!passwordInput.trim()) {
      wx.showToast({ title: "请输入访问密码", icon: "none" });
      return;
    }

    callCloud("verifyFormPassword", {
      templateId: template._id,
      password: passwordInput.trim(),
    }).then((res) => {
      if (res.result?.success) {
        this._formPassword = passwordInput.trim();
        this._verifiedPasswordTemplateId = template._id;
        this.setData({
          passwordVerified: true,
          showPassword: false,
          passwordInput: "",
        });
        wx.showToast({ title: "验证成功", icon: "success" });
      } else {
        wx.showToast({ title: res.result?.errMsg || "密码错误", icon: "none" });
      }
    });
  },

  onSubmit() {
    if (!this.checkEnv() || this.data.formClosed || this.data.quotaFull || this.data.accessBlocked) return;
    if (!this.data.passwordVerified) {
      this.setData({ showPassword: true });
      return;
    }

    if (this.data.pagedForm && !this.data.isLastSection) {
      this.onNextSection();
      return;
    }

    const proceed = () => {
      const validation = validateForm(this.data.fields, this.data.values);
      if (!validation.ok) {
        wx.showToast({ title: validation.errMsg, icon: "none" });
        return;
      }

      const needPrivacy = this.data.template?.settings?.needPrivacy;
      if (needPrivacy && !this.data.privacyAccepted) {
        this.setData({ showPrivacy: true });
        return;
      }

      if (this.data.template?.settings?.captchaEnabled) {
        this.refreshCaptcha();
        this.setData({ showCaptcha: true });
        return;
      }

      this.doSubmit();
    };

    if (getLocalUser() && !hasLoggedOut()) {
      proceed();
      return;
    }

    trySilentLogin().then((user) => {
      if (!user) {
        wx.showModal({
          title: "登录提示",
          content: "提交表单前请先登录",
          cancelText: "取消",
          confirmText: "立即登录",
          confirmColor: "#0c3d7a",
          success: (res) => {
            if (res.confirm) {
              const tid = this._templateId || this.data.template?._id || "";
              const redirect = tid
                ? `/pages/fill/index?templateId=${tid}`
                : "/pages/fill/index";
              goLogin(redirect);
            }
          },
        });
        return;
      }
      this.setData({ needLogin: false });
      proceed();
    });
  },

  refreshCaptcha() {
    callCloud("getCaptcha")
      .then((res) => {
        if (res.result?.success) {
          this.setData({
            captchaId: res.result.captchaId,
            captchaQuestion: res.result.question,
            captchaAnswer: "",
          });
        } else {
          wx.showToast({ title: res.result?.errMsg || "验证码加载失败", icon: "none" });
        }
      })
      .catch(() => {
        wx.showToast({ title: "验证码加载失败", icon: "none" });
      });
  },

  onCaptchaInput(e) {
    this.setData({ captchaAnswer: e.detail.value });
  },

  onCaptchaConfirm() {
    if (!String(this.data.captchaAnswer).trim()) {
      wx.showToast({ title: "请输入验证码答案", icon: "none" });
      return;
    }
    this.setData({ showCaptcha: false });
    this.doSubmit();
  },

  onCaptchaRefresh() {
    this.refreshCaptcha();
  },

  onCaptchaCancel() {
    this.setData({ showCaptcha: false, captchaAnswer: "" });
  },

  onPrivacyAccept() {
    this.setData({ privacyAccepted: true, showPrivacy: false });
    if (this.data.template?.settings?.captchaEnabled) {
      this.refreshCaptcha();
      this.setData({ showCaptcha: true });
      return;
    }
    this.doSubmit();
  },

  onPrivacyReject() {
    this.setData({ showPrivacy: false });
    wx.showToast({ title: "需同意隐私协议才能提交", icon: "none" });
  },

  requestSubmitterNotify(template) {
    const settings = template?.settings || {};
    const tmplId = settings.submitterNotifyTemplateId;
    if (!settings.submitterNotifyEnabled || !tmplId) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [tmplId],
        success: (res) => resolve(res[tmplId] === "accept"),
        fail: () => resolve(false),
      });
    });
  },

  doSubmit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    const app = getApp();
    const template = this.data.template;
    let pendingPayload = null;

    this.requestSubmitterNotify(template)
      .then((submitterNotifyAccepted) => {
        pendingPayload = {
          templateId: template?._id,
          answers: this.data.values,
          formPassword: this._formPassword || "",
          launchScene: app.globalData.launchScene || 0,
          submitterNotifyAccepted,
          groupVerified: !!this._groupVerified,
          captchaId: this.data.captchaId,
          captchaAnswer: this.data.captchaAnswer,
          deviceId: getDeviceId(),
          clientRequestId: createClientRequestId(),
        };
        return callCloud("submitForm", pendingPayload);
      })
      .then((res) => {
        if (res.result?.success) {
          const settings = template?.settings || {};
          const redirectQuery = settings.successRedirectType
            ? `&redirectType=${settings.successRedirectType}&redirectAppId=${encodeURIComponent(settings.successRedirectAppId || "")}&redirectPath=${encodeURIComponent(settings.successRedirectPath || "")}&redirectUrl=${encodeURIComponent(settings.successRedirectUrl || "")}`
            : "";

          if (res.result?.needPayment) {
            const submissionId = res.result.id;
            const amount = res.result.paymentAmount || 0;
            wx.redirectTo({
              url: `/pages/success/index?needPayment=1&submissionId=${submissionId}&amount=${amount}&formNo=${encodeURIComponent(res.result.formNo || "")}&checkCode=${encodeURIComponent(res.result.checkCode || "")}&title=${encodeURIComponent("提交成功，请完成支付")}&desc=${encodeURIComponent(`需支付 ¥${amount} 完成报名`)}${redirectQuery}`,
            });
            return;
          }

          const title = encodeURIComponent(res.result.successTitle || "提交成功");
          const desc = encodeURIComponent(res.result.successDesc || "");
          let url = `/pages/success/index?title=${title}&desc=${desc}&submissionId=${res.result.id || ""}&formNo=${encodeURIComponent(res.result.formNo || "")}${redirectQuery}`;
          if (res.result.checkCode) {
            url += `&checkCode=${encodeURIComponent(res.result.checkCode)}`;
          }
          wx.redirectTo({ url });
        } else {
          wx.showToast({ title: res.result?.errMsg || "提交失败", icon: "none" });
        }
      })
      .catch((e) => {
        const { errMsg = "" } = e;
        if (errMsg.includes("request:fail") || errMsg.includes("timeout")) {
          if (pendingPayload) this.saveOfflineSubmission(pendingPayload);
          else this.handleCloudError(e);
        } else {
          this.handleCloudError(e);
        }
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  checkEnv() {
    const app = getApp();
    if (!app.globalData.env) {
      this.setData({
        showTip: true,
        tipTitle: "环境未配置",
        tipContent: "请在 miniprogram/app.js 中正确配置 env 云环境 ID。",
      });
      return false;
    }
    return true;
  },

  handleCloudError(e) {
    const { errMsg = "" } = e;
    if (errMsg.includes("Environment not found")) {
      this.setData({
        showTip: true,
        tipTitle: "云开发环境未找到",
        tipContent: "请检查 app.js 中的 env 参数是否与云开发控制台的环境 ID 一致。",
      });
    } else if (errMsg.includes("FunctionName parameter could not be found")) {
      this.setData({
        showTip: true,
        tipTitle: "请上传云函数",
        tipContent:
          "在 cloudfunctions/quickstartFunctions 目录右键，选择【上传并部署-云端安装依赖】。",
      });
    } else {
      wx.showToast({ title: "操作失败，请重试", icon: "none" });
    }
  },

  goToList() {
    goPage("/pages/list/index");
  },
});
