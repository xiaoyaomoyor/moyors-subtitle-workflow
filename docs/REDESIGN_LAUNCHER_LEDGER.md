# 启动器重构执行账本

依据：`docs/PLAN_LAUNCHER_REDESIGN.md`（2026-09-14 规划）。
基线：`my-feature` / `49375c6`。
状态取值：`待处理`、`进行中`、`已完成`、`仅说明`、`阻塞`。

本文件是边做边落盘的真实进度账本：每完成一项立即回写，验证命令与结果分层记录（语法/单元、契约、浏览器交互、原生窗口）。不以摘要代替实际代码与测试证据。

## 阶段总览（R0–R6 见 PLAN_LAUNCHER_CORRECTIONS.md）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| A | 视觉原型与交互定稿 | 已完成 |
| B | 横向应用框架与品牌 | 已完成 |
| C | 最近工程、明确空白启动与会话兼容 | 已完成 |
| D | 预制模块编排与旧配置迁移 | 已完成（状态层） |
| E | 统一预制执行与复杂工程保护 | 部分完成（零字幕主链） |
| F | 实用工具、更多设置与指南 | 基础形态完成（随 B 阶段） |
| G | 回归、视觉验收与交付 | 持续进行（测试与账本就绪，原生窗口待实测） |

## 勘察结论（2026-09-14）

- `web/launcher/launcher.js`（2721 行）、`postprocess.js`（2302 行）、`batch.js`（396 行）全部通过元素 ID 绑定交互。B/D 阶段迁移 DOM 结构时保留既有 ID，可在不重写绑定逻辑的前提下重排页面。
- `server-editor/serve.py` 的 `ServerSettings.recent_projects` 已持久化到 `maw/app_paths.py: default_app_data_root() / "server-editor-settings.json"`；编辑器打开/保存工程都会调用 `remember_project`。启动器读取同一文件即可得到与编辑器同步的最近工程索引（C 阶段不另建并行真源；固定/移除等启动器侧元数据单独存启动器数据文件）。
- `maw/gui_web.py:109` `WINDOW_TITLE = "MSW Launcher"`；`run_app()` 初始窗口 900×880、min 760×640、背景 `#16181d`。B 阶段改横向 1200×780 并按屏幕工作区收敛。
- `start_server()`（gui_web.py:1566）：无工程路径时交给服务器按「自动打开上次工程」设置恢复——即规划指出的“空白启动可能恢复旧工程”问题；有工程但缺媒体时会拒绝启动（`server_media_missing`）。C 阶段引入显式 `intent: blank/project/resume` 并放开无媒体工程。
- e2e：`tests/e2e/launcher-interactions.spec.mjs` 等大量用例依赖既有 ID 与类名；G 阶段更新定位与新增用例。

## R2：视觉组件与图标统一（修正案第三批）

状态：已完成（2026-09-15）。对应审查 V05–V08；基线 23bd55d。

改动：

