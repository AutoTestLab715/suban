const { callCloud, trySilentLogin, saveLoginRedirect, goLogin } = require("../../utils/admin");
const {
  initFormValues,
  validateForm,
  normalizeFormValues,
  getEffectiveSections,
  getSectionVisibleFields,
  resolveJumpSection,
} = require("../../utils/formEngine");

Page({
  data: {
    loading: true,
    needLogin: false,
    saving: false,
    submissionId: "",
    template: null,
    fields: [],
    values: {},
    uploadSettings: {},
    themeColor: "#0c3d7a",
    pagedForm: false,
    sections: [],
    currentSectionId: "",
    currentSectionIndex: 0,
    displayFields: [],
    isLastSection: true,
    showTip: false,
    tipTitle: "",
    tipContent: "",
  },

  onLoad(options) {
    this._submissionId = options.id || "";
    this.setData({ submissionId: this._submissionId });
  },

  onShow() {
    if (!this._submissionId) {
      wx.showToast({ title: "参数错误", icon: "none" });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const redirectUrl = `/pages/editsubmit/index?id=${this._submissionId}`;
    saveLoginRedirect(redirectUrl);
    trySilentLogin().then((user) => {
      if (!user) {
        this.setData({ loading: false });
        goLogin(redirectUrl);
        return;
      }
      this.setData({ needLogin: false });
      if (!this._loadedOnce) {
        this._loadedOnce = true;
        this.loadSubmission();
      }
    });
  },

  loadSubmission() {
    this.setData({ loading: true });
    callCloud("getMySubmissionForEdit", { id: this._submissionId })
      .then((res) => {
        if (!res.result?.success) {
          wx.showModal({
            title: "无法修改",
            content: res.result?.errMsg || "加载失败",
            showCancel: false,
            success: () => wx.navigateBack(),
          });
          return;
        }

        const template = res.result.template;
        const submission = res.result.submission;
        const fields = template.fields || [];
        const values = normalizeFormValues(fields, {
          ...initFormValues(fields),
          ...(submission.answers || {}),
        });
        const sections = getEffectiveSections(template);
        const pagedForm = !!template.settings?.pagedForm && sections.length > 0;
        const currentSectionId = sections[0]?.id || "default";

        this.setData({
          template,
          fields,
          values,
          loading: false,
          pagedForm,
          sections,
          currentSectionId,
          currentSectionIndex: 0,
          displayFields: pagedForm
            ? getSectionVisibleFields(fields, currentSectionId, values, template)
            : fields,
          isLastSection: !pagedForm || sections.length <= 1,
          uploadSettings: {
            uploadMaxSizeMB: template.settings?.uploadMaxSizeMB || 10,
            uploadAllowedExts: template.settings?.uploadAllowedExts || "jpg,jpeg,png,pdf,doc,docx",
          },
          themeColor: template.settings?.themeColor || "#0c3d7a",
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  refreshDisplayFields(values = this.data.values) {
    if (!this.data.pagedForm) {
      this.setData({ displayFields: this.data.fields, isLastSection: true });
      return;
    }
    const idx = this.data.sections.findIndex((s) => s.id === this.data.currentSectionId);
    this.setData({
      displayFields: getSectionVisibleFields(
        this.data.fields,
        this.data.currentSectionId,
        values,
        this.data.template
      ),
      isLastSection: idx >= this.data.sections.length - 1,
    });
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
      this.onSave();
      return;
    }
    const nextIndex = this.data.sections.findIndex((s) => s.id === nextId);
    this.setData({
      currentSectionId: nextId,
      currentSectionIndex: nextIndex >= 0 ? nextIndex : this.data.currentSectionIndex + 1,
      isLastSection: nextIndex >= this.data.sections.length - 1,
    });
    this.refreshDisplayFields();
  },

  onSave() {
    if (this.data.pagedForm && !this.data.isLastSection) {
      this.onNextSection();
      return;
    }

    const validation = validateForm(this.data.fields, this.data.values);
    if (!validation.ok) {
      wx.showToast({ title: validation.errMsg, icon: "none" });
      return;
    }

    this.setData({ saving: true });
    callCloud("updateMySubmission", {
      id: this._submissionId,
      answers: this.data.values,
    })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "修改已保存", icon: "success" });
          setTimeout(() => wx.navigateBack(), 600);
        } else {
          wx.showToast({ title: res.result?.errMsg || "保存失败", icon: "none" });
        }
      })
      .catch(() => wx.showToast({ title: "保存失败", icon: "none" }))
      .finally(() => this.setData({ saving: false }));
  },
});
