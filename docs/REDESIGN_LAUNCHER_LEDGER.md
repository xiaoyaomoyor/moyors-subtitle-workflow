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
| G | 回归、视觉验收与交付 | 已完成（R0–R6 全部闭环；云端服务与打包构建见 R6 未验证清单） |

## 勘察结论（2026-09-14）

- `web/launcher/launcher.js`（2721 行）、`postprocess.js`（2302 行）、`batch.js`（396 行）全部通过元素 ID 绑定交互。B/D 阶段迁移 DOM 结构时保留既有 ID，可在不重写绑定逻辑的前提下重排页面。
- `server-editor/serve.py` 的 `ServerSettings.recent_projects` 已持久化到 `maw/app_paths.py: default_app_data_root() / "server-editor-settings.json"`；编辑器打开/保存工程都会调用 `remember_project`。启动器读取同一文件即可得到与编辑器同步的最近工程索引（C 阶段不另建并行真源；固定/移除等启动器侧元数据单独存启动器数据文件）。
- `maw/gui_web.py:109` `WINDOW_TITLE = "MSW Launcher"`；`run_app()` 初始窗口 900×880、min 760×640、背景 `#16181d`。B 阶段改横向 1200×780 并按屏幕工作区收敛。
- `start_server()`（gui_web.py:1566）：无工程路径时交给服务器按「自动打开上次工程」设置恢复——即规划指出的“空白启动可能恢复旧工程”问题；有工程但缺媒体时会拒绝启动（`server_media_missing`）。C 阶段引入显式 `intent: blank/project/resume` 并放开无媒体工程。
- e2e：`tests/e2e/launcher-interactions.spec.mjs` 等大量用例依赖既有 ID 与类名；G 阶段更新定位与新增用例。

## T0：测试隔离与登记污染修复（三轮审查 2026-09-19 第一批）

状态：已完成（2026-09-19）。依据《启动器第三轮审查》§2/T0（基线 cca3291）；P0 索引污染实施前复核属实（547/547/547）。

改动：tests/__init__ 会话级 MSW_APP_DATA_ROOT 隔离（子进程继承）+7 处构造器注入临时 registry；登记层锁由文件存在性锁重做为 OS 级字节范围锁（msvcrt/fcntl——原锁在 Windows 死锁：读锁句柄阻 unlink；同进程 12 线程实测 1/12 存活→修复后 12/12，跨进程 kill 自动释放实测）；注册表 migrated 标记幂等合并（补「先建索引跳过迁移」缺口）；坏索引先备份 .corrupt-<ts> 再当空；清理三件套（预览只读/执行先备份/恢复限目录内）+三桥接+设置入口（确认对话框+备份反馈+一键恢复）；金丝雀（默认路径跟随覆写+真实索引字节比对）。

验证：单元 32 项 OK（清理/坏索引/迁移/金丝雀）；全量 1619 OK+e2e 83/83+ruff 全绿；**全量测试前后真实索引 SHA-256 一致（零写入验收）**；现存 547 条留待用户经设置入口预览清理（备份可恢复，未代为执行）。

## S6：整体回归与交付（二轮修正 2026-09-16 第六批·终批）

状态：已完成（2026-09-16）。依据二轮修正方案 §10 S6；基线 187d9d1。含 S4/S5 遗留摘要补齐。

改动：模块头参数摘要（§6.1 补齐）——全部十类卡「箭头→序号→标题→摘要」，摘要随 renderCards 刷新、中英双语（媒体=文件名/波形=频谱开关/识别=供应商·模型/匹配=文稿名/固定=N 规则/LLM=提示词态/OCR=视频来源/翻译=目标语言/对齐=需人工/输出=目录或默认）。

验证（2026-09-16）：

- 视觉矩阵 13/13：语言×主题×分辨率 12 组合无横向溢出（全模块+日志最宽卡列）+ 应用缩放 150% 无溢出；截图 13 张（build/s6/）。
- launcher e2e 83/83（新用户/旧配置/坏工程/缺依赖/跨页场景由既有用例覆盖）；真实媒体 8/8（FFmpeg 真跑）；启动 3/3 零错误；全量 discover 1613 项 OK（skipped=63）；ruff 全绿。
- 原生窗口：两次启动（后台/前台）进程存活但窗口句柄 0、stdout 零输出——与前两轮相同的会话窗口创建受限问题；如实记录，浏览器端（同内核）验证覆盖。

未验证（终批汇总，不阻塞合并）：原生 WebView 实际交互、真实回收站还原、跨进程注册真机并发、真实云端调用、便携打包、批量逐输入预览 UI。

## S5：输出契约与制作结果（二轮修正 2026-09-16 第五批）

状态：已完成（2026-09-16）。依据二轮修正方案 §10 S5 与 §7；基线 ab3293c。对应反馈 7、14。

改动：

1. **输出模块卡**（右栏 advanced 模块，默认关=设置·文件与输出默认策略）：工程输出目录（文件夹选择）+工程文件名+.mosp 预览+「导出原文 SRT」开关（SRT 字段自媒体卡迁入，关闭时禁用）+「导出译文 SRT」开关（仅翻译启用时显示）+默认策略深链；媒体卡不再有 SRT 输出字段（§6.2）。
2. **后端**：normalize_plan 保留 exportSrt/exportTranslatedSrt/outputDirectory/outputStem（缺省 True/空）；_publish_final 四组合独立发布（不导出即不落盘）、自定义目录/主名、碰撞保护覆盖所有组合；PipelineResult.srt_path 放宽 Optional。
3. **方案携带**：plan.output 与后处理方案（getAutoPostprocessPayload）同字段——转录链自动后处理同样消费。
4. **页脚**：主按钮「制作工程」靠右（spacer 前移）；批量「批量制作工程」；停止→取消。
5. **打开工程**：完成后主按钮右侧出现，绑定该次任务产物（waveform/prefab 的 projectPath、转录 done 的 jsonPath），点击=设目标+回首页+启动编辑器；运行中/失败/取消隐藏（不冒充上一轮）。

