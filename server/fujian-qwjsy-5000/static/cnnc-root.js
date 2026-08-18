(() => {
  const onReady = (fn) => document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", fn, { once: true })
    : fn();

  onReady(() => {
    const site = document.getElementById("site");
    const filter = document.getElementById("filter-source");
    if (!site || !filter) return;
    const crawlLimit = document.getElementById("crawl-limit");
    if (crawlLimit && crawlLimit.value === "200") crawlLimit.value = "0";
    document.getElementById("clear-form")?.addEventListener("click", () => {
      setTimeout(() => {
        if (crawlLimit) crawlLimit.value = "0";
      }, 0);
    });

    const addOption = (select, value, label) => {
      if (!select.querySelector(`option[value="${value}"]`)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
    };
    addOption(site, "cnnc", "核电公告");
    addOption(filter, "cnnc", "核电公告");

    const setText = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };
    const setHidden = (selector, hidden) => {
      const node = document.querySelector(selector);
      if (node) node.classList.toggle("hidden", hidden);
    };
    const applySource = () => {
      if (site.value !== "cnnc") return;
      filter.value = "cnnc";
      setText("stat-source", "核电公告");
      setText("result-source", "核电公告");
      const hint = document.getElementById("hint");
      if (hint) hint.textContent = "当前：核电公告。每次只读取五个公开列表页，不访问受保护的详情正文。";
      const mode = document.getElementById("mode");
      if (mode) mode.value = "title";
      setHidden(".field-date", false);
      document.querySelector("#mode")?.closest(".field")?.classList.add("hidden");
      document.querySelector("#region")?.closest(".field")?.classList.add("hidden");
      const keyword = document.getElementById("keyword");
      if (keyword) keyword.placeholder = "可留空，或按标题关键词筛选";
    };
    const applyResultBadges = () => {
      if (filter.value !== "cnnc") return;
      document.querySelectorAll("#list .badge-fujian").forEach((badge) => {
        if (badge.textContent !== "核电公告") badge.textContent = "核电公告";
        badge.classList.add("badge-cnnc");
      });
      setText("result-source", "核电公告");
    };

    document.head.insertAdjacentHTML("beforeend", "<style>.badge-cnnc{background:#e7f3fb!important;color:#0369a1!important}</style>");
    site.addEventListener("change", () => setTimeout(applySource, 0));
    filter.addEventListener("change", () => setTimeout(applyResultBadges, 0));
    new MutationObserver(applyResultBadges).observe(document.getElementById("list"), { childList: true, subtree: true });
    applySource();
    applyResultBadges();
  });
})();
