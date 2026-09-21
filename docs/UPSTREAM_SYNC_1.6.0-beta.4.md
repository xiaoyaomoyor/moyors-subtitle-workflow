# MSW 跟进 MAW 1.6.0-beta.4：实施与发行账本

## 授权及固定基线

2026-09-20 用户要求按现有 MSW 实际情况逐项适配上游 beta.4，持续兼容上游工程，并在完成验证后提交推送和发布。用户已澄清末尾 beta.3 为笔误，本次发布 **v1.6.0-beta.4**。

- MSW 起点：`fdd15cfeb600382d689fea696014b8c46a07ba39`，与 origin/my-feature 一致；仅有既存未跟踪 `.test-appdata/`，保留且不读取其内容。
- 已对齐上游 beta.3：`bc5262cd7f9f972d1efc299d4537fd13eaa657ce`。
- 本次固定上游 beta.4：`afa288c6e6506dd20c4f04024f13c6967cc56eb0`，本地引用 `upstream-release/v1.6.0-beta.4`。当前标签包含上游后来合回 beta.4 的发布修正，按固定树审查，不按原始发布提交截断。
- 上游 main 当前为 `42656d849f4e2cce9cb21d718add86b692cc6028`，已有更高版本；不混入本次产品。main 在最终发行阶段单独纯镜像，推送时暂停上游 Pages 触发。
- 集成分支：`sync/upstream-1.6.0-beta.4`。上游自动跟随获取的同名标签已归档到 upstream-release 命名空间，MSW 现有发布标签不覆盖；后续 upstream fetch 禁用自动跟随标签。

## 实施原则与重复能力核实

- 保留 beta.3 后 MSW 的五页启动器、方案驱动预制、最近/全部工程、独立编辑器 ASR/TTS、素材库、字幕卡片、三层贴片、导出样式/试听音量快照和保存反馈。
- 共享边界已经实现：同轨真实共同边界双手柄高亮才联动；单手柄只改自己，跨行共同边界、Alt、A/D 和撤销已有测试。比较上游命中区域与光标等增量，不整体替换现有交互。
- 工程 schema 保持 `moy.asr.project.v1`，兼容上游公共字段和历史工程；MSW 未知可选字段、稳定 ID、配音素材引用必须保留。运行态派生缓存不写入普通工程。
- 新公共缓存使用 MSW 目录，兼容读取旧 MAW/MSW 路径，不自动移动旧文件；已有固定 FFmpeg 与实际验收机制继续保留。
- 不读取实际 `.env`，测试使用仓库外隔离配置、合成媒体和模拟接口；不用真实付费调用冒充已验证。

## 当前阶段

| 阶段 | 状态 | 内容与证据 |
| --- | --- | --- |
| A 差异与兼容性评估 | 仅说明 | 固定 113 个变更路径，后续每个实现阶段继续核对语义差异；共享边界不重复引入，上游备份模块不替换 MSW 恢复系统，Linux FFmpeg 保留固定版本及哈希验证 |
| B 工程/缓存/运行时 | 已修复 | 后端及契约首轮 345 项运行通过、4 跳过；MSW 直接导入/切轨、Launcher 与兼容补充 289 项运行通过、1 跳过。响度前端、直接导入无响度层时的降级在 D 阶段处理 |
| C 后处理及 Launcher 接线 | 已修复 | 翻译回填、双语顺序、后缀、通知、语言和错误诊断已接入；50 项浏览器覆盖中的两项失败复测通过，新增 Launcher 3 项通过；完整回归归 E |
| D 编辑器增量 | 已修复 | 颜色组、ASS、响度、阅读位置／跟随与保存已适配并验证；保留 MSW 共享边界 |
| E 回归及候选包 | 已修复 | 本地回归及滚动矩阵通过；预演 35525678605 三平台构建、341 项 Chromium、冻结程序与五包完整性检查全部通过 |
| F 提交推送与 beta.4 发布 | 已修复 | main 保持纯镜像；my-feature／同步分支已推送，最终标签指向 83cfc9c；正式 CI 35527871901 全部通过，公开五包下载校验及 Windows 标准／lite 实际启动通过 |

## 已确认的决策