验证（2026-09-16）：

- 探针 10/10；e2e launcher 83/83（upgrade-bc/interactions 输出字段用例适配）；pipeline 30 项 OK（新增导出开关四组合+自定义目录单测）；test_gui_web 251 OK（新增 S5 契约）；全量 discover 1612 OK（skipped=63）；ruff 全绿。
- 过程修复：全局 choose_folder mock 劫持运行时目录选择（改 bridgeOverride 拦截验证）；PipelineResult 字段顺序变动破坏位置实参（恢复原序仅放宽类型）。

未验证（如实记录）：模块头参数摘要（结构预留，随 S6）；批量每输入预览 UI（防碰撞已有）；真实多步链路的翻译前原文语义（代码序保证，S6 原生验证）。

## S4：独立模块、波形、口播对齐和可选日志（二轮修正 2026-09-16 第四批）

状态：已完成（2026-09-16）。依据二轮修正方案 §10 S4 与 §6/§3.3；基线 9c65c52。对应反馈 6、8、9、13 与 ASR 波形开关遗漏（实施前复核属实）。

改动：

1. §3.3 修复：`_request_from_payload` 解析 `generateWaveform`（缺省 True 兼容）；`formPayload` 从模块注册表读波形开关（单文件/批量 ASR 共用），波形关→频谱门控；已有工程/批量工程链路此前已消费方案。
2. 波形独立卡：频谱开关自 ASR 表单迁入 + 缓存策略说明 + 源音轨状态行；不提供后端未支持的生成模式 UI（记未验证）。
3. 后处理六模块独立卡（data-module-card）：启用复选框与配置字段同卡（自抽屉原样迁入 ID 不变）；LLM 三卡各一按操作持久化的提示词框 + 共用服务摘要（连接配置在设置·服务与连接，postprocessProvider 随迁同步）；翻译卡含目标语言/合并双语/保留中间产物；旧总开关与步骤手风琴删除（enabled=任一步骤勾选）；批量只锁文稿匹配。
4. 口播对齐卡：去省略号 + 需人工徽标 + 一句说明；「打开对齐工作台」直达实用工具页同一面板；「选择对齐结果工程…」接回结果；默认不自动执行。
5. 处理日志：右栏复选框默认关+记忆；开启后为最后一张卡、首次默认折叠；进度条+最新反馈迁页脚任务区（footer-task-strip）；三执行路径不强制滚动日志；LLM 流式输出随日志卡。
6. 工具箱抽屉整体移除（面板/输入链/产物链/右键菜单/缩放把手/手动运行）；openAutoStep 打回=展开对应模块卡+定位字段；预检失败逐卡展开。
7. 模块头参数摘要未做（结构已预留，随 S5 输出卡补齐——记入 S5 待办）。

验证（2026-09-16）：

- 探针 11/11（含 ASR 载荷 generateWaveform:false/true 双向、六卡配置在卡内、折叠不断模块、日志末尾编号+默认折叠+页脚进度、对齐直达、预检逐卡展开）；启动 3/3 零错误。
- e2e launcher 11 spec 共 83 项全部通过（删 7 项抽屉/产物链/缩放用例；6 spec 按独立卡重写）。
- 单元/契约 test_gui_web 250 OK（新增 S4 契约与波形开关解析单测；11 个抽屉时代契约重写/删除）；全量 discover 1609 OK（skipped=63）；ruff 全绿；截图×3。
- 过程修复：抽屉删除牵出 5 处启动即崩悬空引用（init 栈日志定位）；批量锁卡列表更新；OCR/固定处理卡补回分组标题；手术 A 正则误删常量区（git 恢复）；heredoc 反斜杠再损 launcher.js（改 Write 工具）。

未验证（如实记录）：波形生成模式 UI（后端无参数，不臆造）；模块头摘要（随 S5）；批量 ASR 波形开关未单独 e2e（settings 派生自同一 formPayload）；真实对齐产物回流（S6 原生验证）。

## S3：完整工程目录及删除（二轮修正 2026-09-16 第三批）

状态：已完成（2026-09-16）。依据二轮修正方案 §10 S3 与 §5；基线 1c4c8d6。对应反馈 3、5（封面角落图钉收尾）。

改动：

1. **长期登记层**（launcher_projects.py）：`launcher-project-registry.json` 与最近视图分离；统一身份（resolve + Windows normcase 归一去重、保留可读路径）；来源（created/opened/editor/migration）与登记/更新时间；文件锁（O_EXCL 独占+陈旧抢占）+ 临时文件原子替换，跨进程（启动器/编辑器 Server）并发安全；首次从最近合并视图一次性迁移。
2. **统一登记入口**：启动器制作（媒体/波形两处成功返回、预制方案完成、批量共路径）、启动器打开（健康检查通过后）成功登记；编辑器 serve.py 四个 remember_project 调用点经 `_register_launcher_project` 登记（失败仅日志不阻断）；重复登记只刷新更新时间；重定位联动迁移登记条目。
3. **首页双折叠分组**（project-home.js 重写）：最近（约 6 条起步+更多）与全部（更新时间降序分页）两组，独立折叠+记忆+折叠底部显示将打开目标；同工程双卡：选择/图钉/封面/统计/媒体名按路径多节点回写；搜索匹配名/媒体/路径，计数区分总数与命中。
4. **图钉封面角落**：右上角半透明底衬小图钉（aria-label「已固定」），与选中描边互不兼任。
5. **删除工程文件**：全部组红色危险项（Lucide 垃圾桶）→ 确认框（名称/路径/范围）→ SHFileOperationW+ALLOWUNDO 入回收站（非 Windows 需 send2trash，否则明确失败不永久删除）；后缀约束、受管会话占用拒绝（project_in_use）、成功清登记+最近、缺失清失效记录不动同名媒体、失败保留记录；三种移除语义（从最近记录移除/从全部工程记录移除/删除工程文件）文案与提示严格区分。
6. 桥接：get_all_projects（query+计数）/remove_registry_project/delete_project_file；relocate 带 registry；演示 mock 同步（含最近视图之外的登记项）。

