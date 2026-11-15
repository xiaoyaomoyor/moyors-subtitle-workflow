# v1.8.0-beta.1 选择性跟进：缺字提示与 macOS FFmpeg

基线：`my-feature` / `496ccb70471999eac015ef7fd447296ed1932566`。本轮仅实施筛选报告中的第 3 项，不发布版本、不改动 `main`。

| 项目 | 状态 | 处理决定 |
| --- | --- | --- |
| 字体回退后仍缺字时明确提示 | 已修复 | 根据 libass 最终缺字诊断提示字符、码点和字体；正常回退不误报。预览修改后清除旧提示，编辑器与启动器烧录拒绝发布缺字成品且不触发 CPU 重试。 |
| macOS 完整版 FFmpeg 路径发现 | 已修复 | 加入 Apple Silicon / Intel 的 `opt/ffmpeg-full/bin`，先于通用 Homebrew 目录。显式配置、环境变量、随包工具优先级及 ffmpeg / ffprobe 独立查找保持不变。 |
| 回归与交付 | 已修复 | 最终标准 Python 2400 项成功（96 跳过），Node 835 项通过，浏览器及实际烧录验证完成；按既有授权提交推送本任务改动。 |

## 工作区与边界

- 保留原有 `debug.log`、`.test-appdata/`、`output/`、`tests/test_data/_msw/`；不读取真实 `.env`，测试使用隔离目录。
- 不引入上游另一套 ASS 编辑或预览系统，不自动安装字体或 FFmpeg。
- macOS 安装位置可通过模拟平台验证；当前 Windows 环境不能代替 macOS 真机验收。

## 验证记录

- 字体相关单元与打包契约：`python -X utf8 -m unittest test_subtitle_glyphs test_msw_video_encoding_options test_postprocess.MediaToolTests test_packaging_contract`，40 项通过；Node 缺字诊断测试 2 项通过，预览脚本语法检查通过。
- 真实 FFmpeg：编辑器和启动器烧录 U+10FFFD，明确报缺字；不重试、不覆盖已有成品、不残留半成品。1 项通过。首次运行受 Windows 隔离临时目录原子替换限制（WinError 650），改用工作区隔离 TEMP/TMP 后通过，未修改产品行为规避此环境限制。
- Chromium + 本机服务：`subtitle-glyphs.spec.mjs` 2 项通过。验证播放过程中出现缺字、正文修改后清除提示、指定字体不存在但正常回退时不误报；截图位于仓库外的 `msw-checks/font-ffmpeg-20261115/browser`。
- 预览只检查已渲染内容，烧录检查实际输出的完整字幕范围。诊断按字体与码点去重、最多列出 8 项；更多缺字明确省略，日志不进入页面。
- JASSUB 只添加可重建的 worker 诊断扩展；WASM、依赖版本和许可证不变。
- macOS 路径：`python -X utf8 -m unittest test_ffmpeg`，11 项通过，涵盖无 PATH、完整目录优先、缺项继续补齐、手动／环境／随包优先、严格配置、Windows/Linux 不受影响及 PATH 去重。未进行 macOS 真机验收。
- 阶段汇总：两项功能的针对性验证通过，进入整体回归；全量 Node 测试 835 项通过。
- 浏览器相关回归 6 项通过（108 秒）：万条字幕局部预览、正文／撤销／跨时间窗口、更新失败保留预览、快速输入丢弃旧响应，以及本轮缺字／回退。随后补充提示轮询不重复改写状态、不覆盖更新失败信息，最终 `subtitle-glyphs.spec.mjs` 3 项通过（32.2 秒）。
- 全量 Python 首轮在受限进程环境中以 Windows 原生异常退出（`0xC0000008`），未获得完整测试结论；随后使用新的隔离应用目录、可运行本机服务的进程权限和离屏 Qt 重跑。
- 第二轮配置真实 FFmpeg，2440 项 / 426.3 秒 / 87 跳过，仅资源清理旧断言报错：它假定 stderr 是管道，本轮为防止大量警告堵塞已改为临时文件，因此对 `None.closed` 报错。已改为捕获实际日志文件并验证其关闭，保留对子进程终止、stdout 关闭的断言。取消及缺字相关 14 项复测通过；该轮其余测试（包括实际视频编码、字幕烧录、缺字拒绝输出）均通过。随后用全新隔离目录完成标准全量回归（未再次配置可选 FFmpeg），结果见下文。
- 最终前端代码再次执行全量 Node 835 项，全部通过；JS 语法、渲染资产摘要、UTF-8/LF 及 `git diff --check` 通过。

## 上游与工具依据

- 上游参照：`upstream-release/v1.8.0-beta.1` / `1f008d8a`，只移植本轮语义，不套用上游 ASS 界面。
- [libass 最终字体回退诊断](https://github.com/libass/libass/blob/0.17.4/libass/ass_fontselect.c)：最终缺字属于警告；[FFmpeg 日志等级映射](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavfilter/vf_subtitles.c) 会映射为 warning。因此仅对烧录启用 warning 级日志，避免原来的 error 级过滤掉诊断。
- [Homebrew ffmpeg-full](https://formulae.brew.sh/formula/ffmpeg-full)：包含 libass 且为 keg-only，因此补充 `opt/ffmpeg-full/bin` 路径。MSW 自定义／标准版工具优先级保持原样。

## 最终验证与交付

- `.venv/Scripts/python.exe -X utf8 -m unittest discover -s tests -p "test_*.py"`：全新隔离环境，2400 项 / 286.1 秒，成功，96 项按可选工具或平台条件跳过。真实 FFmpeg 的额外视频测试及本轮缺字拒绝输出已在上述专项／第二轮实际执行。
- `node --test` 执行全部 `tests/test_*.mjs`：835 项通过；Playwright 相关回归 6 项通过，最终缺字专项 3 项通过。实际浏览器验证覆盖 7 个不同场景。
- 渲染资源重建成功，`SOURCES.json` 摘要一致；JASSUB WASM 未变化。JS 语法、Python／前端装配及打包契约、UTF-8/LF、`git diff --check` 均通过。
- 没有未解决的实现阻塞。macOS 仅验证路径与优先级规则，未作真机验收；本轮未重新生成发行包。
- 仅包含本轮源代码、测试、日志与说明文档。原有 `debug.log`（35 行新增）及三个测试／输出目录保留；`main` 仍为 `a8bf4384`。按既有授权提交推送 `origin/my-feature`，版本与发布标签保持不变。
