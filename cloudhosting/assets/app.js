(function () {
  "use strict";

  const TOKEN_KEY = "web_admin_token";
  const STATUS_MAP = {
    pending: { label: "待处理", class: "badge-pending" },
    processed: { label: "已处理", class: "badge-processed" },
    rejected: { label: "已拒绝", class: "badge-rejected" },
    unpaid: { label: "待支付", class: "badge-unpaid" },
  };
  const AUDIT_ACTION_MAP = {
    update_status: "更新状态",
    edit_submission: "编辑提交",
    delete_submission: "删除提交",
    batch_update_status: "批量更新状态",
    batch_delete: "批量删除",
    update_template: "更新表单配置",
    checkin: "签到核销",
    update_admin_role: "修改管理员角色",
    refund_approve: "批准退款",
    refund_reject: "拒绝退款",
    export_attachments: "导出附件",
    create_template: "创建表单",
    set_default_template: "设置默认表单",
    send_daily_digest: "推送日报",
    auto_daily_digest: "自动推送日报",
    export_attachments_zip: "ZIP导出附件",
    backup_data: "数据备份",
    auto_backup: "自动备份",
    create_notify_template: "创建通知模板",
    update_notify_template: "更新通知模板",
    delete_notify_template: "删除通知模板",
    save_email_config: "保存邮箱配置",
    send_test_email: "发送测试邮件",
    delete_form_template: "删除表单模板",
  };

  let state = {
    filter: "all",
    page: 1,
    pageSize: 20,
    total: 0,
    keyword: "",
    phone: "",
    typeValue: "",
    templateId: "",
    dateFrom: "",
    dateTo: "",
    list: [],
    stats: { total: 0, pending: 0, processed: 0, rejected: 0 },
    currentPanel: "submissions",
    detailId: null,
    selectMode: false,
    selectedIds: [],
    allSelected: false,
    batchLoading: false,
    typeOptions: [],
    formOptions: [],
    forms: [],
    notifyList: [],
    platformTemplates: [],
    editingNotifyId: "",
    formModalCopyId: "",
    backups: [],
    editingFormId: "",
    editingFormFields: [],
    emailConfig: null,
    emailReady: false,
    overviewAnalytics: null,
    logs: [],
    users: [],
    usersTotal: 0,
    usersPage: 1,
    usersPageSize: 20,
    usersKeyword: "",
    usersRole: "",
    lastSyncAt: null,
  };

  const FIELD_TYPES = [
    { type: "text", label: "单行文本" },
    { type: "textarea", label: "多行文本" },
    { type: "phone", label: "手机号" },
    { type: "email", label: "邮箱" },
    { type: "number", label: "数字" },
    { type: "select", label: "下拉选择" },
    { type: "radio", label: "单选" },
    { type: "checkbox", label: "多选" },
    { type: "date", label: "日期" },
    { type: "time", label: "时间" },
    { type: "image", label: "图片上传" },
    { type: "file", label: "文件上传" },
  ];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function formatTime(date) {
    if (!date) return "-";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "-";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDateInput(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function clearDatePresetSelection() {
    $$('[data-date-preset]').forEach((button) =>
      button.classList.remove("active")
    );
  }

  function applyDatePreset(value) {
    const end = new Date();
    const start = new Date(end);
    const days = value === "today" ? 1 : Math.max(1, Number(value) || 1);
    start.setDate(start.getDate() - (days - 1));

    $("#dateFromInput").value = formatDateInput(start);
    $("#dateToInput").value = formatDateInput(end);

    $$('[data-date-preset]').forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.datePreset === value
      )
    );

    loadSubmissions(true);
  }
  function updateOverviewClock() {
    const now = new Date();
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    if ($("#overviewWeekday")) $("#overviewWeekday").textContent = weekdays[now.getDay()];
    if ($("#overviewDate")) $("#overviewDate").textContent = `${String(now.getMonth() + 1).padStart(2, "0")} / ${String(now.getDate()).padStart(2, "0")}`;
    if ($("#overviewTime")) $("#overviewTime").textContent = `${now.getFullYear()} · ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  function setLastSync() {
    state.lastSyncAt = new Date();
    const el = $("#lastSyncText");
    if (el) el.textContent = `刚刚 · ${String(state.lastSyncAt.getHours()).padStart(2, "0")}:${String(state.lastSyncAt.getMinutes()).padStart(2, "0")}`;
  }

  function getEmailReady(config) {
    return !!(config && config.enabled !== false && config.smtpHost && config.smtpUser && config.hasPassword && String(config.adminEmails || "").trim());
  }

  function showToast(msg, type) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast " + (type || "success");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2800);
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.dataset.prevDisabled = btn.disabled ? "1" : "0";
      btn.classList.add("loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("loading");
      btn.disabled = btn.dataset.prevDisabled === "1";
    }
  }

  function emptyBlockHtml(title, desc) {
    return `<div class="empty-block">
      <div class="empty-block-icon"></div>
      <div class="empty-block-title">${escapeHtml(title)}</div>
      <div class="empty-block-desc">${escapeHtml(desc || "")}</div>
    </div>`;
  }

  function emptyRowHtml(colSpan, title, desc) {
    return `<tr><td colspan="${colSpan}">${emptyBlockHtml(title, desc)}</td></tr>`;
  }

  const PANEL_META = {
    overview: { title: "运营工作台", subtitle: "掌握提交进度、表单状态与通知运行情况" },
    submissions: { title: "提交管理", subtitle: "查看与处理用户提交记录" },
    forms: { title: "表单管理", subtitle: "创建、编辑与复制表单模板" },
    notify: { title: "消息通知", subtitle: "配置邮箱与微信订阅通知" },
    backup: { title: "数据备份", subtitle: "备份生成 Excel 与 JSON" },
    stats: { title: "数据统计", subtitle: "提交趋势与类型分布概览" },
    logs: { title: "操作日志", subtitle: "管理员关键操作审计记录" },
    users: { title: "用户数据", subtitle: "查看云数据库 users 集合中的注册用户" },
  };

  function updateTopbar(panel) {
    const meta = PANEL_META[panel] || PANEL_META.submissions;
    const titleEl = $("#topbarTitle");
    const subEl = $("#topbarSubtitle");
    if (titleEl) titleEl.textContent = meta.title;
    if (subEl) subEl.textContent = meta.subtitle;
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function openTrustedDownload(url) {
    try {
      const parsed = new URL(String(url || ""), window.location.href);
      if (parsed.protocol !== "https:") return false;
      const link = document.createElement("a");
      link.href = parsed.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
    } catch (e) {
      return false;
    }
  }

  function formatError(err) {
    if (!err) return "未知错误";
    const msg = err.message || err.errMsg || err.msg || "";
    const code = err.code || err.errCode || "";
    const detail = err.error?.message || err.error?.code || "";
    const text = [code, msg, detail].filter(Boolean).join("：");
    if (!text) {
      try {
        return JSON.stringify(err);
      } catch (e) {
        return "连接云开发失败";
      }
    }
    if (/PERMISSION|permission|权限|denied|without auth|404|Failed to fetch/i.test(text)) {
      return "请求失败。请确认云函数已部署，且 HTTP 路由 /api/admin 已配置。";
    }
    return text;
  }

  async function callCloud(type, data) {
    const cfg = window.CLOUD_CONFIG;
    const httpUrl = cfg.httpUrl;
    if (!httpUrl) throw new Error("未配置 httpUrl，请在 assets/config.js 中设置 HTTP 网关路径");
    const token = getToken();
    const payload = { type, data: { ...(data || {}), _webToken: token } };
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw new Error("云函数返回格式错误");
      }
    }
    if (!res.ok) throw new Error(json.errMsg || json.message || `HTTP ${res.status}`);
    if (json.resp_data) {
      try {
        return JSON.parse(json.resp_data);
      } catch (e) {
        return json.resp_data;
      }
    }
    return json;
  }

  let pollTimer = null;
  let currentSessionId = "";

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function setQrStatus(text) {
    const el = $("#qrStatus");
    if (el) el.textContent = text;
  }

  function showQrImage(src) {
    const qrImg = $("#qrImage");
    const qrLoading = $("#qrLoading");
    qrImg.src = src;
    qrImg.onload = () => {
      qrImg.classList.add("visible");
      qrLoading.style.display = "none";
    };
    qrImg.onerror = () => {
      qrLoading.style.display = "none";
    };
  }

  async function startWxLogin() {
    stopPoll();
    currentSessionId = "";
    const errEl = $("#loginError");
    const qrImg = $("#qrImage");
    const qrLoading = $("#qrLoading");
    const shortCodeBox = $("#shortCodeBox");
    errEl.textContent = "";
    qrImg.classList.remove("visible");
    qrLoading.style.display = "block";
    qrLoading.textContent = "正在生成二维码...";
    shortCodeBox.style.display = "none";
    setQrStatus("正在生成登录信息...");

    try {
      const res = await callCloud("createWebLoginSession");
      if (!res.success) {
        errEl.textContent = res.errMsg || "生成登录信息失败";
        setQrStatus("请刷新重试");
        qrLoading.style.display = "none";
        return;
      }
      currentSessionId = res.sessionId;
      if (res.shortCode) {
        shortCodeBox.style.display = "block";
        $("#shortCodeText").textContent = res.shortCode;
      }
      if (res.qrDataUrl || res.qrUrl) {
        showQrImage(res.qrDataUrl || res.qrUrl);
        setQrStatus("请使用微信扫描二维码");
      } else if (res.qrContent) {
        showQrImage(
          `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(res.qrContent)}`
        );
        setQrStatus("请使用微信扫描二维码");
      } else {
        qrLoading.style.display = "none";
        setQrStatus("请用验证码在小程序中登录");
        if (res.qrError) errEl.textContent = res.qrError;
      }
      pollTimer = setInterval(pollLoginSession, 2000);
    } catch (err) {
      errEl.textContent = formatError(err);
      setQrStatus("请刷新重试");
      qrLoading.style.display = "none";
    }
  }

  async function pollLoginSession() {
    if (!currentSessionId) return;
    try {
      const res = await callCloud("pollWebLoginSession", { sessionId: currentSessionId });
      if (!res.success) return;
      if (res.status === "pending") {
        setQrStatus("已扫码？请在小程序中点击确认登录");
        return;
      }
      if (res.status === "expired") {
        stopPoll();
        setQrStatus("二维码已过期");
        $("#loginError").textContent = "登录已过期，请刷新二维码";
        return;
      }
      if (res.status === "confirmed" && res.token) {
        stopPoll();
        setToken(res.token);
        setQrStatus("登录成功");
        showApp();
        await loadDashboard();
        showToast(`欢迎，${res.user?.nickName || "管理员"}`);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function showLogin() {
    $("#loginPage").style.display = "flex";
    $("#app").classList.remove("visible");
    startWxLogin();
  }

  function showApp() {
    stopPoll();
    $("#loginPage").style.display = "none";
    $("#app").classList.add("visible");
    const envEl = $("#topbarEnv");
    if (envEl) {
      const envId = window.CLOUD_CONFIG?.envId || "";
      envEl.textContent = envId ? `环境 ${envId.slice(0, 12)}…` : "云环境已连接";
      envEl.title = envId || "";
    }
    updateTopbar(state.currentPanel || "overview");
    updateOverviewClock();
  }

  function handleLogout() {
    setToken("");
    showLogin();
  }

  function switchPanel(name) {
    state.currentPanel = name;
    $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.panel === name));
    $$(".panel").forEach((el) => el.classList.toggle("active", el.id === "panel-" + name));
    updateTopbar(name);

    if (name === "overview") loadOverview();
    else if (name === "submissions") loadSubmissions(true);
    else if (name === "forms") loadForms();
    else if (name === "notify") loadNotify();
    else if (name === "backup") loadBackups();
    else if (name === "stats") loadStats();
    else if (name === "users") loadUsers(true);
    else if (name === "logs") loadLogs();
  }

  async function loadDashboard() {
    await loadTypeOptions();
    switchPanel("overview");
  }

  async function refreshCurrentPanel(button) {
    setButtonLoading(button, true);
    try {
      if (state.currentPanel === "overview") await loadOverview();
      else if (state.currentPanel === "submissions") await loadSubmissions(false);
      else if (state.currentPanel === "forms") await loadForms();
      else if (state.currentPanel === "notify") await loadNotify();
      else if (state.currentPanel === "backup") await loadBackups();
      else if (state.currentPanel === "stats") await loadStats();
      else if (state.currentPanel === "users") await loadUsers(false);
      else if (state.currentPanel === "logs") await loadLogs();
    } finally {
      setButtonLoading(button, false);
    }
  }

  function renderOverviewTrend(trend) {
    if (!trend.length) return emptyBlockHtml("暂无趋势数据", "有新提交后会自动形成 7 日趋势");
    const max = Math.max(...trend.map((item) => Number(item.count || 0)), 1);
    return `<div class="pulse-chart">${trend.map((item) => {
      const height = Math.max(8, Math.round((Number(item.count || 0) / max) * 100));
      return `<div class="pulse-column"><span>${Number(item.count || 0)}</span><div class="pulse-track"><i style="height:${height}%"></i></div><small>${escapeHtml(item.label || item.date || "-")}</small></div>`;
    }).join("")}</div>`;
  }

  function renderOverviewRecent(list) {
    if (!list.length) return emptyBlockHtml("暂无最近提交", "新记录会在这里优先显示");
    return list.map((item) => {
      const summary = getSummary(item);
      return `<button class="recent-item" data-overview-detail="${escapeHtml(item._id)}"><span class="recent-status ${escapeHtml(item.status || "pending")}"></span><span class="recent-main"><strong>${escapeHtml(summary.name)}</strong><small>${escapeHtml(summary.formTitle)} · ${escapeHtml(summary.phone)}</small></span><span class="recent-meta">${formatTime(item.createTime)}${renderStatus(item.status)}</span><svg><use href="#i-chevron"></use></svg></button>`;
    }).join("");
  }

  async function loadOverview() {
    updateOverviewClock();
    $("#overviewTrend").innerHTML = '<div class="loading">加载中...</div>';
    $("#overviewHealth").innerHTML = '<div class="loading">加载中...</div>';
    $("#overviewRecent").innerHTML = '<div class="loading">加载中...</div>';
    try {
      const [analyticsRes, recentRes, formsRes, emailRes, backupsRes] = await Promise.all([
        callCloud("getFormAnalytics"),
        callCloud("getAllForms", { status: "all", page: 1, pageSize: 6 }),
        callCloud("listFormTemplates"),
        callCloud("getAdminEmailConfig"),
        callCloud("listBackups"),
      ]);
      if (!analyticsRes.success) throw new Error(analyticsRes.errMsg || "概览加载失败");
      const stats = analyticsRes.stats || {};
      const total = Number(stats.total || 0);
      const pending = Number(stats.pending || 0);
      const processed = Number(stats.processed || 0);
      const rate = total ? Math.round((processed / total) * 100) : 0;
      state.overviewAnalytics = analyticsRes;
      state.stats = { ...state.stats, total, pending, processed };
      $("#overviewTotal").textContent = total;
      $("#overviewPending").textContent = pending;
      $("#overviewToday").textContent = Number(stats.todayCount || 0);
      $("#overviewRate").textContent = `${rate}%`;
      $("#overviewHeadline").textContent = pending ? `有 ${pending} 条提交等待处理` : "今日待办已清零，可以继续维护业务配置";
      $("#sidebarPendingCount").textContent = pending > 99 ? "99+" : pending;
      $("#overviewTrend").innerHTML = renderOverviewTrend(analyticsRes.dailyTrend || []);
      $("#overviewRecent").innerHTML = renderOverviewRecent(recentRes.success ? recentRes.data || [] : []);

      const forms = formsRes.success ? formsRes.list || [] : [];
      const activeForms = forms.filter((item) => item.enabled !== false).length;
      const emailConfig = emailRes.success ? emailRes.config || {} : {};
      const emailReady = getEmailReady(emailConfig);
      const backups = backupsRes.success ? backupsRes.list || [] : [];
      const latestBackup = backups[0];
      $("#overviewHealth").innerHTML = `
        <button class="health-item ${emailReady ? "ok" : "warn"}" data-quick-panel="notify"><span class="health-icon"><svg><use href="#i-mail"></use></svg></span><span><strong>邮件通知</strong><small>${emailReady ? "授权完整，新提交将自动发送" : "配置未完成，建议尽快处理"}</small></span><b>${emailReady ? "正常" : "待配置"}</b></button>
        <button class="health-item ok" data-quick-panel="forms"><span class="health-icon"><svg><use href="#i-layers"></use></svg></span><span><strong>表单模板</strong><small>${activeForms} 个启用 / ${forms.length} 个全部</small></span><b>${activeForms ? "运行中" : "需启用"}</b></button>
        <button class="health-item ${latestBackup ? "ok" : "warn"}" data-quick-panel="backup"><span class="health-icon"><svg><use href="#i-database"></use></svg></span><span><strong>数据备份</strong><small>${latestBackup ? `最近：${formatTime(latestBackup.createTime)}` : "尚未生成备份"}</small></span><b>${latestBackup ? "已备份" : "待备份"}</b></button>`;
      setLastSync();
    } catch (err) {
      const message = err.message || "请稍后重试";
      $("#overviewTrend").innerHTML = emptyBlockHtml("概览加载失败", message);
      $("#overviewHealth").innerHTML = emptyBlockHtml("运行状态不可用", message);
      $("#overviewRecent").innerHTML = emptyBlockHtml("最近提交不可用", message);
      showToast(message, "error");
    }
  }

  function getFormTitle(templateId) {
    if (!templateId) return "";
    const matched = (state.formOptions || []).find((item) => item._id === templateId);
    return matched?.title || "";
  }

  function readFiltersFromDom() {
    state.keyword = $("#keywordInput")?.value.trim() || "";
    state.phone = $("#phoneInput")?.value.trim() || "";
    state.typeValue = $("#typeSelect")?.value || "";
    state.templateId = $("#formSelect")?.value || "";
    state.dateFrom = $("#dateFromInput")?.value || "";
    state.dateTo = $("#dateToInput")?.value || "";
  }

  function renderFilterSummary() {
    const el = $("#filterSummary");
    if (!el) return;
    const chips = [];
    if (state.templateId) chips.push(`表单：${getFormTitle(state.templateId) || "已选表单"}`);
    if (state.keyword) chips.push(`关键词：${state.keyword}`);
    if (state.phone) chips.push(`手机号：${state.phone}`);
    if (state.typeValue) chips.push(`类型：${state.typeValue}`);
    if (state.dateFrom || state.dateTo) chips.push(`日期：${state.dateFrom || "..."} 至 ${state.dateTo || "..."}`);
    if (state.filter !== "all") {
      const label = STATUS_MAP[state.filter]?.label || state.filter;
      chips.push(`状态：${label}`);
    }
    if (!chips.length) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `<span class="filter-summary-label">当前筛选</span>${chips
      .map((text) => `<span class="filter-chip">${escapeHtml(text)}</span>`)
      .join("")}`;
  }

  function clearAllFilters() {
    state.keyword = "";
    state.phone = "";
    state.typeValue = "";
    state.templateId = "";
    state.dateFrom = "";
    state.dateTo = "";
    state.filter = "all";
    if ($("#keywordInput")) $("#keywordInput").value = "";
    if ($("#phoneInput")) $("#phoneInput").value = "";
    if ($("#typeSelect")) $("#typeSelect").value = "";
    if ($("#formSelect")) $("#formSelect").value = "";
    if ($("#dateFromInput")) $("#dateFromInput").value = "";
    if ($("#dateToInput")) $("#dateToInput").value = "";
    renderFilterSummary();
    loadSubmissions(true);
  }

  function getStatsParams() {
    return {
      templateId: state.templateId,
      keyword: state.keyword,
      phone: state.phone,
      typeValue: state.typeValue,
      fieldId: "type",
      dateFrom: state.dateFrom,
      dateTo: state.dateTo,
    };
  }

  function getSummary(item) {
    const answers = item.answers || {};
    return {
      name: answers.name || answers.nickName || item.name || "-",
      phone: answers.phone || item.phone || "-",
      type: answers.type || item.type || "-",
      formTitle: item.templateTitle || getFormTitle(item.templateId) || "-",
    };
  }

  function renderSubmissionActions(item) {
    if (state.selectMode || item.status !== "pending") return "";
    return `<button class="btn btn-success btn-sm" data-action="approve" data-id="${escapeHtml(item._id)}">通过</button>
            <button class="btn btn-danger btn-sm" data-action="reject" data-id="${escapeHtml(item._id)}">拒绝</button>`;
  }

  function renderStatus(status) {
    const info = STATUS_MAP[status] || STATUS_MAP.pending;
    return `<span class="badge ${info.class}">${info.label}</span>`;
  }

  function syncSelection() {
    const { list, selectedIds } = state;
    state.allSelected = list.length > 0 && list.every((item) => selectedIds.includes(item._id));
    $("#batchCount").textContent = `已选 ${selectedIds.length} 条`;
    $("#selectAllBtn").textContent = state.allSelected ? "取消全选" : "全选";
  }

  function renderList() {
    const tbody = $("#listBody");
    const colSpan = state.selectMode ? 10 : 9;
    $("#selectColHead").classList.toggle("hidden", !state.selectMode);

    if (!state.list.length) {
      tbody.innerHTML = emptyRowHtml(colSpan, "暂无提交记录", "调整筛选条件，或等待用户提交新数据");
      $("#pageInfo").textContent = `第 ${state.page} 页，共 ${state.total} 条`;
      $("#prevPage").disabled = true;
      $("#nextPage").disabled = true;
      syncSelection();
      return;
    }

    tbody.innerHTML = state.list
      .map((item) => {
        const s = getSummary(item);
        const selected = state.selectedIds.includes(item._id);
        const selectCell = state.selectMode
          ? `<td class="select-col"><input type="checkbox" data-action="toggle" data-id="${escapeHtml(item._id)}" ${selected ? "checked" : ""} /></td>`
          : "";
        return `<tr class="${selected ? "row-selected" : ""}">
          ${selectCell}
          <td>${formatTime(item.createTime)}</td>
          <td class="mono">${escapeHtml(item.formNo || "-")}</td>
          <td>${escapeHtml(s.formTitle)}</td>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.phone)}</td>
          <td>${escapeHtml(s.type)}</td>
          <td>${renderStatus(item.status)}</td>
          <td><button class="btn btn-outline btn-sm" data-action="detail" data-id="${escapeHtml(item._id)}">详情</button></td>
          <td class="action-cell">${renderSubmissionActions(item)}</td>
        </tr>`;
      })
      .join("");

    $("#pageInfo").textContent = `第 ${state.page} 页，共 ${state.total} 条`;
    $("#prevPage").disabled = state.page <= 1;
    $("#nextPage").disabled = state.page * state.pageSize >= state.total;
    syncSelection();
  }

  function updateStatsCards() {
    const s = state.stats;
    $("#statTotal").textContent = s.total || 0;
    $("#statPending").textContent = s.pending || 0;
    $("#statProcessed").textContent = s.processed || 0;
    $("#statRejected").textContent = s.rejected || 0;
    if ($("#sidebarPendingCount")) $("#sidebarPendingCount").textContent = Number(s.pending || 0) > 99 ? "99+" : Number(s.pending || 0);
    $$(".stat-card").forEach((el) => el.classList.toggle("active", el.dataset.filter === state.filter));
  }

  function getQueryParams() {
    return {
      status: state.filter,
      page: state.page,
      pageSize: state.pageSize,
      keyword: state.keyword,
      phone: state.phone,
      typeValue: state.typeValue,
      fieldId: "type",
      templateId: state.templateId,
      dateFrom: state.dateFrom,
      dateTo: state.dateTo,
    };
  }

  async function loadTypeOptions() {
    try {
      const [tplRes, formsRes] = await Promise.all([
        callCloud("getFormTemplate", { forAdmin: true }),
        callCloud("listFormTemplates"),
      ]);
      const fields = tplRes.template?.fields || [];
      const typeField = fields.find((f) => f.id === "type" || f.type === "select");
      state.typeOptions = typeField?.options || [];
      const typeSelect = $("#typeSelect");
      if (typeSelect) {
        typeSelect.innerHTML =
          '<option value="">全部类型</option>' +
          state.typeOptions.map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join("");
        if (state.typeValue) typeSelect.value = state.typeValue;
      }
      const formSelect = $("#formSelect");
      const formList = formsRes.success ? formsRes.list || [] : [];
      state.formOptions = formList;
      if (formSelect) {
        formSelect.innerHTML =
          '<option value="">全部表单</option>' +
          formList.map((item) => `<option value="${escapeHtml(item._id)}">${escapeHtml(item.title || "未命名表单")}</option>`).join("");
        if (state.templateId) formSelect.value = state.templateId;
      }
      if (!formsRes.success && formsRes.errMsg) {
        showToast(formsRes.errMsg || "表单列表加载失败", "error");
      }
    } catch (e) {
      showToast(e.message || "筛选选项加载失败", "error");
    }
  }

  async function loadSubmissions(reset) {
    if (reset) state.page = 1;
    readFiltersFromDom();
    renderFilterSummary();
    if (!state.list.length) {
      $("#listBody").innerHTML = `<tr><td colspan="9" class="loading">加载中...</td></tr>`;
    }

    try {
      const [listRes, statsRes] = await Promise.all([
        callCloud("getAllForms", getQueryParams()),
        reset ? callCloud("getFormStats", getStatsParams()) : Promise.resolve(null),
      ]);

      if (!listRes.success) {
        if (listRes.errMsg && listRes.errMsg.includes("权限")) {
          handleLogout();
          showToast("登录已失效，请重新登录", "error");
          return;
        }
        showToast(listRes.errMsg || "加载失败", "error");
        return;
      }

      state.list = listRes.data || [];
      state.total = listRes.total || 0;
      if (statsRes?.success) state.stats = statsRes.stats || state.stats;
      updateStatsCards();
      renderList();
      setLastSync();
    } catch (err) {
      showToast(err.message || "加载失败", "error");
      $("#listBody").innerHTML = emptyRowHtml(8, "加载失败", err.message || "请检查网络后重试");
    }
  }

  async function loadStats() {
    $("#statsContent").innerHTML = '<div class="loading">加载中...</div>';
    try {
      const res = await callCloud("getFormAnalytics");
      if (!res.success) {
        $("#statsContent").innerHTML = emptyBlockHtml("统计加载失败", res.errMsg || "请稍后重试");
        return;
      }
      const stats = res.stats || {};
      const trend = res.dailyTrend || [];
      const maxCount = Math.max(...trend.map((t) => t.count || 0), 1);
      let trendHtml = '<div class="trend-bars">';
      trend.forEach((t) => {
        const h = Math.round(((t.count || 0) / maxCount) * 100);
        trendHtml += `<div class="trend-bar"><div class="bar-count">${t.count || 0}</div><div class="bar" style="height:${Math.max(h, 4)}%"></div><div class="bar-label">${escapeHtml(t.label || t.date)}</div></div>`;
      });
      trendHtml += "</div>";
      const typeRows = (res.typeBreakdown || [])
        .map((t) => `<tr><td>${escapeHtml(t.label || t.type)}</td><td>${t.count || 0}</td><td>${t.percent || 0}%</td></tr>`)
        .join("");
      $("#statsContent").innerHTML = `
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">总提交</div><div class="num">${stats.total || 0}</div></div>
          <div class="stat-card pending"><div class="stat-label">待处理</div><div class="num">${stats.pending || 0}</div></div>
          <div class="stat-card processed"><div class="stat-label">已处理</div><div class="num">${stats.processed || 0}</div></div>
          <div class="stat-card"><div class="stat-label">今日新增</div><div class="num">${stats.todayCount || 0}</div></div>
          <div class="stat-card"><div class="stat-label">近7日</div><div class="num">${stats.weekCount || 0}</div></div>
        </div>
        <div class="card section-card"><h3>近7日趋势</h3>${trendHtml}</div>
        <div class="card table-wrap"><table><thead><tr><th>类型</th><th>数量</th><th>占比</th></tr></thead><tbody>${typeRows || emptyRowHtml(3, "暂无类型数据", "有提交后将显示类型分布")}</tbody></table></div>`;
      setLastSync();
    } catch (err) {
      $("#statsContent").innerHTML = emptyBlockHtml("统计加载失败", err.message || "请稍后重试");
    }
  }

  async function viewFormSubmissions(templateId) {
    if (!templateId) return;
    if (!state.formOptions.length) await loadTypeOptions();
    state.templateId = templateId;
    if ($("#formSelect")) $("#formSelect").value = templateId;
    switchPanel("submissions");
    loadSubmissions(true);
  }

  async function loadForms() {
    $("#formsBody").innerHTML = '<tr><td colspan="5" class="loading">加载中...</td></tr>';
    try {
      const res = await callCloud("listFormTemplates");
      if (!res.success) {
        showToast(res.errMsg || "加载失败", "error");
        return;
      }
      state.forms = res.list || [];
      if (!state.forms.length) {
        $("#formsBody").innerHTML = emptyRowHtml(5, "暂无表单", "点击右上角「新建表单」开始创建");
        return;
      }
      $("#formsBody").innerHTML = state.forms
        .map(
          (t) => `<tr>
            <td><div class="form-title-cell"><strong>${escapeHtml(t.title || "未命名")}${t.isDefault ? ' <span class="badge badge-processed">默认</span>' : ""}</strong><small>${escapeHtml(t.description || "暂无表单说明")}</small></div></td>
            <td><button class="count-link" data-form-action="submissions" data-id="${escapeHtml(t._id)}">${t.submissionCount || 0} 条</button></td>
            <td><button class="status-switch ${t.enabled !== false ? "on" : "off"}" data-form-action="toggle" data-id="${escapeHtml(t._id)}" data-enabled="${t.enabled !== false ? "1" : "0"}"><i></i><span>${t.enabled !== false ? "已启用" : "已停用"}</span></button></td>
            <td>${formatTime(t.updateTime)}</td>
            <td class="action-cell">
              <button class="btn btn-primary btn-sm" data-form-action="edit" data-id="${escapeHtml(t._id)}">编辑</button>
              ${!t.isDefault ? `<button class="btn btn-outline btn-sm" data-form-action="default" data-id="${escapeHtml(t._id)}">设默认</button>` : ""}
              <button class="btn btn-outline btn-sm" data-form-action="copy" data-id="${escapeHtml(t._id)}" data-title="${escapeHtml(t.title || "")}">复制</button>
              ${!t.isDefault && Number(t.submissionCount || 0) === 0 ? `<button class="btn btn-ghost-danger btn-sm" data-form-action="delete" data-id="${escapeHtml(t._id)}" data-title="${escapeHtml(t.title || "")}">删除</button>` : ""}
            </td>
          </tr>`
        )
        .join("");
      setLastSync();
    } catch (err) {
      showToast(err.message || "加载失败", "error");
    }
  }

  async function toggleFormEnabled(id, enabled) {
    const res = await callCloud("updateFormTemplate", { templateId: id, enabled: !enabled });
    if (!res.success) return showToast(res.errMsg || "状态更新失败", "error");
    showToast(enabled ? "表单已停用" : "表单已启用");
    await loadForms();
  }

  async function deleteFormTemplate(id, title) {
    if (!confirm(`确定删除表单“${title || "未命名"}”吗？仅无提交记录且非默认表单可以删除。`)) return;
    const res = await callCloud("deleteFormTemplate", { templateId: id });
    if (!res.success) return showToast(res.errMsg || "删除失败", "error");
    showToast("表单已删除");
    await Promise.all([loadForms(), loadTypeOptions()]);
  }

  async function loadEmailConfig() {
    const badge = $("#emailStatusBadge");
    try {
      const res = await callCloud("getAdminEmailConfig");
      if (!res.success) {
        if (badge) {
          badge.textContent = "加载失败";
          badge.className = "badge badge-rejected";
        }
        return;
      }
      const cfg = res.config || {};
      state.emailConfig = cfg;
      state.emailReady = !!(
        cfg.enabled !== false &&
        cfg.smtpHost &&
        cfg.smtpUser &&
        cfg.hasPassword &&
        String(cfg.adminEmails || "").trim()
      );
      if ($("#emailEnabledInput")) $("#emailEnabledInput").checked = cfg.enabled !== false;
      if ($("#emailSmtpHostInput")) $("#emailSmtpHostInput").value = cfg.smtpHost || "";
      if ($("#emailSmtpPortInput")) $("#emailSmtpPortInput").value = cfg.smtpPort || 465;
      if ($("#emailSmtpSecureInput")) $("#emailSmtpSecureInput").checked = cfg.smtpSecure !== false;
      if ($("#emailSmtpUserInput")) $("#emailSmtpUserInput").value = cfg.smtpUser || "";
      if ($("#emailSmtpPassInput")) $("#emailSmtpPassInput").value = "";
      if ($("#emailFromEmailInput")) $("#emailFromEmailInput").value = cfg.fromEmail || "";
      if ($("#emailFromNameInput")) $("#emailFromNameInput").value = cfg.fromName || "表单通知";
      if ($("#emailAdminEmailsInput")) $("#emailAdminEmailsInput").value = cfg.adminEmails || "";
      if (badge) {
        if (state.emailReady) {
          badge.textContent = "已开启";
          badge.className = "badge badge-processed";
        } else {
          badge.textContent = cfg.enabled === false ? "已关闭" : "未配置";
          badge.className = "badge badge-pending";
        }
      }
    } catch (err) {
      if (badge) {
        badge.textContent = "加载失败";
        badge.className = "badge badge-rejected";
      }
    }
  }

  function applyEmailProvider(provider) {
    const presets = {
      qq: { host: "smtp.qq.com", port: 465, secure: true },
      "163": { host: "smtp.163.com", port: 465, secure: true },
      "126": { host: "smtp.126.com", port: 465, secure: true },
      aliyun: { host: "smtp.qiye.aliyun.com", port: 465, secure: true },
    };
    const preset = presets[provider];
    if (!preset) return;
    $("#emailSmtpHostInput").value = preset.host;
    $("#emailSmtpPortInput").value = preset.port;
    $("#emailSmtpSecureInput").checked = preset.secure;
    $$("[data-email-provider]").forEach((button) => button.classList.toggle("active", button.dataset.emailProvider === provider));
    showToast("已填入常用 SMTP 参数，请继续填写账号和授权码");
  }

  function collectEmailFormData() {
    return {
      enabled: !!$("#emailEnabledInput")?.checked,
      smtpHost: $("#emailSmtpHostInput")?.value.trim() || "",
      smtpPort: Number($("#emailSmtpPortInput")?.value || 465),
      smtpSecure: !!$("#emailSmtpSecureInput")?.checked,
      smtpUser: $("#emailSmtpUserInput")?.value.trim() || "",
      smtpPass: $("#emailSmtpPassInput")?.value || "",
      fromEmail: $("#emailFromEmailInput")?.value.trim() || "",
      fromName: $("#emailFromNameInput")?.value.trim() || "表单通知",
      adminEmails: $("#emailAdminEmailsInput")?.value || "",
    };
  }

  async function saveEmailConfig() {
    const btn = $("#saveEmailBtn");
    setButtonLoading(btn, true);
    try {
      const res = await callCloud("saveAdminEmailConfig", collectEmailFormData());
      if (!res.success) {
        showToast(res.errMsg || "保存失败", "error");
        return;
      }
      showToast("邮箱配置已保存");
      await loadEmailConfig();
    } catch (err) {
      showToast(err.message || "保存失败", "error");
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function testEmailConfig() {
    const btn = $("#testEmailBtn");
    setButtonLoading(btn, true);
    try {
      const res = await callCloud("sendTestAdminEmail");
      if (!res.success) {
        showToast(res.errMsg || "发送失败", "error");
        return;
      }
      showToast("测试邮件已发送，请查收管理员邮箱");
    } catch (err) {
      showToast(err.message || "发送失败", "error");
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function loadNotify() {
    await loadEmailConfig();
    $("#notifyBody").innerHTML = '<tr><td colspan="5" class="loading">加载中...</td></tr>';
    try {
      const res = await callCloud("listNotifyTemplates");
      if (!res.success) {
        showToast(res.errMsg || "加载失败", "error");
        return;
      }
      state.notifyList = res.list || [];
      state.platformTemplates = res.platformTemplates || [];
      const platformAlert = $("#notifyPlatformAlert");
      if (platformAlert) {
        if (res.platformError) {
          platformAlert.textContent = res.platformError;
          platformAlert.classList.remove("hidden");
        } else {
          platformAlert.textContent = "";
          platformAlert.classList.add("hidden");
        }
      }
      if (!state.notifyList.length) {
        $("#notifyBody").innerHTML = emptyRowHtml(5, "暂无通知模板", "点击右上角添加模板，并在小程序中完成授权");
        return;
      }
      $("#notifyBody").innerHTML = state.notifyList
        .map(
          (item) => `<tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.platformTemplateTitle || "-")}</td>
            <td>${item.enabled !== false ? '<span class="badge badge-processed">启用</span>' : '<span class="badge badge-rejected">停用</span>'}</td>
            <td>${item.subscribed ? '<span class="badge badge-processed">已授权</span>' : '<span class="badge badge-pending">未授权</span>'}</td>
            <td class="action-cell">
              <button class="btn btn-outline btn-sm" data-notify-action="test" data-id="${escapeHtml(item._id)}">测试</button>
              <button class="btn btn-outline btn-sm" data-notify-action="edit" data-id="${escapeHtml(item._id)}">编辑</button>
              <button class="btn btn-danger btn-sm" data-notify-action="delete" data-id="${escapeHtml(item._id)}" data-name="${escapeHtml(item.name)}">删除</button>
            </td>
          </tr>`
        )
        .join("");
    } catch (err) {
      showToast(err.message || "加载失败", "error");
    }
  }

  async function loadBackups() {
    $("#backupBody").innerHTML = '<tr><td colspan="4" class="loading">加载中...</td></tr>';
    try {
      const res = await callCloud("listBackups");
      if (!res.success) {
        showToast(res.errMsg || "加载失败", "error");
        return;
      }
      state.backups = res.list || [];
      if (!state.backups.length) {
        $("#backupBody").innerHTML = emptyRowHtml(4, "暂无备份记录", "点击右上角「立即备份」生成 Excel / JSON");
        return;
      }
      $("#backupBody").innerHTML = state.backups
        .map(
          (item) => `<tr>
            <td>${formatTime(item.createTime)}</td>
            <td>${item.count || 0}${item.truncated ? "（已截断）" : ""}</td>
            <td>${item.source === "scheduled" ? "自动" : "手动"}</td>
            <td class="action-cell">
              ${item.excelFileID ? `<button class="btn btn-primary btn-sm" data-backup-download="${escapeHtml(item.excelFileID)}">下载 Excel</button>` : ""}
              <button class="btn btn-outline btn-sm" data-backup-download="${escapeHtml(item.fileID)}">下载 JSON</button>
            </td>
          </tr>`
        )
        .join("");
    } catch (err) {
      showToast(err.message || "加载失败", "error");
      $("#backupBody").innerHTML = emptyRowHtml(4, "加载失败", err.message || "请稍后重试");
    }
  }

  function renderLogs() {
    const keyword = $("#logsKeywordInput")?.value.trim().toLowerCase() || "";
    const action = $("#logsActionSelect")?.value || "";
    const list = state.logs.filter((item) => {
      const actionLabel = AUDIT_ACTION_MAP[item.action] || item.action || item.type || "";
      const detail = typeof item.detail === "object" ? JSON.stringify(item.detail) : item.detail || item.remark || "";
      const haystack = `${actionLabel} ${item.operatorName || item.adminName || item.openid || ""} ${detail}`.toLowerCase();
      return (!keyword || haystack.includes(keyword)) && (!action || (item.action || item.type || "") === action);
    });
    if (!list.length) {
      $("#logsBody").innerHTML = emptyRowHtml(4, "没有匹配的日志", keyword || action ? "请调整搜索条件" : "管理员操作后将在此显示审计记录");
      return;
    }
    $("#logsBody").innerHTML = list.map((item) => {
      const actionLabel = AUDIT_ACTION_MAP[item.action] || item.action || item.type || "-";
      const detail = typeof item.detail === "object" ? JSON.stringify(item.detail) : item.detail || item.remark || "-";
      return `<tr><td>${formatTime(item.createTime)}</td><td><span class="audit-action">${escapeHtml(actionLabel)}</span></td><td>${escapeHtml(item.operatorName || item.adminName || item.openid || "-")}</td><td class="log-detail">${escapeHtml(detail)}</td></tr>`;
    }).join("");
  }

  async function loadLogs() {
    $("#logsBody").innerHTML = '<tr><td colspan="4" class="loading">加载中...</td></tr>';
    try {
      const res = await callCloud("getAuditLogs", { page: 1, pageSize: 100 });
      if (!res.success) {
        showToast(res.errMsg || "加载失败", "error");
        return;
      }
      state.logs = res.list || [];
      const actionSelect = $("#logsActionSelect");
      const current = actionSelect?.value || "";
      const actions = [...new Set(state.logs.map((item) => item.action || item.type).filter(Boolean))];
      if (actionSelect) {
        actionSelect.innerHTML = '<option value="">全部操作</option>' + actions.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(AUDIT_ACTION_MAP[key] || key)}</option>`).join("");
        actionSelect.value = current;
      }
      renderLogs();
      setLastSync();
    } catch (err) {
      showToast(err.message || "加载失败", "error");
      $("#logsBody").innerHTML = emptyRowHtml(4, "日志加载失败", err.message || "请稍后重试");
    }
  }

  function roleBadge(user) {
    if (user.role === "admin") {
      const roleLabel = ({ owner: "超级管理员", editor: "编辑", viewer: "只读", exporter: "导出" })[user.adminRole] || user.adminRole || "管理员";
      return `<span class="badge badge-admin">管理员 · ${escapeHtml(roleLabel)}</span>`;
    }
    return `<span class="badge badge-user">普通用户</span>`;
  }

  function shortOpenId(openid) {
    const text = String(openid || "").trim();
    if (!text) return "-";
    if (text.length <= 16) return text;
    return `${text.slice(0, 8)}…${text.slice(-6)}`;
  }

  function renderUsers() {
    const totalText = $("#usersTotalText");
    if (totalText) totalText.textContent = `共 ${state.usersTotal || 0} 人`;
    const pageInfo = $("#usersPageInfo");
    if (pageInfo) {
      const pages = Math.max(1, Math.ceil((state.usersTotal || 0) / state.usersPageSize));
      pageInfo.textContent = `第 ${state.usersPage} / ${pages} 页`;
    }
    const prev = $("#usersPrevPage");
    const next = $("#usersNextPage");
    if (prev) prev.disabled = state.usersPage <= 1;
    if (next) next.disabled = state.usersPage * state.usersPageSize >= state.usersTotal;

    const list = state.users || [];
    if (!list.length) {
      $("#usersBody").innerHTML = emptyRowHtml(
        7,
        "暂无用户数据",
        state.usersKeyword || state.usersRole ? "请调整搜索条件" : "users 集合暂无记录"
      );
      return;
    }

    $("#usersBody").innerHTML = list
      .map((user) => {
        const avatar = user.avatarUrl
          ? `<img class="user-avatar" src="${escapeHtml(user.avatarUrl)}" alt="" />`
          : `<span class="user-avatar user-avatar-fallback">${escapeHtml((user.nickName || "用").slice(0, 1))}</span>`;
        return `<tr>
          <td><div class="user-cell">${avatar}<div><strong>${escapeHtml(user.nickName || "未命名用户")}</strong><small>${escapeHtml(user._id || "")}</small></div></div></td>
          <td>${escapeHtml(user.phone || "-")}</td>
          <td>${escapeHtml(user.email || "-")}</td>
          <td>${roleBadge(user)}</td>
          <td class="mono" title="${escapeHtml(user.openid || "")}">${escapeHtml(shortOpenId(user.openid))}</td>
          <td>${formatTime(user.createTime)}</td>
          <td>${formatTime(user.lastLoginTime)}</td>
        </tr>`;
      })
      .join("");
  }

  async function loadUsers(resetPage) {
    if (resetPage) state.usersPage = 1;
    state.usersKeyword = ($("#usersKeywordInput")?.value || "").trim();
    state.usersRole = $("#usersRoleSelect")?.value || "";
    $("#usersBody").innerHTML = '<tr><td colspan="7" class="loading">加载中...</td></tr>';
    try {
      const res = await callCloud("listUsers", {
        page: state.usersPage,
        pageSize: state.usersPageSize,
        keyword: state.usersKeyword,
        role: state.usersRole,
      });
      if (!res.success) {
        showToast(res.errMsg || "加载失败", "error");
        $("#usersBody").innerHTML = emptyRowHtml(7, "用户加载失败", res.errMsg || "请稍后重试");
        return;
      }
      state.users = res.list || [];
      state.usersTotal = Number(res.total || 0);
      state.usersPage = Number(res.page || state.usersPage);
      state.usersPageSize = Number(res.pageSize || state.usersPageSize);
      renderUsers();
      setLastSync();
    } catch (err) {
      showToast(err.message || "加载失败", "error");
      $("#usersBody").innerHTML = emptyRowHtml(7, "用户加载失败", err.message || "请稍后重试");
    }
  }

  async function showDetail(id) {
    const modal = $("#detailModal");
    $("#detailBody").innerHTML = '<div class="loading">加载中...</div>';
    modal.classList.add("visible");
    state.detailId = id;

    try {
      const res = await callCloud("getFormDetail", { id });
      if (!res.success) {
        $("#detailBody").innerHTML = emptyBlockHtml("无法加载详情", res.errMsg || "请稍后重试");
        return;
      }
      const item = res.data || {};
      const fields = res.templateFields || [];
      const answers = item.answers || {};
      const summary = getSummary(item);
      let rows = "";
      if (fields.length) {
        fields.forEach((f) => {
          let val = answers[f.id];
          if (Array.isArray(val)) val = val.join(", ");
          if (val && typeof val === "object") val = JSON.stringify(val);
          const isLong = String(val || "").length > 40 || f.type === "textarea";
          rows += `<div class="detail-row ${isLong ? "full" : ""}"><div class="detail-label">${escapeHtml(f.label || f.id)}</div><div class="detail-value">${escapeHtml(val || "-")}</div></div>`;
        });
      } else {
        Object.keys(answers).forEach((key) => {
          rows += `<div class="detail-row"><div class="detail-label">${escapeHtml(key)}</div><div class="detail-value">${escapeHtml(String(answers[key] || "-"))}</div></div>`;
        });
      }
      if (item.remark) {
        rows += `<div class="detail-row full"><div class="detail-label">备注</div><div class="detail-value">${escapeHtml(item.remark)}</div></div>`;
      }
      $("#detailBody").innerHTML = `
        <div class="detail-summary">
          <div class="detail-summary-item">表单编号<strong>${escapeHtml(item.formNo || "-")}</strong></div>
          <div class="detail-summary-item">表单名称<strong>${escapeHtml(summary.formTitle)}</strong></div>
          <div class="detail-summary-item">提交人<strong>${escapeHtml(summary.name)}</strong></div>
          <div class="detail-summary-item">手机号<strong>${escapeHtml(summary.phone)}</strong></div>
          <div class="detail-summary-item">时间<strong>${formatTime(item.createTime)}</strong></div>
          <div class="detail-summary-item">状态<strong>${renderStatus(item.status)}</strong></div>
        </div>
        <div class="detail-grid">${rows}</div>`;
    } catch (err) {
      $("#detailBody").innerHTML = emptyBlockHtml("加载失败", err.message || "请稍后重试");
    }
  }

  function closeModal(id) {
    $(id).classList.remove("visible");
    if (id === "#detailModal") state.detailId = null;
  }

  async function updateStatus(id, status) {
    try {
      const res = await callCloud("updateFormStatus", { id, status });
      if (!res.success) {
        showToast(res.errMsg || "操作失败", "error");
        return;
      }
      showToast("状态已更新");
      closeModal("#detailModal");
      await loadSubmissions(false);
    } catch (err) {
      showToast(err.message || "操作失败", "error");
    }
  }

  async function deleteSubmission(id) {
    if (!confirm("确定删除这条记录吗？删除后无法恢复。")) return;
    try {
      const res = await callCloud("deleteFormSubmission", { id });
      if (!res.success) {
        showToast(res.errMsg || "删除失败", "error");
        return;
      }
      showToast("已删除");
      closeModal("#detailModal");
      await loadSubmissions(true);
    } catch (err) {
      showToast(err.message || "删除失败", "error");
    }
  }

  async function handleExport(format) {
    const btn = format === "xlsx" ? $("#exportXlsxBtn") : $("#exportCsvBtn");
    setButtonLoading(btn, true);
    try {
      const res = await callCloud("exportForms", {
        status: state.filter,
        keyword: state.keyword,
        phone: state.phone,
        typeValue: state.typeValue,
        fieldId: "type",
        templateId: state.templateId,
        dateFrom: state.dateFrom,
        dateTo: state.dateTo,
        format,
      });
      if (!res.success) {
        showToast(res.errMsg || "导出失败", "error");
        return;
      }
      if (res.downloadUrl) {
        if (!openTrustedDownload(res.downloadUrl)) {
          showToast("\u4e0b\u8f7d\u94fe\u63a5\u65e0\u6548\u6216\u4e0d\u5b89\u5168", "error");
          return;
        }
        showToast(`已导出 ${res.count || 0} 条记录`);
      } else {
        showToast("导出成功，请在云存储 exports 目录查看", "success");
      }
    } catch (err) {
      showToast(err.message || "导出失败", "error");
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function toggleBatchMode() {
    state.selectMode = !state.selectMode;
    state.selectedIds = [];
    state.allSelected = false;
    $("#batchBar").classList.toggle("hidden", !state.selectMode);
    $("#batchModeBtn").textContent = state.selectMode ? "取消批量" : "批量操作";
    $("#batchModeBtn").classList.toggle("active", state.selectMode);
    renderList();
  }

  function toggleSelect(id) {
    const idx = state.selectedIds.indexOf(id);
    if (idx >= 0) state.selectedIds.splice(idx, 1);
    else state.selectedIds.push(id);
    renderList();
  }

  function toggleSelectAll() {
    if (state.allSelected) state.selectedIds = [];
    else state.selectedIds = state.list.map((item) => item._id);
    renderList();
  }

  async function batchUpdateStatus(status) {
    const ids = state.selectedIds;
    if (!ids.length) return showToast("请先选择记录", "error");
    const label = STATUS_MAP[status]?.label || status;
    if (!confirm(`确定将选中的 ${ids.length} 条记录标记为「${label}」吗？`)) return;
    state.batchLoading = true;
    try {
      const res = await callCloud("batchUpdateFormStatus", { ids, status });
      if (!res.success) {
        showToast(res.errMsg || "操作失败", "error");
        return;
      }
      showToast(`已更新 ${res.count || ids.length} 条`);
      state.selectedIds = [];
      state.selectMode = false;
      $("#batchBar").classList.add("hidden");
      $("#batchModeBtn").textContent = "批量操作";
      $("#batchModeBtn").classList.remove("active");
      await loadSubmissions(true);
    } catch (err) {
      showToast(err.message || "操作失败", "error");
    } finally {
      state.batchLoading = false;
    }
  }

  async function batchDelete() {
    const ids = state.selectedIds;
    if (!ids.length) return showToast("请先选择记录", "error");
    if (!confirm(`确定删除选中的 ${ids.length} 条记录吗？删除后无法恢复。`)) return;
    state.batchLoading = true;
    try {
      const res = await callCloud("batchDeleteFormSubmissions", { ids });
      if (!res.success) {
        showToast(res.errMsg || "删除失败", "error");
        return;
      }
      showToast(`已删除 ${res.count || ids.length} 条`);
      state.selectedIds = [];
      state.selectMode = false;
      $("#batchBar").classList.add("hidden");
      $("#batchModeBtn").textContent = "批量操作";
      $("#batchModeBtn").classList.remove("active");
      await loadSubmissions(true);
    } catch (err) {
      showToast(err.message || "删除失败", "error");
    } finally {
      state.batchLoading = false;
    }
  }

  function createEmptyField() {
    const id = "field_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return {
      id,
      type: "text",
      label: "新字段",
      required: false,
      placeholder: "",
      options: [],
    };
  }

  function renderFieldsEditor() {
    const container = $("#fieldsEditor");
    if (!state.editingFormFields.length) {
      container.innerHTML = emptyBlockHtml("暂无字段", "点击上方「添加字段」开始配置");
      return;
    }
    const typeOptions = FIELD_TYPES.map(
      (t) => `<option value="${t.type}">${t.label}</option>`
    ).join("");
    container.innerHTML = state.editingFormFields
      .map((field, index) => {
        const hasOptions = ["select", "radio", "checkbox"].includes(field.type);
        const optionsVal = (field.options || []).join(",");
        return `<div class="field-card" data-field-index="${index}">
          <div class="field-card-head">
            <span class="field-card-title">字段 ${index + 1}</span>
            <button type="button" class="btn btn-danger btn-sm" data-remove-field="${index}">删除</button>
          </div>
          <div class="field-grid">
            <div class="form-group">
              <label>标签</label>
              <input type="text" data-field-prop="label" data-field-index="${index}" value="${escapeHtml(field.label || "")}" />
            </div>
            <div class="form-group">
              <label>类型</label>
              <select data-field-prop="type" data-field-index="${index}">${typeOptions}</select>
            </div>
            <div class="form-group">
              <label>占位提示</label>
              <input type="text" data-field-prop="placeholder" data-field-index="${index}" value="${escapeHtml(field.placeholder || "")}" />
            </div>
            <div class="form-group form-row">
              <label>必填</label>
              <input type="checkbox" data-field-prop="required" data-field-index="${index}" ${field.required ? "checked" : ""} />
            </div>
          </div>
          <div class="form-group options-group ${hasOptions ? "" : "hidden"}" data-options-row="${index}">
            <label>选项（逗号分隔）</label>
            <input type="text" data-field-prop="options" data-field-index="${index}" value="${escapeHtml(optionsVal)}" placeholder="选项1,选项2,选项3" />
          </div>
        </div>`;
      })
      .join("");

    container.querySelectorAll('select[data-field-prop="type"]').forEach((sel) => {
      const index = Number(sel.dataset.fieldIndex);
      sel.value = state.editingFormFields[index]?.type || "text";
    });
  }

  function syncFieldFromInput(el) {
    const index = Number(el.dataset.fieldIndex);
    const prop = el.dataset.fieldProp;
    if (Number.isNaN(index) || !prop || !state.editingFormFields[index]) return;
    const field = state.editingFormFields[index];
    if (prop === "required") field.required = !!el.checked;
    else if (prop === "options") field.options = el.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    else field[prop] = el.value;
    if (prop === "type") renderFieldsEditor();
  }

  async function openFormEdit(id) {
    state.editingFormId = id;
    $("#formEditModal").classList.add("visible");
    $("#fieldsEditor").innerHTML = '<div class="loading">加载中...</div>';
    try {
      const res = await callCloud("getFormTemplate", { forAdmin: true, templateId: id });
      if (!res.success) {
        showToast(res.errMsg || "加载失败", "error");
        closeModal("#formEditModal");
        return;
      }
      const template = res.template || {};
      state.editingFormFields = JSON.parse(JSON.stringify(template.fields || []));
      $("#editFormTitle").value = template.title || "";
      $("#editFormDesc").value = template.description || "";
      $("#editFormEnabled").checked = template.enabled !== false;
      renderFieldsEditor();
    } catch (err) {
      showToast(err.message || "加载失败", "error");
      closeModal("#formEditModal");
    }
  }

  async function saveFormEdit() {
    if (!state.editingFormId) return;
    const title = $("#editFormTitle")?.value.trim();
    const description = $("#editFormDesc")?.value.trim() || "";
    const enabled = $("#editFormEnabled")?.checked;
    if (!title) return showToast("请填写表单名称", "error");
    if (!state.editingFormFields.length) return showToast("请至少保留一个字段", "error");

    const btn = $("#formEditSave");
    btn.disabled = true;
    try {
      const res = await callCloud("updateFormTemplate", {
        templateId: state.editingFormId,
        title,
        description,
        enabled,
        fields: state.editingFormFields,
      });
      if (!res.success) {
        showToast(res.errMsg || "保存失败", "error");
        return;
      }
      showToast("保存成功");
      closeModal("#formEditModal");
      state.editingFormId = "";
      state.editingFormFields = [];
      loadForms();
    } catch (err) {
      showToast(err.message || "保存失败", "error");
    } finally {
      btn.disabled = false;
    }
  }

  function openFormModal(copyFromId, defaultTitle) {
    state.formModalCopyId = copyFromId || "";
    $("#formModalTitle").textContent = copyFromId ? "复制表单" : "新建表单";
    $("#formTitleInput").value = defaultTitle || "";
    $("#formModal").classList.add("visible");
  }

  async function saveFormModal() {
    const title = $("#formTitleInput").value.trim() || "新表单";
    try {
      const data = { title };
      if (state.formModalCopyId) data.copyFromId = state.formModalCopyId;
      const res = await callCloud("createFormTemplate", data);
      if (!res.success) {
        showToast(res.errMsg || "保存失败", "error");
        return;
      }
      showToast(state.formModalCopyId ? "已复制" : "创建成功");
      closeModal("#formModal");
      loadForms();
    } catch (err) {
      showToast(err.message || "保存失败", "error");
    }
  }

  function openNotifyModal(item) {
    state.editingNotifyId = item?._id || "";
    $("#notifyModalTitle").textContent = item ? "编辑通知模板" : "添加通知模板";
    $("#notifyNameInput").value = item?.name || "";
    $("#notifyEnabledInput").checked = item ? item.enabled !== false : true;
    const select = $("#notifyPlatformSelect");
    const usedIds = new Set((state.notifyList || []).map((row) => row.platformTemplateId));
    const platforms = (state.platformTemplates || []).filter(
      (p) => !usedIds.has(p.priTmplId) || p.priTmplId === item?.platformTemplateId
    );
    select.innerHTML = platforms
      .map((p) => `<option value="${escapeHtml(p.priTmplId)}">${escapeHtml(p.title || p.priTmplId)}</option>`)
      .join("");
    if (item?.platformTemplateId) select.value = item.platformTemplateId;
    $("#notifyModal").classList.add("visible");
  }

  async function saveNotifyModal() {
    const name = $("#notifyNameInput").value.trim();
    const platformTemplateId = $("#notifyPlatformSelect").value;
    const enabled = $("#notifyEnabledInput").checked;
    if (!name) return showToast("请填写模板名称", "error");
    if (!platformTemplateId) return showToast("请选择公众平台模板", "error");
    try {
      const res = await callCloud("saveNotifyTemplate", {
        id: state.editingNotifyId || undefined,
        name,
        platformTemplateId,
        enabled,
      });
      if (!res.success) {
        showToast(res.errMsg || "保存失败", "error");
        return;
      }
      showToast("保存成功");
      closeModal("#notifyModal");
      loadNotify();
    } catch (err) {
      showToast(err.message || "保存失败", "error");
    }
  }

  async function deleteNotifyTemplate(id, name) {
    if (!confirm(`确定删除「${name}」吗？`)) return;
    try {
      const res = await callCloud("deleteNotifyTemplate", { id });
      if (!res.success) {
        showToast(res.errMsg || "删除失败", "error");
        return;
      }
      showToast("已删除");
      loadNotify();
    } catch (err) {
      showToast(err.message || "删除失败", "error");
    }
  }

  async function testNotify(id) {
    try {
      const res = await callCloud("sendTestAdminNotify", { notifyConfigId: id });
      if (!res.success) {
        showToast(res.errMsg || "发送失败，请先在小程序授权该模板", "error");
        return;
      }
      showToast("测试通知已发送");
    } catch (err) {
      showToast(err.message || "发送失败", "error");
    }
  }

  async function backupNow() {
    const btn = $("#backupNowBtn");
    setButtonLoading(btn, true);
    try {
      const res = await callCloud("backupFormData");
      if (!res.success) {
        showToast(res.errMsg || "备份失败", "error");
        return;
      }
      const tip = res.truncated
        ? `已备份 ${res.count || 0} 条（共 ${res.totalInDb || res.count} 条，已截断）`
        : `已备份 ${res.count || 0} 条记录`;
      showToast(tip);
      loadBackups();
    } catch (err) {
      showToast(err.message || "备份失败", "error");
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function downloadBackup(fileID) {
    try {
      const res = await callCloud("getFileTempUrl", { fileID });
      if (!res.success || !res.downloadUrl) {
        showToast(res.errMsg || "获取下载链接失败", "error");
        return;
      }
      if (!openTrustedDownload(res.downloadUrl)) {
        showToast("\u4e0b\u8f7d\u94fe\u63a5\u65e0\u6548\u6216\u4e0d\u5b89\u5168", "error");
      }
    } catch (err) {
      showToast(err.message || "下载失败", "error");
    }
  }

  function bindEvents() {
    $("#refreshQrBtn").addEventListener("click", startWxLogin);
    $("#logoutBtn").addEventListener("click", handleLogout);

    $$(".nav-item").forEach((el) => el.addEventListener("click", () => switchPanel(el.dataset.panel)));
    $("#refreshPanelBtn")?.addEventListener("click", (event) => refreshCurrentPanel(event.currentTarget));
    $("#refreshSubmissionsBtn")?.addEventListener("click", (event) => refreshCurrentPanel(event.currentTarget));
    $("#pageSizeSelect")?.addEventListener("change", (event) => {
      state.pageSize = Math.max(1, Number(event.target.value) || 20);
      loadSubmissions(true);
    });
    $$('[data-date-preset]').forEach((button) => {
      button.addEventListener("click", () => applyDatePreset(button.dataset.datePreset));
    });
    $("#panel-overview")?.addEventListener("click", (event) => {
      const detailButton = event.target.closest("[data-overview-detail]");
      if (detailButton) {
        showDetail(detailButton.dataset.overviewDetail);
        return;
      }
      const panelButton = event.target.closest("[data-quick-panel]");
      if (panelButton) {
        switchPanel(panelButton.dataset.quickPanel);
        return;
      }
      const actionButton = event.target.closest("[data-quick-action]");
      if (actionButton?.dataset.quickAction === "create-form") {
        switchPanel("forms");
        openFormModal();
      }
    });

    $$(".stat-card").forEach((el) => {
      el.addEventListener("click", () => {
        state.filter = el.dataset.filter || "all";
        renderFilterSummary();
        loadSubmissions(true);
      });
    });

    $("#searchBtn").addEventListener("click", () => loadSubmissions(true));
    $("#clearFiltersBtn")?.addEventListener("click", clearAllFilters);
    $("#formSelect")?.addEventListener("change", () => loadSubmissions(true));
    $("#typeSelect")?.addEventListener("change", () => loadSubmissions(true));

    ["keywordInput", "phoneInput"].forEach((id) => {
      $("#" + id)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") loadSubmissions(true);
      });
    });

    $("#dateFromInput").addEventListener("change", () => {
      clearDatePresetSelection();
      loadSubmissions(true);
    });
    $("#dateToInput").addEventListener("change", () => {
      clearDatePresetSelection();
      loadSubmissions(true);
    });

    $("#batchModeBtn").addEventListener("click", toggleBatchMode);
    $("#selectAllBtn").addEventListener("click", toggleSelectAll);
    $("#batchDeleteBtn").addEventListener("click", batchDelete);
    $$("[data-batch-status]").forEach((btn) => {
      btn.addEventListener("click", () => batchUpdateStatus(btn.dataset.batchStatus));
    });

    $("#prevPage").addEventListener("click", () => {
      if (state.page > 1) {
        state.page--;
        loadSubmissions(false);
      }
    });
    $("#nextPage").addEventListener("click", () => {
      if (state.page * state.pageSize < state.total) {
        state.page++;
        loadSubmissions(false);
      }
    });

    $("#exportCsvBtn").addEventListener("click", () => handleExport("csv"));
    $("#exportXlsxBtn").addEventListener("click", () => handleExport("xlsx"));

    $("#listBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "detail") showDetail(id);
      else if (action === "approve") updateStatus(id, "processed");
      else if (action === "reject") updateStatus(id, "rejected");
    });
    $("#listBody").addEventListener("change", (e) => {
      const input = e.target.closest('[data-action="toggle"]');
      if (input) toggleSelect(input.dataset.id);
    });

    $("#modalClose").addEventListener("click", () => closeModal("#detailModal"));
    $("#modalCloseFooter").addEventListener("click", () => closeModal("#detailModal"));
    $("#detailModal").addEventListener("click", (e) => {
      if (e.target === $("#detailModal")) closeModal("#detailModal");
    });
    $("#modalApprove").addEventListener("click", () => state.detailId && updateStatus(state.detailId, "processed"));
    $("#modalPending").addEventListener("click", () => state.detailId && updateStatus(state.detailId, "pending"));
    $("#modalReject").addEventListener("click", () => state.detailId && updateStatus(state.detailId, "rejected"));
    $("#modalDelete").addEventListener("click", () => state.detailId && deleteSubmission(state.detailId));

    $("#createFormBtn").addEventListener("click", () => openFormModal());
    $("#formModalSave").addEventListener("click", saveFormModal);
    $("#formEditSave").addEventListener("click", saveFormEdit);
    $("#formEditModal").addEventListener("click", (e) => {
      if (e.target.id === "addFieldBtn") {
        state.editingFormFields.push(createEmptyField());
        renderFieldsEditor();
        return;
      }
      const removeBtn = e.target.closest("[data-remove-field]");
      if (removeBtn) {
        const index = Number(removeBtn.dataset.removeField);
        state.editingFormFields.splice(index, 1);
        renderFieldsEditor();
      }
    });
    $("#formEditModal").addEventListener("input", (e) => {
      if (e.target.dataset.fieldProp) syncFieldFromInput(e.target);
    });
    $("#formEditModal").addEventListener("change", (e) => {
      if (e.target.dataset.fieldProp) syncFieldFromInput(e.target);
    });
    $("#formsBody").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-form-action]");
      if (!btn) return;
      const { id, title } = btn.dataset;
      if (btn.dataset.formAction === "edit") openFormEdit(id);
      else if (btn.dataset.formAction === "submissions") viewFormSubmissions(id);
      else if (btn.dataset.formAction === "default") {
        const res = await callCloud("setDefaultFormTemplate", { templateId: id });
        if (res.success) {
          showToast("已设为默认");
          loadForms();
        } else showToast(res.errMsg || "设置失败", "error");
      } else if (btn.dataset.formAction === "copy") {
        openFormModal(id, `${title} 副本`);
      } else if (btn.dataset.formAction === "toggle") {
        toggleFormEnabled(id, btn.dataset.enabled === "1");
      } else if (btn.dataset.formAction === "delete") {
        deleteFormTemplate(id, title);
      }
    });

    $("#addNotifyBtn").addEventListener("click", async () => {
      if (!state.platformTemplates.length) {
        await loadNotify();
      }
      if (!state.platformTemplates.length) {
        showToast("暂无法获取公众平台模板列表，请先修复云调用 access_token 后再添加", "error");
        return;
      }
      openNotifyModal();
    });
    $("#saveEmailBtn").addEventListener("click", saveEmailConfig);
    $("#testEmailBtn").addEventListener("click", testEmailConfig);
    $$("[data-email-provider]").forEach((button) => button.addEventListener("click", () => applyEmailProvider(button.dataset.emailProvider)));
    $("#toggleEmailPassBtn")?.addEventListener("click", (e) => {
      const input = $("#emailSmtpPassInput");
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      e.currentTarget.innerHTML = `<svg><use href="#${reveal ? "i-eye-off" : "i-eye"}"></use></svg>`;
    });
    $("#emailSmtpSecureInput")?.addEventListener("change", (e) => {
      const portInput = $("#emailSmtpPortInput");
      if (!portInput) return;
      const current = Number(portInput.value || 0);
      if (!current || current === 465 || current === 587) {
        portInput.value = e.target.checked ? 465 : 587;
      }
    });
    $("#notifyModalSave").addEventListener("click", saveNotifyModal);
    $("#notifyBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-notify-action]");
      if (!btn) return;
      const item = state.notifyList.find((row) => row._id === btn.dataset.id);
      if (btn.dataset.notifyAction === "edit") openNotifyModal(item);
      else if (btn.dataset.notifyAction === "delete") deleteNotifyTemplate(btn.dataset.id, btn.dataset.name);
      else if (btn.dataset.notifyAction === "test") testNotify(btn.dataset.id);
    });

    $("#backupNowBtn").addEventListener("click", backupNow);
    $("#logsKeywordInput")?.addEventListener("input", renderLogs);
    $("#logsActionSelect")?.addEventListener("change", renderLogs);
    $("#refreshLogsBtn")?.addEventListener("click", loadLogs);
    $("#refreshUsersBtn")?.addEventListener("click", () => loadUsers(false));
    $("#usersRoleSelect")?.addEventListener("change", () => loadUsers(true));
    $("#usersKeywordInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") loadUsers(true);
    });
    $("#usersKeywordInput")?.addEventListener("search", () => loadUsers(true));
    $("#usersPageSizeSelect")?.addEventListener("change", (event) => {
      state.usersPageSize = Math.max(1, Number(event.target.value) || 20);
      loadUsers(true);
    });
    $("#usersPrevPage")?.addEventListener("click", () => {
      if (state.usersPage > 1) {
        state.usersPage -= 1;
        loadUsers(false);
      }
    });
    $("#usersNextPage")?.addEventListener("click", () => {
      if (state.usersPage * state.usersPageSize < state.usersTotal) {
        state.usersPage += 1;
        loadUsers(false);
      }
    });
    let usersSearchTimer = null;
    $("#usersKeywordInput")?.addEventListener("input", () => {
      clearTimeout(usersSearchTimer);
      usersSearchTimer = setTimeout(() => loadUsers(true), 350);
    });
    $("#backupBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-backup-download]");
      if (btn) downloadBackup(btn.dataset.backupDownload);
    });

    $$("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal("#" + btn.dataset.close));
    });
    $$("#formModal, #notifyModal, #formEditModal").forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal("#" + modal.id);
      });
    });
  }

  async function boot() {
    bindEvents();
    if (getToken()) {
      try {
        const res = await callCloud("getFormStats");
        if (res.success) {
          showApp();
          state.stats = res.stats || state.stats;
          await loadDashboard();
          return;
        }
      } catch (e) {
        /* fall through */
      }
      setToken("");
    }
    showLogin();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

