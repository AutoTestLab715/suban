const { callCloud, ensureAdmin } = require("../../../utils/admin");
const {
  FIELD_TYPE_OPTIONS,
  FIELD_TYPE_LABELS,
  createEmptyField,
} = require("../../../utils/formEngine");

const SHOW_IF_OPERATORS = [
  { value: "eq", label: "等于" },
  { value: "neq", label: "不等于" },
  { value: "contains", label: "包含" },
  { value: "notContains", label: "不包含" },
  { value: "empty", label: "为空" },
  { value: "notEmpty", label: "不为空" },
];

function computeShifts(from, to, heights, gap) {
  const dragH = heights[from] || 0;
  const shift = dragH + gap;
  return heights.map((_, i) => {
    if (from < to && i > from && i <= to) return -shift;
    if (from > to && i >= to && i < from) return shift;
    return 0;
  });
}

function getDragZIndex(i, dragIndex, hoverIndex) {
  if (i === dragIndex) return 50;
  const min = Math.min(dragIndex, hoverIndex);
  const max = Math.max(dragIndex, hoverIndex);
  if (i >= min && i <= max) return 30 - Math.abs(i - dragIndex);
  return 1;
}

Page({
  data: {
    loading: true,
    saving: false,
    template: null,
    fields: [],
    renderFields: [],
    typeOptions: FIELD_TYPE_OPTIONS,
    typeLabels: FIELD_TYPE_LABELS,
    showEditor: false,
    editingIndex: -1,
    editingField: null,
    typeIndex: 0,
    showIfEnabled: false,
    showIfFieldIndex: 0,
    showIfValue: "",
    showIfOperators: SHOW_IF_OPERATORS,
    showIfOperatorIndex: 0,
    optionsText: "",
    isDragging: false,
    dragIndex: -1,
    hoverIndex: -1,
    dragOffsetY: 0,
    templateId: "",
    pagedForm: false,
    sectionIdInput: "",
    jumpRulesText: "",
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

  syncRenderFields(patch = {}) {
    const state = { ...this.data, ...patch };
    const { fields, isDragging, dragIndex, hoverIndex, dragOffsetY } = state;
    const heights = this._heights || [];
    const gap = this._gap || 0;
    const shifts = isDragging ? computeShifts(dragIndex, hoverIndex, heights, gap) : [];

    const renderFields = (fields || []).map((field, i) => ({
      ...field,
      shiftY: isDragging ? (i === dragIndex ? dragOffsetY : shifts[i] || 0) : 0,
      zIndex: isDragging ? getDragZIndex(i, dragIndex, hoverIndex) : 1,
    }));

    this.setData({ ...patch, renderFields });
  },

  setFields(fields, extra = {}) {
    this.setData({ fields, ...extra }, () => {
      this.syncRenderFields();
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
        const fields = template.fields || [];
        this.setData({
          template,
          fields,
          pagedForm: !!template.settings?.pagedForm,
          loading: false,
        });
        this.syncRenderFields();
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  measureCardRects() {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .in(this)
        .selectAll(".field-card")
        .boundingClientRect((rects) => {
          resolve(rects || []);
        })
        .exec();
    });
  },

  onDragStart(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;

    const touch = e.touches?.[0];
    if (!touch) return;

    wx.vibrateShort({ type: "light" });
    this.measureCardRects().then((rects) => {
      if (!rects[index]) return;

      this._heights = rects.map((r) => r.height);
      this._gap =
        rects.length > 1
          ? Math.max(0, rects[1].top - rects[0].top - rects[0].height)
          : 8;
      this._cardRectsCache = rects;
      this._startTouchY = touch.clientY;
      this._dragIndex = index;

      this.syncRenderFields({
        isDragging: true,
        dragIndex: index,
        hoverIndex: index,
        dragOffsetY: 0,
      });
    });
  },

  onDragMove(e) {
    if (!this.data.isDragging) return;

    const touch = e.touches?.[0];
    if (!touch) return;

    const rects = this._cardRectsCache;
    if (!rects?.length) {
      this.measureCardRects().then((nextRects) => {
        this._cardRectsCache = nextRects;
      });
      return;
    }

    const dragOffsetY = touch.clientY - this._startTouchY;
    let hover = 0;
    for (let i = 0; i < rects.length; i++) {
      const mid = rects[i].top + rects[i].height / 2;
      if (touch.clientY >= mid) hover = i;
    }
    hover = Math.max(0, Math.min(hover, this.data.fields.length - 1));

    this.syncRenderFields({
      dragOffsetY,
      hoverIndex: hover,
    });
  },

  onDragEnd() {
    if (!this.data.isDragging) return;

    const { dragIndex, hoverIndex, fields } = this.data;
    let nextFields = fields;

    if (dragIndex >= 0 && hoverIndex >= 0 && dragIndex !== hoverIndex) {
      nextFields = [...fields];
      const [item] = nextFields.splice(dragIndex, 1);
      nextFields.splice(hoverIndex, 0, item);
    }

    this._heights = [];
    this._gap = 0;
    this._cardRectsCache = null;
    this._dragIndex = -1;

    this.setData(
      {
        fields: nextFields,
        isDragging: false,
        dragIndex: -1,
        hoverIndex: -1,
        dragOffsetY: 0,
      },
      () => {
        this.syncRenderFields();
      }
    );
  },

  onAddField() {
    const field = createEmptyField("text");
    this.openEditor(field, -1);
  },

  onEditField(e) {
    const { index } = e.currentTarget.dataset;
    const field = JSON.parse(JSON.stringify(this.data.fields[index]));
    this.openEditor(field, Number(index));
  },

  openEditor(field, index) {
    const typeIndex = FIELD_TYPE_OPTIONS.findIndex((o) => o.type === field.type);
    const showIfEnabled = !!(field.showIf && field.showIf.fieldId);
    let showIfFieldIndex = 0;
    if (showIfEnabled) {
      showIfFieldIndex = this.data.fields.findIndex((f) => f.id === field.showIf.fieldId);
      if (showIfFieldIndex < 0) showIfFieldIndex = 0;
    }
    const op = field.showIf?.operator || "eq";
    const showIfOperatorIndex = SHOW_IF_OPERATORS.findIndex((o) => o.value === op);

    this.setData({
      showEditor: true,
      editingIndex: index,
      editingField: field,
      typeIndex: typeIndex >= 0 ? typeIndex : 0,
      showIfEnabled,
      showIfFieldIndex: showIfFieldIndex >= 0 ? showIfFieldIndex : 0,
      showIfValue: field.showIf?.value || "",
      showIfOperatorIndex: showIfOperatorIndex >= 0 ? showIfOperatorIndex : 0,
      sectionIdInput: field.sectionId || "",
      jumpRulesText: field.jumpRules ? JSON.stringify(field.jumpRules) : "",
      optionsText: (field.options || []).join("\n"),
    });
  },

  closeEditor() {
    this.setData({ showEditor: false, editingField: null, editingIndex: -1 });
  },

  onEditorInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`editingField.${field}`]: e.detail.value });
  },

  onEditorSwitch(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`editingField.${field}`]: e.detail.value });
  },

  onTypeChange(e) {
    const typeIndex = Number(e.detail.value);
    const type = FIELD_TYPE_OPTIONS[typeIndex].type;
    this.setData({
      typeIndex,
      "editingField.type": type,
    });
  },

  onOptionsInput(e) {
    const optionsText = e.detail.value;
    const options = optionsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    this.setData({
      optionsText,
      "editingField.options": options.length ? options : ["选项1"],
    });
  },

  onShowIfSwitch(e) {
    this.setData({ showIfEnabled: e.detail.value });
  },

  onShowIfFieldChange(e) {
    this.setData({ showIfFieldIndex: Number(e.detail.value) });
  },

  onShowIfValueInput(e) {
    this.setData({ showIfValue: e.detail.value });
  },

  onShowIfOperatorChange(e) {
    this.setData({ showIfOperatorIndex: Number(e.detail.value) });
  },

  onJumpRulesInput(e) {
    this.setData({ jumpRulesText: e.detail.value });
  },

  onSectionIdInput(e) {
    this.setData({ sectionIdInput: e.detail.value });
  },

  saveEditor() {
    const {
      editingField,
      editingIndex,
      fields,
      showIfEnabled,
      showIfFieldIndex,
      showIfValue,
      showIfOperators,
      showIfOperatorIndex,
      sectionIdInput,
      jumpRulesText,
      pagedForm,
    } = this.data;

    if (!editingField.label?.trim()) {
      wx.showToast({ title: "请填写字段名称", icon: "none" });
      return;
    }
    if (!editingField.id?.trim()) {
      wx.showToast({ title: "请填写字段 ID", icon: "none" });
      return;
    }

    const field = { ...editingField, label: editingField.label.trim(), id: editingField.id.trim() };

    if (showIfEnabled && fields[showIfFieldIndex]) {
      const operator = showIfOperators[showIfOperatorIndex]?.value || "eq";
      field.showIf = {
        fieldId: fields[showIfFieldIndex].id,
        operator,
        value: showIfValue.trim(),
      };
    } else {
      delete field.showIf;
    }

    if (pagedForm && sectionIdInput.trim()) {
      field.sectionId = sectionIdInput.trim();
    } else {
      delete field.sectionId;
    }
    if (pagedForm && jumpRulesText.trim()) {
      try {
        field.jumpRules = JSON.parse(jumpRulesText);
      } catch (e) {
        wx.showToast({ title: "跳转规则 JSON 格式错误", icon: "none" });
        return;
      }
    } else {
      delete field.jumpRules;
    }

    if (field.min !== undefined && field.min !== "") field.min = Number(field.min);
    else delete field.min;
    if (field.max !== undefined && field.max !== "") field.max = Number(field.max);
    else delete field.max;
    if (!field.pattern) delete field.pattern;
    if (!field.patternMsg) delete field.patternMsg;

    const nextFields = [...fields];
    if (editingIndex >= 0) {
      nextFields[editingIndex] = field;
    } else {
      if (nextFields.some((f) => f.id === field.id)) {
        wx.showToast({ title: "字段 ID 已存在", icon: "none" });
        return;
      }
      nextFields.push(field);
    }

    this.setFields(nextFields, {
      showEditor: false,
      editingField: null,
      editingIndex: -1,
    });
  },

  onDeleteField(e) {
    const { index } = e.currentTarget.dataset;
    wx.showModal({
      title: "删除字段",
      content: "确定删除该字段吗？",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        const fields = [...this.data.fields];
        fields.splice(Number(index), 1);
        this.setFields(fields);
      },
    });
  },

  onSaveAll() {
    if (!this.data.fields.length) {
      wx.showToast({ title: "至少保留一个字段", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    callCloud("updateFormTemplate", {
      templateId: this.data.template?._id,
      fields: this.data.fields,
    })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: "字段已保存", icon: "success" });
          const fields = res.result.template.fields || [];
          this.setData({ template: res.result.template, fields }, () => {
            this.syncRenderFields();
          });
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
});
