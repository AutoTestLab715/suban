const { callCloud, ensureAdmin } = require("../../../utils/admin");

const SUBMIT_LIMIT_OPTIONS = [
  { value: "none", label: "不限次数" },
  { value: "once", label: "每人仅1次" },
  { value: "daily", label: "每日限1次" },
];

const ACCESS_MODE_OPTIONS = [
  { value: "public", label: "公开访问" },
  { value: "share_only", label: "仅分享/扫码进入" },
  { value: "friend_only", label: "仅好友私聊分享" },
  { value: "group_only", label: "仅微信群内可填" },
];

const HOME_SERVICE_OPTIONS = [
  { value: "", label: "不关联首页入口" },
  { value: "special", label: "专精代为" },
  { value: "tender", label: "标书代为" },
  { value: "declare", label: "证书委托" },
  { value: "high", label: "高新代为" },
  { value: "talent", label: "人才合作" },
  { value: "other", label: "其他需求" },
];

const HOME_SERVICE_RULES = [
  { key: "special", keys: ["专精代为", "专精特新", "专精"] },
  { key: "tender", keys: ["标书代为", "标书代写", "标书代办", "代写标书", "标书", "投标", "招标文件"] },
  { key: "declare", keys: ["证书委托", "证书"] },
  { key: "high", keys: ["高新代为", "高新代办", "高新"] },
  { key: "talent", keys: ["人才合作", "人才"] },
  { key: "other", keys: ["其他需求"] },
];

const inferHomeServiceKey = (title) => {
  const text = String(title || "").replace(/\s+/g, "").trim();
  if (!text) return "";
  let bestKey = "";
  let bestLen = 0;
  HOME_SERVICE_RULES.forEach((rule) => {
    (rule.keys || []).forEach((word) => {
      const needle = String(word || "").replace(/\s+/g, "");
      if (needle && text.includes(needle) && needle.length > bestLen) {
        bestKey = rule.key;
        bestLen = needle.length;
      }
    });
  });
  return bestKey;
};

