// MSW Launcher · 实用工具页（S2：右侧单选工具 + 左侧直接配置并运行）
// 工具面板与运行按钮自旧工具箱抽屉原样迁入（保留元素 ID，绑定仍由 postprocess.js 持有）；
// 这里只负责：单选切换、面板/动作槽显隐、草稿保留（DOM 不销毁）、上次工具记忆与窄窗抽屉。
(function () {
  "use strict";

  var STORAGE_KEY = "MSW_TOOLS_PAGE_TOOL_V1";
  var TOOL_IDS = ["extractAudio", "burnSubtitle", "ffconcat", "alignment"];
  var activeTool = "extractAudio";

  function el(id) { return document.getElementById(id); }

  function railButtons() {
    return Array.from(document.querySelectorAll("[data-tools-select]"));
  }

  function select(tool) {
    if (!TOOL_IDS.includes(tool)) tool = "extractAudio";
    activeTool = tool;
    railButtons().forEach(function (button) {
      var active = button.dataset.toolsSelect === tool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll("[data-tools-panel]").forEach(function (panel) {
      panel.classList.toggle("hidden", panel.dataset.toolsPanel !== tool);
    });
    // 运行动作槽只管理本页容器内的（工具箱抽屉另有后处理动作槽，作用域互不重叠）。
    var runArea = el("toolsRunArea");
    if (runArea) {
      runArea.querySelectorAll("[data-tool-action]").forEach(function (slot) {
        slot.classList.toggle("hidden", slot.dataset.toolAction !== tool);
      });
    }
    try { localStorage.setItem(STORAGE_KEY, tool); } catch (error) { /* 显示记忆而已 */ }
  }

  function restore() {
    var saved = "";
    try { saved = localStorage.getItem(STORAGE_KEY) || ""; } catch (error) { saved = ""; }
    select(TOOL_IDS.includes(saved) ? saved : "extractAudio");
  }

  function moveFocus(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    var buttons = railButtons();
    var index = buttons.indexOf(event.currentTarget);
    if (index < 0) return;
    var target = event.key === "Home" ? buttons[0]
      : event.key === "End" ? buttons[buttons.length - 1]
      : buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    if (!target) return;
    event.preventDefault();
    select(target.dataset.toolsSelect);
    target.focus();
  }

  function railOpen() {
    return document.body.classList.contains("rail-open");
  }

  // T4/A3：关闭后隐藏栏不可被键盘继续访问——inert 一并移除焦点。
  function syncRailsReachability() {
    var open = railOpen();
    document.querySelectorAll(".tools-rail, .settings-rail").forEach(function (rail) {
      var narrow = window.matchMedia("(max-width: 1100px)").matches;
      rail.toggleAttribute("inert", narrow && !open);
    });
  }

  function closeRailDrawer() {
    if (!railOpen()) return;
    document.body.classList.remove("rail-open");
    el("railBackdrop")?.classList.add("hidden");
    syncRailsReachability();
  }

  function openRailDrawer(focusTarget) {
    document.body.classList.add("rail-open");
    el("railBackdrop")?.classList.remove("hidden");
    syncRailsReachability();
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
  }

  function init() {
    railButtons().forEach(function (button) {
      button.addEventListener("click", function () {
        select(button.dataset.toolsSelect);
        closeRailDrawer(); // 窄窗抽屉中选中即收起
      });
      button.addEventListener("keydown", moveFocus);
    });
    el("toolsRailToggle")?.addEventListener("click", function () {
      openRailDrawer(railButtons().find(function (button) { return button.dataset.toolsSelect === activeTool; }));
    });
    document.querySelectorAll("#toolsRail .rail-close").forEach(function (button) {
      button.addEventListener("click", closeRailDrawer);
    });
    // T4/A2：设置分组栏接入同一抽屉控制（此前按钮无绑定，窄窗点击无响应）。
    var settingsTabs = function () { return Array.from(document.querySelectorAll("#settingsRail [data-settings-tab]")); };
    el("settingsRailToggle")?.addEventListener("click", function () {
      openRailDrawer(settingsTabs().find(function (tab) { return tab.classList.contains("active"); }));
    });
    document.querySelectorAll("#settingsRail .rail-close").forEach(function (button) {
      button.addEventListener("click", closeRailDrawer);
    });
    settingsTabs().forEach(function (tab) {
      tab.addEventListener("click", function () { closeRailDrawer(); });
    });
    // 共用遮罩：预制/工具/设置栏都可能打开；点击关闭即可（各自状态互不影响）。
    el("railBackdrop")?.addEventListener("click", closeRailDrawer);
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !railOpen()) return;
      // 工具箱抽屉/菜单等先处理各自的 Esc；这里只收本页栏抽屉。
      closeRailDrawer();
    });
    document.addEventListener("mswnavigation", closeRailDrawer);
    window.addEventListener("resize", syncRailsReachability);
    syncRailsReachability();
    restore();
  }

  window.MSWTools = {
    select: select,
    current: function () { return activeTool; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
