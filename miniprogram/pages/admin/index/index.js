const { callCloud, decorateForm, ensureAdmin, canAdmin } = require("../../../utils/admin");
const { getPageCache, setPageCache } = require("../../../utils/preload");

const FILTER_LABELS = {
  all: "全部",
  pending: "待处理",
  processed: "已处理",
  rejected: "已拒绝",
  unpaid: "待支付",
};

Page({
  data: {
    stats: { total: 0, pending: 0, processed: 0 },
    list: [],
    filter: "all",
    filterLabel: "全部",
    keyword: "",
    phone: "",
    typeValue: "",
    templateId: "",
    dateFrom: "",
    dateTo: "",
    page: 1,
    pageSize: 10,
    total: 0,
    hasMore: false,
    loading: true,
    exporting: false,
    selectMode: false,
    selectedIds: [],
    batchLoading: false,
    permissions: [],
    typeOptions: [],
    formOptions: [],
    notifyTip: "",
  },

  onLoad() {
    const cached = getPageCache("adminHome");
    if (cached?.list) {
      const list = (cached.list || []).map((item) => ({
        ...decorateForm(item),
        selected: false,
      }));
      this.setData({
        list,
        total: cached.total || 0,
        hasMore: list.length < (cached.total || 0),
        stats: cached.stats || { total: 0, pending: 0, processed: 0 },
        loading: false,
      });
    }
  },

  onShow() {
    this.verifyAndLoad();
  },

  onPullDownRefresh() {
    this.loadData(true).finally(() => wx.stopPullDownRefresh());
  },

  verifyAndLoad() {
    ensureAdmin("read").then((result) => {
      if (result) {
        this.setData({ permissions: result.permissions || [] });
        this.loadTypeOptions();
        this.loadFormOptions();
        this.loadData(true);
        if (canAdmin("config", result.permissions || [])) {
          this.loadNotifyTip();
        }
      }
    });
  },

  loadNotifyTip() {
    callCloud("getAdminNotifyStatus")
      .then((res) => {
        if (!res.result?.success) return;
        const r = res.result;
        if (!r.emailReady) {
          this.setData({ notifyTip: "请配置邮箱通知，用户提交后将自动发邮件提醒" });
          return;
        }
        this.setData({ notifyTip: "" });
      })
      .catch(() => {});
  },

  loadTypeOptions() {
    callCloud("getFormTemplate", { forAdmin: true }).then((res) => {
      const fields = res.result?.template?.fields || [];
      const typeField = fields.find((f) => f.id === "type" || f.type === "select");
      this.setData({ typeOptions: typeField?.options || [] });
    });
  },

  loadFormOptions() {
    callCloud("listFormTemplates").then((res) => {
      if (res.result?.success) {
        this.setData({ formOptions: res.result.list || [] });
      }
    });
  },

  getQueryParams(page) {
    return {
      status: this.data.filter,
      page,
      pageSize: this.data.pageSize,
      keyword: this.data.keyword.trim(),
      phone: this.data.phone.trim(),
      typeValue: this.data.typeValue,
      fieldId: "type",
      templateId: this.data.templateId,
      dateFrom: this.data.dateFrom,
      dateTo: this.data.dateTo,
    };
  },

  loadData(reset = false) {
    const page = reset ? 1 : this.data.page;
    const hasCache = reset && (this.data.list || []).length > 0;
    if (!hasCache) this.setData({ loading: true });

    const requests = [callCloud("getAllForms", this.getQueryParams(page))];

    if (reset) {
      requests.push(callCloud("getFormStats"));
    }

    return Promise.all(requests)
      .then(([listRes, statsRes]) => {
        if (!listRes.result?.success) {
          wx.showToast({ title: listRes.result?.errMsg || "加载失败", icon: "none" });
          return;
        }

        const newList = (listRes.result.data || []).map((item) => ({
          ...decorateForm(item),
          selected: this.data.selectedIds.includes(item._id),
        }));
        const list = reset ? newList : this.data.list.concat(newList);
        const total = listRes.result.total || 0;

        const updates = {
          list,
          page,
          total,
          hasMore: list.length < total,
          loading: false,
        };

        if (statsRes?.result?.success) {
          updates.stats = statsRes.result.stats;
        }

        if (reset) {
          setPageCache("adminHome", {
            list: listRes.result.data || [],
            total,
            stats: updates.stats || this.data.stats,
          });
        }

        this.setData(updates);
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
        this.setData({ loading: false });
      });
  },

  toggleSelectMode() {
    this.setData({
      selectMode: !this.data.selectMode,
      selectedIds: [],
      list: this.data.list.map((item) => ({ ...item, selected: false })),
    });
  },

  onToggleSelect(e) {
    const { id } = e.currentTarget.dataset;
    let selectedIds = [...this.data.selectedIds];
    const idx = selectedIds.indexOf(id);
    if (idx >= 0) selectedIds.splice(idx, 1);
    else selectedIds.push(id);

    const list = this.data.list.map((item) => ({
      ...item,
      selected: selectedIds.includes(item._id),
    }));
    this.setData({ selectedIds, list });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearchConfirm() {
    this.loadData(true);
  },

  onReachBottom() {
    this.loadMore();
  },

  onClearSearch() {
    if (!this.data.keyword) return;
    this.setData({ keyword: "" });
    this.loadData(true);
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onPhoneConfirm() {
    this.loadData(true);
  },

  onTypeFilter(e) {
    const { value } = e.currentTarget.dataset;
    this.setData({ typeValue: value === this.data.typeValue ? "" : value }, () => this.loadData(true));
  },

  onFormFilter(e) {
    const { id } = e.currentTarget.dataset;
    const nextId = id === this.data.templateId ? "" : id;
    this.setData({ templateId: nextId }, () => this.loadData(true));
  },

  onDateFromChange(e) {
    this.setData({ dateFrom: e.detail.value });
    this.loadData(true);
  },

  onDateToChange(e) {
    this.setData({ dateTo: e.detail.value });
    this.loadData(true);
  },

  onClearDates() {
    if (!this.data.dateFrom && !this.data.dateTo) return;
    this.setData({ dateFrom: "", dateTo: "" });
    this.loadData(true);
  },

  onFilter(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.filter) return;

    this.setData({
      filter: status,
      filterLabel: FILTER_LABELS[status],
      selectedIds: [],
    });
    this.loadData(true);
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    const nextPage = this.data.page + 1;
    this.setData({ loading: true });

    callCloud("getAllForms", this.getQueryParams(nextPage))
      .then((listRes) => {
        if (!listRes.result?.success) {
          wx.showToast({ title: listRes.result?.errMsg || "加载失败", icon: "none" });
          return;
        }
        const newList = (listRes.result.data || []).map((item) => ({
          ...decorateForm(item),
          selected: this.data.selectedIds.includes(item._id),
        }));
        const list = this.data.list.concat(newList);
        const total = listRes.result.total || 0;
        this.setData({
          list,
          page: nextPage,
          total,
          hasMore: list.length < total,
        });
      })
      .catch(() => {
        wx.showToast({ title: "加载失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  batchUpdate(status) {
    const { selectedIds } = this.data;
    if (!selectedIds.length) {
      wx.showToast({ title: "请先选择记录", icon: "none" });
      return;
    }

    this.setData({ batchLoading: true });
    callCloud("batchUpdateFormStatus", { ids: selectedIds, status })
      .then((res) => {
        if (res.result?.success) {
          wx.showToast({ title: `已更新 ${res.result.count} 条`, icon: "success" });
          this.setData({ selectMode: false, selectedIds: [] });
          this.loadData(true);
        } else {
          wx.showToast({ title: res.result?.errMsg || "操作失败", icon: "none" });
        }
      })
      .catch(() => wx.showToast({ title: "操作失败", icon: "none" }))
      .finally(() => this.setData({ batchLoading: false }));
  },

  batchMarkProcessed() {
    this.batchUpdate("processed");
  },

  batchMarkPending() {
    this.batchUpdate("pending");
  },

  batchMarkRejected() {
    this.batchUpdate("rejected");
  },

  batchDelete() {
    const { selectedIds } = this.data;
    if (!selectedIds.length) {
      wx.showToast({ title: "请先选择记录", icon: "none" });
      return;
    }

    wx.showModal({
      title: "批量删除",
      content: `确定删除选中的 ${selectedIds.length} 条记录吗？`,
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ batchLoading: true });
        callCloud("batchDeleteFormSubmissions", { ids: selectedIds })
          .then((result) => {
            if (result.result?.success) {
              wx.showToast({ title: `已删除 ${result.result.count} 条`, icon: "success" });
              this.setData({ selectMode: false, selectedIds: [] });
              this.loadData(true);
            } else {
              wx.showToast({ title: result.result?.errMsg || "删除失败", icon: "none" });
            }
          })
          .catch(() => wx.showToast({ title: "删除失败", icon: "none" }))
          .finally(() => this.setData({ batchLoading: false }));
      },
    });
  },

  onExport() {
    if (this.data.exporting) return;

    wx.showActionSheet({
      itemList: ["导出 CSV", "导出 Excel"],
      success: (res) => {
        const format = res.tapIndex === 1 ? "xlsx" : "csv";
        this.runExport(format);
      },
    });
  },

  runExport(format) {
    this.setData({ exporting: true });
    callCloud("exportForms", {
      status: this.data.filter,
      keyword: this.data.keyword.trim(),
      phone: this.data.phone.trim(),
      typeValue: this.data.typeValue,
      fieldId: "type",
      templateId: this.data.templateId,
      dateFrom: this.data.dateFrom,
      dateTo: this.data.dateTo,
      format,
    })
      .then((res) => {
        if (!res.result?.success) {
          wx.showToast({ title: res.result?.errMsg || "导出失败", icon: "none" });
          return;
        }

        wx.showLoading({ title: "下载中..." });
        const fileType = res.result.format || format;
        return wx.cloud
          .downloadFile({ fileID: res.result.fileID })
          .then((dl) => {
            wx.hideLoading();
            return wx.openDocument({
              filePath: dl.tempFilePath,
              fileType,
              showMenu: true,
            });
          })
          .then(() => {
            wx.showToast({ title: `已导出 ${res.result.count} 条`, icon: "success" });
          });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: "导出失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ exporting: false });
      });
  },

  goDetail(e) {
    if (this.data.selectMode) return;
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/admin/detail/index?id=${id}` });
  },

  goForms() {
    wx.navigateTo({ url: "/pages/admin/forms/index" });
  },

  goNotifySettings() {
    wx.navigateTo({ url: "/pages/admin/notify/index" });
  },

  goNotifyManage() {
    wx.navigateTo({ url: "/pages/admin/notifymanage/index" });
  },

  goWebLogin() {
    wx.navigateTo({ url: "/pages/admin/weblogin/index" });
  },

  goBackup() {
    wx.navigateTo({ url: "/pages/admin/backup/index" });
  },

  onCustomExport() {
    const { filter, keyword, dateFrom, dateTo, templateId } = this.data;
    wx.navigateTo({
      url: `/pages/admin/export/index?filter=${filter}&keyword=${encodeURIComponent(keyword.trim())}&dateFrom=${dateFrom}&dateTo=${dateTo}&templateId=${templateId || ""}`,
    });
  },
});