1. **色板令牌落地（V05）**：`launcher.css` 根令牌对齐审查 §4.2 初值——暗色正文 `#EEEAF2`/次要 `#B7B0BF`、边框 `#363238`（弱 `#2f2b31`/强 `#453f47`）、主按钮 `#71558B`、强调 `#BCA2D3`；亮色正文 `#29252D`、边框 `#DCD6E2`、强调 `#74528E`、主按钮 `#71518D`。新增独立选区描边令牌 `--selection-stroke`（暗 `#C3AAD9`/亮 `#82609D`），最近工程卡片选中态改用该令牌 2px 描边；拖放区底色改中性 `--bg-input`，紫色 tint 仅保留在拖拽悬停交互态；散落硬编码色收敛（success `#8ecf9b`→令牌、amber 调整为 (217,168,95) 族）；卡片统一 `shadow-1` 无渐变底。
2. **模块头单行化（V07）**：`workflow.js ensureCardHead` 升级为「序号 · 标题 · 折叠箭头」同一行（h2 移入头部行，15px + 省略号），折叠箭头由文字 `▾` 改为 SVG chevron 并随 `aria-expanded` 旋转；短字段沿用既有 `grid-two` 双列布局，文件路径与长文本保持通栏。
3. **图标语义与 emoji 清理（V08）**：两处设置入口齿轮 SVG 换为标准齿轮 path（内圆 + 环形轮齿，不再近似太阳）；⚙/🌐/1️⃣–5️⃣ emoji 与文字 ✓（ffmpeg 检测）全部替换为内联 SVG 或纯文本；`api_key_missing` 文案改指向「更多设置 → 服务与连接」。
4. **顶部密度（V08）**：`app-header` 收紧至 64px（padding 10/20），水母 LOGO 34px、中文名 19px，品牌栏与五页页头起点对齐。
5. **悬浮工具箱收口（V06）**：移除全局悬浮工具箱按钮 `#toolboxFab` 及其样式（含窄窗口覆盖块）与孤儿 i18n 键 `toolbox_open`；新增公开 API `window.MSWLauncher.openToolbox()`，工具页 `data-tool-entry` 按钮与 e2e 均改经该 API 打开抽屉；抽屉关闭时焦点归还触发按钮（记录 `toolboxReturnFocus`，不再依赖 FAB 接收焦点）。工具页各工具卡（有明确对象与用途的上下文入口）保留。
6. **测试对齐**：`test_gui_web.py` 契约更新（焦点归还断言、控件清单/样式表无 FAB、openToolbox 公开 API 存在、brand-logo 34px）；`launcher-interactions.spec.mjs` 3 处用例与 D 阶段模块门控对齐——后处理配置卡现需任一后处理模块启用（经右栏勾选）方出现，未就绪勾选会被打回并打开工具箱，故测试先配置文稿/供应商再启用模块；设置已为五页框架内页面，切分组高度随内容变化，弹窗高度相等断言改为宽度与位置稳定；4 个 e2e 的 FAB 点击改 `openToolbox()`。

验证（2026-09-15）：

- e2e：启动器 8 个 spec 共 64 项全部通过（含 3 项对齐后的交互用例）。
- 单元/契约：全量 1554 项通过（OK，skipped=63 为环境相关跳过）。
- 截图：`build/shot_r2.mjs`（本地留档）14 张——明暗五页、预制高级区展开、工具箱抽屉、错误态、设置详情；脚本显式钉住 `MAW_GUI_THEME` 后 reload（修复 localStorage 上次运行残留把“暗色”pass 拍成亮色），高级区截图补 `scrollIntoView`（该区在 780px 折叠线以下）。视觉核验逐张通过：模块头单行、品牌栏紧凑、拖放区中性、齿轮标准、错误条琥珀警示可读、明暗两版五页无重叠溢出。
- 编辑器隔离：本轮仅改 `web/launcher/*` 与测试，编辑器外观不受共享规范影响。

未验证（顺延）：

- 工具箱 LLM 面板内联「模型」配置区与「在更多设置中配置 API Key」链接并存——双路径收口属 F13（R5）。
- 首页主操作常态为 ghost split 按钮、选中工程后才出现紫色主按钮——与 H02 选中语义相关，R3 一并观察。
- pywebview 原生窗口下的实际观感与系统缩放（R6 实测）。

## R1：页面骨架与布局修复（修正案第二批）

状态：已完成（2026-09-15）。对应审查 V01–V04；基线 d4b26cd。

改动：