- 响度自动定标与旧手动振幅：用户确认采用建议。新工程自动，旧 MSW 手动值保持，上游显式 auto 标志照常读取；继续保留独立的“跟随源试听增益”。
- 翻译回填：用户确认编辑器默认仍生成/更新副字幕，另提供“替换主字幕”；保留已有副轨、配音贴片和稳定 ID，只清除已改文字幕的旧字词时间码，支持一次撤销。

## B 阶段适配记录

- `maw/media.py` 优先按失效引用中的媒体文件名寻找同目录素材，再尝试工程名；保留 MSW 历史英文后缀。`media_metadata.video_width/video_height` 成对可选，不改旧帧率和选轨值。
- `loudness` 为可重建运行态缓存，随普通工程保存剥离；媒体/音轨切换必须失效，服务端异步读取仍受工程代次限制。MSW 直接导入路径也补充视频尺寸和响度返回。
- 本地 Qwen 自动设备支持 MPS，加载失败仅在 auto 模式退回 CPU；本机无 Apple GPU，真实 MPS 推理待外部验收，单元测试使用模拟 Torch。
- 吸收英文按完整单词插值，但修正上游极短/非正区间可能向外延长时间的边界；仍不生成伪词级时间码。
- PyTorch 源探测保留 TLS 校验，增加 `MSW_PYTORCH_INDEX` 优先、兼容 `MAW_PYTORCH_INDEX`；不吸收证书错误后关闭校验的重试。

## 验证记录

- 升级前 Node 基线：368/368 通过。
- 升级前 Python 基线：运行 1673 项，失败 6，跳过 20。3 项受本次显式 `FFMPEG_PATH` 影响，2 项指出现有打包清单漏掉 `maw/msw/subtitle_export.py`，1 项仍断言已替换的旧保存提示。后续单测不继承显式 FFmpeg 配置，并修正打包依赖及旧断言；保留原失败日志。
- B 后端首轮：`python -m unittest` 覆盖 quapeaks_loudness/media/project_contract/project_io/local_asr/qwen/local_log/local_runtime/moss_runtime/runtime_mirror_picker/runtimes/local_editor_server/media_cache，345 项运行通过、4 跳过。
- B 接口补充：beta4_compatibility/gui_web/msw_media_jobs/msw_media_service，289 项运行通过、1 跳过。使用 FFmpeg 合成媒体；不涉及真实云端付费调用或模型下载。
- 尚未完成浏览器、打包与完整 beta.4 回归，不能据此宣称发行完成。详细差异、临时夹具与日志存放于仓库外验证目录。

## C 阶段适配记录

- 后处理回填保留 MSW 副轨与扩展，双语行序进入现有预制方案及批量恢复；不恢复已移除的上游工具箱抽屉。固定处理空操作返回跳过结果，现有方案预检仍要求已启用模块完成配置。
- 编辑器翻译新增主字幕替换模式，默认仍副字幕；快照保存输出模式，回填在现有任务/冲突/撤销机制中执行。目标语言预过滤的条目返回明确跳过标记，不能用原文覆盖旧副字幕。
- 输出后缀吸收文稿匹配、固定处理方向及回填标记；保留 MSW 输出目录、自定义输出主名、稳定 ID 与内部素材路径。
- 新安装默认不附加模型名，已有显式开关仍生效；完成通知默认关闭，使用 MSW 标识；未设置界面语言时跟随系统。保留五页工作台、连接设置和已有地域/Workspace 控件。
- 独立端口启动诊断在停止对应会话前采集，包含状态、PID（存在时）、最后探测和日志；日志脱敏并限长。批处理失败保留原始错误及总数，显示友好提示。表情包路径可以打开，后端重新验证目录。
- 第一轮 C Python 347 项中 4 失败/2 错误（新测试导入、旧默认值断言、启动日志脱敏入口、批失败计数与品牌）；第二轮 607 项中 3 失败/1 跳过（旧 GUI API URL、模型后缀默认、启动诊断结构断言）。均保留日志并逐项修正。
- 第三轮复测 GUI 与兼容补充：266 项运行通过、1 跳过；翻译前端单元 15/15 通过。浏览器首轮 50 项中 48 通过、2 失败：撤销会补齐夹具缺失的帧索引，已有素材库菜单使翻译/TTS 不再直接相邻；保留原日志，修正夹具并按真实需求检查菜单先后顺序，正在复测。
- 浏览器复测两项均通过；新增 Launcher 3 项首次失败源于误以为预览模拟后端跨页面持久化，改为验证实际保存请求/读取结果后 3/3 通过。磁盘持久化由已通过的 Python 配置/方案契约覆盖。

