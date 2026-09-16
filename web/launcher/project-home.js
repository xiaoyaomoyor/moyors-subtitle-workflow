// MSW Launcher · 首页最近工程（C 阶段；R3 修正案 H01–H05 重做）
// 卡片列表来自后端合并视图（编辑器 recent_projects + 启动器固定/移除/重定位元数据）。
// 单击选择、双击直接打开、Enter 执行当前主按钮；首次进入默认无选择——
// 「启动空白编辑器」始终可用，不因自动选中最近工程而失去意义。
//
// R3 要点：
// - 封面（H01）：16:9 卡片图，按可见区域异步加载；状态含 图片/纯音频/无媒体/
//   媒体缺失/工程缺失/工程损坏/提取失败，失败不阻止打开工程；
// - 选中（H02）：卡片创建时从唯一选中状态恢复样式与 aria-pressed，
//   选择随 sessionStorage 在刷新后恢复；
// - 搜索（H03）：筛选隐藏当前目标时清除选择，启动区显示当前将打开的目标；
// - 目标（H04）：卡片选择与工程路径表单共用一个目标状态；
// - 性能（H05）：统计/封面按工程文件版本缓存、请求去重、搜索防抖、
//   响应只回写到当前 DOM 里同路径的节点（过期响应不写回新卡片）。
(function () {
  "use strict";

  var DEFAULT_LIMIT = 12;
  var SEARCH_DEBOUNCE_MS = 200;
  var SELECTED_KEY = "MSW_HOME_SELECTED_PATH";
  var state = {
    projects: [],
    visible: DEFAULT_LIMIT,
    selectedPath: "",
    query: "",
    statsCache: {},   // path -> { version, text }（version = modifiedAt）
    statsPending: {}, // path -> Promise
    covers: {},       // path -> { state, dataUri, version, message }
    coversPending: {},// path -> Promise
    mediaNames: {},   // path -> 媒体文件名（统计或封面载荷带回，避免重复读工程）
  };
  var searchTimer = 0;
  var coverObserver = null;
  // S1：右键菜单单一实例——目标、DOM、关闭监听与焦点归还都挂在 menu 上，
  // 每次打开替换整个实例，旧实例的监听不再残留到 document。
  var menu = { el: null, path: "", opener: null };

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

  // ---------------- 封面（H01） ----------------

  // 图标取自 Lucide（ISC License，https://lucide.dev），以 currentColor 内联使用。
  var COVER_ICONS = {
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    broken: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="M12 15.01v.01"/></svg>',
  };;
  var COVER_STATE_LABEL_KEYS = {
    audio: "cover_state_audio",
    no_media: "cover_state_no_media",
    media_missing: "cover_state_media_missing",
    project_broken: "cover_state_project_broken",
    project_missing: "recent_missing",
    failed: "cover_state_failed",
  };

  function coverStateFor(entry) {
    if (!entry.exists) return "project_missing";
    var cached = state.covers[entry.path];
    return cached ? cached.state : "loading";
  }

  function createCover(entry) {
    var cover = document.createElement("div");
    cover.className = "recent-cover";
    cover.dataset.path = entry.path;
    cover.setAttribute("aria-hidden", "true");
    applyCoverState(cover, entry, state.covers[entry.path]);
    return cover;
  }

  function applyCoverState(cover, entry, cached) {
    var status = cached ? cached.state : (entry.exists ? "loading" : "project_missing");
    cover.dataset.coverState = status;
    cover.replaceChildren();
    if (status === "image" && cached && cached.dataUri) {
      var img = document.createElement("img");
      img.className = "recent-cover-image";
      img.src = cached.dataUri;
      img.alt = "";
      img.decoding = "async";
      cover.append(img);
      return;
    }
    var icon = status === "audio" ? COVER_ICONS.audio
      : (status === "project_broken" ? COVER_ICONS.broken : COVER_ICONS.film);
    var holder = document.createElement("span");
    holder.className = "recent-cover-icon";
    holder.innerHTML = icon;
    cover.append(holder);
    var labelKey = COVER_STATE_LABEL_KEYS[status];
    if (labelKey) {
      var label = document.createElement("span");
      label.className = "recent-cover-state";
      label.textContent = cached && cached.message && status === "media_missing" ? cached.message : t(labelKey);
      cover.append(label);
    }
  }

  function coverNode(path) {
    return grid().querySelector('.recent-cover[data-path="' + cssEscape(path) + '"]');
  }

  function requestCover(entry) {
    if (!entry.exists) return;
    if (state.covers[entry.path] && state.covers[entry.path].state === "image") return;
    if (state.coversPending[entry.path]) return;
    // 失败短期缓存在后端；前端同样避免对同一路径的重复请求。
    var failedAt = state.covers[entry.path] && state.covers[entry.path].state !== "image"
      ? state.covers[entry.path].at || 0 : 0;
    if (failedAt && Date.now() - failedAt < 60000) return;
    var pending = bridge("get_recent_project_thumbnail", { path: entry.path }).then(function (result) {
      delete state.coversPending[entry.path];
      if (!result || result.ok !== true) return;
      state.covers[entry.path] = {
        state: result.state || "failed",
        dataUri: result.dataUri || "",
        version: result.version || "",
        mediaName: result.mediaName || "",
        message: result.message || "",
        at: Date.now(),
      };
      if (result.mediaName) state.mediaNames[entry.path] = result.mediaName;
      var node = coverNode(entry.path);
      if (node) applyCoverState(node, entry, state.covers[entry.path]);
      syncMediaName(entry);
    }).catch(function () {
      delete state.coversPending[entry.path];
    });
    state.coversPending[entry.path] = pending;
  }

  function syncMediaName(entry) {
    var name = state.mediaNames[entry.path];
    if (!name) return;
    var node = grid().querySelector('.recent-media[data-path="' + cssEscape(entry.path) + '"]');
    if (node && node.textContent !== name) node.textContent = name;
  }

  function refreshCover(entry) {
    // 卡片菜单「刷新封面」：绕过后端磁盘缓存重新提取。
    return bridge("refresh_recent_project_thumbnail", { path: entry.path }).then(function (result) {
      if (!result || result.ok !== true) return;
      state.covers[entry.path] = {
        state: result.state || "failed",
        dataUri: result.dataUri || "",
        version: result.version || "",
        message: result.message || "",
        at: Date.now(),
      };
      if (result.mediaName) state.mediaNames[entry.path] = result.mediaName;
      var node = coverNode(entry.path);
      if (node) applyCoverState(node, entry, state.covers[entry.path]);
      syncMediaName(entry);
    });
  }

  function observeCovers(shown) {
    if (!("IntersectionObserver" in window)) {
      // 无观察器环境（老 WebView）直接顺序加载，功能不缺失。
      shown.forEach(function (entry) { requestCover(entry); });
      return;
    }
    if (!coverObserver) {
      coverObserver = new IntersectionObserver(function (records) {
        records.forEach(function (record) {
          if (!record.isIntersecting) return;
          coverObserver.unobserve(record.target);
          var path = record.target.dataset.path || "";
          var entry = state.projects.find(function (item) { return item.path === path; });
          if (entry) requestCover(entry);
        });
      }, { rootMargin: "200px 0px" });
    } else {
      coverObserver.disconnect();
    }
    shown.forEach(function (entry) {
      if (!entry.exists) return;
      var node = coverNode(entry.path);
      if (node) coverObserver.observe(node);
    });
  }

  // ---------------- 卡片 ----------------

  function createCard(entry) {
    var card = document.createElement("div");
    // H02：创建卡片时从唯一选中状态同时恢复样式与无障碍属性。
    var isSelected = Boolean(state.selectedPath) && entry.path === state.selectedPath;
    card.className = "recent-card"
      + (entry.pinned ? " pinned" : "")
      + (isSelected ? " selected" : "");
    card.dataset.path = entry.path;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", String(isSelected));
    if (!entry.exists) card.classList.add("missing");

    var cover = createCover(entry);

    var info = document.createElement("div");
    info.className = "recent-info";
    var name = document.createElement("div");
    name.className = "recent-name";
    name.textContent = entry.name;
    name.title = entry.path;
    var media = document.createElement("div");
    media.className = "recent-media";
    media.dataset.path = entry.path;
    if (state.mediaNames[entry.path]) media.textContent = state.mediaNames[entry.path];
    else media.textContent = entry.exists ? t("recent_media_loading") : "";
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
      stats.textContent = statsTextFor(entry);
      meta.append(stats);
    } else {
      var missing = document.createElement("span");
      missing.className = "missing";
      missing.textContent = t("recent_missing");
      meta.append(missing);
    }
    info.append(name, media, dir, meta);
    if (entry.pinned) {
      var pin = document.createElement("span");
      pin.className = "recent-pin";
      pin.title = t("recent_pinned");
      pin.setAttribute("aria-label", t("recent_pinned"));
      // 图钉取自 Lucide（ISC License，https://lucide.dev），以 currentColor 内联使用。
      pin.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      info.append(pin);
    }
    card.append(cover, info);
    return card;
  }

  function render() {
    var gridNode = el("recentGrid");
    var empty = el("recentEmpty");
    var more = el("recentMore");
    var count = el("recentCount");
    gridNode.replaceChildren();
    // 网格重建后卡片节点已换代：菜单随之关闭，避免悬浮菜单指向已换位的列表。
    closeMenu({});
    // H03：筛选隐藏当前目标时清除选择，避免隐藏工程仍是启动目标。
    if (state.selectedPath && !visibleProjects().some(function (item) { return item.path === state.selectedPath; })) {
      clearSelection({ clearTarget: true });
    }
    var list = visibleProjects();
    var shown = list.slice(0, state.visible);
    shown.forEach(function (entry) { gridNode.append(createCard(entry)); });
    empty.classList.toggle("hidden", list.length > 0);
    more.classList.toggle("hidden", list.length <= state.visible);
    count.textContent = list.length ? t("recent_count").replace("{n}", String(list.length)) : "";
    renderLaunchArea();
    // 统计与封面按需拉取：卡片先显示占位，不伪造数字或画面。
    shown.filter(function (entry) { return entry.exists; }).forEach(requestStats);
    observeCovers(shown);
  }

  function statsTextFor(entry) {
    var cached = state.statsCache[entry.path];
    if (cached && cached.version === (entry.modifiedAt || "")) return cached.text;
    return t("recent_stats_loading");
  }

  function requestStats(entry) {
    var version = entry.modifiedAt || "";
    var cached = state.statsCache[entry.path];
    if (cached && cached.version === version && cached.text) return;
    if (state.statsPending[entry.path]) return;
    var pending = bridge("get_recent_project_stats", { path: entry.path }).then(function (result) {
      delete state.statsPending[entry.path];
      var text = "";
      if (result && result.ok === true && !result.skipped) {
        text = t("recent_stats_summary")
          .replace("{main}", String(result.mainSubtitles ?? 0))
          .replace("{sub}", String(result.subSubtitles ?? 0))
          .replace("{audio}", String(result.audioClips ?? 0));
      }
      if (result && result.mediaName) {
        state.mediaNames[entry.path] = result.mediaName;
        syncMediaName(entry);
      }
      // H05：按工程文件版本缓存；版本变化（工程被保存过）后自然失效。
      state.statsCache[entry.path] = { version: version, text: text };
      var node = grid().querySelector('.recent-stats[data-path="' + cssEscape(entry.path) + '"]');
      if (node) node.textContent = text;
    }).catch(function () {
      delete state.statsPending[entry.path];
    });
    state.statsPending[entry.path] = pending;
  }

  function grid() { return el("recentGrid"); }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  // ---------------- 目标状态与启动区（H03/H04） ----------------

  function selectedEntry() {
    if (!state.selectedPath) return null;
    return state.projects.find(function (item) { return item.path === state.selectedPath; }) || null;
  }

  function browsedTargetPath() {
    var json = el("jsonPath");
    return json ? json.value.trim() : "";
  }

  function basenameOf(value) {
    var parts = String(value).split(/[\\/]/);
    return parts[parts.length - 1] || value;
  }

  function renderLaunchArea() {
    var openSelected = el("homeOpenSelected");
    var chip = el("homeTarget");
    var entry = selectedEntry();
    var raw = browsedTargetPath();
    var label = entry ? entry.name : (raw ? basenameOf(raw) : "");
    if (openSelected) openSelected.classList.toggle("hidden", !label);
    if (chip) {
      chip.classList.toggle("hidden", !label);
      chip.textContent = label ? t("home_target").replace("{name}", label) : "";
    }
  }

  function persistSelection() {
    try {
      if (state.selectedPath) sessionStorage.setItem(SELECTED_KEY, state.selectedPath);
      else sessionStorage.removeItem(SELECTED_KEY);
    } catch (error) { /* 隐私模式下不可用；仅影响刷新后恢复 */ }
  }

  function restoreSelection() {
    var saved = "";
    try { saved = sessionStorage.getItem(SELECTED_KEY) || ""; } catch (error) { saved = ""; }
    if (saved && state.projects.some(function (item) { return item.path === saved && item.exists; })) {
      state.selectedPath = saved;
    } else if (saved) {
      state.selectedPath = "";
      persistSelection();
    }
  }

  function updateCardStates() {
    grid().querySelectorAll(".recent-card").forEach(function (card) {
      var selected = Boolean(state.selectedPath) && card.dataset.path === state.selectedPath;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    renderLaunchArea();
  }

  function setSelected(path) {
    state.selectedPath = state.selectedPath === path ? "" : path;
    persistSelection();
    // H04：卡片选择与工程路径共用一个目标状态；取消选择即清空目标。
    if (window.MSWLauncher && window.MSWLauncher.setJsonPath) {
      window.MSWLauncher.setJsonPath(state.selectedPath);
    }
    updateCardStates();
  }

  function clearSelection(options) {
    var clearTarget = !options || options.clearTarget !== false;
    if (!state.selectedPath && !(clearTarget && browsedTargetPath())) {
      renderLaunchArea();
      return;
    }
    state.selectedPath = "";
    persistSelection();
    if (clearTarget && browsedTargetPath() && window.MSWLauncher && window.MSWLauncher.setJsonPath) {
      // 目标被筛选隐藏：连表单里的目标一并清空，避免隐藏工程仍是启动目标（H03）。
      window.MSWLauncher.setJsonPath("");
    }
    updateCardStates();
  }

  function syncTargetFromPath(path) {
    // 工程路径来自浏览/表单/编辑器事件：与卡片选择互通（H04）。
    var raw = String(path || "").trim();
    var match = raw && state.projects.find(function (item) { return item.path === raw; });
    if (match) {
      if (match.exists && state.selectedPath !== match.path) {
        state.selectedPath = match.path;
        persistSelection();
        updateCardStates();
      }
    } else if (!raw) {
      clearSelection({ clearTarget: false });
    } else {
      // 指向最近列表之外的工程：保留为浏览目标，卡片不伪造选中。
      clearSelection({ clearTarget: false });
    }
  }

  function openProject(path) {
    var entry = state.projects.find(function (item) { return item.path === path; });
    if (entry && !entry.exists) {
      relocateFlow(entry);
      return;
    }
    if (window.MSWLauncher && window.MSWLauncher.setJsonPath) {
      window.MSWLauncher.setJsonPath(path);
      window.MSWNavigation.show("home");
      void window.MSWLauncher.openServerEditor();
    }
  }

  function openCurrentTarget() {
    var entry = selectedEntry();
    if (entry) {
      openProject(entry.path);
      return;
    }
    var json = el("jsonPath");
    var raw = json ? json.value.trim() : "";
    if (raw) void window.MSWLauncher.openServerEditor();
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
        persistSelection();
      }
      if (!state.selectedPath) restoreSelection();
      render();
    });
  }

  // ---------------- 交互 ----------------

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
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        var menuCard = event.target.closest(".recent-card");
        if (!menuCard || !node.contains(menuCard)) return;
        event.preventDefault();
        openMenu(menuCard, event, { keyboard: true });
        return;
      }
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

  // ---------------- 右键菜单（S1：监听常驻一次，按实例判定） ----------------

  function menuItems() {
    return menu.el ? Array.from(menu.el.querySelectorAll('button[role="menuitem"]')) : [];
  }

  function closeMenu(options) {
    options = options || {};
    var node = menu.el;
    if (!node) return;
    menu.el = null;
    menu.path = "";
    var opener = menu.opener;
    menu.opener = null;
    node.remove();
    if (options.restoreFocus && opener && document.contains(opener)) opener.focus();
  }

  function handleMenuKey(event) {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restoreFocus: event.key === "Escape" });
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    var items = menuItems();
    if (!items.length) return;
    var index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") index = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === "ArrowUp") index = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === "Home") index = 0;
    else index = items.length - 1;
    items[index].focus();
  }

  function initMenuLifecycle() {
    // 捕获阶段先于网格的 contextmenu 处理：旧菜单先关，随后网格处理器按新目标
    // 重开（替换语义）；右键落在菜单自身上时只关闭不重开（与系统菜单一致），
    // 替换语义不依赖定时器延迟注册（旧实现泄漏的 once 监听会误关新菜单）。
    document.addEventListener("contextmenu", function (event) {
      if (!menu.el) return;
      closeMenu({});
    }, true);
    document.addEventListener("click", function (event) {
      if (!menu.el || menu.el.contains(event.target)) return;
      closeMenu({});
    }, true);
    document.addEventListener("keydown", function (event) {
      if (!menu.el) return;
      handleMenuKey(event);
    }, true);
    window.addEventListener("blur", function () { closeMenu({}); });
    window.addEventListener("scroll", function () { closeMenu({}); }, true);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) closeMenu({});
    });
    document.addEventListener("mswnavigation", function () { closeMenu({}); });
  }

  function openMenu(card, event, options) {
    options = options || {};
    closeMenu({});
    var entry = state.projects.find(function (item) { return item.path === card.dataset.path; });
    if (!entry) return;
    menu.path = entry.path;
    menu.opener = card;
    var menuEl = document.createElement("div");
    menuEl.id = "recentContextMenu";
    menuEl.className = "recent-context-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.setAttribute("aria-label", entry.name);
    var actions = [];
    actions.push({ key: "recent_open_project", run: function () { openProject(entry.path); } });
    actions.push({ key: entry.pinned ? "recent_unpin" : "recent_pin", run: function () {
      void bridge("set_recent_project_pinned", { path: entry.path, pinned: !entry.pinned }).then(refresh);
    } });
    actions.push({ key: "recent_open_folder", run: function () {
      void bridge("open_containing_folder", { path: entry.path });
    } });
    if (entry.exists) {
      actions.push({ key: "recent_refresh_cover", run: function () { void refreshCover(entry); } });
    }
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
      button.addEventListener("click", function () { closeMenu({}); action.run(); });
      menuEl.append(button);
    });
    document.body.append(menuEl);
    menu.el = menuEl;
    positionMenu(menuEl, card, event, options.keyboard);
    // 鼠标唤起不抢焦点（Esc 由 document 捕获监听兜底）；键盘唤起聚焦首项。
    if (options.keyboard) {
      var first = menuEl.querySelector('button[role="menuitem"]');
      if (first) first.focus();
    }
  }

  function positionMenu(menuEl, card, event, keyboard) {
    var margin = 8;
    var left;
    var top;
    if (keyboard || !event || (!event.clientX && !event.clientY)) {
      var box = card.getBoundingClientRect();
      left = box.left;
      top = box.bottom + 4;
    } else {
      left = event.clientX;
      top = event.clientY;
    }
    // 视口内收敛：兼容应用缩放与系统缩放（clientX/Y 与 innerWidth 同为 CSS 像素）。
    left = Math.min(Math.max(margin, left), window.innerWidth - menuEl.offsetWidth - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - menuEl.offsetHeight - margin);
    menuEl.style.left = left + "px";
    menuEl.style.top = top + "px";
  }

  function bindToolbar() {
    var search = el("recentSearch");
    search.addEventListener("input", function () {
      // H05：搜索防抖——连续输入不重复重建列表与统计请求。
      window.clearTimeout(searchTimer);
      var value = search.value.trim().toLowerCase();
      searchTimer = window.setTimeout(function () {
        state.query = value;
        state.visible = DEFAULT_LIMIT;
        render();
      }, SEARCH_DEBOUNCE_MS);
    });
    el("recentMore").addEventListener("click", function () {
      state.visible += DEFAULT_LIMIT;
      render();
    });
    el("homeBlank").addEventListener("click", function () {
      void window.MSWLauncher.startBlankEditor();
    });
    var browse = el("homeBrowse");
    if (browse) {
      browse.addEventListener("click", async function () {
        var result = await bridge("choose_file", { kind: "json" });
        if (result && result.ok) window.MSWLauncher.setJsonPath(result.path);
      });
    }
    var openSelected = el("homeOpenSelected");
    if (openSelected) {
      openSelected.addEventListener("click", openCurrentTarget);
    }
  }

  function init() {
    bindToolbar();
    bindCardEvents();
    initMenuLifecycle();
    // H04：工程路径变化（浏览/表单/编辑器事件）与卡片选择互通。
    var previous = window.MSWLauncher.onProjectPathChanged;
    window.MSWLauncher.onProjectPathChanged = function () {
      try { if (typeof previous === "function") previous.call(window.MSWLauncher); } catch (error) { /* 前一个钩子失败不阻断 */ }
      var json = el("jsonPath");
      syncTargetFromPath(json ? json.value : "");
    };
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
    syncTargetFromPath: syncTargetFromPath,
    requestCover: requestCover,
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
