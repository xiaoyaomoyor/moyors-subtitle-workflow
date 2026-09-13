# 编辑器选区与 ASR 面板调整（2026-09-13）

基线：my-feature 上已有独立编辑器实现及未提交修改；保留全部 WIP，不改 main。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| 编辑选区工具、加减选、边界拖动 | 已修复 | 保留 Ctrl/Cmd+Shift 临时选择；支持不连续选区与逐片段精确编辑。ASR 分别提交，保留未选中的间隔。Chromium 选区 9 项与 ASR 16 项全部通过（1.2 分钟），含跨行、取消、原字幕拖动回归和真实 FFmpeg 分段提取。 |
| ASR 面板对齐 TTS，配置迁入环境配置 | 已修复 | 配置已全部迁移，无媒体可保存；新任务只用已保存配置，面板宽度 440px、SVG 关闭按钮和 TTS 一致。最终 ASR 19 项、原手势和剪贴板 13 项回归通过；多片段中途断线只重试剩余请求，任务卡片显示各自范围。 |
| 搁置和候选导出说明 | 仅说明 | 核对 `msw-asr.js`：搁置保留结果；候选工程仅含本次结果和媒体引用；候选 SRT 保留源时间，两种导出都不改当前字幕。已写入使用说明。 |
| 播放代理说明 | 仅说明 | 核对 `media_jobs.py`：生成浏览器可播放的 H.264/AAC MP4 缓存，ASR 仍用源文件、所选音轨。 |
| 原生与 REAPER 波形说明 | 仅说明 | 核对 `waveform.py`、`reapeaks.py`、`activeWaveShape()`：原生分析与已有 ReaPeaks 包络不同；下拉框切换已有数据，不生成 ReaPeaks。默认偏好 REAPER、缺缓存回退；新媒体自动生成原生，匹配旧缓存可复用。 |

本轮修改与说明全部完成。选区修改：`web/msw-range-selection.js`、`web/waveform.js`、工具栏模板、波形 CSS、`web/msw-asr.js` 多片段提交。配置迁移涉及环境设置模板、桥接与样式、`asr_config.py`、`api.py`；Launcher 参数校验增加仅供配置保存使用的可选媒体检查开关，实际识别仍检查媒体。已运行 `edit.py --blank` 重建便携页面。外部云端识别使用本机模拟服务，不使用真实密钥或付费请求。

## 验证记录

- 第二轮 Chromium：`editor-asr.spec.mjs`、`editor-time-range.spec.mjs`、`editor-tts-workspace.spec.mjs`，33 项通过（1.5 分钟）；含无媒体保存、保存后清空密码框、未保存草稿不参与调用、设置导航、窄窗口布局、TTS 回归。
- Node：`test_waveform_js.mjs`、`test_msw_asr.mjs`，65 项通过。
- Python：`test_msw_asr`、`test_gui_web`、`test_editor_assets` 共 280 项，首次有 3 项失败、1 项跳过。3 项失败均因测试命令的全局 `FFMPEG_PATH` 覆盖 GUI 工具路径夹具；移除该测试进程变量后单独重跑 `test_gui_web`，243 项通过（其中 1 项跳过），其余 37 项此前通过。未改产品代码规避夹具。
- 最终 Chromium：`editor-asr.spec.mjs`、`waveform-clipboard.spec.mjs`，32 项通过（1.5 分钟），含最后布局微调及多片段中途提交失败恢复。连同前轮选区 9 项、TTS 6 项，本轮相关浏览器用例共 47 项通过。
- 最终 Python：再次运行 `test_msw_asr`、`test_editor_assets`，37 项通过；与已通过的 GUI 243 项合计 280 项（279 通过、1 跳过）。
- 已查看最终多选区反色、ASR 调用面板、ASR 环境配置截图。确认设置内 ASR/LLM/TTS 导航、表单字号、标题关闭按钮和选区工具显示正常。
- 检查 75 个当前修改文件：UTF-8/LF、无 BOM、无机器路径，JS 语法和 `git diff --check` 通过。未修改 main，保留全部未提交工作。

## 交付边界

已更新源码、便携页面、使用说明和 changelog。本轮未重新打包 EXE；本机服务验证来自当前源码。未使用真实付费 ASR，也未重新执行 macOS/Linux 原生界面验证。不存在待处理、进行中或阻塞的本轮需求。