## D 阶段适配记录

- ASS 吸收媒体分辨率、字号换算、颜色样式/说话人及去空隙导出；保留 MSW 视频烧录和独立副轨样式。
- 显式自动标志优先，旧 MSW 工作区仅保存手动数值时补为手动；新工程不继承上个媒体自动拟合的数值。源试听增益仍是独立显示系数。
- 无有效 RMS 响度层（包括仅生成 mopeaks 的直接导入路径）保留振幅；点击响度适配提示缓存不可用，不将峰值伪装为 RMS，也不阻塞导入补跑全媒体解码。
- 颜色组中途改色先拆旧引用；单条脱离继承原组颜色，保持已有卡片样式和撤销入口。
- 阅读位置采用稳定 DOM 身份、邻近存活字幕回退及可取消补偿；保留 MSW 双轨卡片与音频时间线播放高亮。跟随按钮放在现有模块标签栏，滚轮/触摸/列表导航交出跟随控制。
- 保存沿用 MSW 进度气泡、工程代次与完整快照比较，补充行内文字刷新而不结束编辑；保存成功仅清理脏标记，不重建字幕列表。
- D 单元回归 285/285 通过（首轮缺少测试导出入口及一条上游专属文案断言，另有一次未配置 Python 子进程导致 XML 检查失败，均已修正）。首轮浏览器 36 项中 29 通过、7 失败，定位到 ASS 函数名与跟随按钮挂载；修正后 ASS 4 项通过，完整阅读矩阵继续执行。振幅旧上游工程重复迁移问题已修正，待复测；副轨弹窗拆分位置也补上跨弹窗锚点。

- D 第二轮浏览器 52 项中 49 通过、3 失败：上游未显式设置的工作区重复迁移、副轨拆分弹窗阅读锚点、测试使用了上游设置按钮。修正后针对三项及新增启动工作区保护用例复测 4/4 通过。
- E 首轮完整 Python：1734 项运行、3 失败、67 跳过。两项为基线已有的本地/OCR 运行时缺失 subtitle_export.py，另一项为旧滚动实现与旧保存提示的静态断言；已补清单并更新页面资产检查。下一轮把 FFmpeg 加入 PATH，避免缺工具导致额外跳过；不设置 FFMPEG_PATH。

## E 阶段收尾记录

- 完整 Node 回归 379/379 通过；官网按当前文档同步，15 页构建通过。
- 完整 Python 第二轮 1763 项、3 失败、24 条件跳过；继续暴露字幕样式传递依赖与误写的跟随按钮静态断言。依赖补齐后资产／打包组 42 项通过、2 条件跳过；完整最终轮继续执行。
- 完整浏览器回归发现列表点击夹具与恢复布局冲突、共享工程被自动保存污染，以及表情包更新缺少布局锚点。前两项修正测试隔离，后一项补充原地更新前后的阅读位置恢复；保留全部失败记录，未用自动重试掩盖。
- 桌面开发目录仅同步媒体后缀兼容，MOSE 不随 MSW 发行，未将 Rust 桌面构建冒充本次三平台 MSW 验收。

## 113 个上游路径处置索引

此表按固定 beta.3 → beta.4 树差异生成；具体行为与验证以以上适配记录为准。