验证（2026-09-16）：

- 单元：test_launcher_projects 25 项 OK（登记去重/大小写归一/排序过滤/一次性迁移/移除登记不动最近/重定位联动/12 线程并发全保留/回收成功清两组且媒体与 .assets 原样/回收失败保留/缺失清理/后缀拒绝/SHFileOperation 标志）。
- e2e：launcher 11 spec 共 90 项全部通过（home 新增 3 项 S3 用例：全部组超最近上限可见+双卡同步+图钉角落；删除确认/取消/回收+反馈/语义分离；双组折叠+记忆+搜索计数；既有用例适配双组）。
- 契约：test_gui_web 253 项 OK，新增 test_launcher_s3_project_directory_contracts。探针 15/15；全量 discover 1612 项 OK（skipped=63）；ruff 全绿；截图×3（危险项红色像素核验）。
- 过程修复：Playwright scrollIntoView 平滑滚动尾波触发「滚动关菜单」（行为符合 §3.1，测试改为预滚动稳定后右键）；演示 mock 媒体名懒惰派生导致搜索误命中（改为按路径派生）；heredoc 反斜杠再次损坏 launcher_projects.py（git checkout 恢复后改用 Write 补丁脚本）。

未验证（如实记录）：

- 真实 Windows 回收站端到端（真调 SHFileOperationW 后从回收站还原）：单测以桩断言标志与目标，留待原生窗口人工验证。
- 两进程同时写注册表的真机跨进程实测（同进程 12 线程并发已覆盖锁语义）。
- 外部自启编辑器（非启动器受管）正在编辑时删除防护：启动器无法感知外部进程，回收会成功、编辑器后续保存会重建文件——已知边界，S6 评估。

## S2：工具与设置的页面内迁移（二轮修正 2026-09-16 第二批）

状态：已完成（2026-09-16）。依据二轮修正方案 §10 S2 与 §4；基线 b203197。对应反馈 1、2；实施前复核属实（工具页为入口卡片弹旧抽屉、设置为上方横排标签）。

改动：

1. **公共右侧分类框架（§4.1）**：`.tools-wrap`/`.settings-wrap`（左 main + 右 248px 栏）与预制栏同底色/分组标题/行距；单选导航活动描边（`.rail-select`/`.settings-tab`，区别于预制多选复选）；≤1100px 三页右栏统一右侧抽屉（复用 body.rail-open/#railBackdrop/Esc/页头切换按钮）。
2. **四工具页内迁移（反馈1）**：提取音频/压制字幕/媒体重组/口播对齐面板（含共享媒体输入与全部字段）原样迁入实用工具页——ID 不变、postprocess.js 绑定不动、零克隆；页内运行区（#toolsRunArea）承载动作槽+取消+进度+结果；切换只改可见性（草稿天然保留）、上次工具记忆。
3. **进度/结果双目标**：setResult/setBusy 写 `#toolsPageResult`/`#toolsPageProgress` 与抽屉容器两份——文件工具页内运行、后处理抽屉运行，各自页面只见本页结果；运行中切页取消入口不丢。
4. **设置六分组（反馈2/§4.3）**：外观与语言 / 文件与输出 / 服务与连接 / 处理默认值 / 运行环境 / 缓存与诊断（通用组拆分重排；「编辑器启动」组因暂无内容按「不臆造」原则未设）；深链锚点原样保留并经 closest 自动映射；分组记忆持久化。
5. **旧工具箱收口**：删主分组页签/实用工具视图/页脚实用工具槽——抽屉仅剩后处理四工具供 auto-config 引导（S4 后整体移除）；**波形生成工具删除**（R5 后无入口的孤儿 UI，频谱开关与波形桥接由预制执行链继续承载）；相关 i18n/样式（tools-grid/tool-card/settings-tabs/settings-modal-card/toolbox-primary 等）清理。
6. 新增 `web/launcher/tools.js`（单选/记忆/窄窗抽屉/键盘导航小模块）。

验证（2026-09-16）：

- 探针 19/19：单选四项无复选、草稿保留、动作槽随工具、**提取音频页内真跑通**（桥接调用+结果在本页+抽屉全程未开）、工具记忆、六分组/深链/记忆、抽屉仅后处理、窄窗抽屉+Esc、无 JS 错误。
- e2e 87/87（launcher 11 spec）：shell 工具/设置右栏用例重写；interactions 设置标签用例按六分组重写；upgrade-bc 布局矩阵改测工具页右栏（80/100/150% × 1280×800/800×600）+分组记忆；layout-feedback OCR 分组定位更新。
- 单元 252 项 OK（全量 discover 见本批提交记录）：新增 `test_launcher_s2_tools_settings_rail_contracts`；波形移除/抽屉收口/R5 工具契约按当前真值重写。
- 截图 s2-tools-page/s2-tools-alignment/s2-settings-rail（暗色）右栏内容像素核验。
- 过程修复：设置重组时旧通用面板闭合标签残留导致设置页提前闭合、四面板外泄为 page-host 子节点——由页脚钉扎探针定位后修正；单行子串匹配陷阱（stopToolboxMedia 迁移错侧）已对调修正。

未验证（如实记录）：

- 压制字幕/媒体重组/口播对齐未做页内真跑（桥接与运行路径与提取音频共用同一运行区与 setBusy/setResult 链路，提取音频已验证该链路；三者的字段校验与 mock 桥接由既有单测/契约覆盖）。原生 WebView 未复核（延续上批环境异常记录）。

## S1：交互可靠性与基础视觉（二轮修正 2026-09-16 第一批）

状态：已完成（2026-09-16）。依据用户《启动器第二轮修正与完善方案》（仓库外 PLAN_LAUNCHER_REFINEMENT_20260916.md）第 10 节 S1；基线 8d0b656。对应反馈 4/5/10/11/12 与新增 Esc 问题；根因指控 §3.1/§3.2 实施前逐项复核属实（监听泄漏的 1、0、0 序列与隐藏文字占位导致图标中心 17.5px 均在源码与探针中复现）。