1. **层级修复（V01/V02/V03）**：`web/launcher/index.html` 删除预制页收尾处多余的 `</div>`（浏览器解析会提前弹出 `.page-host`，导致 footer 掉入 `.app-body`、工具/指南/设置三页脱离内容容器），并把 `.prefab-rail` 移入 `.prefab-wrap` 内与配置列并排。修正后层级：`section.page[prefab] > div.prefab-wrap > (div.prefab-main > div.page-scroll) + aside.prefab-rail`，footer 在 section 内、wrap 外。
2. **弹窗残留清理（V04）**：`launcher.css` 移除 `#settingsClose` 与工具箱关闭按钮共用 的 36×36/22px 旧规则（页面「返回」按钮改用 `.settings-back`）；删除 `.settings-modal-card` 的弹窗固定高度；删除 `.actions` 旧页脚死代码（含窄屏媒体查询残留）；`launcher.js` 移除 `.actions` 死引用与无效 ResizeObserver。
3. **窄窗口模块抽屉（审查 §4.3）**：≤1100px 时模块栏改为右侧滑出抽屉（fixed + 遮罩 + 关闭按钮 + Esc/点遮罩关闭；切页自动收起；恢复宽窗口时复位），页面头部出现「处理模块」切换按钮；`renderRail` 目标改为 `#railContent`，抽屉头部常驻。1200×780 主设计尺寸保持双栏。
4. **结构断言 e2e（`tests/e2e/launcher-structure.spec.mjs` 5 项）**：解析后 DOM 父子关系断言——五页均为 `.page-host` 直接子项；预制 footer 属于预制页且其他页激活时开始按钮不可见；rail 在 wrap 内位于配置列右侧（宽≥200）；五页正文起点一致、页脚贴底、无横向溢出；960×640 主操作可见、模块栏默认移出视口、抽屉开合可用。

验证（2026-09-15）：

- e2e：启动器全部 9 个 spec 共 64 项通过（新增结构 5 项）。
- 单元/契约：全量 1554 项通过（1 处设置关闭按钮契约断言按 V04 新契约更新）。
- 截图：五页 1200×780 暗色 + 预制页 960×640 抽屉开/合（`build/r1-*.png`，本地留档）；预制页视觉核验通过（模块栏右侧并排、操作栏贴底横跨、无重叠溢出）。

未验证（顺延）：960 以下更窄宽度与 125%/150% 系统缩放的实测（R2/R6）；IAB 内嵌浏览器缓存旧 JS 导致的复验干扰与生产行为无关（打包为本地文件加载，e2e file:// 已覆盖）。

## R0：会话与执行入口修复（修正案第一批）

状态：已完成（2026-09-15）。对应审查 F01–F08；基线 718afe8。

改动：

1. **多会话管理（F01）**：`maw/gui_web.py` 新增 `EditorSession`（port/process/log_file/project_path）与 `editor_sessions: dict[int, EditorSession]`；`start_server` 只替换目标端口的旧受管会话，独立端口启动不触碰任何既有会话；`stop_server` 支持 `url` 参数按会话定位；`get_server_status` 返回 `owned` 与 `managedSessions` 清单；`shutdown` 清理全部会话；启动失败不覆盖原会话句柄。删除单一 `server_process`/`server_log_file` 句柄。
2. **会话 URL（F02）**：前端 `state.activeSessionUrl` 保存后端返回的实际会话 URL；快捷打开优先实际 URL；停止操作按会话 URL 定位。
3. **未保存状态（F03）**：`server-editor/serve.py` 记录 `last_mutation`/`last_save`（加载/接管=一致、写盘=已保存），`/api/startup-status` 新增 `mediaPath`/`unsaved`/`hasContent`；启动器探测与冲突载荷携带该状态；blank 复用收紧为「真空白」（projectPath 与 hasContent 皆为空）；冲突/替换确认文案携带未保存警告。
4. **波形开关（F04）**：`generate_waveform_project` 支持 `waveform:false` → 产出无波形纯媒体工程（`.media.mosp`），不调用波形提取；前端按波形模块开关分流「纯媒体／波形工程」。
5. **执行分派（F05/F06）**：「已有工程／字幕再处理」输入模式不再走 ASR 校验与转录 API，给出明确的下一阶段接入说明；勾选后处理但无字幕来源时定位模块并说明缺失条件，不静默跳过。
6. **批量拦截（F07）**：识别模块关闭时批量开始明确报错（完整模块化批量在 R4）。
7. **可取消波形任务（F08）**：`maw/waveform.py`/`media_cache.py` 透传 `cancel_event`（各阶段检查点，取消抛 `MediaCacheCancelled`）；新增 `start_waveform_project`（后台线程 + taskId）与 `cancel_waveform_project` 桥接，事件 `waveformTask`（running/completed/failed/cancelled）经 EventPump 推送；前端停止按钮对媒体工程任务走专属取消，不再借道 `cancel_transcription`；同步版保留给工具箱。
8. **打开时序（H06 后端）**：`note_project_opened` 移到服务器健康检查通过、成功返回之前紧邻处。

