// MSW Launcher · 页面导航
// 五页横向工作台的切换、滚动位置记忆与紧凑态。页面内容不因切换而重置：
// 切页只改显示，不清表单草稿，不影响运行中的任务。
(function () {
  "use strict";

  var PAGE_IDS = ["home", "prefab", "tools", "guide", "settings"];
  var STORAGE_KEY = "MSW_LAUNCHER_PAGE";
  var scrollMemory = {};
  var historyStack = [];
  var activePage = "home";

  function pageEl(pageId) {
    return document.querySelector('.page[data-page-id="' + pageId + '"]');
  }

  function scrollerFor(pageId) {
    var page = pageEl(pageId);
    return page ? page.querySelector(".page-scroll") : null;
  }

  function navButtons() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-nav-page]"));
  }

  function compactAllowed() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function applyCompactState() {
    var compact = compactAllowed();
    document.body.classList.toggle("nav-compact", compact);
  }

  function show(pageId, options) {
    options = options || {};
    if (PAGE_IDS.indexOf(pageId) < 0) pageId = "home";
    var current = pageEl(activePage);
    if (current) {
      var scroller = scrollerFor(activePage);
      if (scroller) scrollMemory[activePage] = scroller.scrollTop;
    }
    if (activePage && activePage !== pageId && !options.replace) historyStack.push(activePage);
    PAGE_IDS.forEach(function (id) {
      var page = pageEl(id);
      if (page) page.classList.toggle("active", id === pageId);
    });
    navButtons().forEach(function (button) {
      var selected = button.dataset.navPage === pageId;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    activePage = pageId;
    try { localStorage.setItem(STORAGE_KEY, pageId); } catch (error) { /* 私密模式等场景忽略 */ }
    var nextScroller = scrollerFor(pageId);
    if (nextScroller) nextScroller.scrollTop = scrollMemory[pageId] || 0;
    document.dispatchEvent(new CustomEvent("mswnavigation", { detail: { page: pageId } }));
  }

  function back() {
    var previous = historyStack.pop();
    show(previous || "home", { replace: true });
  }

  function current() {
    return activePage;
  }

  function init() {
    navButtons().forEach(function (button) {
      button.addEventListener("click", function () { show(button.dataset.navPage); });
    });
    var stored = "";
    try { stored = localStorage.getItem(STORAGE_KEY) || ""; } catch (error) { stored = ""; }
    show(PAGE_IDS.indexOf(stored) >= 0 ? stored : "home", { replace: true });
    applyCompactState();
    window.addEventListener("resize", applyCompactState);
  }

  window.MSWNavigation = {
    show: show,
    back: back,
    current: current,
    pageIds: PAGE_IDS.slice(),
    scrollerFor: scrollerFor,
    init: init,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