| 上游路径 | 处置 |
| --- | --- |
| `.env.example` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `.gitignore` | 验证日志与截图放仓库外，不导入上游临时文件规则 |
| `CHANGELOG.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `JSON_SCHEMA.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `README-en.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `README.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `blank-editor.html` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `desktop/src-tauri/src/server.rs` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/CLI.md` | 无独立产品变更；保留 MSW 内容，相关使用说明已在工作流及编辑器指南同步 |
| `docs/EDITOR_GUIDE.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/KEYBOARD_ADJUSTMENT.md` | 已有 MSW 双手柄联动及 Alt／键盘语义，保留现有交互与测试 |
| `docs/LLM_POSTPROCESS_PROTOCOL.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/LOCAL_ASR.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/MULTI_SUBTITLE.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/OCR_SUBTITLE_DEDUP.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/POSTPROCESS_PIPELINE.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/PROVIDERS.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/TEST_FEEDBACK_MOSS.md` | 上游演示图片／内部反馈记录，不进入 MSW 产品 |
| `docs/TEST_FEEDBACK_OUTPUT_DIR_WAVE2.md` | 上游演示图片／内部反馈记录，不进入 MSW 产品 |
| `docs/WORKFLOW.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `docs/assets/1.6.0/boundary-drag.webp` | 上游演示图片／内部反馈记录，不进入 MSW 产品 |
| `docs/assets/1.6.0/partial-translate.webp` | 上游演示图片／内部反馈记录，不进入 MSW 产品 |
| `edit.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `generate_subtitle_qwen_api.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/doubao.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/gui_config.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/gui_web.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/gui_workflow.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/launcher_batch.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/local_asr.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/local_log.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/local_runtime.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/media.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/moss_runtime.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/notify.py` | 新增并适配 MSW 品牌、目录及调用接口 |
| `maw/output_naming.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/postprocess.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/postprocess_io.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/postprocess_llm.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/postprocess_ocr.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/postprocess_pipeline.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/project.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/project_backups.py` | 保留 MSW 现有恢复记录、备份与冲突检测，不引入并行备份系统 |
| `maw/project_io.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/quapeaks.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/runtime_mirror_picker.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw/runtimes/base.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `maw_gui.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `playwright.scroll.config.mjs` | 并入现有 Playwright 配置与隔离的滚动夹具，不增加重复入口 |
| `pyproject.toml` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `scripts/build-appimage.sh` | 保留 MSW 固定月末 FFmpeg 版本与 SHA-256 校验，不切换浮动 latest |
| `scripts/verify_sha256.sh` | 保留 MSW 固定月末 FFmpeg 版本与 SHA-256 校验，不切换浮动 latest |
| `server-editor/README.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `server-editor/serve.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/e2e/ass-export.spec.mjs` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/e2e/click-behavior.spec.mjs` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/e2e/cue-color-filter.spec.mjs` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/e2e/cue-scroll-fixture.mjs` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/e2e/cue-scroll-stability.spec.mjs` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/e2e/keyboard-timing.spec.mjs` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/e2e/launcher-interactions.spec.mjs` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/e2e/multi-subtitle.spec.mjs` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/e2e/speaker-labels.spec.mjs` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/e2e/waveform-history.spec.mjs` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/test_bcut.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_editor_utils.mjs` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_gui_config.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_gui_web.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_gui_workflow.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_launcher_batch.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_local_asr.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_local_editor_server.py` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/test_local_log.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_local_runtime.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_media.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_moss_runtime.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_notify.py` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/test_output_naming.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_packaging_contract.py` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/test_postprocess.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_postprocess_io.py` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/test_postprocess_pipeline.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_project_backups.py` | 保留 MSW 现有恢复记录、备份与冲突检测，不引入并行备份系统 |
| `tests/test_project_contract.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_project_io.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_quapeaks_loudness.py` | 保留 MSW 契约／交互覆盖；新增行为由对应 beta.4 和滚动／导出专项验证 |
| `tests/test_qwen.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_runtime_mirror_picker.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_runtimes.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_verify_sha256_script.py` | 保留 MSW 固定月末 FFmpeg 版本与 SHA-256 校验，不切换浮动 latest |
| `tests/test_waveform.py` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `tests/test_waveform_js.mjs` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/assets/cursors/left-boundary.svg` | 已有 MSW 双手柄联动及 Alt／键盘语义，保留现有交互与测试 |
| `web/assets/cursors/right-boundary.svg` | 已有 MSW 双手柄联动及 Alt／键盘语义，保留现有交互与测试 |
| `web/assets/cursors/shared-boundary.svg` | 已有 MSW 双手柄联动及 Alt／键盘语义，保留现有交互与测试 |
| `web/editor-i18n.js` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/editor-template.html` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/editor-utils.js` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/editor.css` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/editor.js` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/launcher/batch.js` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/launcher/index.html` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/launcher/launcher.css` | 保留 MSW 五页工作台主题，新增控件使用现有布局 |
| `web/launcher/launcher.js` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/launcher/postprocess.js` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `web/waveform.css` | 已有 MSW 双手柄联动及 Alt／键盘语义，保留现有交互与测试 |
| `web/waveform.js` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `website/src/pages/docs/cli.md` | 无独立产品变更；保留 MSW 内容，相关使用说明已在工作流及编辑器指南同步 |
| `website/src/pages/docs/editor-guide.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `website/src/pages/docs/json-schema.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `website/src/pages/docs/local-asr.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `website/src/pages/docs/providers.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |
| `website/src/pages/docs/workflow.md` | 结合 MSW 修改／同步，包含下表说明的实现差异 |