验证（2026-09-15）：

- 单测新增 15 项：`tests/test_launcher_r0.py`（独立端口保留旧会话、普通启动只替换同端口、按 URL 停止单会话、状态清单、打开记录仅在成功后、waveform 开关两路径、异步任务完成/取消事件）＋ `tests/test_local_editor_server.py::SessionStateProtocolTests`（空白无内容、加载即已保存、修改未保存、写盘恢复）。受影响断言更新 6 处（会话句柄、embed cancel_event 参数、stop_server 载荷）。
- 全量 Python 1554 项通过；启动器 e2e 52 项通过（`launcher-workflow` 重写为 6 项：波形异步任务+开关载荷、纯媒体工程、后处理缺字幕说明、工程模式拒走 ASR、ASR 管线保持、批量拦截）。
- 浏览器 mock 核验：三场景分流（waveform:false→.media.mosp、工程模式零执行调用+明确报错、waveform:true→.waveform.mosp）。

未验证（顺延）：原生 pywebview 双会话实测（R6）；reapeaks 生成阶段中段的取消为尽力而为（阶段间检查点，已在代码注释与账本记录）；「已有工程再处理」执行管线（R4）。

## E：统一预制执行（首条主链）

状态：部分完成（2026-09-14）。

已完成：媒体预制且不勾识别时，「生成字幕和工程」改走 `generate_waveform_project`，产出零字幕波形 `.mosp` 并设为当前工程、刷新最近工程索引；无媒体时给出字段错误不伪造结果；ASR 勾选时保持原 `start_transcription` 管线。e2e `tests/e2e/launcher-workflow.spec.mjs` 2 项通过（零字幕主链含 jsonPath 回填与状态提示；ASR 管线不受影响）。启动器 e2e 共 48 项通过、Python 1542 项通过。

未完成（后续迭代，见规划 §8-E）：输出设置卡与结果卡统一呈现、方案保存/载入（版本化 schema）、一次性预检集中校验、翻译默认独立副轨与旧双语单轨兼容选项、已有工程再处理执行链、批量模块级状态与失败步骤重试、复杂 MSW 工程跨后处理兼容夹具回归（规划 §9「数据」行）。

## F：实用工具、更多设置与指南

状态：基础形态已随 B 阶段落地（2026-09-14）：实用工具页 6 张工具卡直连工具箱对应工具；使用指南页三张入门卡＋FAQ 折叠＋外链；「更多设置」页面化（4 标签页结构、深链、返回按钮）。

未完成：工具箱抽屉完全迁移为页面内工具（当前保留抽屉形态，入口已并流）；设置按七类重排与环境配置分层细化；设置保存冲突/热刷新；「媒体信息」轻量工具；文档站点链接核验。

## G：回归、文档与交付

状态：持续进行（2026-09-14）。

已完成：启动器相关 e2e 全部更新并新增 13 项（首页 5＋模块 6＋工作流 2），Python 契约测试随各阶段同步更新（245＋11 项）；CHANGELOG 添加 Unreleased 全新特性条目；账本（本文件）按阶段记录真实进度与未验证项。

