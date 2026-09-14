# 启动器重构执行账本

依据：`docs/PLAN_LAUNCHER_REDESIGN.md`（2026-09-14 规划）。
基线：`my-feature` / `49375c6`。
状态取值：`待处理`、`进行中`、`已完成`、`仅说明`、`阻塞`。

本文件是边做边落盘的真实进度账本：每完成一项立即回写，验证命令与结果分层记录（语法/单元、契约、浏览器交互、原生窗口）。不以摘要代替实际代码与测试证据。

## 阶段总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| A | 视觉原型与交互定稿 | 已完成 |
| B | 横向应用框架与品牌 | 已完成 |
| C | 最近工程、明确空白启动与会话兼容 | 待处理 |
| D | 预制模块编排与旧配置迁移 | 待处理 |
| E | 统一预制执行与复杂工程保护 | 待处理 |
| F | 实用工具、更多设置与指南 | 待处理 |
| G | 回归、视觉验收与交付 | 待处理 |

## 勘察结论（2026-09-14）

- `web/launcher/launcher.js`（2721 行）、`postprocess.js`（2302 行）、`batch.js`（396 行）全部通过元素 ID 绑定交互。B/D 阶段迁移 DOM 结构时保留既有 ID，可在不重写绑定逻辑的前提下重排页面。
- `server-editor/serve.py` 的 `ServerSettings.recent_projects` 已持久化到 `maw/app_paths.py: default_app_data_root() / "server-editor-settings.json"`；编辑器打开/保存工程都会调用 `remember_project`。启动器读取同一文件即可得到与编辑器同步的最近工程索引（C 阶段不另建并行真源；固定/移除等启动器侧元数据单独存启动器数据文件）。
- `maw/gui_web.py:109` `WINDOW_TITLE = "MSW Launcher"`；`run_app()` 初始窗口 900×880、min 760×640、背景 `#16181d`。B 阶段改横向 1200×780 并按屏幕工作区收敛。
- `start_server()`（gui_web.py:1566）：无工程路径时交给服务器按「自动打开上次工程」设置恢复——即规划指出的“空白启动可能恢复旧工程”问题；有工程但缺媒体时会拒绝启动（`server_media_missing`）。C 阶段引入显式 `intent: blank/project/resume` 并放开无媒体工程。
- e2e：`tests/e2e/launcher-interactions.spec.mjs` 等大量用例依赖既有 ID 与类名；G 阶段更新定位与新增用例。

## B：横向应用框架与品牌

状态：已完成（2026-09-14）。

改动：

1. `maw/gui_web.py`：`WINDOW_TITLE` 改为「我的字幕流 · Moyor's Subtitle Workflow」；初始窗口 1200×780、最小 960×640（按屏幕工作区收敛，`_initial_window_size()`/`_screen_work_area()`，Windows 用 SPI_GETWORKAREA，其他平台回落 pywebview.screens）；`background_color` 改 `#101010`；新增桥接 `sync_theme_title_bar(payload.dark)`。
2. `maw/gui_platform.py`：`apply_theme_title_bar(window_title, dark)` 支持亮色回退（原 `apply_dark_title_bar` 保留为别名）。
3. `web/launcher/index.html`：重写为横向五页框架（页头/左导航/页内容/页操作栏），全部既有元素 ID 保留。工程文件与端口字段移入首页「字幕编辑器」卡；识别/媒体/后处理/日志与错误提示在预制页；工具箱抽屉、批量确认弹窗、右键菜单原位保留。品牌区使用内联水母 SVG（`fill="currentColor"`），设置由弹窗改为「更多设置」页面（保留 4 标签页结构与深链）。
4. `web/launcher/navigation.js`（新增）：五页切换、滚动位置记忆、页面历史（back）、≤980px 紧凑导航、`window.MSWNavigation` API。
5. `web/launcher/launcher.css`：令牌重定为中性黑/紫（`--bg-base #101010`、`--bg-side #171717`、卡片 `--bg-panel #1E1E1E`、`--accent #b19acb/#73568f`，亮色对应），去掉 body 蓝色径向渐变；新增 app-header/app-nav/page/page-actions/tools/guide/settings-page 组件层；页脚改为页面内操作栏（按钮不收缩、窄窗换行）；滚动条样式接入 `.page-scroll`。
6. `web/launcher/launcher.js`：全部 emoji 序号/按钮文案清除（1️⃣/✨/🎬/🧰/⚙️/🚀/📝 等，含中英两套）；新增五页/指南/工具文案；`openSettings` 改为收起工具箱+导航到设置页（保留深链滚动与字段聚焦），`closeSettings` 变为返回上一页；`syncFixedFooterClearance`/`revealErrorNotice` 面向当前页滚动容器；`applyTheme` 同步原生标题栏（仅真实后端）；新增 `bindStaticPages()`（指南跳转、FAQ 折叠、工具页入口打开抽屉对应工具）。
7. `web/launcher/postprocess.js`：暴露 `MSWLauncher.closeToolbox`；抽屉高度钳制增加顶部预留 92px，不再覆盖页头。