- E 最终完整 Python 1763 项运行通过、24 条件跳过；完整 Node 379/379 通过。点击组修复后 31/31，颜色组 10/10；新工程保存与整段 TTS 两项复测通过。
- Windows 本地 PyInstaller 候选构建成功；冻结入口与目录检查通过，随包 FFmpeg 生成波形、真实冻结 OpenAI 子进程对接 localhost 模拟服务、片段偏移及结果校验、原生 QPK1 生成均通过。未调用真实付费服务。
- 完整浏览器中另发现旧素材按钮数量断言和模型后缀默认值断言；按现有再生按钮与本次默认关闭规则修正，同时更新默认值提示。播放缓冲用例在前一次自动保存中触发快捷键，单独复测通过；测试改为等待保存完成后再准备磁盘夹具，不改变播放逻辑。

- 首轮完整浏览器 683 项：617 通过、19 失败、47 条件跳过。多数失败为此前 MSW 卡片／弹窗／默认值变化后的旧夹具；真实增量问题为表情包布局锚点与慢布局副轨居中，均已修正。字词断言保留毫秒映射并允许已有帧字段；滚动以屏幕位置而非懒布局下可变化的 scrollTop 验证。19 项统一复测及显式 FFmpeg 媒体组继续执行。

- 全量失败项统一复测连同关联新工程用例 22/22 通过。显式 FFmpeg 首轮媒体组 42 项中 31 通过、11 失败：9 项为测试启动时把可执行文件传给要求目录的变量，另两项为冲突提示被自动分析覆盖、编辑器工具设置遗漏已有 strict_config 校验；已修正并补跑。ASR 26 项全部通过，使用真实 FFmpeg 与 localhost 模拟服务。
- 最终资产／媒体工具／服务契约 60 项运行通过、3 条件跳过，版本与锁文件一致；文档和便携 HTML 已同步，LICENSE 与 THIRD_PARTY_NOTICES 无需新增依赖条目。本地验证通过后提交候选用于三平台五包 CI 预演，公开标签在预演与资产校验之后创建。

- 媒体导入＋视频导出修正后 16/16 通过。683 项浏览器全集中的 19 项失败已经统一复测通过，42 项 FFmpeg 条件用例补跑通过；剩余 5 项需可选真实油库里资源包，不宣称已实测。

