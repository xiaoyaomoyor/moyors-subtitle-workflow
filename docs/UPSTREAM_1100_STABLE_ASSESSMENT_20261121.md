# MAW v1.10.0 跟进筛选

MAW 于 2026-11-04 发布 v1.10.0。从 MAW beta.2 的 `200406ff` 到正式版 `cc7e7448` 有 15 个提交，涉及 110 个文件。正式版说明汇总了整个 1.10 系列，本次以两个标签之间的差异筛选。MSW 对照基线为 `my-feature` 的 `9c2e399a`，其 beta.2 代码候选 `639064e8` 已通过三平台五包预演。MSW 当前公开稳定版为 v1.9.0，1.10 的两个候选版均未公开发布。 [MAW 发布说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.10.0) · [MAW 标签比较](https://github.com/Moyf/moys-asr-workflow/compare/v1.10.0-beta.2...v1.10.0) · [MSW beta.2 验收记录](TEST_FEEDBACK_RELEASE_1100_BETA2_PREP_20261120.md)

| 优先级 | 项目 | 筛选结论 |
| --- | --- | --- |
| 正式版前 | 本地 ASR 自定义模型目录 | 跟进 #308 的目录校验、实际路径交付和配置防串写。MSW 已复现问题。 |
| 可选 | 快速测试的媒体分析开销 | 测量 MSW 长媒体的波形与频谱生成耗时，按结果决定是否推迟预计算。 |
| 按需 | PR 预览包构建 | 如果使用 PR 预览包，统一构建内容和产物记录的提交。 |
| 暂缓 | 缩略图开关、出现动画、前端重构及构建优化 | MAW 的实现依赖各自的时间轴显示、样式和构建流程。 |

## 正式版前建议修复

### 本地 ASR 目录识别与保存

- **目录误判。** 用合成文件模拟本地运行环境，MSW 将一个只在深层依赖目录内含 `.pt` 的路径识别为已安装的 FunASR 模型。选择 Qwen 时，中性命名目录中带有 Whisper 的 `model_type` 与非空权重也显示已安装。对选择的目录按引擎核对同层配置与权重，遇到明确的模型类型冲突给出提示。保留 FireRed 的专用检查、合法的自定义变体与分片完整性校验。 [MSW 目录检查](../maw/local_models.py#L85) · [上游 #308](https://github.com/Moyf/moys-asr-workflow/pull/308)
- **快照与传参。** 同一套有效 Qwen 测试文件，直接选 `snapshots/<revision>` 显示已安装，选其单模型仓库目录则显示路径无效。权重索引是合法 JSON 数组时，当前检查抛出 `AttributeError`。建议沿用双缓存机制识别明确匹配的仓库或快照，遇到无法判断的多模型目录、缺片或损坏索引时提示应选择哪一级。保留 MOSS 固定版本规则和已有目录偏好。Launcher 与 MSWE 共享后端应把校验出的实际快照路径交给识别入口，界面仍记住用户选中的目录。 [MSW 快照检查](../maw/hub_download.py#L41) · [共享请求构建](../maw/gui_web.py#L4732) · [MSWE 识别配置](../maw/msw/asr_config.py#L151)
- **文件夹选择与反馈。** 在真实 Chromium 中模拟系统选择器延迟返回。打开 Qwen 的目录选择器后切到 FunASR，结果进入 FunASR 的输入框，`save_prefs` 也收到 FunASR 的键。建议把选择请求和返回结果绑定到发起的模型，清空后恢复自动检测，并在原设置位置明确显示「目录无效」「模型类型不符」或「缺少文件」。继续使用 MSW 按模型保存的设置结构。 [MSW 启动器回调](../web/launcher/launcher.js#L4095) · [既有目录设置回归](../tests/e2e/local-model-settings.spec.mjs)
- 实施后的验收覆盖手输、选择、取消、清空、快速切换模型、重启恢复偏好，以及自动识别 Hugging Face 与 ModelScope 缓存。补后端用例确认误判和坏索引都会返回可处理状态，已校验的快照路径实际传入识别。

## 可选与按需

- **快速测试的开销。** MAW #321 提供时间轴画面缓存开关，#323 将快速测试的两级画面缓存限制在前两分钟并允许稍后补齐。MSW 使用按需载入的工程封面，并在勾选生成波形时为原媒体准备完整波形与频谱缓存。在合成测试中，识别用媒体截到 120,000 ms，缓存仍按 126,000 ms 的源媒体生成。这符合完整时间轴的设计，也说明快速测试在长媒体上可能有额外开销。若冷缓存实测耗时明显，优先复用已有完整缓存，或让快速测试跳过波形预计算，由编辑器按需生成。独立「生成波形」与正常工作流继续按完整原媒体处理，截取结果须与完整缓存区分。 [MSW 波形缓存](../maw/media_cache.py#L94) · [MSW 工程封面](../maw/launcher_thumbnails.py) · [上游 #321](https://github.com/Moyf/moys-asr-workflow/pull/321) · [上游 #323](https://github.com/Moyf/moys-asr-workflow/pull/323)
- **PR 预览包。** 当前 MSW 的 PR 预览会取 PR 分支头部提交，GitHub 的 PR 检查通常对应合并预览提交。如果日常依赖 PR 预览包，可让检出内容与工作流验证同一份合并结果，包信息记录实际构建提交。这与正式版的打包入口独立。文档专用减量检查可以后续评估，需考虑会进入安装包的文件。 [MSW PR 预览流程](../.github/workflows/pr-release-windows.yml#L82) · [上游检出修复](https://github.com/Moyf/moys-asr-workflow/commit/350c3b0251e3a1f31b2a8adba1afaa2cae493c4d) · [上游 #319](https://github.com/Moyf/moys-asr-workflow/pull/319)

## 沿用 MSW 现有方案

- 上游 #332 调整 `{{文字}}` 出现动画的缩放方向并修正画布测量。MSW 的变换动画已经能从 85% 放大至 100%，前端与导出支持同一套参数。沿用现有样式和时间参数。 [MSW 动画参数](../web/msw-subtitle-animation.js#L9) · [导出参数](../maw/msw/subtitle_animation.py#L11) · [上游 #332](https://github.com/Moyf/moys-asr-workflow/pull/332)
- 上游 #315 针对 `pnpm` 安装生命周期重复打包。MSW 当前 Windows 打包使用 Python 入口，前端通过 MSW 自己的装配流程交付。#307 的 ESM 工程读写重构及测试夹具整理同样留在上游。两个上游标签之间的 Python 锁文件只改变项目版本。此前 MSW beta.2 已处理的依赖安全更新、空隙跳过、路径联动、查找编辑和字体兼容继续保留在候选版中。 [MSW Windows 打包脚本](../scripts/build-windows.ps1) · [上游 #315](https://github.com/Moyf/moys-asr-workflow/pull/315) · [上游 #307](https://github.com/Moyf/moys-asr-workflow/pull/307) · [MSW beta.2 实施记录](TEST_FEEDBACK_RELEASE_1100_BETA2_20261120.md)
- 正式版说明中的 Launcher 直烧工程、表情包烧录和工程响度匹配属于上游 1.10 系列汇总。Launcher 直烧维持此前决定，表情包成片与工程响度匹配暂缓。 [MAW 发布说明](https://github.com/Moyf/moys-asr-workflow/releases/tag/v1.10.0)

## 验证与发布建议

本轮运行本地模型、目录偏好、快照和对齐入口等 38 项 Python 用例，以及媒体缓存 10 项用例，均通过。另用合成目录、合成音频和 Chromium 模拟选择器结果复现上述行为。模型探针覆盖校验与设置，实际模型下载、推理和长媒体耗时留待实施验证。

建议在 MSW 已通过预演的 beta.2 候选基础上修完本地模型目录，再以 `v1.10.0` 运行正式版回归与三平台打包预演。正式发行说明按从 v1.9.0 升级汇总 MSW 实际交付的 1.10 系列改动。
