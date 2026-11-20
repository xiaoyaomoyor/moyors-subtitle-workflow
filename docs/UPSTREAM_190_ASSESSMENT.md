# MAW v1.9.0 正式版跟进筛选

MAW 在 2026-10-18 发布了 v1.9.0 正式版，发行说明汇总此前 beta 系列的功能、变更和修复。Windows 标准／lite、macOS 标准／lite 和 Linux AppImage 都有下载。从 beta.3 到正式版实际有 16 个提交，比较范围为 `9babf35b22ae7b9b2f788ddc6beef353c4c686cd..5a449eb07533191ac73011a7c28077d776a7dd83`，涉及 180 个路径，含大量说明、配图和官网工具。对照 MSW `my-feature` / `9ee09b31`，产品基线为已发布的 `90bb9e1a`。 [MAW 正式版发行说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.9.0) · [标签比较](https://github.com/Moyf/moys-asr-workflow/compare/v1.9.0-beta.3...v1.9.0)

| 筛选项 | 状态 | 建议 |
| --- | --- | --- |
| 工程切换与旧请求 | 仅说明 | 优先修复。浏览器读文件、服务端打开最近工程两条路径均复现较早请求最后生效。 |
| 去空隙 SRT | 仅说明 | 建议修复。字幕导出及时间线配套 SRT 会为已完全删除的区间生成字幕。 |
| 旧输入的翻译产物 | 仅说明 | 建议小范围适配。兼容处理链和独立文件工作流仍可能把原译文压进单轨。 |
| 样式、导出和开发流程 | 仅说明 | MSW 已有主要对应能力。其余新增工具按下文判断。 |

## 建议跟进

### 1. 工程切换以最后一次有效操作为准

上游在异步载入前登记打开操作，在媒体、工程接管和写入完成后复核对应的工程。MSW 已有保存绑定及磁盘修订校验，媒体分析和处理任务也有工程身份检查。这些机制会在新工程生效后拦截过期结果。仍有两条打开路径在读取前未区分新旧操作：

- 浏览器 `web/editor.js` 的 `openProjectFile()` 在异步读取后直接应用内容。对实际函数用可延迟的读取替身，先发起 A，再让 B 加载完成，最后释放 A，页面提交顺序为 B → A。
- `server-editor/serve.py` 的 `open_recent_project()` 在锁外读取，在锁内直接更改绑定。调用实际方法并控制两次加载完成次序，服务端同样从第二个工程被切回第一个。这里验证的是工程绑定与页面内容被旧操作夺回，尚未观测到磁盘工程被覆盖。

建议复用现有工程代次和绑定检查，再给打开／接管操作补顺序校验，覆盖选择文件、拖入、最近工程、新建，以及旧媒体和波形回调。另检查 `downloadFile()` 在保存对话框等待期间切换工程的场景，按 MSW 各入口的实际行为分别验收。锁内只做提交与状态检查，保留现有的异步读盘。 [上游 #246](https://github.com/Moyf/moys-asr-workflow/pull/246)

### 2. 去空隙 SRT 排除没有保留画面的字幕

「字幕导出」中的去空隙 SRT 和时间线配套 SRT 仍使用起止时间分别映射，再保底 1 ms。受控案例删除 `0–1000 ms`，其中的 `100–300 ms`、`500–900 ms` 两条都生成 `0 → 1 ms`，跨切点的 `950–1200 ms` 正常保留为 `0 → 200 ms`。现有 Python 烧录投影对同样输入只输出跨切点的字幕，v4 精确 ASS 也按保留区间请求服务端渲染。

建议在 SRT 导出投影中丢弃完全落在实际删除区间内的字幕，再计算从零开始的首条及各导出组。覆盖分轨、双语合并、按说话人及时间线配套 SRT，同时回归跨切点、手工保留区间、绑定字幕和原时间轴导出。用现有 MSW 区间逻辑作准。 [上游 #265](https://github.com/Moyf/moys-asr-workflow/pull/265)

### 3. 统一旧格式和原生工程的翻译交付

原生 v4 的 Launcher 和编辑器已经保留原文与可编辑译文，原生 Launcher 可选择目标轨，重译可更新绑定字幕，双语 SRT 可以独立输出。验证 `test_launcher_flat_processing` 中双轨保存、重译和恢复案例均通过。

兼容路径仍有差别。直接文件翻译的合成工程以 `Hello world` 和原词时间为输入，`run_llm_postprocess()` 普通翻译写出的 MOSP 只含 `你好`，双语模式写成同条 `你好\nHello world`，两者的新主轨都失去原字词时间。旧版自动处理的双语模式还有用例明确断言生成单轨。现有旧格式「写入译文轨道」会追加新轨并分配后缀。是否仍经由这些入口取决于输入格式和 Launcher 是否指定轨道范围。

若纳入正式版，建议将兼容入口统一到现有 v4 译文输出，保留主轨原文、词时间、样式、说话人及绑定；双语合一只作用于 SRT，显式「翻译回填」继续按照用户选择工作。重复翻译以明确的目标轨和已匹配条目为更新范围，保留手工译文及其他轨道，并单独验收跳过目标语言、翻译失败和旧工程重开。 [上游 #262](https://github.com/Moyf/moys-asr-workflow/pull/262)

## 其余增量

- **句内样式拆合**。上游补的是带空格的单词型合并、渐进拆分的左半句，以及 `!!`、`>>…<<` 的整句符号。MSW 成对语法已经处理带空格的嵌套合并和两侧闭合，现有测试覆盖。MSW 将整句震动和淡入淡出作为样式／动画处理。 [上游 #264](https://github.com/Moyf/moys-asr-workflow/pull/264)
- **ASS 实际预览、样式库和内置参数**。MSW 已有 libass 预览、工程与轨道预设、按属性恢复继承，以及刚发布的单条缩放手柄。上游默认字号、边距和淡入淡出属于其排版选择，建议沿用 MSW 默认值。 [上游 #263](https://github.com/Moyf/moys-asr-workflow/pull/263) · [上游 #265](https://github.com/Moyf/moys-asr-workflow/pull/265)
- **绿幕视频及可选源音轨**。属于单独的交付需求，维持此前暂缓的决定。上游发布页重述的缩略图带、逐词轨道、LRC 和 AI 口播整理也维持此前筛选结果。 [上游 #263](https://github.com/Moyf/moys-asr-workflow/pull/263) · [beta.3 筛选记录](UPSTREAM_190_BETA3_ASSESSMENT_20261119.md)
- **开发与发布**。增量 ESM 初始化、官网更新记录、配图与 CHANGELOG 编辑工具主要服务于 MAW 的源码和网站发布。MSW beta.3 已拥有三平台五包、预览说明和 SHA-256 校验门槛，建议沿用这一流程。 [上游 #259](https://github.com/Moyf/moys-asr-workflow/pull/259) · [MSW beta.3 发布记录](TEST_FEEDBACK_RELEASE_190_BETA3_20261120.md)

## 验证与发布建议

- Git 只读核实远端标签，`git merge-base --is-ancestor` 和 `git rev-list --count` 确认 beta.3 是正式版祖先，范围内为 16 项。网页比较缓存未命中，实际差异来自本机同一提交对象。
- Node 定向 `test_inline_markup.mjs`、`test_flat_editing.mjs` 和 `test_preview_avoidance.mjs` 合计 22 项通过。Python `test_launcher_flat_processing`、`test_translation_prefilter`、`test_postprocess_pipeline` 合计 69 项通过。第一次 Python 命令误将 Node 专项也传给 unittest，报模块缺失，分开执行后通过。
- 合成探针调用实际函数，浏览器采用隔离 JS 上下文，服务器采用受控读盘次序，翻译使用确定性替身。探针未写入个人工程，未读取个人 `.env`。本轮未运行 Chromium 全流程、真实云端翻译或新发行包测试。

建议正式版优先完成工程切换和去空隙 SRT 两项修复。翻译只补仍走旧格式的入口，已验证的 v4 轨道工作流继续沿用。随后做定向回归和现有三平台五包验收，再将 MSW 1.9 系列整理为正式版。