- 三平台首次 CI 预演 [35522392445](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/35522392445) 在 Python 检查失败：Windows 11 失败／2 错误，macOS 12 失败／2 错误，Linux 1 失败／2 错误，均未进入发布。定位为临时目录别名（Windows 短路径、macOS /var）与规范路径断言不一致、真实媒体测试第二组遗漏工具可用性守卫并硬编码工具文件名，以及 POSIX 上 Windows 媒体路径的文件名提取错误。规范化夹具目录，统一真实工具解析／整组守卫，并将真实闭环加入三平台随包 FFmpeg 检查；修正跨平台媒体名提取后重新验证。
- main 已快进镜像 upstream/main 的 42656d849f4e2cce9cb21d718add86b692cc6028；产品同步以固定 beta.4 引用 afa288c6e6506dd20c4f04024f13c6967cc56eb0 记录合并祖先，不引入上游后续主线功能。
- CI 修正本地首轮 121 项有 4 失败：3 项为测试命令未使用 tests 包入口，未触发既有隔离初始化（金丝雀检测并自愈索引）；改用 tests.* 后余 1 项短视频封面失败。单独运行通过，定位为并发去重测试两个线程交错 mock 导致 duration=100 泄漏至后续真实测试；改为覆盖整个测试生命周期的单个 mock。随包测试同样使用 tests.*，确保应用数据隔离。
- CI 修正最终本地复测 121/121 通过，包含真实 FFmpeg 长短视频封面、波形、取消及媒体名索引闭环；保留前三轮日志。
- 第二轮 CI 预演 [35523133651](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/35523133651)，候选 9162be79c0e199f8e3b1b00633f1f691174fad92：macOS/Linux 均通过 1734 项 Python 运行（76 条件跳过），随包真实媒体／导出 40 项运行通过（1 平台条件跳过），冻结编辑器、localhost 模拟 ASR 子进程、QPK1 原生波形和普通工程剥离缓存通过；macOS 标准/lite 与 Linux AppImage 构建完成。Windows 与五包整体验证仍在执行。
- 第二轮预演 Windows Python 与 Node 通过，Chromium 340 项为 336 通过／4 失败，发布自动跳过。诊断包括两处滚动夹具未关闭初始 renderAll 的异步锚点恢复、取消模拟响应先于服务端接收取消、导入后的自动保存尚未完成就触发手动保存。补齐明确的交互／请求／保存等待边界，继续复测；不降低滚动位置、取消后素材数量或磁盘持久化断言。
- Windows 四项失败修正首轮重复测试 9 通过／3 失败（拆分夹具选项名误写为 preserveScroll，未关闭恢复）；更正为 preserveCueListScroll 后，四项各重复三轮，12/12 全部通过。候选产品代码未变化，仅修正夹具时序，重新进行完整发布预演。
- 第三轮 CI [35524264036](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/35524264036) 的 Windows 浏览器为 339 通过／1 失败，macOS/Linux 通过；剩余关闭点击滚动用例揭示产品异步 seek 跟随缺陷。将测试拆成媒体已加载／延迟加载两种，并显式发出 seeked/timeupdate，修复前两项都稳定复现 scrollTop=2170。修复时记录同步抑制的播放目标，延迟媒体加载保留本次跳转的抑制意图，继续验证下一目标跟随。
- 异步 seek 修复后，已加载／延迟加载媒体两种回归均通过，并在下一字幕继续跟随的断言下重复三轮，6/6 通过；完整 Node 379/379、编辑器契约 17 项运行通过（2 条件跳过）。点击、beta.4 与滚动矩阵 81 项正在执行，已通过点击及 beta.4 子集；与新的 CI 预演并行完成剩余回归，不提前发行。
- 本地滚动矩阵生成 output/playwright/cue-scroll 诊断文件，首个提交扫描因 SQLite 非文本文件失败，而命令未及时终止，导致 de2af1f 仅提交测试／报告；已停止该不完整候选预演 35525479652。自动审批随后拒绝批量提交，担心包含诊断文件；改用四个已核对源文件的显式暂存清单，测试数据库与日志不参与提交。未创建标签或 Release。
- 完整异步 seek 修复候选 3c312814cb0793ac593de7336a7014c45e7fe640 已启动预演 [35525678605](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/35525678605)。本地点击／beta.4／滚动稳定性矩阵 81/81 通过（含主、副、双轨、窗口与行高、保存中更新、触控打断、合并及撤销/重做），两种异步 seek 与下一字幕跟随 6/6 重复通过。合成诊断已移入仓库外验证目录保留。

- E 最终预演 35525678605 全部通过：Windows Python 1734 项运行（74 跳过）、Chromium 341/341、标准/lite 冻结入口、真实媒体导出 40 项运行（1 条件跳过）；macOS/Linux 构建与运行检查通过，五包 CRC／结构／SHA-256 校验通过。下载的预演 Release notes 与本地审查版完全一致，并包含五个包的哈希。
- 本次验证边界（仅说明）：未使用真实付费 ASR/TTS/翻译服务；MPS 模型推理使用单元模拟，未做真机模型推理；5 项依赖外部油库里资源的可选用例未执行；未宣称在所有第三方剪辑软件中做过人工导入验收。

