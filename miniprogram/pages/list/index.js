const { decorateForm, trySilentLogin, callCloud, requestPayment, goPage, getLocalUser, goLogin } = require("../../utils/admin");
const {
  getPageCache,
  setPageCache,
  applyMySubmissions,
  waitForPreload,
} = require("../../utils/preload");
const { enableShareMenu, buildListShare, toTimeline } = require("../../utils/share");

Page({
  data: {
    list: [],
    loading: true,
    needLogin: false,
    deletingId: "",
    payingId: "",
    refundingId: "",
    selectMode: false,
    selectedIds: [],
    allSelected: false,
    batchDeleting: false,
    showTip: false,
    tipTitle: "",
    tipContent: "",
    total: 0,
    page: 1,
    pageSize: 10,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    if (getLocalUser()) {
      applyMySubmissions(this, getPageCache("mySubmissions"));
    }
  },

  onShow() {
    enableShareMenu();
    waitForPreload().finally(() => {
      trySilentLogin().then((user) => {
        if (!user) {
          this.setData({ loading: false, needLogin: true, list: [] });
          return;
        }
        this.setData({ needLogin: false });
        const cached = getPageCache("mySubmissions");
        const hasCache = applyMySubmissions(this, cached);
        this.loadList(hasCache);
      });
    });
  },

  goLoginTap() {
    goLogin("/pages/list/index");
  },

  onReachBottom() {
    this.loadList(true, true);
  },

  loadList(silent = false, append = false) {
    const app = getApp();
    if (!app.globalData.env) {
      this.setData({
        loading: false,
        loadingMore: false,
        showTip: true,
        tipTitle: "\u73af\u5883\u672a\u914d\u7f6e",
        tipContent: "\u8bf7\u5728 miniprogram/app.js \u4e2d\u6b63\u786e\u914d\u7f6e env \u4e91\u73af\u5883 ID\u3002",
      });
      return;
    }
    if (append && (this._listRequestPending || this.data.loadingMore || !this.data.hasMore)) return;

    const page = append ? this.data.page + 1 : 1;
    const pageSize = this.data.pageSize || 10;
    const requestSeq = (this._listRequestSeq || 0) + 1;
    this._listRequestSeq = requestSeq;
    this._listRequestPending = true;
    this.setData({
      loading: !silent && !append,
      loadingMore: append,
    });

    callCloud("getMyForms", { page, pageSize })
      .then((res) => {
        if (requestSeq !== this._listRequestSeq) return;
        if (res.result?.success) {
          const selectedIds = this.data.selectedIds || [];
          const rawItems = res.result.data || [];
          const existing = append ? this.data.list || [] : [];
          const itemMap = new Map(existing.map((item) => [item._id, item]));
          rawItems.forEach((item) => itemMap.set(item._id, decorateForm(item)));
          const list = [...itemMap.values()].map((item) => ({
            ...item,
            selected: selectedIds.includes(item._id),
          }));
          const hasExplicitTotal = Number.isFinite(Number(res.result.total));
          const total = hasExplicitTotal ? Number(res.result.total) : list.length;
          const madeProgress = !append || list.length > existing.length;
          const hasMore = madeProgress && (hasExplicitTotal
            ? page * pageSize < total
            : rawItems.length >= pageSize);
          const allSelected =
            list.length > 0 && list.every((item) => selectedIds.includes(item._id));
          this.setData({ list, allSelected, total, page, hasMore });
          if (!append) {
            setPageCache("mySubmissions", {
              data: rawItems,
              total,
              page: 1,
              pageSize,
              hasMore,
            });
          }
        } else {
          wx.showToast({ title: res.result?.errMsg || "\u52a0\u8f7d\u5931\u8d25", icon: "none" });
        }
      })
      .catch((e) => {
        if (requestSeq !== this._listRequestSeq) return;
        const { errMsg = "" } = e;
        if (errMsg.includes("FunctionName parameter could not be found")) {
          this.setData({
            showTip: true,
            tipTitle: "\u8bf7\u4e0a\u4f20\u4e91\u51fd\u6570",
            tipContent:
              "\u5728 cloudfunctions/quickstartFunctions \u76ee\u5f55\u53f3\u952e\uff0c\u9009\u62e9\u3010\u4e0a\u4f20\u5e76\u90e8\u7f72-\u4e91\u7aef\u5b89\u88c5\u4f9d\u8d56\u3011\u3002",
          });
        } else {
          wx.showToast({
            title: append ? "\u52a0\u8f7d\u66f4\u591a\u5931\u8d25" : "\u52a0\u8f7d\u5931\u8d25",
            icon: "none",
          });
        }
      })
      .finally(() => {
        if (requestSeq === this._listRequestSeq) {
          this._listRequestPending = false;
          this.setData({ loading: false, loadingMore: false });
        }
      });
  },

  syncSelection(selectedIds) {
    const list = (this.data.list || []).map((item) => ({
      ...item,
      selected: selectedIds.includes(item._id),
    }));
    const allSelected =
      list.length > 0 && list.every((item) => selectedIds.includes(item._id));
    this.setData({ selectedIds, list, allSelected });
  },

  toggleSelectMode() {
    const selectMode = !this.data.selectMode;
    const list = (this.data.list || []).map((item) => ({ ...item, selected: false }));
    this.setData({
      selectMode,
      selectedIds: [],
      allSelected: false,
      list,
    });
  },

  onToggleSelect(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;

    const selectedIds = [...this.data.selectedIds];
    const idx = selectedIds.indexOf(id);
    if (idx >= 0) selectedIds.splice(idx, 1);
    else selectedIds.push(id);

    this.syncSelection(selectedIds);
  },

  toggleSelectAll() {
    const { list, allSelected } = this.data;
    if (!list.length) return;

    const selectedIds = allSelected ? [] : list.map((item) => item._id);
    this.syncSelection(selectedIds);
  },

  batchDelete() {
    const { selectedIds, batchDeleting } = this.data;
    if (batchDeleting) return;
    if (!selectedIds.length) {
      wx.showToast({ title: "请先选择记录", icon: "none" });
      return;
    }

    wx.showModal({
      title: "批量删除",
      content: `确定删除选中的 ${selectedIds.length} 条提交记录吗？删除后无法恢复。`,
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;

        this.setData({ batchDeleting: true });
        callCloud("batchDeleteMySubmissions", { ids: selectedIds })
          .then((result) => {
            if (result.result?.success) {
              wx.showToast({
                title: `已删除 ${result.result.count || selectedIds.length} 条`,
                icon: "success",
              });
              this.setData({ selectMode: false, selectedIds: [], allSelected: false });
              this.loadList();
            } else {
              wx.showToast({ title: result.result?.errMsg || "删除失败", icon: "none" });
            }
          })
          .catch(() => wx.showToast({ title: "删除失败", icon: "none" }))
          .finally(() => this.setData({ batchDeleting: false }));
      },
    });
  },

  onDelete(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: "删除记录",
      content: "删除后无法恢复，确定要删除这条提交记录吗？",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;

        this.setData({ deletingId: id });
        callCloud("deleteMySubmission", { id })
          .then((result) => {
            if (result.result?.success) {
              wx.showToast({ title: "已删除", icon: "success" });
              this.loadList();
            } else {
              wx.showToast({ title: result.result?.errMsg || "删除失败", icon: "none" });
            }
          })
          .catch(() => {
            wx.showToast({ title: "删除失败", icon: "none" });
          })
          .finally(() => {
            this.setData({ deletingId: "" });
          });
      },
    });
  },

  onPay(e) {
    const { id } = e.currentTarget.dataset;
    if (!id || this.data.payingId) return;

    this.setData({ payingId: id });
    requestPayment(id)
      .then(() => {
        wx.showToast({ title: "支付成功", icon: "success" });
        this.loadList();
      })
      .catch((err) => {
        const msg = err?.errMsg || err?.message || "支付失败";
        if (!msg.includes("cancel")) {
          wx.showToast({ title: msg.replace("requestPayment:fail ", ""), icon: "none" });
        }
      })
      .finally(() => {
        this.setData({ payingId: "" });
      });
  },

  onRefund(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: "申请退款",
      editable: true,
      placeholderText: "请简要说明退款原因（选填）",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ refundingId: id });
        callCloud("requestRefund", { submissionId: id, reason: res.content || "" })
          .then((result) => {
            if (result.result?.success) {
              wx.showToast({ title: "已提交申请", icon: "success" });
              this.loadList();
            } else {
              wx.showToast({ title: result.result?.errMsg || "申请失败", icon: "none" });
            }
          })
          .catch(() => wx.showToast({ title: "申请失败", icon: "none" }))
          .finally(() => this.setData({ refundingId: "" }));
      },
    });
  },

  goVoucher(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/voucher/index?submissionId=${id}` });
  },

  onEdit(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/editsubmit/index?id=${id}` });
  },

  goToForm() {
    wx.navigateBack({
      fail: () => goPage("/pages/index/index"),
    });
  },

  goFormsGallery() {
    goPage("/pages/forms/index");
  },

  onShareAppMessage() {
    return buildListShare();
  },

  onShareTimeline() {
    return toTimeline(buildListShare());
  },
});