改动：

1. **右键菜单生命周期重写（project-home.js）**：单一实例（el/path/opener）；document 捕获阶段常驻监听——contextmenu 先关旧菜单、网格处理器随后按新目标开新菜单（替换语义，不再依赖 `setTimeout` 延迟注册 `{once:true}` dismiss，根除泄漏监听误杀新菜单）；click 外部/Esc/Tab/方向键/Home/End（捕获层，右键不移动焦点也能 Esc）、窗口失焦、任意滚动（capture）、切页（mswnavigation）、visibilitychange、网格重建统一关闭；Esc 归还焦点；Shift+F10/Menu 键唤起（按卡片定位）并聚焦首项、方向键循环；视口内收敛定位；菜单首项补「打开工程」；菜单自身上再次右键仅关闭不重开（系统菜单语义，解除对下层卡片的遮挡）。
2. **图钉 SVG（反馈5）**：`recent-pin` 由「已固定」文字改为 Lucide pin 内联 SVG（ISC 标注），aria-label/title 保留「已固定」；位置维持卡片右下角（封面角落迁移随 S3）。
3. **导航图标固定槽位（反馈11/§3.2）**：`.nav-item` 常态 `flex-start + padding-left 14.5px`（8+14.5+9.5=中心 32px），删除 hover 态 padding/justify 切换规则——折叠/展开图标横坐标一致；折叠态「MSW」底标居中；settings-dot 锚定图标槽右缘（left:34px）双态同栅格；`prefers-reduced-motion` 覆盖导航动效。
4. **模块头（反馈12）**：`ensureCardHead` 顺序改「箭头 → 序号 → 标题」，箭头 28px 命中区左置；整头空白区可点折叠（头部内按钮/链接/表单控件排除）；悬浮只点亮箭头不加底色（删除 `:hover` 背景）。
5. **闲置「就绪」移除（反馈10）**：`#status` 改 `role="status" aria-live="polite"` 瞬时反馈区 + `:empty` 整块收起；`setRunning(false)`/stopEditorServer/checkExistingServer/startEditorServer 回退/init 六处不再写闲置文案；`ready` i18n 键删除（中英）。有效反馈去向不变（进度条/字段错误/保存瞬时反馈/首页会话区），完整任务区独立随 S4。

验证（2026-09-16）：

- 探针 18/18：同卡 10 次＋跨卡 10 次连续右键菜单恒为 1（旧实现 1、0、0…）；5 项菜单动作含打开工程；Esc 归还焦点；菜单上右键关闭；点击外部/滚动（真实容器事件）/切页关闭；Shift+F10 键盘链；900×600 菜单收敛视口内；图标中心折叠/展开均 32.0px、pageHost 恒 64px（无回流）；MSW 底标居中 31.5px；图钉 SVG＋aria-label；闲置状态 `display:none`＋`role=status`；模块头顺序/28px/整头折叠；无 JS 错误。
- e2e 86/86（launcher-home/-interactions/-structure/-modules/-shell/-zoom/-upgrade-bc/-workflow/beta3-launcher/branding/layout-feedback）：新增 S1 用例 4 项（20 次右键替换、导航固定槽位、模块头、图钉＋闲置状态），菜单动作断言更新，运行错误用例闲置态断言翻转。
- 单元/契约：全量 discover 1598 项 OK（skipped=63）；新增 `test_launcher_s1_interaction_contracts`。
- 像素核验（视觉 MCP 本轮对截图 URL 解析失败，改用可复现像素断言、暗色主题钉定）：折叠/展开态图标描边像素完全一致（146px、重心 32.2px）、折叠栏内文字像素 0、展开态标签可见。

未验证（如实记录）：

- 100%/125%/150% 系统 DPI 下的菜单定位：菜单定位基于 CSS 像素（clientX/Y 对 innerWidth），缩放语义同尺度；headless 以 900×600 窄视口覆盖收敛逻辑，真实多 DPI 显示器留待原生窗口复核。
- 原生 WebView（pywebview/WebView2）内的菜单交互：上一批复核环境异常（Edge InPrivate 壳）未重试；本批菜单/导航改动均为标准 DOM 事件，风险低，留待下次原生窗口打开时人工确认。

## D8：启动器细节完善批（用户六项反馈）

状态：已完成（2026-09-16）。R6 之后用户提出的六项细节修正；基线 82da3a6。

改动：

1. **版本号移位（反馈1）**：移除标题后的 `brand-version` 徽标；版本进导航底栏——折叠态只显示「MSW」，展开态显示「MSW：v1.6.0-beta.3」（`#appVersion` 移入 `nav-footer-full`，报告页版本提取改用正则从复合文本中取 `v…` 段）。
2. **图标更换为 Lucide（反馈2）**：五个导航项与最近工程占位图标全部换为 Lucide（ISC License，https://lucide.dev）内联 SVG——home、list-checks、wrench（标准开口扳手）、book-open、settings（齿形均匀的长齿轮）＋circle；封面占位 music/clapperboard/file-warning。stroke=currentColor、宽 1.6 与全局风格统一，源码注释标注来源与许可。
3. **更多设置底部遮挡（反馈3）**：根因是滚动渐隐 mask 的 `animation-timeline: scroll(self)` 在内容不足一屏时 progress 恒为 0，底部 18px 渐隐常驻压住末行——设置页与工具箱同款一并修复（`--settings-bottom-fade`/`--toolbox-bottom-fade` 置 0px），设置滚动区补 `padding-block-end: 22px`。
4. **删除右上角设置按钮（反馈4）**：`settingsButton` 及其红点、绑定、样式、i18n 全量移除；红点 `settingsDot` 移入左侧导航设置项内（`refreshFfmpeg` 逻辑不变）。原「右上按钮」进入路径统一走左导航（`mswnavigation` 事件 + `enteringSettings` 防递归标志，深链 openSettings 拆出 `enterSettings` 完整例程——含偏好控件同步，避免 upgrade-bc 断言失效）。
5. **删除设置页返回按钮（反馈5）**：`settingsClose` 移除；返回路径为左导航切换或 Esc（保留 Esc 监听）。
6. **导航默认折叠（反馈6）**：`.app-nav` 固定 64px，`.app-nav-inner` 绝对定位覆盖层展开至 200px（不推挤正文，pageHost 恒 64px）；`:hover` 与 `:has(:focus-visible)` 展开——**特意不用 `:focus-within`**（点击聚焦会把 200px 展开层常驻钉住、覆盖左缘控件，实测拦截 `#outputSubfolder` 点击；键盘焦点才钉住是可达性要求）。标签 opacity 过渡、导航项对齐与 footer 双态随之切换。