- F：my-feature 与同步分支已快进到发行提交 2cc92257ca34a2718599c5328cd72f7081ce69fb，已创建并推送 v1.6.0-beta.4 标签；相对通过预演的 3c31281 仅验证报告变化。正式发行运行 [35526597161](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/35526597161)。
- 文档站部署 [35526597730](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/35526597730) 成功；公开主页和便携编辑器均 HTTP 200，确认 MSW 品牌及最终异步跳转修复。首检误以为主页必含中文品牌／版本号而失败，实际主页为合法英文 MSW 标题；改按双语品牌及便携编辑器内容验证后通过。
- 正式发行首轮 35526597161 的 Chromium 为 339 通过／2 失败，未创建 Release（API 确认 404）：表情包用例记录位置时初始化／旧恢复尚未稳定，主题用例可误接收较早的保存响应。原用例重复 10 项为 6 通过／4 失败，两组完整重复 48 项为 47 通过／1 失败，保留全部证据。仅补齐夹具就绪与最新颜色请求匹配，产品代码未变；两项各五轮复测 10/10 通过。
- 原未发布标签对象 c92fb4be6caa8149960d8546e0d02905d6027715 指向 2cc9225；后续对齐仅包含测试及报告修正，使用限定此标签旧对象的 force-with-lease，保留旧提交及本地备份引用，分支仍快进。
- 两组完整用例修正后重复两轮，48/48 通过；相对发行候选仅 tests/e2e/cue-color-filter.spec.mjs、tests/e2e/editor-upgrade-d.spec.mjs 和本报告变化。

## F 最终发行验收

- 最终发行提交为 `83cfc9cfe570543723ceffc00153f26542bcc5d6`，`v1.6.0-beta.4` 注解标签对象为 `7b0561e18bfcd3b65c32af297ab64e74fefca942`。my-feature 与同步分支均已推送；main 仍为纯上游 `42656d849f4e2cce9cb21d718add86b692cc6028`。本节后续文档提交不移动已发布标签。
- 正式发行 [35527871901](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/35527871901) 的三个平台构建、五包验证和发布任务全部成功。Windows Python 1734 项运行通过（74 条件跳过），Chromium 341/341 通过；标准／lite 冻结入口及随包媒体检查通过。
- [v1.6.0-beta.4 Release](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.6.0-beta.4) 已公开，prerelease=true、draft=false，目标提交与标签一致。实际发布说明与 `prepare_release_notes.py` 生成并审查的正文一致，附有五包对应 SHA-256。
- 从公开下载链接取得 Windows 标准／lite、macOS arm64 标准／lite 和 Linux x86_64 AppImage，五包大小及 SHA-256 与 GitHub 资产元数据、发布说明一致。`python scripts/check_release_assets.py --directory <公开包下载目录> --tag v1.6.0-beta.4` 通过五包 ZIP CRC／结构及 AppImage 检查；源码 ZIP／tar.gz 链接均 HTTP 200。
- 首次 Node 流式下载中断，保留失败日志；改用 curl 断点续传后五包完整下载并校验成功。最终 Python 校验首次被沙箱阻止启动，使用获准的沙箱外只读检查后通过；均不涉及产品代码修改。
- 对公开下载并解压的 Windows 标准和 lite 包分别执行 `python scripts/smoke_beta3_bundle.py <MSW.exe> --standard` 和不带 `--standard` 的检查，均通过。标准包实际完成随包 FFmpeg 波形、冻结 OpenAI 子进程对接 localhost 模拟 ASR、片段偏移／回填校验及原生 QPK1 生成；普通 MOSP 未内嵌运行态缓存。macOS/Linux 运行证据来自对应平台 CI，不宣称本机执行。
- 文档站与便携编辑器公开访问已验证，见前述 Pages 部署记录。B—F 均已完成，无待处理实施项；真实付费服务、真实 MPS 模型推理、可选油库里资源及第三方剪辑软件人工导入的验证边界仍按 E 阶段说明保留。
