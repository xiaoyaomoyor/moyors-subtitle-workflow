# MAW v1.11.1 跟进筛选

以 MSW v1.11.0 的发行提交 `f4c06974` 为基线，审阅 MAW v1.11.0 `cedb5bfd` 到 v1.11.1 `b0a9bcbd` 的 8 个提交和 177 个文件。上游于 2026-11-11 发布。两标签间 Python 项目元数据仅调整版本号，`uv.lock` 无差异。 [MAW 发布说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.11.1) · [MAW 标签比较](https://github.com/Moyf/moys-asr-workflow/compare/v1.11.0...v1.11.1) · [MSW v1.11.0](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.11.0)

| 建议顺序 | 范围 | 筛选结论 |
| --- | --- | --- |
| A | Windows 中文路径、运行环境子进程回收 | 优先修复。路径问题涉及共享运行环境生命周期，已在 MSW 复现后台回调异常时子进程残留。 |
| B | FCP 7 XML 媒体回链 | 建议纳入现有导出。MSW 样本存在与上游相同的 XML 差异，需保护 Premiere 现有交接行为。 |
| C | MSW 启动器配置读取 | MSW 自有修复，可随补丁版处理。v1.11.0 原生窗口复测已记录该问题。 |
| 按需 | 视频画面术语提取 | 有独立用途，待实际需要画面词表工作流时再规划。 |
| 沿用 MSW | 赞助二维码、开发工具页、编辑器 ESM 重构 | MSW 使用自己的启动器资源和编辑模块。维持现有离线对比工具。 |

## A　Windows 运行环境和进程回收

- **中文路径。** MSW 已允许从「设置 → 运行环境」改本地 ASR 目录，默认仍由 `%LOCALAPPDATA%` 决定。锁定的 Qwen-ASR 依赖包含 `nagisa` 和 `dynet38`，安装末尾会导入 Qwen-ASR 自检。`PYTHONUTF8=1` 处理 Python 文本编码，第三方原生库打开模型文件的路径仍有自己的编码规则。用独立的中文应用数据目录测试，三套运行环境都沿用中文长路径，Windows 也未给出可用的纯 ASCII 8.3 别名。 [MSW 目录解析](../maw/runtimes/base.py#L235) · [MSW ASR 自检](../maw/runtimes/local_spec.py#L16) · [上游 #356](https://github.com/Moyf/moys-asr-workflow/pull/356) · [Windows 短路径说明](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getshortpathnamew)
- **建议适配。** 在 MSW 的共享运行环境解析中统一选择实际目录，状态、自检、启动、修复和取消使用同一路径。已有可用的 ASCII 路径继续直接使用，有合适的 8.3 别名时验证其目录身份。默认路径无可用别名时再采用隔离、可写的 ASCII 回退目录，核对 Windows 目录所有权、访问权限和重解析点。显式指定的路径无法使用时，提示在现有入口改选目录。运行环境、模型缓存、用户配置与工程数据各自管理。测试覆盖旧安装、关闭短名、目录权限不足、重启后再识别，及本地 ASR、OCR、MOSS 三套运行环境的状态与启动。原生依赖触发证据集中在本地 ASR。
- **运行环境进程回收。** #359 在 OCR 新工具之外修订了共享进程生命周期。MSW 的 `_run_process` 只在读取输出期间判断取消，遇到上层回调抛出异常会跳过进程回收。Windows 本机用只输出一行后休眠的合成子进程复现，回调抛出后子进程仍存活，探针已回收。源码也显示 Linux／macOS 若根进程提前退出，当前终止逻辑可能直接结束，即使子进程还持有输出管道。建议为运行环境执行补齐异常和取消清理、可取消的等待、输出线程关闭顺序，并验证只回收 MSW 创建的子进程组。Windows 沿用现有 Job Object 路径。POSIX 进程组仍待目标平台验证。 [MSW 运行环境进程执行](../maw/runtimes/base.py#L1051) · [MSW 进程组终止](../maw/gui_platform.py#L205) · [上游 #359](https://github.com/Moyf/moys-asr-workflow/pull/359)

## B　现有 FCP 7 XML 媒体回链

- **MSW 样本结果。** 用合成源视频、源音频、贴图和 GraphicAndType 字幕导出 XML。源媒体路径使用 `file://localhost/D:/…`，贴图使用 `file://localhost/D%3A/…`。视频样本 5 个定义型 `<file>` 仅贴图包含 `<timecode>`，纯音频样本的定义也缺该字段。引用型 `<file id="…"/>` 已沿用首次定义。两个输出符合现有 MSW 测试，同时存在上游修复针对的差异。 [MSW URL 生成](../web/editor-utils.js#L5457) · [MSW XML 生成](../web/editor-utils.js#L5933) · [上游 #358](https://github.com/Moyf/moys-asr-workflow/pull/358)
- **建议适配。** 保留 MSW 的 FCP 7 XML、轨道选择和去空隙计划，在现有序列化器验证定义节点 `timecode` 及 Windows 盘符编码。覆盖源视频、纯音频、贴图、GraphicAndType 和重复引用，同时验证 UNC、中文路径、已编码 URI、POSIX 路径及帧边界。MSW 曾为 Premiere 自动回链调整 Windows URL，合并前应检查 Premiere 的回链和原生文字，再在 Resolve 验证媒体在线。当前仅确认 XML 结构差异，未进行目标软件导入。Resolve 对 Premiere GraphicAndType 的渲染能力需要独立验证。 [MSW Premiere 回链记录](TEST_FEEDBACK_BETA7.md#L316) · [上游修复提交](https://github.com/Moyf/moys-asr-workflow/commit/5aeca0ea1ae4a7effa10701b0d84137afa336d40)

## C　MSW 启动器配置读取

v1.11.0 的原生 WebView2 复测中，Launcher 的通用桥接把一个参数传给 `get_user_config`，Python 方法签名只接收 `self`。主窗口可以继续打开，共享配置的首次读取报错。可以按现有桥接契约修复并用隔离的配置快照复测原生启动、退出和重开。此项单列为 MSW 修复。 [原生复测记录](TEST_FEEDBACK_RELEASE_1110_20261121.md) · [桥接调用](../web/launcher/launcher.js#L2712) · [Python 方法](../maw/gui_web.py#L710)

## 其余上游更新

- **赞助二维码与打包。** 上游修复 MAW 专有入口引用的静态图片。MSW 启动器没有这个入口，v1.11.0 的 Windows 与 macOS 标准及 lite 四个 ZIP 中，Launcher HTML 的 19 个本地资源引用全部存在。MSW 已有 `MSW.spec` 与五包检查。A 阶段若新增子运行环境模块，可在现有检查补它们的实际打包验证。 [MSW 打包清单](../MSW.spec) · [MSW 五包检查](../scripts/check_release_assets.py) · [上游 #357](https://github.com/Moyf/moys-asr-workflow/pull/357)
- **OCR 术语提取。** 上游独立工具从画面扫描文字，按出现证据聚合和筛选，最后导出热词表。MSW 的 OCR 字幕去重解决画面已有硬字幕时避免重复显示，识别预设已支持热词和提示词复用。画面文字转热词仍是独立功能，待有实际制作需求时从现有 OCR 与预设体系规划。无需随这次补丁一并引入上游工具页。 [MSW OCR 字幕去重](OCR_SUBTITLE_DEDUP.md) · [MSW 识别预设](WORKFLOW.md#L730) · [上游 #359](https://github.com/Moyf/moys-asr-workflow/pull/359)
- **维护者工具和静态导入。** PR 看板正文预览、刷新反馈、核对清单、说明页与统一主题属于上游的独立工具。编辑器静态导入改造围绕其字幕编辑模块和文本预设装配。MSW 继续使用自己的字幕事务、v4 多轨、查找并编辑及两份离线对比工具。 [上游静态导入 #343](https://github.com/Moyf/moys-asr-workflow/pull/343) · [上游工具更新](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.11.1)

## 筛选验证

- 在本机 Windows ANSI 代码页 936 下读取同一内容的合成文件。窄字符 `fopen` 接收 UTF-8 路径时，ASCII 目录读取成功，中文目录失败，宽字符读取两者均成功。这复现了路径编码机制。锁定依赖的独立下载超时，尚未在本机跑完真实 Qwen-ASR 运行环境安装及导入自检。
- Python 的运行环境与打包契约 58 项通过。现有用例通过，同时合成子进程探针复现回调异常时仍有子进程存活。
- Node 的 FCP 7、Premiere 原生文字和文件 URL 定向用例 14 项通过。另用合成视频、音频和贴图核对定义型及引用型节点。
- 对已发布的四个 ZIP 核对 Launcher HTML 静态资源。未合入上游产品代码、调整版本或启动发布。
