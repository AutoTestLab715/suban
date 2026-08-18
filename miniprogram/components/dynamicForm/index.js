const { getVisibleFields } = require("../../utils/formEngine");

Component({
  properties: {
    fields: { type: Array, value: [] },
    values: { type: Object, value: {} },
    uploadSettings: { type: Object, value: {} },
  },

  data: {
    visibleFields: [],
    pickerIndex: {},
    checkboxChecked: {},
    signFieldId: "",
    signing: false,
  },

  observers: {
    "fields, values"() {
      this.syncState();
    },
  },

  lifetimes: {
    detached() {
      this._signCtx = null;
    },
  },

  methods: {
    syncState() {
      const { fields, values } = this.properties;
      const visibleFields = getVisibleFields(fields || [], values || {}).map((field) => {
        const next = { ...field };
        if (field.type === "image") {
          const count = Array.isArray(values[field.id]) ? values[field.id].length : 0;
          next.showUploadAdd = count < (field.maxCount || 3);
        }
        if (field.type === "file") {
          const count = Array.isArray(values[field.id]) ? values[field.id].length : 0;
          next.showUploadAdd = count < (field.maxCount || 1);
        }
        if (field.type === "textarea" && field.maxLength) {
          const text = values[field.id];
          next.textLength = text ? String(text).length : 0;
        }
        return next;
      });
      const pickerIndex = {};
      const checkboxChecked = {};

      visibleFields.forEach((field) => {
        if (field.type === "select") {
          const idx = (field.options || []).indexOf(values[field.id]);
          pickerIndex[field.id] = idx >= 0 ? idx : 0;
        }
        if (field.type === "checkbox") {
          checkboxChecked[field.id] = {};
          (field.options || []).forEach((opt) => {
            checkboxChecked[field.id][opt] = (values[field.id] || []).includes(opt);
          });
        }
      });

      this.setData({ visibleFields, pickerIndex, checkboxChecked });
    },

    getUploadRules() {
      const s = this.properties.uploadSettings || {};
      return {
        maxSizeMB: Number(s.uploadMaxSizeMB || 10),
        allowedExts: String(s.uploadAllowedExts || "jpg,jpeg,png,pdf,doc,docx,xls,xlsx")
          .split(/[,，;；\s]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      };
    },

    checkFileAllowed(fileName, fileSize) {
      const { maxSizeMB, allowedExts } = this.getUploadRules();
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (fileSize && fileSize > maxBytes) {
        wx.showToast({ title: `文件不能超过${maxSizeMB}MB`, icon: "none" });
        return false;
      }
      if (allowedExts.length && fileName) {
        const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase() : "";
        if (ext && !allowedExts.includes(ext)) {
          wx.showToast({ title: `不支持 .${ext} 格式`, icon: "none" });
          return false;
        }
      }
      return true;
    },

    emitChange(id, value) {
      this.triggerEvent("change", { id, value });
    },

    onInput(e) {
      const { id } = e.currentTarget.dataset;
      this.emitChange(id, e.detail.value);
    },

    onSelectChange(e) {
      const { id } = e.currentTarget.dataset;
      const field = (this.properties.fields || []).find((f) => f.id === id);
      const index = Number(e.detail.value);
      const value = field?.options?.[index] || "";
      this.emitChange(id, value);
    },

    onRadioChange(e) {
      const { id } = e.currentTarget.dataset;
      this.emitChange(id, e.detail.value);
    },

    onCheckboxChange(e) {
      const { id } = e.currentTarget.dataset;
      this.emitChange(id, e.detail.value || []);
    },

    onDateChange(e) {
      const { id } = e.currentTarget.dataset;
      this.emitChange(id, e.detail.value);
    },

    onRatingTap(e) {
      const { id, star } = e.currentTarget.dataset;
      this.emitChange(id, Number(star));
    },

    onChooseImage(e) {
      const { id } = e.currentTarget.dataset;
      const field = (this.properties.fields || []).find((f) => f.id === id);
      const maxCount = field?.maxCount || 3;
      const current = this.properties.values[id] || [];
      const remain = maxCount - current.length;
      if (remain <= 0) {
        wx.showToast({ title: `最多上传${maxCount}张`, icon: "none" });
        return;
      }

      wx.chooseMedia({
        count: remain,
        mediaType: ["image"],
        sizeType: ["compressed"],
        success: (res) => {
          const { maxSizeMB } = this.getUploadRules();
          const maxBytes = maxSizeMB * 1024 * 1024;
          const files = res.tempFiles || [];
          for (let i = 0; i < files.length; i++) {
            if (files[i].size > maxBytes) {
              wx.showToast({ title: `图片不能超过${maxSizeMB}MB`, icon: "none" });
              return;
            }
          }

          wx.showLoading({ title: "上传中..." });
          const uploads = files.map((file) => {
            const ext = /\.(\w+)$/.test(file.tempFilePath)
              ? file.tempFilePath.match(/\.(\w+)$/)[0]
              : ".jpg";
            return wx.cloud.uploadFile({
              cloudPath: `form-uploads/${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`,
              filePath: file.tempFilePath,
            });
          });

          Promise.all(uploads)
            .then((results) => {
              const fileIDs = results.map((r) => r.fileID);
              this.emitChange(id, [...current, ...fileIDs]);
            })
            .catch(() => {
              wx.showToast({ title: "上传失败", icon: "none" });
            })
            .finally(() => {
              wx.hideLoading();
            });
        },
      });
    },

    onRemoveImage(e) {
      const { id, index } = e.currentTarget.dataset;
      const current = [...(this.properties.values[id] || [])];
      current.splice(Number(index), 1);
      this.emitChange(id, current);
    },

    onChooseFile(e) {
      const { id } = e.currentTarget.dataset;
      const field = (this.properties.fields || []).find((f) => f.id === id);
      const maxCount = field?.maxCount || 1;
      const current = this.properties.values[id] || [];
      const remain = maxCount - current.length;
      if (remain <= 0) {
        wx.showToast({ title: `最多上传${maxCount}个文件`, icon: "none" });
        return;
      }

      wx.chooseMessageFile({
        count: remain,
        type: "file",
        success: (res) => {
          const tempFiles = res.tempFiles || [];
          for (let i = 0; i < tempFiles.length; i++) {
            if (!this.checkFileAllowed(tempFiles[i].name, tempFiles[i].size)) return;
          }

          wx.showLoading({ title: "上传中..." });
          const uploads = tempFiles.map((file) => {
            const ext = file.name?.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
            return wx.cloud
              .uploadFile({
                cloudPath: `form-files/${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`,
                filePath: file.path,
              })
              .then((uploadRes) => ({
                fileID: uploadRes.fileID,
                name: file.name,
                size: file.size,
              }));
          });

          Promise.all(uploads)
            .then((files) => {
              this.emitChange(id, [...current, ...files]);
            })
            .catch(() => {
              wx.showToast({ title: "上传失败", icon: "none" });
            })
            .finally(() => {
              wx.hideLoading();
            });
        },
      });
    },

    onRemoveFile(e) {
      const { id, index } = e.currentTarget.dataset;
      const current = [...(this.properties.values[id] || [])];
      current.splice(Number(index), 1);
      this.emitChange(id, current);
    },

    onTimeChange(e) {
      const { id } = e.currentTarget.dataset;
      this.emitChange(id, e.detail.value);
    },

    onRegionChange(e) {
      const { id } = e.currentTarget.dataset;
      const region = e.detail.value || [];
      const current = this.properties.values[id] || {};
      this.emitChange(id, {
        ...current,
        region,
        regionText: region.join(""),
      });
    },

    onAddressDetail(e) {
      const { id } = e.currentTarget.dataset;
      const current = this.properties.values[id] || {};
      this.emitChange(id, {
        ...current,
        detail: e.detail.value,
      });
    },

    openSignPad(e) {
      const { id } = e.currentTarget.dataset;
      this._signFieldId = id;
      this._signHasDraw = false;
      this.setData({ signFieldId: id });
      wx.nextTick(() => this.initSignCanvas());
    },

    closeSignPad() {
      this._signCtx = null;
      this._signFieldId = "";
      this.setData({ signFieldId: "" });
    },

    initSignCanvas() {
      const query = this.createSelectorQuery();
      query
        .select("#signCanvas")
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0]?.node) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext("2d");
          const dpr = wx.getSystemInfoSync().pixelRatio || 2;
          canvas.width = 600 * dpr;
          canvas.height = 300 * dpr;
          ctx.scale(dpr, dpr);
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, 600, 300);
          ctx.strokeStyle = "#0f172a";
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          this._signCanvas = canvas;
          this._signCtx = ctx;
        });
    },

    onSignStart(e) {
      if (!this._signCtx) return;
      const touch = e.touches[0];
      this._signLastX = touch.x;
      this._signLastY = touch.y;
      this._signHasDraw = true;
    },

    onSignMove(e) {
      if (!this._signCtx) return;
      const touch = e.touches[0];
      const ctx = this._signCtx;
      ctx.beginPath();
      ctx.moveTo(this._signLastX, this._signLastY);
      ctx.lineTo(touch.x, touch.y);
      ctx.stroke();
      this._signLastX = touch.x;
      this._signLastY = touch.y;
      this._signHasDraw = true;
    },

    onSignClear() {
      if (!this._signCtx) return;
      const ctx = this._signCtx;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 600, 300);
      this._signHasDraw = false;
    },

    confirmSign() {
      if (!this._signCanvas || !this._signFieldId) return;
      if (!this._signHasDraw) {
        wx.showToast({ title: "请先签名", icon: "none" });
        return;
      }

      this.setData({ signing: true });
      wx.canvasToTempFilePath({
        canvas: this._signCanvas,
        success: (res) => {
          wx.cloud
            .uploadFile({
              cloudPath: `form-signatures/${Date.now()}-${Math.floor(Math.random() * 10000)}.png`,
              filePath: res.tempFilePath,
            })
            .then((uploadRes) => {
              this.emitChange(this._signFieldId, uploadRes.fileID);
              this.closeSignPad();
            })
            .catch(() => {
              wx.showToast({ title: "签名保存失败", icon: "none" });
            })
            .finally(() => {
              this.setData({ signing: false });
            });
        },
        fail: () => {
          wx.showToast({ title: "签名生成失败", icon: "none" });
          this.setData({ signing: false });
        },
      });
    },

    clearSign(e) {
      const { id } = e.currentTarget.dataset;
      this.emitChange(id, "");
    },
  },
});