未验证（需后续真实环境）：pywebview 原生窗口（标题栏双语、1200×780、系统文件对话框、拖放、100%/125%/150% 缩放实测）；真实后端下最近工程与编辑器保存事件的联动；macOS/Linux 窗口与对话框；README/WORKFLOW/启动器指南文档同步与网站 Pages 核验；发行包（标准包/lite）包含新增 JS 模块的实测（spec 已含整目录打包，风险低）。

## D：预制模块编排与旧配置迁移

状态：已完成（2026-09-14，状态层；执行层统一在 E 阶段）。

改动：

1. `web/launcher/modules.js`（新增）：模块注册表（稳定 ID、分组、固定依赖顺序、控件映射）。右栏「处理模块」分组渲染：输入与分析（选择媒体[必需·固定]、波形生成、识别设置）、字幕整理（文稿匹配/固定处理/LLM 校对/重新断句/OCR 字幕去重）、语言处理（翻译）、高级（交互式口播对齐）、运行反馈（显示处理日志入口）。勾选状态存 localStorage 草稿；后处理六项与 `autoStep*` 复选框双向同步，未就绪步骤被 postprocess.js 打回时以控件实际状态回写（不静默跳过），并广播 `rejected` 事件。任一后处理启用自动打开自动后处理总开关。
2. `web/launcher/workflow.js`（新增）：左侧配置卡编排——模块卡头（01/02 序号 + 折叠按钮 + 可折叠 body），折叠只改显示不改启用，状态记忆；卡片可见性：媒体固定、识别设置随 ASR 模块、「转写后自动处理」承载六项后处理（任一启用或打回引导时显示）；序号按可见顺序连续编号。输入方式切换（媒体预制 / 已有工程·字幕再处理）：卡标题/字段标签/拖放提示切换，模式记忆。处理顺序摘要胶囊随模块状态更新。语言切换后重应用动态文案。
3. `web/launcher/index.html`：预制页改双栏（内容 + 248px 模块栏）；页头加输入方式 segmented 与顺序摘要；三张配置卡挂 `data-module-card`。
4. `web/launcher/launcher.css`：双栏、模块栏、模块卡头/折叠/隐藏、chip、project 输入模式下隐藏不适用的单文件 HTML 与仅-SRT 选项。
5. 文案：mod_*/rail_*/chip_*/prefab_mode_*/project_* 中英全套。

模块语义说明：ASR 默认保持启用（旧配置迁移不改变老用户习惯；「媒体＋波形」新默认在 E 阶段内置方案中体现）；波形模块首版为执行层选项（`generateSpectral` 仍在识别卡高级区，独立配置卡在 E 阶段并入时建立）。

验证（2026-09-14）：

- e2e：`tests/e2e/launcher-modules.spec.mjs` 新增 6 项（分组与固定必需项、ASR 开关隐藏/恢复保留草稿与重编号、折叠不禁用、后处理打回同步与设置页引导、输入方式标签切换与草稿保留、切页保留折叠与勾选）。启动器全部 7 个 spec 52/52 通过。
- 单元：1542 项全部通过（DOM 顺序断言修正：预制右栏也是 aside，抽屉结束标记从 footer 后查找）。
- 浏览器（mock）：双栏截图视觉核验通过（模式切换+顺序胶囊+序号卡头+分组右栏+底部操作栏无重叠）；打回流程验证（未就绪模块被拒、配置卡强制显示展开、模块保持未启用）。

未完成（按规划顺延至 E）：「开始预制」读取模块状态决定执行链（不勾 ASR → 走 generate_waveform_project 零字幕工程路径）；输出设置卡与结果卡的统一呈现；方案保存/载入（版本化 schema）；一次性预检集中校验。

## C：最近工程、明确空白启动与会话兼容

状态：已完成（2026-09-14）。

改动：

