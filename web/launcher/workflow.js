// MSW Launcher · 预制页编排（D 阶段）
// 左侧模块区：折叠只改显示不改启用；序号按当前可见顺序连续编号。
// 输入方式：媒体预制 / 已有工程·字幕再处理。切页、折叠、主题与语言切换保留草稿。
(function () {
  "use strict";

  var COLLAPSE_KEY = "MSW_LAUNCHER_MODULE_COLLAPSE_V1";
  var INPUT_MODE_KEY = "MSW_LAUNCHER_INPUT_MODE_V1";

  var state = {
    inputMode: "media",       // media | project
    collapsed: {},            // module card id -> true
    forcePostprocessCard: false, // 勾选被“未就绪”打回时保留配置卡显示引导
  };

  function el(id) { return document.getElementById(id); }
  function t(key) { return window.MSWLauncher ? window.MSWLauncher.translate(key) : key; }
  function modules() { return window.MSWModules; }

  // ---------------- 折叠与序号 ----------------

  function cardFor(moduleId) {
    return document.querySelector('[data-module-card="' + moduleId + '"]');
  }

  function ensureCardHead(card, moduleId) {
    if (card.querySelector(".module-head")) return;
    var heading = card.querySelector("h2");
    if (!heading) return;
    // R2/V07：序号 · 标题 · 折叠箭头同一行；标题移入头部，不再两行堆叠。
    var head = document.createElement("div");
    head.className = "module-head";
    var index = document.createElement("span");
    index.className = "module-index";
    head.append(index, heading);
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "module-collapse";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", t("module_toggle_label"));
    toggle.innerHTML = '<svg class="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    head.append(toggle);
    card.prepend(head);
    var body = document.createElement("div");
    body.className = "module-body";
    while (head.nextSibling) body.append(head.nextSibling);
    head.after(body);
    card.dataset.moduleBody = "1";
    toggle.addEventListener("click", function () {
      setCollapsed(moduleId, !state.collapsed[moduleId]);
    });
  }

  function setCollapsed(moduleId, collapsed) {
    state.collapsed[moduleId] = Boolean(collapsed);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state.collapsed)); } catch (error) { /* 显示状态而已 */ }
    renderCards();
  }

  function loadCollapse() {
    try { state.collapsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}") || {}; } catch (error) { state.collapsed = {}; }
  }

  var POSTPROCESS_MODULE_IDS = ["match", "replace", "proofread", "resegment", "ocr", "translate"];

  function renderCards() {
    // 配置卡与模块并非一一对应：波形是执行层选项（无独立卡）；
    // 「转写后自动处理」卡承载六项后处理模块，任一启用即显示。
    var cards = [
      { moduleId: "media", visible: true },
      { moduleId: "asr", visible: modules() ? modules().isEnabled("asr") : true },
      { moduleId: "postprocess", visible: modules() ? (state.forcePostprocessCard || POSTPROCESS_MODULE_IDS.some(function (id) { return modules().isEnabled(id); })) : false },
    ];
    var orderMap = {};
    var next = 0;
    cards.forEach(function (card) {
      if (!card.visible) return;
      next += 1;
      orderMap[card.moduleId] = next;
    });
    var allCards = document.querySelectorAll("[data-module-card]");
    var anyHidden = false;
    allCards.forEach(function (card) {
      var moduleId = card.dataset.moduleCard;
      ensureCardHead(card, moduleId);
      var visibleNow = Boolean(orderMap[moduleId]);
      card.classList.toggle("module-hidden", !visibleNow);
      if (!visibleNow) { anyHidden = true; return; }
      var indexEl = card.querySelector(".module-index");
      if (indexEl) indexEl.textContent = String(orderMap[moduleId]).padStart(2, "0");
      var collapsed = Boolean(state.collapsed[moduleId]);
      card.classList.toggle("collapsed", collapsed);
      var toggle = card.querySelector(".module-collapse");
      if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
    });
    renderOrderChip(orderMap);
  }

  function renderOrderChip(orderMap) {
    var chip = el("prefabOrderChip");
    if (!chip) return;
    var names = [];
    if (orderMap.media) names.push(t("chip_media"));
    if (modules() && modules().isEnabled("waveform")) names.push(t("chip_waveform"));
    if (orderMap.asr) names.push(t("chip_asr"));
    var postprocess = POSTPROCESS_MODULE_IDS.filter(function (id) { return modules() && modules().isEnabled(id); });
    if (postprocess.length) names.push(t("chip_cleanup").replace("{n}", String(postprocess.length)));
    chip.textContent = t("chip_order").replace("{steps}", names.join(" → "));
  }

  function showLogCard() {
    var logCard = el("logTitle")?.closest(".card");
    if (!logCard) return;
    setCollapsed("postprocess", state.collapsed["postprocess"]); // 重渲染不受影响
    logCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------- 输入方式 ----------------

  function setInputMode(mode, options) {
    options = options || {};
    if (mode !== "media" && mode !== "project") mode = "media";
    state.inputMode = mode;
    if (!options.silent) {
      try { localStorage.setItem(INPUT_MODE_KEY, mode); } catch (error) { /* 草稿 */ }
    }
    el("inputModeMedia").classList.toggle("active", mode === "media");
    el("inputModeMedia").setAttribute("aria-pressed", String(mode === "media"));
    el("inputModeProject").classList.toggle("active", mode === "project");
    el("inputModeProject").setAttribute("aria-pressed", String(mode === "project"));
    document.documentElement.dataset.prefabInputMode = mode;
    var dropZone = el("dropZone");
    if (dropZone) dropZone.textContent = mode === "project" ? t("project_drop_hint") : t("drop_hint");
    var mediaLabel = document.querySelector('label[for="mediaPath"]');
    if (mediaLabel) mediaLabel.textContent = mode === "project" ? t("project_input_label") : t("media");
    var mediaTitle = el("mediaTitle");
    if (mediaTitle) mediaTitle.textContent = mode === "project" ? t("project_card_title") : t("media_output");
  }

  function loadInputMode() {
    var stored = "";
    try { stored = localStorage.getItem(INPUT_MODE_KEY) || "media"; } catch (error) { stored = "media"; }
    setInputMode(stored === "project" ? "project" : "media", { silent: false });
  }

  // ---------------- 窄窗口模块抽屉（R1） ----------------

  function railDrawerActive() {
    return window.matchMedia("(max-width: 1100px)").matches;
  }

  function openRailDrawer() {
    document.body.classList.add("rail-open");
    document.getElementById("railBackdrop")?.classList.remove("hidden");
    var toggle = document.getElementById("railToggle");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
  }

  function closeRailDrawer() {
    document.body.classList.remove("rail-open");
    document.getElementById("railBackdrop")?.classList.add("hidden");
    var toggle = document.getElementById("railToggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function bindRailDrawer() {
    document.getElementById("railToggle")?.addEventListener("click", function () {
      if (document.body.classList.contains("rail-open")) closeRailDrawer();
      else openRailDrawer();
    });
    document.getElementById("railClose")?.addEventListener("click", closeRailDrawer);
    document.getElementById("railBackdrop")?.addEventListener("click", closeRailDrawer);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && document.body.classList.contains("rail-open")) closeRailDrawer();
    });
    // 宽窗口恢复双栏时收起抽屉状态。
    window.addEventListener("resize", function () {
      if (!railDrawerActive()) closeRailDrawer();
    });
  }

  function bindInputMode() {
    el("inputModeMedia").addEventListener("click", function () { setInputMode("media"); });
    el("inputModeProject").addEventListener("click", function () { setInputMode("project"); });
  }

  function refresh() { renderCards(); }

  function init() {
    loadCollapse();
    bindRailDrawer();
    bindInputMode();
    loadInputMode();
    renderCards();
    document.addEventListener("mswnavigation", function () {
      closeRailDrawer();
    });
    document.addEventListener("mswmodules", function (event) {
      var detail = event.detail || {};
      if (detail.rejected) {
        // 勾选因缺少条件被打回：显示并展开「转写后自动处理」卡承载配置引导。
        state.forcePostprocessCard = true;
        if (state.collapsed.postprocess) setCollapsed("postprocess", false);
        else renderCards();
        return;
      }
      refresh();
    });
    document.addEventListener("mawlauncherready", refresh);
  }

  function start() {
    if (window.MSWLauncher && window.MSWLauncher.backend && window.MSWLauncher.backend !== "pending") init();
    else window.addEventListener("mawlauncherready", init, { once: true });
  }

  // 语言切换时 renderLanguage 会按 data-i18n 重写静态文案；重新应用当前输入方式的动态文案。
  window.MSWLauncher = window.MSWLauncher || {};
  var previousLanguageChanged = window.MSWLauncher.onLanguageChanged;
  window.MSWLauncher.onLanguageChanged = function () {
    try { if (typeof previousLanguageChanged === "function") previousLanguageChanged.call(window.MSWLauncher); } catch (error) { /* 前一个钩子失败不阻断 */ }
    setInputMode(state.inputMode, { silent: true });
    renderCards();
  };

  window.MSWWorkflow = {
    state: state,
    setInputMode: setInputMode,
    inputMode: function () { return state.inputMode; },
    renderCards: renderCards,
    showLogCard: showLogCard,
    setCollapsed: setCollapsed,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