验证（2026-09-16）：

- 契约：`test_gui_web` 新增 `test_launcher_detail_round_contracts`（nav-footer 双态、无 settingsButton/settingsClose/brand-version、64px/200px 折叠规则、hover+focus-visible 选择器、Lucide/ISC 标注、wrench path、渐隐 0px、padding 22px、navigation.js 无 nav-compact 残留），250 项 OK。
- e2e：11 个 spec 共 82 项全部通过——设置入口改 `[data-nav-page="settings"]`（点击后 `mouse.move(600,400)` 移开悬停让覆盖层收起）、返回改 Esc、layout-feedback 两用例按当前 DOM 真值重写（旧断言自 R1/R2 起已过期）。
- 探针：折叠 64px / 悬停展开 200px / 正文不回流 / footer 双态 / 标签过渡 / mask 底部 100% 不透明 / padding 22px / Esc 返回原页 / 导航进设置无 JS 错误——逐项通过。
- 截图：`build/d1-nav-collapsed.png`、`d2-nav-expanded.png`、`d3-settings-bottom.png`——视觉核验通过（扳手呈标准开口扳手造型、齿轮齿形均匀、底行完整可见）。

未验证（如实记录）：

- 细节批复核时重启 `maw_gui.py` 两次，窗口均以 Edge InPrivate 浏览器壳形态呈现（a11y 树含标签页栏/新建标签页/协作者头像），无法进行元素级复核；进程 stdout 为空，未能定位（疑 WebView2 运行时环境残留或 pywebview 回退系统浏览器）。本批视觉验证以 Playwright 截图（同一 Chromium 渲染内核）+ 视觉模型覆盖；原生窗口导航/主题/语言/输入链路在 R6 已实测通过，不因本批 DOM 调整失效（改动均为前端静态资源，加载路径不变）。后续人工开窗一次即可确认。

## R6：原生窗口与生产场景验收（修正案第七批·终批）

状态：已完成（2026-09-15）。对应审查 R6 全部条目；基线 08cc88c。

改动：

1. **真实媒体验收基础设施**：便携 FFmpeg 9.0.1（gyan essentials）解压至 `build/ffmpeg-bin`（gitignored，不随仓库分发、不改系统 PATH、不写用户 .env）；测试经各自临时 env 文件的 `FFMPEG_PATH` 指向它。
2. **真实媒体测试（`tests/test_launcher_r6_real.py` 8 项，无 FFmpeg 时整组显式跳过并说明原因）**：合成媒体（testsrc2 横屏/竖屏/1.2 秒短片/近全黑/纯音频/30 秒长片）真实跑通——封面状态机（image/audio/近黑回退、JPEG data URI、版本化缓存文件复用）；波形工程（`.waveform.mosp` + `.quapeaks` 侧车真实生成）与纯媒体工程（无波形键、无 reapeaks）；取消链（预置 cancel_event 贯穿真实提取调用返回 cancelled）；复杂工程（F12 夹具）再处理产物经 `server_editor.load_project` 真实加载。
3. **环境状态机**：全新环境启动（空配置 get_config/get_recent_projects 空态，编辑器索引用桩隔离）；缺依赖（无 FFmpeg 时封面返回 failed +「FFmpeg 不可用」，不启动提取）；旧配置升级 e2e（存储 asr=true/waveform=false 保持用户选择，未存模块按新默认补齐）。
4. **pywebview 原生窗口实测（Windows 真机，WebView2）**：以 `maw_gui.py` 启动真实后端窗口（FFMPEG_PATH 指向便携版）——五页导航、预制页新默认（处理顺序「媒体 → 波形」、ASR 默认未勾选、模块栏完整）、设置四分组与主题三选、明暗切换（亮色截图核验通过后切回）、语言中英互切（整页文案翻转、搜索值与过滤保留）、中文输入（「东方」入搜索框）、搜索过滤（Touhou→1 个）与无匹配空态、右键上下文菜单（四项操作）与「从最近记录移除」实际生效；真实用户数据验证——真实最近工程（5 个）、**真实视频封面**（UE5 工程卡片显示真实画面）、媒体名/统计/时间语义、高级折叠区。清理：早期测试轮残留的 5 个 Temp 失效工程记录（1 个经 UI 菜单移除、4 个经同一后端调用清除）。
5. **文档同步**：CHANGELOG `[Unreleased]` 增补修正案三条目（真实视频封面／方案驱动执行／R0–R6 修正案汇总）；账本 R0–R6 七个专节完整。
6. **仓库检查**：`ruff check` 全绿；`git diff --check` 干净；UTF-8/LF 保持。

验证（2026-09-15）：

- 单元/契约：全量 1596 项 OK（skipped=63；含 R6 真实媒体 8 项——本机 FFmpeg 就位时全部真实执行）。
- e2e：启动器 9 个 spec 共 75 项全部通过（R6 新增旧配置升级保留 1 项）。
- 修复：R3 的时间合并测试为时间炸弹（固定「今天 09:30」在 UTC 时钟越过该时刻后失效）——改为 2020/2099 极值边界，与真实时钟无关。
- 原生窗口：见上——渲染/导航/主题/语言/中文输入/搜索/右键菜单/移除/真实封面全部实测通过。