1. `maw/launcher_projects.py`（新增）：最近工程合并视图——只读编辑器真源 `server-editor-settings.json`（`recent_projects`，编辑器打开/保存/另存为都会更新），叠加启动器侧元数据 `launcher-recent.json`（固定、移除、失效路径 alias 重定位、启动器打开时间）。提供 `recent_projects_payload / note_project_opened / remove_recent_project / set_recent_project_pinned / relocate_recent_project / project_stats_payload`（统计：主字幕=顶层 segments、副=multi_subtitle 非主轨、音频贴片=msw.audio_clips；>64MB 跳过不伪造）。原子写、LF、容错读。
2. `server-editor/serve.py`：`/api/startup-status` 增加 `projectPath`，供启动器校验「选 A 打开 A」。
3. `maw/gui_web.py`：`start_server` 显式 `intent: blank/project/resume`——blank 附加 `--blank` 不恢复上次工程；project 缺媒体不再拒绝（编辑器加载时提示手动指定媒体）；端口已有服务先 `_probe_existing_server` 取工程身份：目标一致才复用（`sameProject`/`blankProject`），不一致返回 `server_conflict`（含 url/projectPath/owned），`independentPort` 走空闲端口、`restart` 仅重启受管服务，不杀外部进程。新增桥接：`get_recent_projects`、`get_recent_project_stats`、`remove_recent_project`、`set_recent_project_pinned`、`relocate_recent_project`（原生文件对话框）。`LauncherPaths.recent_metadata` 可注入，测试不污染真实用户数据。
4. `web/launcher/project-home.js`（新增）：首页卡片渲染（名称/目录/时间[打开时间优先，文件修改为后备并标注]/统计逐项拉取显示「读取中」/失效警告/固定标记）；搜索过滤、默认 12 项+加载更多；单击选择、再击取消、双击打开、Enter 打开/Space 选择；右键菜单（固定/取消固定、打开所在文件夹、失效时重新定位、从最近记录移除——只删记录不删文件）；切页/窗口聚焦刷新索引。等 `mawlauncherready` 后再拉取。
5. `web/launcher/launcher.js`：`openServerEditor(options)` 支持意图与重试参数；冲突处理（返回现有会话→独立端口→重启受管服务三步确认，且在 finally 之后执行避免 serverStarting 守卫死锁）；`startBlankEditor()` 显式空白启动；缺媒体预检放开为提示；bridge 增加 `bridgeOverride` 注入点（带 next 直通防递归）；mock 增加 recent 系列方法并记录 start_server 意图。
6. `web/launcher/index.html` / `launcher.css`：首页工具栏（搜索+计数）、卡片网格、空态、加载更多、底部「启动空白编辑器 + 打开所选工程（选中时出现）」；recent 卡片与右键菜单样式（紫色选中描边+小勾、琥珀失效、固定标记）。

验证（2026-09-14）：

- 单元：`tests/test_launcher_projects.py` 新增 11 项（合并视图、移除恢复、重定位映射、统计、元数据往返、blank/--blank、冲突上报不复用、同工程复用、空白冲突、独立端口）。全套 1542 项通过（5 个 start_server 用例按新语义更新：单次 `_wait_for_server`、`_probe_existing_server` mock、缺媒体改为允许启动断言）。
- e2e：`tests/e2e/launcher-home.spec.mjs` 新增 5 项（卡片渲染/统计/搜索/选择、双击打开+空白启动意图断言、失效重定位确认、右键菜单动作、会话冲突三步流程）；启动器相关 46/46 通过。
- 浏览器（mock）：双击卡片 jsonPath 正确回填 clip.mosp 完整路径（修复过 mock 反斜杠转义）、按钮转「打开字幕编辑器」、空白启动清空目标并 blank 意图；首页截图视觉核验通过（搜索/计数/两张卡/统计/固定/失效/底部按钮）。
- 未验证：真实后端下的最近工程数据（编辑器 settings 实际联动）、pywebview 原生窗口与文件对话框（G 阶段实测）；「恢复未保存内容」入口需要编辑器恢复记录协议，C 首版未加入（编辑器内已有恢复 UI，账本跟踪）。

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
