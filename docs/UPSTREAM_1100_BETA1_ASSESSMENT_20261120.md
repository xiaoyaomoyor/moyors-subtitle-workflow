# MAW v1.10.0-beta.1 跟进筛选

上游 v1.10.0-beta.1 于 2026-10-20 发布。从 MAW v1.9.0 的 `5a449eb07533191ac73011a7c28077d776a7dd83` 到 beta.1 的 `87810635d3cfc77ee6ef2225f392d2579e87512e` 有 57 个提交，涉及 209 个路径。对照 MSW v1.9.0 正式发行提交 `e9309ed4` 及 `my-feature` 上的验证记录 `01e12644`。本轮范围为筛选。[上游发行说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.10.0-beta.1) · [标签比较](https://github.com/Moyf/moys-asr-workflow/compare/v1.9.0...v1.10.0-beta.1)

| 项目 | 状态 | 筛选决定 |
| --- | --- | --- |
| 后处理供应商连接 | 仅说明 | 优先修复迟到回包及验证结果归属，复用每步骤供应商设置。 |
| Windows FFmpeg 查找 | 仅说明 | 优先修复共享查找器，针对 PATH 回退查找原生可执行文件。 |
| 对齐模型与运行环境 | 仅说明 | 建议适配。分开显示下载与运行状态，增加云端 ASR 模式下的设置入口。 |
| Launcher 工程直烧 | 仅说明 | 可选功能。增加手动入口，复用 MSWE 的 v4 样式和编码链。 |
| 表情包、独立文稿匹配、开发改造 | 仅说明 | 结合现有工具和实际用途分别判断，见下文。 |

## 建议跟进

### 1. 修复后处理连接验证的竞态

MSW 已按校对、重断句、翻译记忆独立供应商与模型，用后端保存的连接字段判断验证是否仍然有效。自定义接口为 `localhost` 或 `127.0.0.1` 时，后端已经允许空 Key。

Launcher 仍只有一个待启用步骤变量。实际 Chromium 页面中用延迟的成功回包复现两种情况。校对尚未启用时离开「更多设置」，回包抵达仍启用校对。改从 DeepSeek 切到自定义供应商再填写草稿，旧回包既启用校对，又清空新供应商输入框。演示配置也会重新生成部分供应商状态，值得按各自设置核对就绪状态。[MSW 后处理前端](../web/launcher/postprocess.js) · [上游 #276](https://github.com/Moyf/moys-asr-workflow/pull/276)

建议保存本次验证的步骤、供应商和连接参数，离开设置、取消待启用或修改供应商及参数时使旧请求失效。成功只确认对应步骤的连接，保留其他步骤及模型覆盖。由于现有请求会同时测试与保存，实施时也应处理后端迟到写入，避免仅修页面。回归成功启用、取消、切换供应商、并发及回到设置后的状态。

### 2. 修复 Windows 下 FFmpeg、FFprobe 的 PATH 回退

MSW 共享查找器仍把裸名交给 `shutil.which`。在本机 Windows 的合成目录中，将 `.PY` 放在 `PATHEXT` 前面，合法候选位于 PATH、同名模块位于当前目录时，实际解析器选中了 `ffmpeg.py` 和 `ffprobe.py`。字词时间码、媒体工具和 lite 版的 PATH 路径都使用这套查找逻辑。测试证实了选错路径，上游记录了随后启动失败的现象。[MSW FFmpeg 查找器](../maw/ffmpeg.py) · [上游修复](https://github.com/Moyf/moys-asr-workflow/commit/54d10fc78433bfa9c984048727f1b4a6fb181e0c)

建议在共享层限制 Windows 自动回退查找为原生 `.exe`，同时回归无有效可执行文件、手动指定、随包发现、macOS Homebrew 及 Linux 路径。继续沿用 MSW 的查找优先级和严格配置规则。

### 3. 补齐对齐模型状态和入口

MSW 已有工具箱「字词时间码对齐」和识别后补齐时间码，也有运行环境版本与组件清单。当前检查会在探测权重前因缺少运行依赖退出。同一份合成 FireRed 权重和 token 文件存在时，有运行环境显示已下载，缺运行环境显示未下载。云端 ASR 又会隐藏用于安装本地运行环境的面板，用户缺少直接修复入口。[MSW 对齐模型检查](../maw/alignment_models.py) · [MSW 时间码工具](../web/launcher/local-asr-tools.js) · [上游状态修复](https://github.com/Moyf/moys-asr-workflow/commit/f5cba025e784da72cf1e0b95b2c4faa0f917a3c4) · [上游入口修复](https://github.com/Moyf/moys-asr-workflow/commit/a2a866979710d9c20612f34052c754866d31c4e6)

建议分别呈现权重是否齐全、缺少哪些依赖、运行环境是否需要升级。从工具箱及识别后对齐选择处进入现有设置，让云端识别用户安装对齐所需环境时保留当前识别配置。复用 MSW 的共享运行环境、缓存及自定义目录，统一处理完成、取消、失败后的刷新。

## 可选和暂缓项

- **Launcher 手动工程直烧**。MSW 编辑器已按工程烧录多轨、说话人和单条样式、句内标记及动画，Launcher「压制字幕」只接受 SRT、ASS、SSA。若希望在启动器直接交付视频，可以让它接受 MOSP／工程 JSON，通过现有工程加载器和 MSWE 的 ASS 编译器处理轨道选择、媒体关联与原时间轴，再使用现有编码和进度。需覆盖显隐、空字幕、资源路径和未知工程版本。首版可限于手动原时间轴直烧，去空隙与配音混合仍从编辑器操作。上游只生成基础工程样式，绿色背景也曾单独暂缓。此项可以独立排期。[MSW 压制入口](../maw/gui_web.py) · [MSW 样式编译器](../maw/msw/subtitle_style.py) · [上游 #267](https://github.com/Moyf/moys-asr-workflow/pull/267)
- **文稿工具**。MAW 的「媒体＋准确文稿，跳过 ASR」有独立用途。MSW 的文稿匹配用于已有字幕校正，字词对齐以工程／SRT 的选中轨道为输入，口播对齐还涉及片段选择。建议保留现有导航。需要时可在单独工具和预制模块标注「需要已有字幕」，避免把它和从录音生成时间码混淆。音频加纯文稿的流程可以在有实际需求时独立设计。[MSW 使用流程](WORKFLOW.md) · [上游文稿工具调整](https://github.com/Moyf/moys-asr-workflow/commit/54d10fc78433bfa9c984048727f1b4a6fb181e0c)
- **编辑器烧录、帮助和前后缀**。MSW 的输出以工程样式及所选时间轴为准，ASS 预览开关与视频烧录分开，现有多轨渲染和去空隙用例通过。上游的 SRT 烧录补了其 ASS 关闭时的入口及首句对零造成的时间偏移。此处建议保留 MSW 实现。现有操作帮助、提示图标和查找并编辑前后缀继续沿用，上游针对 `>>…<<` 单侧淡入淡出的包裹修补与 MSW 的样式字段不同。[MSW 视频渲染](../maw/msw/video_render.py) · [上游 #268](https://github.com/Moyf/moys-asr-workflow/pull/268) · [上游首句同步修复](https://github.com/Moyf/moys-asr-workflow/commit/7f392736cbeefff2fdf98a3985b31d1ec77befa9)
- **表情包烧进 MP4**。MSW 已有表情包预览和独立 OTIO／OTIOZ 轨道，现有 MP4 渲染链没有表情包合成。这是成片功能，涉及素材校验、重叠、动画以及去空隙时间映射。建议暂缓。有需求时再设计独立的「视频包含表情包」选项，输出选择由用户明确控制。[MSW 导出流程](WORKFLOW.md) · [上游 #272](https://github.com/Moyf/moys-asr-workflow/pull/272)
- **ASR 入口重构、测试并行和开发构建**。上游迁移七个 ASR 脚本并配套调整冻结入口，新增并行测试和 ESM bundle 锁。MSW 有自己的转写入口、打包契约和按请求渲染的前端。仅在遇到实际维护瓶颈时单独评估。Windows PR 已用固定版本、验哈希的 FFmpeg；下载重试或镜像属于可独立处理的 CI 小改。保留 MSW 三平台五包齐备后公开的流程。[上游 #279](https://github.com/Moyf/moys-asr-workflow/pull/279) · [上游 #270](https://github.com/Moyf/moys-asr-workflow/pull/270) · [MSW 正式版验证记录](TEST_FEEDBACK_RELEASE_190.md)

## 筛选验证

- 使用 `git ls-remote` 核实两枚上游标签。GitHub 网页比较缓存未命中，代码差异以本地同一标签的提交对象为准。范围截至 beta.1。
- Python 合成探针复现 Windows 同名模块遮蔽与已下载模型状态误报，并确认回环自定义接口允许空 Key。FFmpeg、模型状态和 ASS 不透明度专项 19 通过、1 条件跳过。再使用已核验的 v1.9.0 随包 FFmpeg 运行样式和真实渲染专项，12 通过。
- Chromium 合成连接延迟探针复现离开设置和切换供应商两种迟到回包。Launcher 既有两个测试文件为 14 通过、1 失败。单项重跑仍失败，原用例只给输入框赋值，现行入口要求先保存本机连接。补走该步骤的隔离浏览器探针通过，现有测试文件留待实施时更新。
- 本轮验证使用合成媒体、模型文件和模拟服务，未调用实际云端服务、下载推理模型，也未运行完整发行回归。

建议先实施前两项缺陷修复，再完成对齐模型状态与入口。工程直烧可在确认需要 Launcher 直接交付时独立实施。完成所选项后再进行 MSW 回归及 beta.1 发布准备。
