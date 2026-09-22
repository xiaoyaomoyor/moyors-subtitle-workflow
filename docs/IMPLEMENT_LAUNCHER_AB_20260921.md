# 启动器 A+B 实施记录

日期：2026-09-21。基线：`de20723` / `my-feature`。

范围：[混合输入与模块配置修缮计划](PLAN_LAUNCHER_INPUT_MODULES_20260921.md) A+B。C–F 的独立功能不提前实施；A+B 所依赖的参数适配、工程数据保留与验收纳入本轮。

| 工作项 | 状态 | 说明 |
| --- | --- | --- |
| A1 统一输入描述、任务及预检 | 已修复 | 新增版本 2 队列与逐任务解析；最终 21 项专用隔离后端测试通过 |
| A2 顺序执行、取消、重试、任务结果 | 已修复 | 顺序执行、任务身份、失败隔离、运行互斥；真实 FFmpeg 处理链通过 |
| B1 拖入区、队列、关联候选、条目详情 | 已修复 | 输入队列、确认关联、多音轨、逐任务来源与草稿恢复；补充关联路径重新探测与结果目录入口 |
| B2 单一模块状态、默认折叠与错误定位 | 已修复 | 删除重复启用行；注册表统一布局与序号，保留参数草稿，只展开首个错误模块 |
| A+B 自动化与浏览器验收 | 已修复 | 312 项后端回归：311 通过、1 平台条件跳过；70 项浏览器用例经修正与定向复核全部通过 |
| 生成产物、变更说明与收尾 | 已修复 | 已更新工作流、CHANGELOG、规划阶段状态；重新生成 blank-editor.html 无变化；UTF-8/LF、JS 语法、diff 检查通过 |

初始工作区只有未跟踪的 `.test-appdata/`、本轮规划与 TTS 规划；保留这些文件。没有既有受跟踪代码改动。

## 验证与阶段记录

- 已核对 AGENTS.md、规划和当前差异。原批量入口拒绝工程/字幕并禁用文稿匹配，新的执行器不能继续继承这个限制。
- 新增 `maw/launcher_queue.py`，保留旧桥接接口作为兼容适配；新界面只提交统一队列方案。
- 发现旧代码接受 ASS 后缀但底层只读 SRT，现补充 ASS 时间/文本导入，并提示不导入样式与绘图。
- 2026-09-21：`tests.test_launcher_queue` 首轮 13 项通过。此前 4 个失败来自夹具使用了字符串颜色，改为生产契约的颜色对象后全部通过。
- 演示页实际打开 3 文件混合队列，确认同名候选、类型显示、无旧模式按钮、波形默认折叠；未采集到 pageerror。截图仅存工作区验收目录，不加入仓库。
- 为避免移除输入模式时丢失旧批量“仅 SRT”能力，提前把该开关移入输出并适配统一队列；原文/译文/双语的完整输出重构仍留 D 阶段。
- 可选便携 HTML 同样移到输出，使用最终处理后的工程；仅 SRT 时不生成 HTML。无关联媒体时明确提示无法生成便携 HTML。
- 后端初轮扩展回归 310 项：运行逻辑通过，11 项旧静态断言依赖已移除的按钮/模式/启用行，已按新契约迁移；字号统一为既有 12px 下限。1 项环境相关跳过最终单列。
- 真实 FFmpeg：临时中文带空格文件名的合成 WAV + 同名 SRT，通过生产解析与处理链生成原生波形、ReaPeaks 波形层、频谱、派生工程、SRT、便携 HTML；逐项检查内容，源字幕保持不变。未使用个人媒体或云端调用。
- 旧版未持久化输入路径/批量条目，没有可迁移的旧文件队列；已保存的模块启用值、后处理参数、提示词和输出偏好沿用既有存储。旧的输入模式/展开记忆不再参与执行。

## 最终验证

1. 后端：`python -m unittest tests.test_launcher_queue tests.test_launcher_r4 tests.test_launcher_batch tests.test_gui_web` 对应 312 项；311 通过、1 跳过。跳过项为非 Windows 文件打开器，在 Windows 上不适用。实际通过同一 unittest suite 的紧凑报告运行器执行，避免静态断言失败时打印完整源码。
2. 浏览器：`node node_modules/@playwright/test/cli.js test tests/e2e/launcher-queue.spec.mjs tests/e2e/launcher-workflow.spec.mjs tests/e2e/launcher-interactions.spec.mjs tests/e2e/launcher-modules.spec.mjs tests/e2e/launcher-shell.spec.mjs tests/e2e/launcher-upgrade-bc.spec.mjs tests/e2e/launcher-zoom.spec.mjs tests/e2e/beta4-launcher.spec.mjs --project=chromium --reporter=line`。70 项首轮 68 通过；新增用例发现错误文字受 `.field-error` 默认隐藏规则影响，已改为显式可见；重试测试补等待整批结束（完成一项不代表队列结束）。随后重跑 `launcher-queue.spec.mjs` 全部 12 项通过，覆盖此前 2 个失败。
3. 真实本地处理：临时 WAV/SRT + FFmpeg/ffprobe 完成关联、缓存、工程/SRT/HTML 输出，源内容保留。另有复杂工程夹具比较主副字幕、颜色、贴片、选区、素材及自定义扩展字段。
4. 视觉：实际 Chromium 检查亮/暗主题、1440×900 与 800×600，窄窗抽屉及队列无横向溢出，无 pageerror；回归另覆盖 80%/100%/150% 缩放、语言切换、键盘和设置/工具页。
5. 产物：使用已有依赖环境运行 `uv run --active --no-sync python edit.py --blank`，生成成功且无差异。所有修改的 JS/MJS 执行 `node --check`；所有修改文本检查 UTF-8/LF；`git diff --check` 通过。

## 边界与后续阶段

- **仅说明**：浏览器采用演示桥接；Python 直接验证真实队列 API。没有自动化操控原生 Windows 文件选择器/系统拖入，也没有调用付费云 ASR/LLM 或实际 OCR 模型。这些实机边界不能由演示页通过代替。
- **仅说明**：重试是跳过已完成任务、重新运行未完成任务，不是按处理步骤续传。当前参数在开始时冻结，运行期间不允许修改输入或更改本地运行环境目录。
- **待处理（后续授权范围）**：C 的独立供应商/提示词与完整表单、D 的原文/译文/双语输出语义及独立波形工具、E 的语言入口/全局帮助布局、F 的全阶段交付。A+B 的必要依赖已完成，不将 C–F 标为已执行。
- 没有本轮实施阻塞；没有修改个人配置、个人工程或 `.test-appdata/`，未提交或推送。
