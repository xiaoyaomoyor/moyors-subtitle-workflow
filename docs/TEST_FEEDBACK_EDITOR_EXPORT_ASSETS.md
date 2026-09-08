# 导出字幕烧录、播放头描边与素材库优化

基线：`my-feature` / `426c477`，保留此前未提交的 D3/D4 修改。用户要求实施四项调整，并说明 E 阶段油库里资源的接入方式；本轮不实施油库里、不推送、不调用云端合成。

| 编号 | 内容 | 状态 | 决定与验证 |
| --- | --- | --- | --- |
| F1 | 视频可选压制字幕 | 已修复 | 复用启动器 libass 滤镜及默认样式；不压制／主／副／双字幕随范围与空隙映射。真实 FFmpeg 音视频渲染 19 测试通过，双行像素、空白区间和跨编码块通过；视频／OTIOZ 浏览器 5 测试通过。字体依赖系统，表情包不烧录 |
| F2 | 播放头命中音频贴片描边 | 已修复 | 只更新可见贴片命中 class，不重建 DOM；沿用字幕块的播放头颜色及选中优先级。Chromium 新测试覆盖暂停、边界 Seek、播放、静音，既有拖动／配色 2 测试通过。测试先修正颜色控件选择器，再使用等待式断言消除异步重绘竞态 |
| F3 | 素材库模块切换菜单 | 已修复 | 菜单按内容定宽、最小 128px 并约束视口，名称单行。Chromium 实测五个名称均一行且未截断，模块切换通过；截图已查看 |
| F4 | 素材库卡片与密度 | 已修复 | 默认三列；图标播放／暂停、下载 WAV、放置及拖动保留。每页 90 项，密度 1–5 列存浏览器，窄窗口自动减列。卡片刷新保留焦点与滚动。Chromium 针对性 6 测试通过，含 105 素材分页及 270px 窄面板；默认／窄屏截图已查看 |
| Q1 | 油库里资源与部署方式 | 仅说明 | 重新读取指定仓库公开 README／package.json 及底层官方 README；建议内置 MSW 适配器 + 可选本地资源包，支持自定义目录，普通用户无需 npm。AquesTalk 资源保留其许可；运行时与工程分离，已生成 WAV 直接复用现有导出。本轮未安装／实现，Node 兼容性待 E0 实测 |
| V1 | 回归与产物 | 已修复 | Python 全量运行 1260 项（19 跳过），Node 303 项、Chromium 最终 46 项均通过；便携页已生成，Ruff／语法／diff／发布扫描通过。用法、契约、changelog 和架构同步 |

阶段汇总：F1、F2 已通过针对性真实媒体／浏览器验证；尚需完成素材库布局、最终回归及生成产物。

第二次汇总：F3、F4 也通过针对性浏览器验证。四项实现均已落地，进入最终回归；E 引擎保持仅说明。

## 最终验证与交付

- Python：隔离驱动调用 `unittest.defaultTestLoader.discover('tests', pattern='test_*.py')`，1260 项运行完成，19 项条件跳过，无失败。阻止读取真实 `.env`，恢复库使用测试目录，包含真实 FFmpeg 和官方 OTIO 解析。新增字幕投影测试覆盖源范围、空隙、禁用字幕和文本转义；真实视频测试检查字幕像素、双行分离及跨块同步。
- Node：`node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_translation.mjs tests/test_msw_tts.mjs tests/test_msw_audio.mjs tests/test_msw_audio_render.mjs`，303 项通过。
- Chromium：`editor-tts.spec.mjs`、`editor-video-export.spec.mjs`、`editor-audio-export.spec.mjs`、`subtitle-preview-geometry.spec.mjs`，最终同一轮 46 项全部通过。覆盖实际播放／暂停、边界 Seek、选中优先级、静音、拖动、素材分页与密度、窗口切换、保存恢复、真实 WAV／MP4／OTIOZ 下载及便携页字幕布局。所有 TTS 使用本机模拟服务。
- 产物：隔离配置下运行 `python edit.py --blank`，重新生成 `blank-editor.html`；编辑器、波形、TTS、音频贴片、导出及 i18n 的 `node --check`，相关 Python 模块 Ruff，以及 `git diff --check` 均通过。36 个变更文本文件通过 UTF-8／LF／BOM、凭据形状和个人路径扫描。
- 视觉：已查看实际 Chromium 截图中的可选压制表单、播放头描边、模块下拉、默认三列卡片及 270px 窄面板；媒体、截图和测试日志留在仓库之外。

F1–F4 已修复，无阻塞项；Q1 仅说明，不包含引擎安装或兼容性承诺。字幕压制依赖所用 FFmpeg 的 libass 和系统字体；本轮未测试 macOS／Linux、打包发行版或小时级压力。更新后需重启本机编辑器服务并刷新网页，后台才会载入新增压制能力。全部修改保留在 `my-feature` 工作区，未提交／推送，未同步上游或重启用户服务。
