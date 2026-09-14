// MSW Launcher · 首页最近工程（C 阶段）
// 卡片列表来自后端合并视图（编辑器 recent_projects + 启动器固定/移除/重定位元数据）。
// 单击选择、双击直接打开、Enter 执行当前主按钮；首次进入默认无选择——
// 「启动空白编辑器」始终可用，不因自动选中最近工程而失去意义。
(function () {
  "use strict";

  var DEFAULT_LIMIT = 12;
  var state = {
    projects: [],
    visible: DEFAULT_LIMIT,
    selectedPath: "",
    query: "",
    menuPath: "",
  };

  function el(id) { return document.getElementById(id); }
  function t(key) { return window.MSWLauncher ? window.MSWLauncher.translate(key) : key; }
  function bridge(method, payload) { return window.MSWLauncher.callBackend(method, payload || {}); }

  function formatWhen(entry) {
    var stamp = entry.lastOpenedAt || entry.modifiedAt;
    if (!stamp) return t("recent_time_unknown");
    var date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return t("recent_time_unknown");
    var prefix = entry.lastOpenedAt ? "" : t("recent_time_file_prefix");
    var diff = Date.now() - date.getTime();
    var minutes = Math.floor(diff / 60000);
    if (minutes < 1) return prefix + t("recent_time_just_now");
    if (minutes < 60) return prefix + t("recent_time_minutes").replace("{n}", String(minutes));
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return prefix + t("recent_time_hours").replace("{n}", String(hours));
    var days = Math.floor(hours / 24);
    if (days < 30) return prefix + t("recent_time_days").replace("{n}", String(days));
    return prefix + date.toLocaleDateString();
  }

  function matchesQuery(entry) {
    if (!state.query) return true;
    var needle = state.query.toLowerCase();
    return entry.name.toLowerCase().includes(needle) || entry.dir.toLowerCase().includes(needle);
  }

  function visibleProjects() {
    return state.projects.filter(matchesQuery);
  }

  function createCard(entry) {
    var card = document.createElement("div");
    card.className = "recent-card" + (entry.pinned ? " pinned" : "");
    card.dataset.path = entry.path;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", String(entry.path === state.selectedPath));
    if (!entry.exists) card.classList.add("missing");

    var cover = document.createElement("div");
    cover.className = "recent-cover";
    cover.setAttribute("aria-hidden", "true");
    cover.innerHTML = '<svg viewBox="169 18 600 600" fill="currentColor"><path d="M639.25,138.93l-170.84-84.38-169.78,82.81-50,206.25,219.78,82.81,220.84-81.25-50-206.25Z"/></svg>';

    var info = document.createElement("div");
    info.className = "recent-info";
    var name = document.createElement("div");
    name.className = "recent-name";
    name.textContent = entry.name;
    name.title = entry.path;
    var dir = document.createElement("div");
    dir.className = "recent-dir";
    dir.textContent = entry.dir;
    var meta = document.createElement("div");
    meta.className = "recent-meta";
    var when = document.createElement("span");
    when.textContent = formatWhen(entry);
    meta.append(when);
    if (entry.exists) {
      var stats = document.createElement("span");
      stats.className = "recent-stats";
      stats.dataset.path = entry.path;
      stats.textContent = t("recent_stats_loading");
      meta.append(stats);
    } else {
      var missing = document.createElement("span");
      missing.className = "missing";
      missing.textContent = t("recent_missing");
      meta.append(missing);
    }
    info.append(name, dir, meta);
    if (entry.pinned) {
      var pin = document.createElement("span");
      pin.className = "recent-pin";
      pin.textContent = t("recent_pinned");
      info.append(pin);
    }
    card.append(cover, info);
    return card;
  }

  function render() {
    var grid = el("recentGrid");
    var empty = el("recentEmpty");
    var more = el("recentMore");
    var count = el("recentCount");
    grid.replaceChildren();
    var list = visibleProjects();
    var shown = list.slice(0, state.visible);
    shown.forEach(function (entry) { grid.append(createCard(entry)); });
    empty.classList.toggle("hidden", list.length > 0);
    more.classList.toggle("hidden", list.length <= state.visible);
    count.textContent = list.length ? t("recent_count").replace("{n}", String(list.length)) : "";
    renderLaunchButtons();
    // 统计按需逐个拉取：卡片先显示「读取中」，不伪造数字。
    shown.filter(function (entry) { return entry.exists; }).forEach(requestStats);
  }

  function requestStats(entry) {
    void bridge("get_recent_project_stats", { path: entry.path }).then(function (result) {
      var node = grid().querySelector('.recent-stats[data-path="' + cssEscape(entry.path) + '"]');
      if (!node) return;
      if (!result || result.ok !== true || result.skipped) {
        node.textContent = "";
        return;
      }
      node.textContent = t("recent_stats_summary")
        .replace("{main}", String(result.mainSubtitles ?? 0))
        .replace("{sub}", String(result.subSubtitles ?? 0))
        .replace("{audio}", String(result.audioClips ?? 0));
    });
  }

  function grid() { return el("recentGrid"); }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function renderLaunchButtons() {
    var openSelected = el("homeOpenSelected");
    if (!openSelected) return;
    openSelected.classList.toggle("hidden", !state.selectedPath);
  }

  function setSelected(path) {
    state.selectedPath = state.selectedPath === path ? "" : path;
    grid().querySelectorAll(".recent-card").forEach(function (card) {
      var selected = Boolean(state.selectedPath) && card.dataset.path === state.selectedPath;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    renderLaunchButtons();
  }

  function openProject(path) {
    var entry = state.projects.find(function (item) { return item.path === path; });
    if (!entry) return;
    if (!entry.exists) {
      relocateFlow(entry);
      return;
    }
    if (window.MSWLauncher && window.MSWLauncher.setJsonPath) {
      window.MSWLauncher.setJsonPath(entry.path);
      window.MSWNavigation.show("home");
      void window.MSWLauncher.openServerEditor();
    }
  }

  function relocateFlow(entry) {
    void window.MSWLauncher.confirm(t("recent_relocate_confirm").replace("{name}", entry.name)).then(function (yes) {
      if (!yes) return;
      void bridge("relocate_recent_project", { path: entry.path }).then(function (result) {
        if (result && result.ok) refresh();
        else if (result && result.cancelled) return;
        else if (window.MSWLauncher && window.MSWLauncher.errorText) {
          window.MSWLauncher.appendLog(t("recent_relocate_failed") + " " + (result ? (result.error || "") : ""), { inline: true });
        }
      });
    });
  }

  function refresh() {
    return bridge("get_recent_projects").then(function (result) {
      if (!result || result.ok !== true) return;
      state.projects = Array.isArray(result.projects) ? result.projects : [];
      if (state.selectedPath && !state.projects.some(function (item) { return item.path === state.selectedPath; })) {
        state.selectedPath = "";
      }
      render();
    });
  }

  function bindCardEvents() {
    var node = grid();
    node.addEventListener("click", function (event) {
      var card = event.target.closest(".recent-card");
      if (!card || !node.contains(card)) return;
      if (event.target.closest("button")) return;
      setSelected(card.dataset.path);
    });
    node.addEventListener("dblclick", function (event) {
      var card = event.target.closest(".recent-card");
      if (!card || !node.contains(card)) return;
      openProject(card.dataset.path);
    });
    node.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var card = event.target.closest(".recent-card");
      if (!card) return;
      event.preventDefault();
      if (event.key === " ") setSelected(card.dataset.path);
      else openProject(card.dataset.path);
    });
    node.addEventListener("contextmenu", function (event) {
      var card = event.target.closest(".recent-card");
      if (!card) return;
      event.preventDefault();
      openMenu(card, event);
    });
  }

  function openMenu(card, event) {
    closeMenu();
    state.menuPath = card.dataset.path;
    var entry = state.projects.find(function (item) { return item.path === state.menuPath; });
    if (!entry) return;
    var menu = document.createElement("div");
    menu.id = "recentContextMenu";
    menu.className = "recent-context-menu";
    menu.setAttribute("role", "menu");
    var actions = [];
    actions.push({ key: entry.pinned ? "recent_unpin" : "recent_pin", run: function () {
      void bridge("set_recent_project_pinned", { path: entry.path, pinned: !entry.pinned }).then(refresh);
    } });
    actions.push({ key: "recent_open_folder", run: function () {
      void bridge("open_containing_folder", { path: entry.path });
    } });
    if (!entry.exists) {
      actions.push({ key: "recent_relocate", run: function () { relocateFlow(entry); } });
    }
    actions.push({ key: "recent_remove", run: function () {
      void bridge("remove_recent_project", { path: entry.path }).then(refresh);
    } });
    actions.forEach(function (action) {
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = t(action.key);
      button.addEventListener("click", function () { closeMenu(); action.run(); });
      menu.append(button);
    });
    document.body.append(menu);
    var box = card.getBoundingClientRect();
    var left = Math.min(event.clientX || (box.left + box.width / 2), window.innerWidth - menu.offsetWidth - 8);
    var top = Math.min(event.clientY || box.top, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
    menu.addEventListener("keydown", function (keyEvent) {
      if (keyEvent.key === "Escape") closeMenu();
    });
    var dismiss = function (clickEvent) {
      if (!menu.contains(clickEvent.target)) closeMenu();
    };
    // 当前 contextmenu 事件仍在冒泡：延迟注册 dismiss，避免菜单刚创建就被自己删除。
    setTimeout(() => {
      document.addEventListener("click", dismiss, { once: true });
      document.addEventListener("contextmenu", dismiss, { once: true });
    }, 0);
  }

  function closeMenu() {
    var menu = el("recentContextMenu");
    if (menu) menu.remove();
    state.menuPath = "";
  }

  function bindToolbar() {
    var search = el("recentSearch");
    search.addEventListener("input", function () {
      state.query = search.value.trim().toLowerCase();
      state.visible = DEFAULT_LIMIT;
      render();
    });
    el("recentMore").addEventListener("click", function () {
      state.visible += DEFAULT_LIMIT;
      render();
    });
    el("homeBlank").addEventListener("click", function () {
      void window.MSWLauncher.startBlankEditor();
    });
    var openSelected = el("homeOpenSelected");
    if (openSelected) {
      openSelected.addEventListener("click", function () {
        if (state.selectedPath) openProject(state.selectedPath);
      });
    }
  }

  function init() {
    bindToolbar();
    bindCardEvents();
    void refresh();
    // 编辑器保存/另存为成功都会写编辑器设置；窗口重新聚焦时刷新一次首页索引。
    window.addEventListener("focus", function () {
      if (window.MSWNavigation && window.MSWNavigation.current() === "home") void refresh();
    });
    document.addEventListener("mswnavigation", function (event) {
      if (event.detail && event.detail.page === "home") void refresh();
    });
  }

  window.MSWProjectHome = {
    refresh: refresh,
    setSelected: setSelected,
    openProject: openProject,
    state: state,
  };

  function start() {
    // 桥接在 launcher.js init 完成前不可用；等待就绪事件再拉取最近工程。
    if (window.MSWLauncher && window.MSWLauncher.backend && window.MSWLauncher.backend !== "pending") init();
    else window.addEventListener("mawlauncherready", init, { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
