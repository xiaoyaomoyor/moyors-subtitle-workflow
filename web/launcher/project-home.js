// MSW Launcher · 首页最近工程 + 全部工程（C/R3 修正案；S3 二轮修正重做分组层）
// 最近工程来自后端合并视图（编辑器 recent_projects + 启动器固定/移除/重定位元数据）；
// 全部工程来自长期登记层（launcher-project-registry，制作/打开/保存成功即登记）。
// 单击选择、双击直接打开、Enter 执行当前主按钮；首次进入默认无选择——
// 「启动空白编辑器」始终可用，不因自动选中最近工程而失去意义。
//
// R3 要点（保留）：
// - 封面（H01）：16:9 卡片图，按可见区域异步加载；状态含 图片/纯音频/无媒体/
//   媒体缺失/工程缺失/工程损坏/提取失败，失败不阻止打开工程；
// - 选中（H02）：卡片创建时从唯一选中状态恢复样式与 aria-pressed，
//   选择随 sessionStorage 在刷新后恢复；
// - 搜索（H03）：筛选隐藏当前目标时清除选择，启动区显示当前将打开的目标；
// - 目标（H04）：卡片选择与工程路径表单共用一个目标状态；
// - 性能（H05）：统计/封面按工程文件版本缓存、请求去重、搜索防抖、
//   响应只回写到当前 DOM 里同路径的节点（过期响应不写回新卡片）。
//
// S3 要点（§5.1/§5.3）：
// - 首页两个独立折叠分组：最近工程（约 6 条起步）/ 全部工程（长期登记，分页）；
//   折叠状态记忆；搜索作用于两组并显示各自命中数；
// - 同一工程可在两组出现：选择/图钉/封面/统计按路径同步（多节点回写）；
// - 图钉移至封面固定角落（选中描边与图钉互不兼任）；
// - 右键菜单按分组区分「从最近记录移除」「从全部工程记录移除」「删除工程文件…」
//   （后者经确认对话框移入回收站，仅工程文件本身）。
(function () {
  "use strict";

  var DEFAULT_LIMIT = 6;
  var ALL_PAGE = 12;
  var SEARCH_DEBOUNCE_MS = 200;
  var SELECTED_KEY = "MSW_HOME_SELECTED_PATH";
  var GROUPS_KEY = "MSW_HOME_GROUPS_V1";
  var state = {
    projects: [],
    allProjects: [],
    allTotal: 0,
    allMatched: 0,
    allPages: 1,
    allPage: 1,
    allPageSize: ALL_PAGE,
    allMediaIndexed: 0,
    allRequest: 0, // T2/§5.2：请求序号——慢响应不回退页面
    visible: DEFAULT_LIMIT,
    selectedPath: "",
    query: "",
    groupsCollapsed: { recent: false, all: false },
    statsCache: {},   // path -> { version, text }（version = modifiedAt）
    statsPending: {}, // path -> Promise
    covers: {},       // path -> { state, dataUri, version, message, sourceVersion }
    coversPending: {},// path -> Promise
    coversGeneration: {}, // T1/A5：按路径的请求代次——同路径换代后旧响应不回写（不同路径互不影响）
    coversIdentity: {},  // path -> 抓取时的 path@modifiedAt 身份
    mediaNames: {},   // path -> 媒体文件名（统计或封面载荷带回，避免重复读工程）
    openingPath: "",  // 调整5：双击打开中的工程路径——对应卡片持续转圈直到打开流程结束
  };
  var searchTimer = 0;
  var coverObserver = null;

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
    if (entry.name.toLowerCase().includes(needle)) return true;
    if (entry.dir.toLowerCase().includes(needle)) return true;
    if (entry.path.toLowerCase().includes(needle)) return true;
    // 搜索同时匹配媒体文件名（§5.1）：媒体名在统计/封面返回前可能未知。
    var media = state.mediaNames[entry.path] || "";
    return Boolean(media) && media.toLowerCase().includes(needle);
  }

  function visibleProjects() {
    return state.projects.filter(matchesQuery);
  }

  function visibleAllProjects() {
    return state.allProjects.filter(matchesQuery);
  }

  function entryByPath(path) {
    return state.projects.find(function (item) { return item.path === path; })
      || state.allProjects.find(function (item) { return item.path === path; })
      || null;
  }

  // ---------------- 封面（H01；S3：图钉入封面固定角落） ----------------

  // 图标取自 Lucide（ISC License，https://lucide.dev），以 currentColor 内联使用。
  var COVER_ICONS = {
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    broken: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="M12 15.01v.01"/></svg>',
  };
  // 图钉取自 Lucide（ISC License，https://lucide.dev），以 currentColor 内联使用。
  // T1/U1：描边定义在 SVG 根，两条路径（含针杆 M12 17v5）统一继承。
  var PIN_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1Z"/></svg>';
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

  function makePin() {
    var pin = document.createElement("span");
    pin.className = "recent-pin";
    pin.title = t("recent_pinned");
    pin.setAttribute("aria-label", t("recent_pinned"));
    pin.innerHTML = PIN_ICON;
    return pin;
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
      // T1/A5：data URI 解码失败回退失败占位，不残留空白。
      img.addEventListener("error", function () {
        state.covers[entry.path] = { state: "failed", dataUri: "", version: "", message: "", at: Date.now(), sourceVersion: cached.sourceVersion || "" };
        coverNodes(entry.path).forEach(function (node) { applyCoverState(node, entry, state.covers[entry.path]); });
      });
      cover.append(img);
    } else {
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
    // S3/§5.1：图钉放封面固定角落；选中描边（卡片类）与图钉互不兼任。
    if (entry.pinned) cover.append(makePin());
  }

  function coverNodes(path) {
    // S3：同一工程可能在两组各有一张卡——回写所有同路径封面节点。
    var selector = '.recent-cover[data-path="' + cssEscape(path) + '"]';
    var nodes = [];
    bothGrids().forEach(function (gridNode) {
      gridNode.querySelectorAll(selector).forEach(function (node) { nodes.push(node); });
    });
    return nodes;
  }

  // T1/A4：封面缓存按「工程文件版本」失效——modifiedAt 变化（工程保存、
  // 换媒体、重新定位）后不再复用旧图；缓存记录抓取时的版本号用于比对。
  function coverCacheValid(cached, entry) {
    return Boolean(cached) && cached.state === "image"
      && cached.sourceVersion === (entry.modifiedAt || "")
      && (cached.version || "") !== "";
  }

  function requestCover(entry) {
    if (!entry.exists) return;
    if (coverCacheValid(state.covers[entry.path], entry)) return;
    if (state.coversPending[entry.path]) return;
    // 失败短期缓存在后端；前端同样避免对同一路径的重复请求（失败/加载中态 60s 内不重试）。
    var failedAt = state.covers[entry.path] && state.covers[entry.path].state !== "image"
      ? state.covers[entry.path].at || 0 : 0;
    if (failedAt && Date.now() - failedAt < 60000) return;
    // T1/A5：请求带代次与身份；旧响应（工程已被替换/刷新换代）不回写新卡片。
    var generation = (state.coversGeneration[entry.path] || 0) + 1;
    state.coversGeneration[entry.path] = generation;
    var identity = entry.path + "@" + (entry.modifiedAt || "");
    var pending = bridge("get_recent_project_thumbnail", { path: entry.path }).then(function (result) {
      delete state.coversPending[entry.path];
      if (generation !== state.coversGeneration[entry.path]) return;
      // T1/A5：桥接失败/异常载荷 → 明确失败态（可重试），不再永久停在 loading。
      if (!result || result.ok !== true) {
        state.covers[entry.path] = { state: "failed", dataUri: "", version: "", message: "", at: Date.now(), sourceVersion: entry.modifiedAt || "" };
        coverNodes(entry.path).forEach(function (node) { applyCoverState(node, entry, state.covers[entry.path]); });
        return;
      }
      state.covers[entry.path] = {
        state: result.state || "failed",
        dataUri: result.dataUri || "",
        version: result.version || "",
        mediaName: result.mediaName || "",
        message: result.message || "",
        at: Date.now(),
        sourceVersion: entry.modifiedAt || "",
      };
      state.coversIdentity[entry.path] = identity;
      if (result.mediaName) state.mediaNames[entry.path] = result.mediaName;
      coverNodes(entry.path).forEach(function (node) { applyCoverState(node, entry, state.covers[entry.path]); });
      syncMediaName(entry.path);
    }).catch(function () {
      delete state.coversPending[entry.path];
      if (generation !== state.coversGeneration[entry.path]) return;
      state.covers[entry.path] = { state: "failed", dataUri: "", version: "", message: "", at: Date.now(), sourceVersion: entry.modifiedAt || "" };
      coverNodes(entry.path).forEach(function (node) { applyCoverState(node, entry, state.covers[entry.path]); });
    });
    state.coversPending[entry.path] = pending;
  }

  function syncMediaName(path) {
    var name = state.mediaNames[path];
    if (!name) return;
    var selector = '.recent-media[data-path="' + cssEscape(path) + '"]';
    bothGrids().forEach(function (gridNode) {
      gridNode.querySelectorAll(selector).forEach(function (node) {
        if (node.textContent !== name) node.textContent = name;
      });
    });
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
        sourceVersion: entry.modifiedAt || "",
      };
      if (result.mediaName) state.mediaNames[entry.path] = result.mediaName;
      coverNodes(entry.path).forEach(function (node) { applyCoverState(node, entry, state.covers[entry.path]); });
      syncMediaName(entry.path);
    });
  }

  function observeCovers(entries) {
    if (!("IntersectionObserver" in window)) {
      // 无观察器环境（老 WebView）直接顺序加载，功能不缺失。
      entries.forEach(function (entry) { requestCover(entry); });
      return;
    }
    if (!coverObserver) {
      coverObserver = new IntersectionObserver(function (records) {
        records.forEach(function (record) {
          if (!record.isIntersecting) return;
          coverObserver.unobserve(record.target);
          var path = record.target.dataset.path || "";
          var entry = entryByPath(path);
          if (entry) requestCover(entry);
        });
      }, { rootMargin: "200px 0px" });
    } else {
      coverObserver.disconnect();
    }
    entries.forEach(function (entry) {
      if (!entry.exists) return;
      coverNodes(entry.path).forEach(function (node) {
        // T1/§6.1：折叠分组不主动解码——隐藏 body 里的节点跳过观察。
        if (node.closest(".home-group-body")?.classList.contains("hidden")) return;
        coverObserver.observe(node);
      });
    });
  }

  // ---------------- 卡片 ----------------

  function createCard(entry) {
    var card = document.createElement("div");
    // H02：创建卡片时从唯一选中状态同时恢复样式与无障碍属性。
    var isSelected = Boolean(state.selectedPath) && entry.path === state.selectedPath;
    // 调整5：正在打开的工程卡片保留加载反馈（渲染换代后转圈不中断）。
    var isOpening = Boolean(state.openingPath) && entry.path === state.openingPath;
    card.className = "recent-card"
      + (entry.pinned ? " pinned" : "")
      + (isSelected ? " selected" : "")
      + (isOpening ? " opening" : "");
    card.dataset.path = entry.path;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", String(isSelected));
    if (isOpening) card.setAttribute("aria-busy", "true");
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
    card.append(cover, info);
    return card;
  }

  function render() {
    // 网格重建后卡片节点已换代：菜单随之关闭，避免悬浮菜单指向已换位的列表。
    closeMenu({});
    renderRecentGroup();
    renderAllGroup();
    // T1/U2：两组分别渲染后统一收集可见卡并集，一次更新封面观察——
    // 最近组不再依赖全部组的观察顺带加载（全部空/仅失效时最近封面仍能显示）。
    observeCovers(visibleProjects().slice(0, state.visible)
      .concat(state.allProjects));
    renderLaunchArea();
  }

  function renderRecentGroup() {
    var gridNode = el("recentGrid");
    var empty = el("recentEmpty");
    var more = el("recentMore");
    var count = el("recentCount");
    gridNode.replaceChildren();
    // H03+T2/§5.2：筛选隐藏当前目标时清除选择——翻页不清（所选可在其他页），
    // 仅搜索（query 非空）后所选既不在最近可见也不在当前页时，再经服务端
    // 单路径查询确认彻底排除才清除。
    if (state.selectedPath && state.query && !visibleProjects().some(function (item) { return item.path === state.selectedPath; })
      && !state.allProjects.some(function (item) { return item.path === state.selectedPath; })) {
      var keepPath = state.selectedPath;
      var keepQuery = state.query;
      var request = ++state.allRequest;
      // 按用户的查询词取满一页（120=服务端页长上限）做成员判定；
      // 命中超上限的极端场景保留选择（宁可不误清）。
      bridge("get_all_projects", { query: keepQuery, page: 1, pageSize: 120 }).then(function (result) {
        if (request !== state.allRequest) return;
        var stillThere = (result && result.ok && (result.projects || []).some(function (item) { return item.path === keepPath; }));
        if (!stillThere && state.selectedPath === keepPath && state.query === keepQuery) clearSelection({ clearTarget: true });
      });
    }
    var list = visibleProjects();
    var shown = list.slice(0, state.visible);
    shown.forEach(function (entry) { gridNode.append(createCard(entry)); });
    empty.classList.toggle("hidden", list.length > 0);
    more.classList.toggle("hidden", list.length <= state.visible);
    count.textContent = list.length ? t("recent_count").replace("{n}", String(list.length)) : "";
    // 统计与封面按需拉取：卡片先显示占位，不伪造数字或画面。
    shown.filter(function (entry) { return entry.exists; }).forEach(requestStats);
    applyGroupCollapsed("recent");
    renderGroupHeaders();
  }

  function renderAllGroup() {
    var gridNode = el("allGrid");
    var empty = el("allEmpty");
    var pager = el("allPager");
    var count = el("allCount");
    gridNode.replaceChildren();
    // T2/U4：全部组内容 = 服务端当前页（DOM 只保留当前页，不累积）。
    var shown = state.allProjects;
    shown.forEach(function (entry) { gridNode.append(createCard(entry)); });
    empty.classList.toggle("hidden", shown.length > 0);
    // §5.1：计数区分工程总数与当前结果数（服务端 matched/total）。
    count.textContent = state.query
      ? t("all_count_matched").replace("{matched}", String(state.allMatched)).replace("{total}", String(state.allTotal))
      : t("all_count").replace("{n}", String(state.allTotal));
    renderAllPager(pager);
    shown.filter(function (entry) { return entry.exists; }).forEach(requestStats);
    applyGroupCollapsed("all");
    renderGroupHeaders();
  }

  // T2/U4：页码控件——上一页/紧凑页码（省略号）/下一页 + 第 X/Y 页；0 条隐藏。
  function renderAllPager(pager) {
    if (!pager) return;
    pager.replaceChildren();
    if (state.allTotal === 0) return;
    var current = state.allPage;
    var pages = state.allPages;
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "ghost small";
    prev.textContent = t("pager_prev");
    prev.disabled = current <= 1;
    prev.addEventListener("click", function () { goToAllPage(current - 1); });
    var next = document.createElement("button");
    next.type = "button";
    next.className = "ghost small";
    next.textContent = t("pager_next");
    next.disabled = current >= pages;
    next.addEventListener("click", function () { goToAllPage(current + 1); });
    pager.append(prev);
    compactPageList(current, pages).forEach(function (item) {
      if (item === "…") {
        var dots = document.createElement("span");
        dots.className = "pager-ellipsis";
        dots.textContent = "…";
        pager.append(dots);
        return;
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost small pager-page" + (item === current ? " active" : "");
      btn.textContent = String(item);
      if (item === current) btn.setAttribute("aria-current", "page");
      btn.addEventListener("click", function () { goToAllPage(item); });
      pager.append(btn);
    });
    pager.append(next);
    var info = document.createElement("span");
    info.className = "pager-info hint";
    info.textContent = t("pager_info").replace("{page}", String(current)).replace("{pages}", String(pages)).replace("{n}", String(state.allMatched));
    pager.append(info);
  }

  // 紧凑页码：始终含 1 与末页；当前页两侧各 1；其余折叠为省略号。
  function compactPageList(current, pages) {
    if (pages <= 7) {
      var all = [];
      for (var i = 1; i <= pages; i += 1) all.push(i);
      return all;
    }
    var keep = new Set([1, pages, current - 1, current, current + 1]);
    var out = [];
    for (var j = 1; j <= pages; j += 1) {
      if (keep.has(j)) {
        if (out.length && j - out[out.length - 1] > 1) out.push("…");
        out.push(j);
      }
    }
    if (out.length && out[0] !== 1) out.unshift("…");
    return out;
  }

  function renderGroupHeaders() {
    [["recent", "recentGroupTitle", visibleProjects().length],
     ["all", "allGroupTitle", visibleAllProjects().length]].forEach(function (item) {
      var node = el(item[1]);
      if (node) {
        var label = node.querySelector(".home-group-label");
        if (label) label.textContent = t(item[0] === "recent" ? "recent_group_title" : "all_group_title")
          + "（" + item[2] + "）";
        node.setAttribute("aria-expanded", String(!state.groupsCollapsed[item[0]]));
      }
    });
  }

  function applyGroupCollapsed(group) {
    var body = el(group === "recent" ? "recentGroupBody" : "allGroupBody");
    var footer = el(group === "recent" ? "recentGroupTarget" : "allGroupTarget");
    if (!body) return;
    var collapsed = Boolean(state.groupsCollapsed[group]);
    body.classList.toggle("hidden", collapsed);
    if (footer) {
      // §5.1：折叠分组保留当前选择，底部显示将打开的工程名。
      var entry = selectedEntry();
      footer.textContent = collapsed && entry ? t("home_target").replace("{name}", entry.name) : "";
      footer.classList.toggle("hidden", !collapsed || !entry);
    }
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
        syncMediaName(entry.path);
      }
      // H05：按工程文件版本缓存；版本变化（工程被保存过）后自然失效。
      state.statsCache[entry.path] = { version: version, text: text };
      var selector = '.recent-stats[data-path="' + cssEscape(entry.path) + '"]';
      bothGrids().forEach(function (gridNode) {
        gridNode.querySelectorAll(selector).forEach(function (node) { node.textContent = text; });
      });
    }).catch(function () {
      delete state.statsPending[entry.path];
    });
    state.statsPending[entry.path] = pending;
  }

  function bothGrids() {
    var grids = [];
    var recent = el("recentGrid");
    var all = el("allGrid");
    if (recent) grids.push(recent);
    if (all) grids.push(all);
    return grids;
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  // ---------------- 目标状态与启动区（H03/H04） ----------------

  function selectedEntry() {
    if (!state.selectedPath) return null;
    return entryByPath(state.selectedPath);
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
    var entry = saved ? entryByPath(saved) : null;
    if (entry && entry.exists) {
      state.selectedPath = saved;
    } else if (saved) {
      state.selectedPath = "";
      persistSelection();
    }
  }

  function updateCardStates() {
    bothGrids().forEach(function (gridNode) {
      gridNode.querySelectorAll(".recent-card").forEach(function (card) {
        var selected = Boolean(state.selectedPath) && card.dataset.path === state.selectedPath;
        card.classList.toggle("selected", selected);
        card.setAttribute("aria-pressed", String(selected));
      });
    });
    renderLaunchArea();
    applyGroupCollapsed("recent");
    applyGroupCollapsed("all");
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
    var match = raw ? entryByPath(raw) : null;
    if (match) {
      if (match.exists && state.selectedPath !== match.path) {
        state.selectedPath = match.path;
        persistSelection();
        updateCardStates();
      }
    } else {
      // 指向两组之外的工程：保留为浏览目标，卡片不伪造选中。
      clearSelection({ clearTarget: false });
    }
  }

  function openProject(path) {
    var entry = entryByPath(path);
    if (entry && !entry.exists) {
      relocateFlow(entry);
      return;
    }
    if (window.MSWLauncher && window.MSWLauncher.setJsonPath) {
      // 调整5：打开流程启动即在该工程两组卡片上显示加载反馈；流程结束（成功
      // 或失败）后统一解除——期间的重渲染凭 state.openingPath 延续转圈状态。
      state.openingPath = path;
      markOpeningCards(path);
      window.MSWLauncher.setJsonPath(path);
      window.MSWNavigation.show("home");
      Promise.resolve(window.MSWLauncher.openServerEditor())
        .catch(function () {})
        .then(function () {
          if (state.openingPath !== path) return;
          state.openingPath = "";
          markOpeningCards("");
        });
    }
  }

  // 调整5：不重建网格，直接同步现有卡片的开合状态（即时反馈、封面不闪换）。
  function markOpeningCards(path) {
    bothGrids().forEach(function (grid) {
      grid.querySelectorAll(".recent-card").forEach(function (card) {
        var opening = Boolean(path) && card.dataset.path === path;
        card.classList.toggle("opening", opening);
        if (opening) card.setAttribute("aria-busy", "true");
        else card.removeAttribute("aria-busy");
      });
    });
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
          notice(t("recent_relocate_failed") + (result ? window.MSWLauncher.errorText(result.code || "", result.detail || result.error || "") : ""));
        }
      });
    });
  }

  function notice(message) {
    var node = el("homeNotice");
    if (!node) return;
    node.textContent = String(message || "");
    node.classList.toggle("hidden", !message);
  }

  // S3/§5.3：删除工程文件——确认对话框展示工程名、实际路径与删除范围。
  function deleteProjectFlow(entry) {
    var message = t("delete_project_confirm")
      .replace("{name}", entry.name)
      .replace("{path}", entry.path);
    void window.MSWLauncher.confirm(message).then(function (yes) {
      if (!yes) return;
      void bridge("delete_project_file", { path: entry.path }).then(function (result) {
        if (result && result.ok) {
          notice(t("delete_project_done").replace("{name}", entry.name));
          refresh();
          return;
        }
        var detail = result && (result.detail || result.error) ? (result.detail || result.error) : "";
        notice(t("delete_project_failed").replace("{detail}", detail || t("failed_key_missing")));
      });
    });
  }

  // ---------------- 刷新 ----------------

  function refresh() {
    var recentReady = bridge("get_recent_projects").then(function (result) {
      if (!result || result.ok !== true) return;
      state.projects = Array.isArray(result.projects) ? result.projects : [];
      if (state.selectedPath && !entryByPath(state.selectedPath)) {
        state.selectedPath = "";
        persistSelection();
      }
    });
    var allReady = fetchAllPage();
    return Promise.all([recentReady, allReady]).then(function () {
      if (!state.selectedPath) restoreSelection();
      render();
    });
  }

  // T2/§5.3：全部组按「查询+页码」向服务端取当前页；请求带序号，
  // 慢响应（旧序号）不得覆盖新查询或把页面回退。
  function fetchAllPage() {
    var request = ++state.allRequest;
    return bridge("get_all_projects", { query: state.query, page: state.allPage, pageSize: state.allPageSize }).then(function (result) {
      if (request !== state.allRequest) return;
      if (!result || result.ok !== true) return;
      state.allProjects = Array.isArray(result.projects) ? result.projects : [];
      state.allTotal = Number(result.total || 0) || 0;
      state.allMatched = Number(result.matched || state.allProjects.length) || 0;
      state.allPages = Math.max(1, Number(result.pages || 1) || 1);
      state.allPage = Math.min(Math.max(1, Number(result.page || 1) || 1), state.allPages);
      state.allMediaIndexed = Number(result.mediaIndexed || 0) || 0;
    });
  }

  function goToAllPage(page) {
    var target = Math.min(Math.max(1, page), state.allPages);
    if (target === state.allPage) return;
    state.allPage = target;
    void fetchAllPage().then(renderAllGroup);
    // §5.1：翻页只替换本页，不把用户带回整个窗口顶部。
    var group = document.querySelector('[data-home-group="all"]');
    if (group) group.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------- 交互 ----------------

  function bindCardEvents() {
    bothGrids().forEach(function (node) {
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
    });
  }

  // ---------------- 右键菜单（S1：单一实例 + 完整生命周期） ----------------

  var menu = { el: null, path: "", opener: null };

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

  function menuItems() {
    return menu.el ? Array.from(menu.el.querySelectorAll('button[role="menuitem"]')) : [];
  }

  function openMenu(card, event, options) {
    options = options || {};
    closeMenu({});
    var group = card.closest("[data-home-group]")?.dataset.homeGroup === "all" ? "all" : "recent";
    var entry = entryByPath(card.dataset.path);
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
    if (group === "recent") {
      // 仅影响最近视图；工程文件与全部工程登记不动。
      actions.push({ key: "recent_remove", run: function () {
        void bridge("remove_recent_project", { path: entry.path }).then(refresh);
      } });
    } else {
      // §5.3+调整4：移除语义严格区分——「从全部工程移除」同步撤出最近（包含关系
      // 不变式，否则读取补齐会立即撤销移除）；删除工程文件才动磁盘。
      actions.push({ key: "remove_registry", run: function () {
        void bridge("remove_registry_project", { path: entry.path }).then(refresh);
      } });
      actions.push({ key: "delete_project_file", danger: true, run: function () { deleteProjectFlow(entry); } });
    }
    actions.forEach(function (action) {
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      if (action.danger) {
        button.classList.add("danger");
        // 垃圾桶取自 Lucide（ISC License，https://lucide.dev），以 currentColor 内联使用。
        button.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17" fill="none"/></svg>';
        var span = document.createElement("span");
        span.textContent = t(action.key);
        button.append(span);
      } else {
        button.textContent = t(action.key);
      }
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
        // §5.2：搜索输入后回到第一页；全部组改由服务端按查询返回。
        state.allPage = 1;
        void fetchAllPage().then(render);
      }, SEARCH_DEBOUNCE_MS);
    });
    el("recentMore").addEventListener("click", function () {
      state.visible += DEFAULT_LIMIT;
      renderRecentGroup();
    });
    bindGroupToggle("recent", "recentGroupTitle");
    bindGroupToggle("all", "allGroupTitle");
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

  function bindGroupToggle(group, titleId) {
    var title = el(titleId);
    if (!title) return;
    title.addEventListener("click", function () {
      state.groupsCollapsed[group] = !state.groupsCollapsed[group];
      persistGroups();
      applyGroupCollapsed(group);
      renderGroupHeaders();
    });
  }

  function persistGroups() {
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(state.groupsCollapsed)); } catch (error) { /* 显示状态而已 */ }
  }

  function restoreGroups() {
    try {
      var saved = JSON.parse(localStorage.getItem(GROUPS_KEY) || "null");
      if (saved && typeof saved === "object") {
        if (typeof saved.recent === "boolean") state.groupsCollapsed.recent = saved.recent;
        if (typeof saved.all === "boolean") state.groupsCollapsed.all = saved.all;
      }
    } catch (error) { /* 默认两组展开 */ }
  }

  function init() {
    bindToolbar();
    bindCardEvents();
    initMenuLifecycle();
    restoreGroups();
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
      if (window.MSWNavigation && window.MSWNavigation.current() === "home") {
        void refresh();
        // 调整6：编辑器内「退出服务器」后返回启动器——右上角服务器地址与
        // 「关闭服务器」按钮一样按重新探测结果刷新，不再残留失效地址。
        if (window.MSWLauncher && typeof window.MSWLauncher.refreshServerStatus === "function") {
          window.MSWLauncher.refreshServerStatus();
        }
      }
    });
    document.addEventListener("mswnavigation", function (event) {
      if (event.detail && event.detail.page === "home") {
        void refresh();
        // 调整6：回到首页同样重探服务器状态（切页期间退出服务器的场景）。
        if (window.MSWLauncher && typeof window.MSWLauncher.refreshServerStatus === "function") {
          window.MSWLauncher.refreshServerStatus();
        }
      }
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
