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
    // S1/§6.1：折叠箭头 → 序号 → 标题同一行，箭头左置；整头可点折叠。
    var head = document.createElement("div");
    head.className = "module-head";
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "module-collapse";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", t("module_toggle_label"));
    toggle.innerHTML = '<svg class="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var index = document.createElement("span");
    index.className = "module-index";
    // S6/§6.1：标题右侧参数摘要槽（逐模块更新，折叠不丢失）。
    var summary = document.createElement("span");
    summary.className = "module-summary";
    head.append(toggle, index, heading, summary);
    card.prepend(head);
    var body = document.createElement("div");
    body.className = "module-body";
    while (head.nextSibling) body.append(head.nextSibling);
    head.after(body);
    card.dataset.moduleBody = "1";
    var toggleCard = function () {
      setCollapsed(moduleId, !state.collapsed[moduleId]);
    };
    toggle.addEventListener("click", toggleCard);
    // 头部空白区同样可折叠；头部内的按钮、链接与表单控件不触发。
    head.addEventListener("click", function (event) {
      if (event.target.closest("button, a, input, select, textarea")) return;
      toggleCard();
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

  // S6/§6.1：模块头参数摘要——一行只读状态，帮助折叠时辨识卡内容。
  function basenameOf(value) {
    var parts = String(value || "").split(/[\/]/);
    return parts[parts.length - 1] || "";
  }

  function moduleSummary(moduleId) {
    var el = function (id) { return document.getElementById(id); };
    switch (moduleId) {
      case "media": {
        var path = (el("mediaPath")?.value || el("jsonPath")?.value || "").trim();
        return path ? basenameOf(path) : "";
      }
      case "waveform":
        return el("generateSpectral")?.checked ? t("summary_spectral_on") : t("summary_spectral_off");
      case "asr": {
        var provider = el("provider")?.selectedOptions?.[0]?.textContent || "";
        var model = el("model")?.value || "";
        return provider ? provider + (model ? " · " + model : "") : "";
      }
      case "match": {
        var script = el("postprocessScriptPath")?.value.trim() || "";
        return script ? basenameOf(script) : t("summary_not_configured");
      }
      case "replace": {
        var rules = (el("postprocessReplacements")?.value || "").split("\n").filter(function (line) { return line.trim(); }).length;
        return rules ? t("summary_rules").replace("{n}", String(rules)) : t("summary_not_configured");
      }
      case "proofread":
      case "resegment": {
        var field = el(moduleId === "proofread" ? "postprocessPromptProofread" : "postprocessPromptResegment");
        return field?.value.trim() ? t("summary_custom_prompt") : t("summary_default_prompt");
      }
      case "ocr": {
        var video = el("ocrVideoPath")?.value.trim() || "";
        return video ? basenameOf(video) : t("summary_auto_video");
      }
      case "translate": {
        var target = el("autoTranslateTarget")?.value || "zh";
        return target === "en" ? t("summary_target_en") : t("summary_target_zh");
      }
      case "alignment":
        return t("alignment_manual_badge");
      case "output": {
        var dir = el("outputDirectory")?.value.trim() || "";
        return dir ? dir : t("summary_default_output");
      }
      default:
        return "";
    }
  }

  var POSTPROCESS_MODULE_IDS = ["match", "replace", "proofread", "resegment", "ocr", "translate"];

  function renderCards() {
    // S4/§6.1：每个模块一张独立配置卡（波形/六后处理/对齐），处理日志可选且始终最后；
    // 序号按可见卡动态连续编排，模块 ID 持久化。
    var enabled = function (id) { return modules() ? modules().isEnabled(id) !== false : true; };
    var cards = [
      { moduleId: "media", visible: true },
      { moduleId: "waveform", visible: enabled("waveform") },
      { moduleId: "asr", visible: enabled("asr") },
    ];
    POSTPROCESS_MODULE_IDS.forEach(function (id) { cards.push({ moduleId: id, visible: enabled(id) }); });
    cards.push({ moduleId: "output", visible: enabled("output") });
    cards.push({ moduleId: "alignment", visible: enabled("alignment") });
    var logVisible = window.MSWModules ? window.MSWModules.isLogCardEnabled() : false;
    if (logVisible) {
      cards.push({ moduleId: "log", visible: true });
      // §6.5：日志卡首次显示默认折叠（用户展开后照常持久化）。
      if (state.collapsed.log === undefined) state.collapsed.log = true;
    }
    var orderMap = {};
    var next = 0;
    cards.forEach(function (card) {
      if (!card.visible) return;
      next += 1;
      orderMap[card.moduleId] = next;
    });
    var allCards = document.querySelectorAll("[data-module-card]");
    allCards.forEach(function (card) {
      var moduleId = card.dataset.moduleCard;
      ensureCardHead(card, moduleId);
      var visibleNow = Boolean(orderMap[moduleId]);
      card.classList.toggle("module-hidden", !visibleNow);
      if (!visibleNow) return;
      var indexEl = card.querySelector(".module-index");
      if (indexEl) indexEl.textContent = String(orderMap[moduleId]).padStart(2, "0");
      var collapsed = Boolean(state.collapsed[moduleId]);
      card.classList.toggle("collapsed", collapsed);
      var toggle = card.querySelector(".module-collapse");
      if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
      var summaryEl = card.querySelector(".module-summary");
      if (summaryEl) summaryEl.textContent = moduleSummary(moduleId);
    });
    renderOrderChip(orderMap);
  }

  function renderOrderChip(orderMap) {
    var chip = el("prefabOrderChip");
    if (!chip) return;
    // R4/§7.1：执行摘要由方案对象生成，与预检/执行/批量共用同一来源。
    var plan = window.MSWPlan ? window.MSWPlan.build() : null;
    var names = plan && window.MSWPlan.summaryLabels ? window.MSWPlan.summaryLabels(plan) : [];
    chip.textContent = t("chip_order").replace("{steps}", names.join(" → "));
  }

  function showLogCard() {
    // S4/§6.5：启用日志复选（同步右栏）→ 展开并定位日志卡；不再强制滚动其他执行路径。
    if (window.MSWModules && !window.MSWModules.isLogCardEnabled()) {
      window.MSWModules.setLogCardEnabled(true);
      window.MSWModules.renderRail();
    }
    state.collapsed.log = false;
    renderCards();
    var logCard = document.querySelector('[data-module-card="log"]');
    if (logCard) logCard.scrollIntoView({ behavior: "smooth", block: "start" });
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
        // S4：勾选因缺少条件打回——对应模块卡已常驻（未勾选也显示配置引导），直接展开它。
        var moduleId = detail.id || "";
        if (moduleId && document.querySelector('[data-module-card="' + moduleId + '"]')) {
          if (state.collapsed[moduleId]) setCollapsed(moduleId, false);
          else renderCards();
          return;
        }
        renderCards();
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