Page({
  data: {
    loading: true,
    saving: false,
    templateId: "",
    template: null,
    form: {
      title: "",
      description: "",
      homeServiceKey: "",
      coverImage: "",
      logoImage: "",
      accessMode: "public",
      shareOnlyMsg: "",
      friendOnlyMsg: "",
      groupOnlyMsg: "",
      openidWhitelistEnabled: false,
      openidWhitelist: "",
      openidWhitelistDenyMsg: "",
      successRedirectType: "none",
      successRedirectAppId: "",
      successRedirectPath: "",
      successRedirectUrl: "",
      submitterNotifyEnabled: false,
      submitterNotifyTemplateId: "",
      submitLimit: "none",
      allowEditSubmission: true,
      needPrivacy: true,
      privacyTitle: "",
      privacyText: "",
      submitButtonText: "提交",
      successTitle: "提交成功",
      successDesc: "",
      themeColor: "#0d4a9c",
      openAt: "",
      closeAt: "",
      notOpenMsg: "",
      closedMsg: "",
      accessPassword: "",
      maxSubmissions: "",
      quotaFullMsg: "",
      paymentAmount: "",
      paymentMchId: "",
      whitelistEnabled: false,
      phoneWhitelist: "",
      whitelistDenyMsg: "",
      footerText: "",
      uploadMaxSizeMB: "10",
      uploadAllowedExts: "jpg,jpeg,png,pdf,doc,docx",
      checkinEnabled: false,
      captchaEnabled: false,
      maxSubmitsPerHour: "",
      rateLimitMsg: "",
      anomalyThreshold: "3",
      smsEnabled: false,
      smsWebhookUrl: "",
      smsSecret: "",
      smsNotifyPhones: "",
      smsDigestEnabled: false,
      smsSubmitterEnabled: false,
      tencentSmsEnabled: false,
      tencentSecretId: "",
      tencentSecretKey: "",
      tencentSmsAppId: "",
      tencentSmsSign: "",
      tencentSmsTemplateId: "",
      tencentSmsRegion: "ap-guangzhou",
      autoDigestEnabled: false,
      digestHour: "9",
      autoBackupEnabled: false,
      duplicateCheckEnabled: false,
      duplicateWindowMinutes: "5",
      duplicateMsg: "",
      deviceLimitEnabled: false,
      maxSubmitsPerDevice: "3",
      deviceLimitMsg: "",
      ipLimitEnabled: false,
      maxSubmitsPerIp: "10",
      ipLimitMsg: "",
      oaName: "",
      oaArticleUrl: "",
      pagedForm: false,
      sectionsText: "",
    },
    submitLimitOptions: SUBMIT_LIMIT_OPTIONS,
    submitLimitIndex: 0,
    accessModeOptions: ACCESS_MODE_OPTIONS,
    accessModeIndex: 0,
    homeServiceOptions: HOME_SERVICE_OPTIONS,
    homeServiceIndex: 0,
    digestHourOptions: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
    digestHourIndex: 9,
  },

  onLoad(options) {
    if (options.templateId) {
      this.setData({ templateId: options.templateId });
    }
  },

  onShow() {
    ensureAdmin("config").then((result) => {
      if (result && !this._loadedOnce) {
        this._loadedOnce = true;
        this.loadTemplate();
      }
    });
  },

  loadTemplate() {
    this.setData({ loading: true });
    callCloud("getFormTemplate", { forAdmin: true, templateId: this.data.templateId || undefined })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }

        const template = res.result.template;
        const settings = template.settings || {};
        const submitLimit = settings.submitLimit || "none";
        const limitIndex = SUBMIT_LIMIT_OPTIONS.findIndex((o) => o.value === submitLimit);
        const accessMode = settings.accessMode || "public";
        const accessIndex = ACCESS_MODE_OPTIONS.findIndex((o) => o.value === accessMode);
        const homeServiceKey =
          String(settings.homeServiceKey || "").trim() || inferHomeServiceKey(template.title);
        const homeServiceIndex = Math.max(
          0,
          HOME_SERVICE_OPTIONS.findIndex((o) => o.value === homeServiceKey)
        );

        this.setData({
          template,
          form: {
            title: template.title || "",
            description: template.description || "",
            homeServiceKey,
            coverImage: settings.coverImage || "",
            logoImage: settings.logoImage || "",
            accessMode,
            shareOnlyMsg: settings.shareOnlyMsg || "",
            friendOnlyMsg: settings.friendOnlyMsg || "",
            groupOnlyMsg: settings.groupOnlyMsg || "",
            openidWhitelistEnabled: !!settings.openidWhitelistEnabled,
            openidWhitelist: Array.isArray(settings.openidWhitelist)
              ? settings.openidWhitelist.join("\n")
              : settings.openidWhitelist || "",
            openidWhitelistDenyMsg: settings.openidWhitelistDenyMsg || "",
            successRedirectType: settings.successRedirectType || "none",
            successRedirectAppId: settings.successRedirectAppId || "",
            successRedirectPath: settings.successRedirectPath || "",
            successRedirectUrl: settings.successRedirectUrl || "",
            submitterNotifyEnabled: !!settings.submitterNotifyEnabled,
            submitterNotifyTemplateId: settings.submitterNotifyTemplateId || "",
            submitLimit,
            allowEditSubmission: settings.allowEditSubmission !== false,
            needPrivacy: settings.needPrivacy !== false,
            privacyTitle: settings.privacyTitle || "隐私保护提示",
            privacyText: settings.privacyText || "",
            submitButtonText: settings.submitButtonText || "提交",
            successTitle: settings.successTitle || "提交成功",
            successDesc: settings.successDesc || "",
            themeColor: settings.themeColor || "#0d4a9c",
            openAt: settings.openAt ? settings.openAt.slice(0, 10) : "",
            closeAt: settings.closeAt ? settings.closeAt.slice(0, 10) : "",
            notOpenMsg: settings.notOpenMsg || "",
            closedMsg: settings.closedMsg || "",
            accessPassword: settings.accessPassword || "",
            maxSubmissions: settings.maxSubmissions ? String(settings.maxSubmissions) : "",
            quotaFullMsg: settings.quotaFullMsg || "",
            paymentAmount: settings.paymentAmount ? String(settings.paymentAmount) : "",
            paymentMchId: settings.paymentMchId || "",
            whitelistEnabled: !!settings.whitelistEnabled,
            phoneWhitelist: Array.isArray(settings.phoneWhitelist)
              ? settings.phoneWhitelist.join("\n")
              : settings.phoneWhitelist || "",
            whitelistDenyMsg: settings.whitelistDenyMsg || "",
            footerText: settings.footerText || "",
            uploadMaxSizeMB: settings.uploadMaxSizeMB ? String(settings.uploadMaxSizeMB) : "10",
            uploadAllowedExts: settings.uploadAllowedExts || "jpg,jpeg,png,pdf,doc,docx",
            checkinEnabled: !!settings.checkinEnabled,
            captchaEnabled: !!settings.captchaEnabled,
            maxSubmitsPerHour: settings.maxSubmitsPerHour ? String(settings.maxSubmitsPerHour) : "",
            rateLimitMsg: settings.rateLimitMsg || "",
            anomalyThreshold: settings.anomalyThreshold ? String(settings.anomalyThreshold) : "3",
            smsEnabled: !!settings.smsEnabled,
            smsWebhookUrl: settings.smsWebhookUrl || "",
            smsSecret: settings.smsSecret || "",
            smsNotifyPhones: Array.isArray(settings.smsNotifyPhones)
              ? settings.smsNotifyPhones.join("\n")
              : settings.smsNotifyPhones || "",
            smsDigestEnabled: !!settings.smsDigestEnabled,
            smsSubmitterEnabled: !!settings.smsSubmitterEnabled,
            tencentSmsEnabled: !!settings.tencentSmsEnabled,
            tencentSecretId: settings.tencentSecretId || "",
            tencentSecretKey: settings.tencentSecretKey || "",
            tencentSmsAppId: settings.tencentSmsAppId || "",
            tencentSmsSign: settings.tencentSmsSign || "",
            tencentSmsTemplateId: settings.tencentSmsTemplateId || "",
            tencentSmsRegion: settings.tencentSmsRegion || "ap-guangzhou",
            autoDigestEnabled: !!settings.autoDigestEnabled,
            digestHour: settings.digestHour !== undefined ? String(settings.digestHour) : "9",
            autoBackupEnabled: !!settings.autoBackupEnabled,
            duplicateCheckEnabled: !!settings.duplicateCheckEnabled,
            duplicateWindowMinutes: settings.duplicateWindowMinutes
              ? String(settings.duplicateWindowMinutes)
              : "5",
            duplicateMsg: settings.duplicateMsg || "",
            deviceLimitEnabled: !!settings.deviceLimitEnabled,
            maxSubmitsPerDevice: settings.maxSubmitsPerDevice ? String(settings.maxSubmitsPerDevice) : "3",
            deviceLimitMsg: settings.deviceLimitMsg || "",
            ipLimitEnabled: !!settings.ipLimitEnabled,
            maxSubmitsPerIp: settings.maxSubmitsPerIp ? String(settings.maxSubmitsPerIp) : "10",
            ipLimitMsg: settings.ipLimitMsg || "",
            oaName: settings.oaName || "",
            oaArticleUrl: settings.oaArticleUrl || "",
            pagedForm: !!settings.pagedForm,
            sectionsText: JSON.stringify(
              template.sections || [{ id: "default", title: "表单内容" }],
              null,
              2
            ),
          },
          submitLimitIndex: limitIndex >= 0 ? limitIndex : 1,
          accessModeIndex: accessIndex >= 0 ? accessIndex : 0,
          homeServiceIndex,
          digestHourIndex: Number(settings.digestHour ?? 9),
          loading: false,
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onSwitchChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onLimitChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      submitLimitIndex: index,
      "form.submitLimit": SUBMIT_LIMIT_OPTIONS[index].value,
    });
  },

  onDateChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onAccessModeChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      accessModeIndex: index,
      "form.accessMode": ACCESS_MODE_OPTIONS[index].value,
    });
  },

  onHomeServiceChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      homeServiceIndex: index,
      "form.homeServiceKey": HOME_SERVICE_OPTIONS[index].value,
    });
  },

  onRedirectTypeChange(e) {
    const map = ["none", "miniprogram", "web"];
    this.setData({ "form.successRedirectType": map[Number(e.detail.value)] || "none" });
  },

  uploadSettingImage(e) {
    const { field } = e.currentTarget.dataset;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath;
        wx.showLoading({ title: "上传中" });
        wx.cloud
          .uploadFile({
            cloudPath: `templates/${field}-${Date.now()}.jpg`,
            filePath: path,
          })
          .then((r) => {
            wx.hideLoading();
            this.setData({ [`form.${field}`]: r.fileID });
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: "上传失败", icon: "none" });
          });
      },
    });
  },

  onRemoveSettingImage(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: "" });
  },

  onDigestHourChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      digestHourIndex: index,
      "form.digestHour": String(index),
    });
  },

  onSave() {
    const { form, template } = this.data;
    if (!form.title.trim()) {
      wx.showToast({ title: "请填写表单标题", icon: "none" });
      return;
    }

    this.setData({ saving: true });

    const settings = {
      submitLimit: form.submitLimit,
      allowEditSubmission: !!form.allowEditSubmission,
      needPrivacy: form.needPrivacy,
      // 空值时按标题/原标题推断，改名后仍能绑在同一首页入口
      homeServiceKey:
        String(form.homeServiceKey || "").trim() ||
        inferHomeServiceKey(form.title) ||
        inferHomeServiceKey(template?.title) ||
        "",
      privacyTitle: form.privacyTitle.trim(),
      privacyText: form.privacyText.trim(),
      submitButtonText: form.submitButtonText.trim() || "提交",
      successTitle: form.successTitle.trim() || "提交成功",
      successDesc: form.successDesc.trim(),
      themeColor: form.themeColor.trim() || "#0d4a9c",
      coverImage: form.coverImage || "",
      logoImage: form.logoImage || "",
      accessMode: form.accessMode || "public",
      shareOnlyMsg: form.shareOnlyMsg.trim(),
      friendOnlyMsg: form.friendOnlyMsg.trim(),
      groupOnlyMsg: form.groupOnlyMsg.trim(),
      openidWhitelistEnabled: !!form.openidWhitelistEnabled,
      openidWhitelist: form.openidWhitelist
        .split(/[\n,，;；\s]+/)
        .map((p) => p.trim())
        .filter(Boolean),
      openidWhitelistDenyMsg: form.openidWhitelistDenyMsg.trim(),
      successRedirectType: form.successRedirectType || "none",
      successRedirectAppId: form.successRedirectAppId.trim(),
      successRedirectPath: form.successRedirectPath.trim(),
      successRedirectUrl: form.successRedirectUrl.trim(),
      submitterNotifyEnabled: !!form.submitterNotifyEnabled,
      submitterNotifyTemplateId: form.submitterNotifyTemplateId.trim(),
      openAt: form.openAt ? `${form.openAt}T00:00:00` : "",
      closeAt: form.closeAt ? `${form.closeAt}T23:59:59` : "",
      notOpenMsg: form.notOpenMsg.trim(),
      closedMsg: form.closedMsg.trim(),
      accessPassword: form.accessPassword.trim(),
      maxSubmissions: form.maxSubmissions ? Number(form.maxSubmissions) : 0,
      quotaFullMsg: form.quotaFullMsg.trim(),
      paymentAmount: form.paymentAmount ? Number(form.paymentAmount) : 0,
      paymentMchId: form.paymentMchId.trim(),
      whitelistEnabled: !!form.whitelistEnabled,
      phoneWhitelist: form.phoneWhitelist
        .split(/[\n,，;；\s]+/)
        .map((p) => p.trim())
        .filter(Boolean),
      whitelistDenyMsg: form.whitelistDenyMsg.trim(),
      footerText: form.footerText.trim(),
      uploadMaxSizeMB: form.uploadMaxSizeMB ? Number(form.uploadMaxSizeMB) : 10,
      uploadAllowedExts: form.uploadAllowedExts.trim() || "jpg,jpeg,png,pdf,doc,docx",
      checkinEnabled: !!form.checkinEnabled,
      captchaEnabled: !!form.captchaEnabled,
      maxSubmitsPerHour: form.maxSubmitsPerHour ? Number(form.maxSubmitsPerHour) : 0,
      rateLimitMsg: form.rateLimitMsg.trim(),
      anomalyThreshold: form.anomalyThreshold ? Number(form.anomalyThreshold) : 3,
      smsEnabled: !!form.smsEnabled,
      smsWebhookUrl: form.smsWebhookUrl.trim(),
      smsSecret: form.smsSecret.trim(),
      smsNotifyPhones: form.smsNotifyPhones
        .split(/[\n,，;；\s]+/)
        .map((p) => p.trim())
        .filter(Boolean),
      smsDigestEnabled: !!form.smsDigestEnabled,
      smsSubmitterEnabled: !!form.smsSubmitterEnabled,
      tencentSmsEnabled: !!form.tencentSmsEnabled,
      tencentSecretId: form.tencentSecretId.trim(),
      tencentSecretKey: form.tencentSecretKey.trim(),
      tencentSmsAppId: form.tencentSmsAppId.trim(),
      tencentSmsSign: form.tencentSmsSign.trim(),
      tencentSmsTemplateId: form.tencentSmsTemplateId.trim(),
      tencentSmsRegion: form.tencentSmsRegion.trim() || "ap-guangzhou",
      autoDigestEnabled: !!form.autoDigestEnabled,
      digestHour: form.digestHour !== undefined && form.digestHour !== "" ? Number(form.digestHour) : 9,
      autoBackupEnabled: !!form.autoBackupEnabled,
      duplicateCheckEnabled: !!form.duplicateCheckEnabled,
      duplicateWindowMinutes: form.duplicateWindowMinutes ? Number(form.duplicateWindowMinutes) : 5,
      duplicateMsg: form.duplicateMsg.trim(),
      deviceLimitEnabled: !!form.deviceLimitEnabled,
      maxSubmitsPerDevice: form.maxSubmitsPerDevice ? Number(form.maxSubmitsPerDevice) : 3,
      deviceLimitMsg: form.deviceLimitMsg.trim(),
      ipLimitEnabled: !!form.ipLimitEnabled,
      maxSubmitsPerIp: form.maxSubmitsPerIp ? Number(form.maxSubmitsPerIp) : 10,
      ipLimitMsg: form.ipLimitMsg.trim(),
      oaName: form.oaName.trim(),
      oaArticleUrl: form.oaArticleUrl.trim(),
      pagedForm: !!form.pagedForm,
    };

    let sections = [{ id: "default", title: "表单内容" }];
    if (form.sectionsText.trim()) {
      try {
        const parsed = JSON.parse(form.sectionsText);
        if (!Array.isArray(parsed) || !parsed.length) {
          wx.showToast({ title: "分节配置需为非空 JSON 数组", icon: "none" });
          this.setData({ saving: false });
          return;
        }
        sections = parsed;
      } catch (e) {
        wx.showToast({ title: "分节 JSON 格式错误", icon: "none" });
        this.setData({ saving: false });
        return;
      }
    }

    callCloud("updateFormTemplate", {
      templateId: template?._id,
      title: form.title.trim(),
      description: form.description.trim(),
      settings,
      sections,
    })
      .then((res) => {
        if (res.result?.success) {
          try {
            const app = getApp();
            if (app?.globalData?.pageCache?.publicForms) {
              delete app.globalData.pageCache.publicForms;
            }
          } catch (e) {
            // ignore
          }
          wx.showToast({ title: "保存成功", icon: "success" });
          this.setData({ template: res.result.template });
        } else {
          wx.showToast({ title: res.result?.errMsg || "保存失败", icon: "none" });
        }
      })
      .catch(() => {
        wx.showToast({ title: "保存失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  },

  goFields() {
    wx.navigateTo({ url: "/pages/admin/fields/index" });
  },

  goStats() {
    wx.navigateTo({ url: "/pages/admin/stats/index" });
  },

  goShare() {
    wx.navigateTo({ url: "/pages/admin/share/index" });
  },
});
