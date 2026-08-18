const { callCloud, ensureLogin } = require("../../utils/admin");

const formatTime = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

Page({
  data: {
    loading: true,
    voucher: null,
    saving: false,
  },

  onLoad(options) {
    this.submissionId = options.submissionId || "";
  },

  onShow() {
    if (!this.submissionId) {
      this.setData({ loading: false });
      wx.showToast({ title: "缺少凭证信息", icon: "none" });
      return;
    }

    const redirectUrl = `/pages/voucher/index?submissionId=${this.submissionId}`;
    ensureLogin({ redirectUrl, autoGoLogin: true }).then((result) => {
      if (result) {
        this.loadVoucher();
      } else {
        this.setData({ loading: false });
      }
    });
  },

  loadVoucher() {
    if (!this.submissionId) {
      wx.showToast({ title: "缺少凭证信息", icon: "none" });
      this.setData({ loading: false });
      return;
    }

    this.setData({ loading: true });
    callCloud("getMyVoucher", { submissionId: this.submissionId })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "加载失败", icon: "none" });
          return;
        }
        const voucher = res.result.voucher || {};
        this.setData({
          voucher: {
            ...voucher,
            createTimeStr: formatTime(voucher.createTime),
          },
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  copyCode() {
    const code = this.data.voucher?.checkCode;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: "凭证码已复制", icon: "success" }),
    });
  },

  savePoster() {
    const { voucher, saving } = this.data;
    if (!voucher || saving) return;

    this.setData({ saving: true });
    const ctx = wx.createCanvasContext("voucherCanvas", this);
    const w = 600;
    const h = 800;

    ctx.setFillStyle("#ffffff");
    ctx.fillRect(0, 0, w, h);
    ctx.setFillStyle("#0d4a9c");
    ctx.fillRect(0, 0, w, 120);

    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(28);
    ctx.fillText("电子活动凭证", 200, 70);

    ctx.setFillStyle("#334155");
    ctx.setFontSize(22);
    ctx.fillText(voucher.title || "活动凭证", 40, 180);
    ctx.fillText(`提交人：${voucher.submitter || "—"}`, 40, 230);
    ctx.fillText(`提交时间：${voucher.createTimeStr || "—"}`, 40, 270);

    ctx.setFillStyle("#0f172a");
    ctx.setFontSize(56);
    ctx.fillText(voucher.checkCode || "", 120, 420);

    ctx.setFillStyle("#64748b");
    ctx.setFontSize(20);
    ctx.fillText(voucher.checkedIn ? "状态：已签到" : "状态：待核验", 40, 520);
    ctx.fillText("请向工作人员出示此凭证码", 40, 560);

    ctx.draw(false, () => {
      wx.canvasToTempFilePath(
        {
          canvasId: "voucherCanvas",
          success: (res) => {
            wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
              fail: () => wx.showToast({ title: "保存失败，请授权相册", icon: "none" }),
            });
          },
          fail: () => wx.showToast({ title: "生成图片失败", icon: "none" }),
        },
        this
      );
    });

    setTimeout(() => this.setData({ saving: false }), 800);
  },
});