验证（2026-09-14）：

- 单元/契约：`uv run python -m unittest discover` 1531 通过（更新 5 个断言以匹配新契约：#101010 防闪烁背景、内联品牌 SVG、无 emoji 标题、非 emoji 批量按钮；11px 字号禁令以 11.5px 遵守）。
- e2e（Playwright/Chromium）：`launcher-interactions` 28/28、`launcher-upgrade-bc` 13/13、`launcher-zoom`、`beta3-launcher`、`branding` 3/3 全部通过。测试更新：打开启动器后切到「预制工程」页；工程字段测试切首页；错误提示测试改用页面滚动容器与预制页操作栏；工具箱高度测试初始值避开新的页头预留钳制；窄页脚「必须增高」放宽为「不低于」（单行可容纳三按钮是新布局的合法状态）；品牌测试改为内联 SVG 契约（fill=currentColor、主题取色不同、方形包围盒）。
- 浏览器（mock 模式）：首页/预制页截图视觉核验通过（品牌栏、五导航高亮、卡片、底部按钮、黑紫主题、亮色反黑水母）；工具页 6 卡入口→打开抽屉并选中正确工具→可关闭；指南 FAQ 折叠与页面跳转；`openSettings('ffmpegSettingsSection')` 深链正确切运行环境标签并滚动到 FFmpeg 区块。截图存档 `../msw-checks/launcher-redesign/`（10 张，暗/亮/紧凑）。
- 未验证：pywebview 原生窗口（WebView2 标题栏双语、1200×780 初始尺寸、系统文件对话框、拖放）需真实窗口环境，G 阶段实测；macOS/Linux 未测。

遗留（按规划顺延）：页头 `#status` 为全局状态行（后续 C 阶段首页提供更完整的会话状态展示）；「更多设置」分类重排与设置保存热刷新在 F 阶段。

## A：视觉原型与交互定稿

状态：已完成（2026-09-14）。未接入任何真实服务，未改动 `web/launcher/` 生产文件。

产出：

1. `docs/prototype/launcher-prototype.html`：单文件原型，含五页（启动编辑器／预制工程／实用工具／使用指南／更多设置）、暗／亮主题、中／英演示切换、模块勾选→左侧编号配置区插入、卡片选择、错误态聚焦演示、紧凑导航演示。水母 LOGO 以 `fill="currentColor"` 内联，颜色随应用主题（暗反白／亮黑色）。
2. `docs/PROTOTYPE_THEME_TOKENS.md`：主题令牌表（暗／亮，含状态色、结构令牌、紫色使用边界）。
3. `docs/PROTOTYPE_INTERACTION_STATES.md`：交互状态表（导航、最近工程卡片、模块状态机、按钮层级、底部操作栏、表单草稿、日志、主题语言）。

验证（浏览器证据，2026-09-14）：

- 首页暗色：品牌栏（水母/双语名/版本徽标）、五项导航当前项高亮、三张最近工程卡片（含失效路径警告与固定标记）、底部「空白启动＋打开所选工程（禁用态）」——视觉检查通过。
- 卡片选择逻辑：evaluate 触发 click 后 `selected` 类、`aria-pressed=true`、主按钮启用并转为主样式——通过。（注：Playwright 原生 click 在该环境超时，改用 DOM click + 状态断言；G 阶段原生窗口验收时复核。）
- 预制页暗色：勾选 ASR 后左侧出现 01/02/03 连续编号模块卡、右栏按「输入与分析／字幕整理／语言处理／高级／运行反馈」分组、底部操作栏主按钮为紫色——视觉检查通过。
- 亮色主题：背景/文字对比正常、水母变黑色轮廓、导航淡紫高亮、无暗色残留——视觉检查通过。
- 紧凑导航：`.app-nav` 计算宽度 64px、标签 display:none——通过。
- 语言演示：品牌中文名切换为英文名——通过。

遗留：原型中的「媒体信息」工具卡为规划允许的低优先级新增项，F 阶段实现时按优先级决定是否落地；验收矩阵第 9 节其余项在 B–G 阶段覆盖。

