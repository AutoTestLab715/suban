const { callCloud, ensureAdmin } = require("../../../utils/admin");

Page({
  data: {
    loading: true,
    generating: false,
    posterGenerating: false,
    templateId: "",
    template: null,
    qrUrl: "",
    qrFileID: "",
    qrLocalPath: "",
    posterPath: "",
  },

  onLoad(options) {
    if (options.templateId) {
      this.setData({ templateId: options.templateId });
    }
  },

  onShow() {
    ensureAdmin("config").then((result) => {
      if (!result) return;
      if (this._loadedOnce && this.data.qrUrl) return;
      this._loadedOnce = true;
      this.loadData();
    });
  },

  onShareAppMessage() {
    const title = this.data.template?.title || "信息提交";
    const templateId = this.data.template?._id || this.data.templateId;
    const path = templateId
      ? `/pages/fill/index?templateId=${templateId}`
      : "/pages/fill/index";
    return {
      title: `邀请您填写：${title}`,
      path,
    };
  },

  loadData() {
    this.setData({ loading: true });
    Promise.all([
      callCloud("getFormTemplate", {
        forAdmin: true,
        templateId: this.data.templateId || undefined,
      }),
    ])
      .then(([tplRes]) => {
        const template = tplRes.result?.template;
        this.setData({
          template,
          loading: false,
        });
        this.generateQr();
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  generateQr() {
    this.setData({ generating: true });
    const templateId = this.data.template?._id || this.data.templateId;
    const path = templateId
      ? `pages/fill/index?templateId=${templateId}`
      : "pages/fill/index";
    callCloud("getFormQrCode", { path })
      .then((res) => {
        if (res.result?.success) {
          this.setData({
            qrUrl: res.result.tempUrl,
            qrFileID: res.result.fileID,
          });
          if (res.result.fileID) {
            wx.cloud.downloadFile({ fileID: res.result.fileID }).then((dl) => {
              this.setData({ qrLocalPath: dl.tempFilePath });
            });
          }
        } else {
          wx.showToast({ title: res.result?.errMsg || "二维码生成失败", icon: "none" });
        }
      })
      .catch(() => {
        wx.showToast({ title: "二维码生成失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ generating: false });
      });
  },

  onGeneratePoster() {
    const { qrLocalPath, qrUrl, template, posterGenerating } = this.data;
    if (posterGenerating) return;
    if (!qrLocalPath && !qrUrl) {
      wx.showToast({ title: "请先生成二维码", icon: "none" });
      return;
    }

    this.setData({ posterGenerating: true });

    const prepareQr = qrLocalPath
      ? Promise.resolve(qrLocalPath)
      : wx.cloud.downloadFile({ fileID: this.data.qrFileID }).then((r) => r.tempFilePath);

    prepareQr
      .then((qrPath) => this.drawPoster(qrPath))
      .then((posterPath) => {
        this.setData({ posterPath, posterGenerating: false });
        wx.previewImage({ urls: [posterPath] });
      })
      .catch(() => {
        wx.showToast({ title: "海报生成失败", icon: "none" });
        this.setData({ posterGenerating: false });
      });
  },

  drawPoster(qrPath) {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery();
      query
        .select("#posterCanvas")
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0]?.node) {
            reject(new Error("canvas not found"));
            return;
          }

          const canvas = res[0].node;
          const ctx = canvas.getContext("2d");
          const width = 375;
          const height = 560;
          const dpr = wx.getSystemInfoSync().pixelRatio || 2;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);

          const theme = this.data.template?.settings?.themeColor || "#0d4a9c";
          const gradient = ctx.createLinearGradient(0, 0, 0, height);
          gradient.addColorStop(0, theme);
          gradient.addColorStop(1, "#0f172a");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, height);

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 22px sans-serif";
          const title = (this.data.template?.title || "信息提交").slice(0, 16);
          ctx.fillText(title, 32, 72);

          ctx.font = "14px sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          const desc = (this.data.template?.description || "扫码填写表单").slice(0, 40);
          this.wrapText(ctx, desc, 32, 104, 311, 22);

          ctx.fillStyle = "#ffffff";
          this.roundRect(ctx, 47, 180, 281, 281, 16);
          ctx.fill();

          const image = canvas.createImage();
          image.onload = () => {
            ctx.drawImage(image, 67, 200, 241, 241);

            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.font = "13px sans-serif";
            ctx.fillText("长按识别小程序码", 108, 490);

            wx.canvasToTempFilePath({
              canvas,
              success: (r) => resolve(r.tempFilePath),
              fail: reject,
            });
          };
          image.onerror = reject;
          image.src = qrPath;
        });
    });
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    let line = "";
    let drawY = y;
    for (let i = 0; i < text.length; i++) {
      const test = line + text[i];
      if (ctx.measureText(test).width > maxWidth) {
        ctx.fillText(line, x, drawY);
        line = text[i];
        drawY += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, drawY);
  },

  onSavePoster() {
    const { posterPath } = this.data;
    if (!posterPath) {
      this.onGeneratePoster();
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath: posterPath,
      success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
      fail: (err) => {
        if (err.errMsg?.includes("auth deny")) {
          wx.showModal({
            title: "需要相册权限",
            content: "请在设置中允许保存到相册",
            success: (r) => r.confirm && wx.openSetting(),
          });
        } else {
          wx.showToast({ title: "保存失败", icon: "none" });
        }
      },
    });
  },

  onSaveQr() {
    const { qrFileID, qrUrl } = this.data;
    if (!qrFileID && !qrUrl) {
      wx.showToast({ title: "请先生成二维码", icon: "none" });
      return;
    }

    const download = qrFileID
      ? wx.cloud.downloadFile({ fileID: qrFileID })
      : Promise.resolve({ tempFilePath: qrUrl });

    download
      .then((res) =>
        wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath }).then(() => {
          wx.showToast({ title: "已保存到相册", icon: "success" });
        })
      )
      .catch((err) => {
        if (err.errMsg?.includes("auth deny")) {
          wx.showModal({
            title: "需要相册权限",
            content: "请在设置中允许保存到相册",
            success: (r) => r.confirm && wx.openSetting(),
          });
        } else {
          wx.showToast({ title: "保存失败", icon: "none" });
        }
      });
  },
});