发布门槛核对（审查 R6）：

| 门槛 | 结论 |
| --- | --- |
| P0/P1 全部闭环 | F01–F12（P1 含 F10/F12）与 H01–H03、V01–V04 均已修复并有测试；F13（P2）一并闭环 |
| 明暗主题与主要分辨率无错位 | 暗色默认 + 亮色切换（e2e + 原生实测）；1200×780、1280×800@80–150% 缩放（upgrade-bc 六项）、960×640 紧凑（structure e2e）无错位 |
| 真实媒体零字幕工程链 | ✅ 真实 FFmpeg 波形工程/纯媒体工程 + 取消（R6 真实媒体测试） |
| 已有复杂工程再处理链 | ✅ F12 夹具全链 + 产物被编辑器真实加载 |
| 独立会话链 | ✅ R0 多会话隔离/同端口替换/按 URL 停止 + 冲突三步确认 e2e |
| 未完成项列为扩展 | TTS/素材预制在指南中明示「后续扩展阶段」，未混入完成声明 |

未验证（如实记录，不用模拟结果代替）：

- 云端 ASR/LLM 真实服务调用（需明确测试样本与现有授权；本轮无真实密钥授权，全部以契约/替身覆盖，未冒充真实验收）。
- 原生「文件选择」对话框与媒体拖入（原生交互受自动化会话焦点争用限制：导航/输入/菜单已实测，文件选择与拖入列入人工复核清单）。
- 便携版（PyInstaller/MSW.spec）打包产物构建未执行（发布时按仓库流程构建验收）。
- 真实长视频（>分钟级）波形的取消时序与批量波形耗时分布（取消链已验证，长媒体端到端耗时留待实际使用观察）。

## R5：工具、设置与指南收口（修正案第六批）

状态：已完成（2026-09-15）。对应审查 F13 与 §5.3；基线 f7331f0。

改动：

1. **工具页收口（F13.1/§5.3）**：移除「文稿与字幕处理」「生成波形」两张工具卡（回归预制模块编排，配置入口在预制模块行内）；实用工具保留四项独立文件操作——提取音频、压制字幕、媒体重组、口播对齐（人工处理入口）；副标题说明独立性与去向；清理四个孤儿 i18n 键（中英）。工具箱抽屉的后处理/实用工具页签保留，作为预制模块配置与独立工具的上下文承载（R2 已移除全局 FAB）。
2. **语言切换只存语言（§5.3）**：`langToggle` 原先 `save_settings(formPayload())` 会把整个识别表单（含密钥、区域、模型）从未确认的界面状态写入环境——改为 `save_prefs {guiLang}`；后端 `save_prefs` 新增 `MAW_GUI_LANG` 写入（`_gui_lang` 同一解析），显式「保存设置」按钮仍走全量 `save_settings`（用户主动语义）。
3. **设置往返保留草稿（§5.3）**：设置为页面框架成员（R1），关闭经 `navigation.back()` 返回原页；页面 DOM 仅隐藏不销毁——草稿与滚动位置天然保留，本轮以 e2e 固化契约（媒体路径/密钥草稿 + scrollTop 180 往返不变）。
4. **指南文案（F13.4）**：中英文案去掉「Server 版」实现术语；「直接进编辑器」路径改为与实际首页按钮一致（选最近工程点「打开所选工程」或「启动空白编辑器」）；「提前预制工程」步骤说明新默认（仅媒体＋波形）与「生成字幕和工程」按钮名；文档/仓库链接保留。
5. **缓存与诊断（§5.3 组7 + R3 顺延项）**：设置「运行环境」分组新增「缓存与诊断」小节——「清理最近工程封面缓存」按钮（`clear_thumbnail_cache` 桥接），带删除数量反馈并刷新首页（封面按需重新生成）。
6. **api_key_missing 文案**：原指向不存在的「更多设置 → 服务与连接」分组——改为如实说明（密钥在识别卡填写、只存本机连接配置），中英同步。

验证（2026-09-15）：

- 单元：`test_gui_web` +2——`save_prefs {guiLang}` 只写 MAW_GUI_LANG 不动连接键（既有密钥保留断言）；R5 契约（四工具卡/语言只存语言/缓存入口/指南文案）。全量 1588 项 OK（skipped=63）。
- e2e：新增 `launcher-shell.spec.mjs` 5 项——工具页恰四卡且入口定位抽屉对应工具、语言切换仅一次 `save_prefs{guiLang}` 载荷（双向）、设置往返草稿与滚动保留、封面缓存清理反馈（已清理 3 个 + 调用计数）、指南无「Server 版」且按钮跳转正确；1 处英译断言随文案更新。启动器 9 个 spec 共 73 项全部通过。
- 截图：`build/r5-tools-dark.png`（四卡 + 副标题去向说明）、`r5-settings-cache-dark.png`（缓存与诊断小节在运行环境分组内）——视觉核验通过。

未验证（顺延）：

- §5.3 建议的七组设置分栏重组（现有四分组已覆盖连接/参数/运行环境；「默认处理参数与当前方案区分」「文件与输出」组随后续方案参数化需要再拆分，避免本轮无收益搬动）。
- 工具箱 LLM 面板内联连接配置与设置的分工细化（两处写同一 env 契约、单一真源已成立；界面合并随 R6 实测反馈决定）。

## R4：方案驱动的执行流程对齐（修正案第五批）

状态：已完成（2026-09-15）。对应审查 F04–F12 与 §7；基线 9cf7347。

改动：

