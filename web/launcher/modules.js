// MSW Launcher · 预制模块注册表（D 阶段）
// 模块身份用稳定 ID 持久化；序号按当前可见顺序临时编排，不写入存储。
// 右栏勾选与既有控件双向同步：后处理六项直接对应 autoStep* 复选框，
// 取消勾选只从本次计划移除配置区显示，不清空路径、提示词与替换规则。
(function () {
  "use strict";

  var STORAGE_KEY = "MSW_LAUNCHER_MODULES_V1";

  // 固定依赖顺序：媒体 → 波形 → 识别 → 后处理 → 翻译（规划 §5，不提供拖拽排序）。
  var MODULES = [
    { id: "media", group: "input", fixed: true, defaultOn: true, labelKey: "mod_media", order: 10 },
    { id: "waveform", group: "input", defaultOn: true, labelKey: "mod_waveform", order: 20 },
    { id: "asr", group: "input", defaultOn: true, labelKey: "mod_asr", order: 30,
      // 旧配置迁移：识别没有历史开关，保持既有行为默认参与（升级不改变习惯）；
      // 全新方案在 workflow.js 的内置方案里才会使用「媒体＋波形」的新默认。
      summaryKey: "mod_asr_summary" },
    { id: "match", group: "subtitle", defaultOn: false, labelKey: "mod_match", order: 40, control: "autoStepMatch", requires: "subtitles" },
    { id: "replace", group: "subtitle", defaultOn: false, labelKey: "mod_replace", order: 50, control: "autoStepReplace" },
    { id: "proofread", group: "subtitle", defaultOn: false, labelKey: "mod_proofread", order: 60, control: "autoStepProofread" },
    { id: "resegment", group: "subtitle", defaultOn: false, labelKey: "mod_resegment", order: 70, control: "autoStepResegment" },
    { id: "ocr", group: "subtitle", defaultOn: false, labelKey: "mod_ocr", order: 80, control: "autoStepOcr" },
    { id: "translate", group: "language", defaultOn: false, labelKey: "mod_translate", order: 90, control: "autoStepTranslate" },
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
    var rejected = false;
    if (module.control) {
      // 后处理模块以控件实际状态为准：未就绪的步骤会被 postprocess.js
      // 强制取消并打开配置引导（点击不可用模块显示缺少条件，不静默跳过）。
      var control = el(module.control);
      if (control && control.checked !== Boolean(on)) {
        control.checked = Boolean(on);
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (control) {
        state.enabled[id] = control.checked;
        rejected = Boolean(on) && !control.checked;
      }
      persist();
    }
    if (!options.silent) document.dispatchEvent(new CustomEvent("mswmodules", { detail: { id: id, enabled: state.enabled[id] === true, rejected: rejected } }));
  }

  function syncFromControls() {
    // 后处理六项复选框（工具箱「配置」入口等）变化时反向同步模块状态。
    MODULES.forEach(function (module) {
      if (!module.control) return;
      var control = el(module.control);
      if (!control) return;
      var handler = function () {
        state.enabled[module.id] = control.checked;
        // 任一后处理模块启用时打开自动后处理总开关；全部关闭不强制关（保留用户选择）。
        if (control.checked && module.id !== "asr") {
          var master = el("autoPostprocessEnabled");
          if (master && !master.checked) {
            master.checked = true;
            master.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        persist();
        renderRail();
        document.dispatchEvent(new CustomEvent("mswmodules", { detail: { id: module.id, enabled: control.checked } }));
      };
      control.addEventListener("change", handler);
    });
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
        input.disabled = Boolean(module.fixed);
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
    var logButton = document.createElement("button");
    logButton.type = "button";
    logButton.className = "rail-item rail-log-button";
    logButton.textContent = t("rail_show_log");
    logButton.addEventListener("click", function () {
      window.MSWWorkflow?.showLogCard?.();
    });
    feedback.append(feedbackTitle, logButton);
    rail.append(feedback);
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
    syncFromControls();
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
    state: state,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
