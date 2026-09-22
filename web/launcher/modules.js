// MSW Launcher · 预制模块注册表（D 阶段）
// 模块身份用稳定 ID 持久化；序号按当前可见顺序临时编排，不写入存储。
// 模块启用状态是方案的唯一真源；右栏直接编辑状态，卡片中不再放重复开关。
// 取消勾选只从本次计划移除配置区显示，不清空路径、提示词与替换规则。
(function () {
  "use strict";

  var STORAGE_KEY = "MSW_LAUNCHER_MODULES_V1";

  // 固定依赖顺序：媒体 → 波形 → 识别 → 后处理 → 翻译（规划 §5，不提供拖拽排序）。
  var MODULES = [
    { id: "media", group: "input", fixed: true, defaultOn: true, labelKey: "mod_media", order: 10 },
    { id: "waveform", group: "input", defaultOn: true, labelKey: "mod_waveform", order: 20 },
    // R4/F09：全新方案默认「仅媒体＋波形」，识别按需开启；
    // 旧配置迁移：存储里已保存 asr 开关的用户保持原值（load() 逐项保留 stored 值），
    // 未存储过的旧环境升级后按新默认（关）呈现。
    { id: "asr", group: "input", defaultOn: false, labelKey: "mod_asr", order: 30,
      summaryKey: "mod_asr_summary" },
    // match 依赖字幕来源（媒体＋ASR、已有工程或 SRT 输入）；预检统一校验（F11）。
    { id: "match", group: "subtitle", defaultOn: false, labelKey: "mod_match", order: 40, requires: "subtitles" },
    { id: "replace", group: "subtitle", defaultOn: false, labelKey: "mod_replace", order: 50 },
    { id: "proofread", group: "subtitle", defaultOn: false, labelKey: "mod_proofread", order: 60 },
    { id: "resegment", group: "subtitle", defaultOn: false, labelKey: "mod_resegment", order: 70 },
    { id: "ocr", group: "subtitle", defaultOn: false, labelKey: "mod_ocr", order: 80 },
    { id: "translate", group: "language", defaultOn: false, labelKey: "mod_translate", order: 90 },
    // 对齐是人工交互步骤：不进自动执行链，作为独立入口表达（R4/F10）。
    { id: "output", group: "advanced", defaultOn: false, labelKey: "mod_output", order: 95 },
    { id: "alignment", group: "advanced", defaultOn: false, labelKey: "mod_alignment", order: 100, external: true },
  ];

  var GROUP_LABELS = [
    { id: "input", labelKey: "rail_input" },
    { id: "subtitle", labelKey: "rail_subtitle" },
    { id: "language", labelKey: "rail_language" },
    { id: "advanced", labelKey: "rail_advanced" },
  ];

  var state = { enabled: {} };

  function el(id) { return document.getElementById(id); }
  function t(key) { return window.MSWLauncher ? window.MSWLauncher.translate(key) : key; }

  function defaults() {
    var enabled = {};
    MODULES.forEach(function (module) {
      enabled[module.id] = Boolean(module.defaultOn);
    });
    return enabled;
  }

  function load() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (error) { stored = null; }
    var enabled = defaults();
    if (stored && typeof stored === "object" && typeof stored.enabled === "object") {
      MODULES.forEach(function (module) {
        if (typeof stored.enabled[module.id] === "boolean") enabled[module.id] = stored.enabled[module.id];
      });
    }
    if (!stored) {
      (window.MSWLauncher?.config?.postprocessAutoPlan?.steps || []).forEach(step => {
        if (MODULES.some(module => module.id === step.id)) enabled[step.id] = Boolean(step.enabled);
      });
    }
    state.enabled = enabled;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, enabled: state.enabled })); } catch (error) { /* 草稿而已 */ }
  }

  function isEnabled(id) { return Boolean(state.enabled[id]); }

  function setEnabled(id, on, options) {
    options = options || {};
    var module = MODULES.find(function (item) { return item.id === id; });
    if (!module || module.fixed) return;
    state.enabled[id] = Boolean(on);
    persist();
    if (!options.silent) document.dispatchEvent(new CustomEvent("mswmodules", { detail: { id: id, enabled: Boolean(on) } }));
  }

  function renderRail() {
    var rail = el("railContent");
    if (!rail) return;
    rail.replaceChildren();
    GROUP_LABELS.forEach(function (group) {
      var items = MODULES.filter(function (module) { return module.group === group.id; });
      if (!items.length) return;
      var box = document.createElement("div");
      box.className = "rail-group";
      var title = document.createElement("div");
      title.className = "rail-group-title";
      title.textContent = t(group.labelKey);
      box.append(title);
      items.forEach(function (module) {
        var item = document.createElement("label");
        item.className = "rail-item" + (module.fixed ? " fixed" : "");
        var input = document.createElement("input");
        input.type = "checkbox";
        input.checked = isEnabled(module.id);
        input.dataset.moduleId = module.id;
        input.disabled = Boolean(module.fixed) || Boolean(window.MSWQueue?.state.running);
        input.setAttribute("aria-label", t(module.labelKey));
        var label = document.createElement("span");
        label.className = "rail-item-label";
        label.textContent = t(module.labelKey);
        item.append(input, label);
        if (module.fixed) {
          var note = document.createElement("span");
          note.className = "rail-item-note";
          note.textContent = t("rail_fixed_note");
          item.append(note);
        } else {
          input.addEventListener("change", function () { setEnabled(module.id, input.checked); renderRail(); });
        }
        box.append(item);
      });
      rail.append(box);
    });
    var feedback = document.createElement("div");
    feedback.className = "rail-group";
    var feedbackTitle = document.createElement("div");
    feedbackTitle.className = "rail-group-title";
    feedbackTitle.textContent = t("rail_feedback");
    // S4/§6.5：处理日志为可选显示模块——右栏复选框，默认不勾选（与预制多选一致）。
    var logItem = document.createElement("label");
    logItem.className = "rail-item";
    var logInput = document.createElement("input");
    logInput.type = "checkbox";
    logInput.id = "railLogToggle";
    logInput.checked = isLogCardEnabled();
    logInput.disabled = Boolean(window.MSWQueue?.state.running);
    logInput.setAttribute("aria-label", t("rail_log_toggle"));
    logInput.addEventListener("change", function () {
      setLogCardEnabled(logInput.checked);
      window.MSWWorkflow?.renderCards?.();
    });
    var logLabel = document.createElement("span");
    logLabel.className = "rail-item-label";
    logLabel.textContent = t("rail_log_toggle");
    logItem.append(logInput, logLabel);
    feedback.append(feedbackTitle, logItem);
    rail.append(feedback);
  }

  var LOG_CARD_KEY = "MSW_LAUNCHER_LOG_CARD_V1";

  function isLogCardEnabled() {
    try { return localStorage.getItem(LOG_CARD_KEY) === "1"; } catch (error) { return false; }
  }

  function setLogCardEnabled(enabled) {
    try { localStorage.setItem(LOG_CARD_KEY, enabled ? "1" : "0"); } catch (error) { /* 显示状态而已 */ }
  }

  function visibleCards() {
    // 左侧配置区按模块启用状态显示；固定模块始终显示。
    return MODULES.filter(function (module) { return module.fixed || isEnabled(module.id); });
  }

  function orderedEnabled() {
    return MODULES.filter(function (module) { return isEnabled(module.id); }).sort(function (a, b) { return a.order - b.order; });
  }

  function init() {
    load();
    renderRail();

  }

  function start() {
    if (window.MSWLauncher && window.MSWLauncher.backend && window.MSWLauncher.backend !== "pending") init();
    else window.addEventListener("mawlauncherready", init, { once: true });
  }

  window.MSWModules = {
    modules: MODULES,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    visibleCards: visibleCards,
    orderedEnabled: orderedEnabled,
    renderRail: renderRail,
    isLogCardEnabled: isLogCardEnabled,
    setLogCardEnabled: setLogCardEnabled,
    state: state,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