1. **方案单一来源（§7.1，新 `web/launcher/plan.js`）**：`MSWPlan.build()` 从唯一真源（模块注册表 + 表单控件）构建带版本号（version:1）的冻结方案对象——输入模式与输入引用、模块开关集合、后处理方案引用、输出选项；密钥只存连接配置，方案不含密钥（LLM 设置经 `snapshot_postprocess_llm_settings` 从环境读取）。执行顺序摘要（`renderOrderChip`）、开始前预检（`preflight`）、单文件执行与批量执行全部从同一方案生成；不再另立第三份持久化（模块开关仍由 `MSW_LAUNCHER_MODULES_V1` 唯一持有）。
2. **F09 新默认**：`modules.js` 全新方案默认「仅媒体＋波形」，识别按需开启；旧配置迁移——存储里已保存开关的用户保持原值（load 逐项保留），未存储过的旧环境按新默认呈现。依赖默认 ASR 开的 6 处 e2e 显式启用后继续验证转录管线。
3. **F11 待配置态**：`postprocess.js` 未就绪步骤不再打回取消勾选/自动跳转——保留选中并标记「待配置」（needs-config 行状态），配置在本模块补齐，开始前由方案预检统一校验；`modules.js` 打回（rejected）语义自然消失，双来源清理（`postprocessModulesEnabled` 移除）。
4. **三类输入执行链（F05/F06）**：后端新增 `run_prefab_plan`/`cancel_prefab_plan`——输入按扩展名分流：`.mosp/.json` 工程处理（媒体从工程实际引用解析）、`.srt/.ass` 字幕处理（经生产 I/O 包一层零媒体工程适配器，`read_srt` → `write_mosp` 临时目录，不污染源目录；使翻译副轨等每一步都有源工程可读写）；预检覆盖输入类型/路径/步骤为空/OCR 需视频（SRT 输入明确报缺媒体）；复用转录链同一条 `run_postprocess_pipeline` 与事件通道，失败保留 `postprocess_retry_context`（「从失败步骤重试后处理」可用），任务事件 `prefabTask`（running/completed/cancelled/failed），与转录/波形/批量任务互不影响。前端 `runPrefabPlan` 完成后产物成为当前目标。
5. **F07 批量共用方案**：`batch.js` 从 `MSWPlan.build()` 取冻结方案——识别开走既有 `start_batch_transcription`（含 autoPostprocess）；识别关走新 `start_batch_projects`（逐项 `_generate_media_project_sync`，波形开关/频谱选项来自方案，逐项 `unique_output_path` 防碰撞，事件与转录批量同形，失败不冒充整批成功）；工程/字幕输入模式批量明确报错（`batch_media_only`）；移除 R0 的 `batch_requires_asr` 硬拦截。
6. **F10 对齐独立入口**：对齐为人工交互步骤不进自动执行链——执行摘要显示「口播对齐（人工）」（`chip_alignment_manual`），配置经工具箱对齐入口。
7. **F12 复杂工程保真（§7.3）**：`run_prefab_plan` 全链经生产读取/迁移/写入（`read_project`→`run_postprocess_pipeline`→`write_mosp`），不重建简化对象；测试夹具通过生产校验器（`msw.editor.v1` schema、合法音频资产/TTS generation/source_ref、字幕资产批次绑定、音轨增益/静音、多轨绑定 one-to-one）并额外携带未知扩展字段。
8. **杂项**：`startBlankEditor` 等清目标路径统一经 `setJsonPath`（R3 遗留一致性）；mock 增加工程链/批量工程/多选文件三个注入点（`__prefabPlanRuns`/`__batchPlanRuns` 计数器）；`batch.js` 暴露只读 `MSWBatch.state` 供逐项结果观察。

验证（2026-09-15）：

- 单元：新增 `tests/test_launcher_r4.py` 11 项——预检矩阵（缺输入/不支持扩展/无步骤/SRT+OCR 缺媒体/坏工程）、复杂工程保真（素材/贴片/TTS 配方/音轨/多轨绑定/选区/未知扩展全量保留 + 主轨按方案处理且 ID/时间稳定）、翻译默认独立副轨（既有副轨与素材保留、新轨绑定主轨、主轨不被双语覆盖）、SRT 输入链、任务唯一性与取消上报、失败保留重试上下文、批量冻结方案逐项执行（波形开关传递/部分失败不冒充成功/坏条目预检）。
- 契约：`test_gui_web` 新增 R4 契约（plan.js 加载与单一来源、F09 默认值、三类输入分派与任务事件、F11 保留勾选、批量共用方案、后端三个入口与 SRT 适配器）；1 处旧「打回跳转」契约更新为 F11 待配置契约。
- e2e：`launcher-workflow` 重写工程输入链（无步骤预检 → 启用翻译 → `run_prefab_plan` 载荷断言（version/inputMode/模块集合/不含密钥）→ 产物成为目标）、SRT 输入（OCR 缺媒体说明 + 固定处理执行）、批量冻结方案（真实「添加文件」入口两项、`start_batch_projects` 载荷、逐项产物、工程模式批量报错）；`launcher-modules` 断言新默认与 F11（勾选保留 + needs-config + 就绪转换）；6 处依赖默认 ASR 的用例显式启用识别。启动器 8 个 spec 共 68 项全部通过。
- 全量：Python 1586 项 OK（skipped=63）。
- 截图：预制页视觉核验通过——ASR 默认未勾选、摘要「媒体 → 波形」、输入模式切换在位、无重叠溢出。

未验证（顺延）：

- 真实 LLM 服务的翻译副轨全链（单测以替身 `complete_subtitle_groups` 覆盖段数/ID/时间稳定性校验；真实连接在 R6 生产验收）。
- 长媒体批量波形的实际耗时与取消（后端事件/取消链已就绪，真实媒体实测在 R6）。
- 波形任务取消的 reapeaks 中段尽力而为语义（R0 已记账本，未变）。

## R3：最近工程卡片与真实视频封面（修正案第四批）

状态：已完成（2026-09-15）。对应审查 H01–H06；基线 d455586。

改动：

1. **封面服务（H01，`maw/launcher_thumbnails.py` 新增）**：按审查 §6 实现工程媒体解析与后台取帧——复用 `resolve_project_media` 从工程实际 `media` 引用解析（不猜同名、不用启动器输入框路径）；候选帧取时长约 10% 处并夹在 1~5 秒（时长未知回退 0.5/1/2 秒，最多三次），单遍 `ffmpeg -ss … scale=480:270:force_original_aspect_ratio=increase,crop,signalstats` 同时提取并输出 YAVG 亮度，几乎全黑（<16）/全白（>240）自动换下一候选，全不理想时用最后可用帧；缓存存应用数据目录 `cover-cache/`（键 = 媒体规范路径 + 大小 + mtime + 尺寸 + 策略版本，不写 `.mosp`/`.assets`）；同一媒体请求去重（in-flight 任务共享）、`Semaphore(2)` 限并发、失败短期缓存 10 分钟；`clear_cover_cache` 清缓存与失败标记。状态机：image/audio/no_media/media_missing/project_missing/project_broken/failed，纯音频按扩展名或 ffprobe 无视频流判定，封面失败不阻止打开工程。
2. **桥接（H01）**：`gui_web.py` 新增 `get_recent_project_thumbnail`/`refresh_recent_project_thumbnail`（force 绕过磁盘缓存）/`clear_thumbnail_cache`；图片以 480×270 JPEG data URI 经桥接返回，不新增任意本机文件读取接口。
3. **卡片重做（H01/H04 前端，`project-home.js` 重写）**：卡片改纵向布局，顶部 16:9 封面（居中裁切、object-fit cover），下方工程名 + **媒体文件名**（统计/封面载荷带回，不重复读工程）+ 目录 + 元信息；封面按可见区域异步加载（IntersectionObserver，rootMargin 200px，无观察器环境直接加载）；七种状态占位（音频/胶片/破损文档图标 + 状态标签）；选中角标 ✓ 字形改 SVG mask；右键菜单新增「刷新封面」。
4. **选中恢复（H02）**：`createCard` 从唯一选中状态同时恢复 `.selected` 样式与 `aria-pressed`（此前只恢复 aria 是缺陷根源）；选择随 sessionStorage（`MSW_HOME_SELECTED_PATH`）在刷新后恢复，工程消失时清除。
5. **搜索清选（H03）**：筛选隐藏当前目标时清除选择并连表单目标一并清空，隐藏工程不再可能成为启动目标；启动区常显「当前目标」徽标（`#homeTarget`）。
6. **目标统一与端口收起（H04）**：卡片选择 ⇄ `jsonPath` 双向互通（`onProjectPathChanged` 链式挂接；`startBlankEditor` 改经 `setJsonPath("")` 清目标）；首页保留三个清晰操作「打开所选工程（主按钮）/启动空白编辑器/浏览工程…」+ 目标徽标；工程文件/服务器媒体/端口大表单收进默认折叠的「高级：直接指定工程与端口」（`#serverCard` + `#serverToggle`，错误路径仍自动展开）；Server 版编辑器入口（openMawe 分流 + HTML 编辑器菜单）随高级区收纳，ID 与绑定保持不变。
7. **缓存与防抖（H05）**：统计按工程文件版本（modifiedAt）缓存 + 请求去重；封面按路径缓存 + 前端失败 60 秒不重发；搜索输入 200ms 防抖；异步响应只按路径回写当前 DOM 节点，过期响应不写回新卡片（重渲染后旧节点不存在即丢弃）。
8. **时间语义（H06）**：`serve.py` `RecentProject` 增加 `openedAt`（`remember_project` 仅在加载/接管/另存成功路径打戳，序列化往返保留）；启动器合并视图 `lastOpenedAt` 取编辑器记录与启动器记录较新者；启动器侧 `note_project_opened` 维持 R0 语义（服务器健康检查通过后）；波形/媒体工程生成成功即设为当前目标（徽标 + 主按钮指向，尚未打开不进最近列表）。

验证（2026-09-15）：

- 单元：新增 `tests/test_launcher_thumbnails.py` 16 项（候选时间点/亮度判定/缓存键跟踪/七种状态/黑帧换帧/失败短期缓存与 force 重试/并发去重（阻塞式两线程确定性验证）/清缓存/工程只读）；`test_launcher_projects` +2（时间取新、统计带媒体名）；`test_local_editor_server` +1（openedAt 往返）。
- 契约：`test_gui_web` 新增 R3 契约（收起表单/三操作/目标徽标/封面状态机/sessionStorage 恢复/缓存与防抖/三个桥接方法）；2 处设置序列化断言按 openedAt 新契约更新。
- e2e：`launcher-home.spec.mjs` 重写为 9 项（两张不同视频不同画面 + 占位、统计/封面缓存去重（请求计数断言）、刷新后选中恢复（样式+aria）、搜索隐藏目标清选清表单、双击打开与空白启动清目标、浏览设目标 + 端口表单默认收起/可展开、缺失工程重定位、右键菜单含刷新封面、会话冲突三步确认）；`launcher-interactions` 1 处按折叠区先展开。启动器 8 个 spec 共 68 项全部通过。
- 全量：Python 1574 项 OK（skipped=63）。
- 截图：`build/r3-home-selected-dark.png`、`r3-home-advanced-dark.png`、`r2-home-*.png`（重拍）——视觉核验通过：两张封面颜色可区分、选中描边 + 对勾角标 + 目标徽标联动、高级区折叠一行/展开完整（工程文件/媒体/端口/Server 入口）、亮色主题同样正常、无重叠溢出无 emoji。
- mock 环境（file:// e2e 与浏览器演示模式）的封面为注入的 SVG data URI；真实 FFmpeg 提取路径由单测的替身 runner 覆盖命令拼接（scale/crop/signalstats/-ss）与亮度回退。

未验证（顺延）：

- 真实视频文件的端到端取帧（含竖屏/短片/中文路径/坏工程的实际 FFmpeg 行为）——R6 生产验收用真实媒体实测（§6.2 验收清单）。
- 「清理封面缓存」的设置页入口（后端方法已就绪，UI 入口随 R5 设置收口一并放置）。
- 统计读取的后端缓存（当前前端版本缓存已避免重复请求；后端按文件版本缓存可再省一次 JSON 解析，收益小顺延）。

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
