# MSW v1.7.0：回归与发布准备

用户请求完成 MSW 回归，再准备发布。起点 `f6efdb18`，工作分支 `my-feature`；本轮准备候选版本与安装包预演，不创建标签或公开 Release。保留现有 `debug.log`、个人测试目录及 `main`，不读取维护者真实 `.env`。

| 项目 | 状态 | 范围与证据 |
| --- | --- | --- |
| MSW 回归 | 已修复 | 本机 Python 2391 通过／23 跳过，前端逻辑 833 通过，浏览器去重 198 项经测试坐标修正后全部通过。 |
| 版本与发行说明 | 已修复 | 版本统一 1.7.0，归档已适配内容并生成、审阅发行说明；保留 800ms 默认，不增加自动烧录。 |
| 三平台安装包预演 | 已修复 | 最终候选 `cb43f044` 三平台与五包总验均成功；下载后内容／SHA-256 复核和 Windows 标准／lite 本机启动检查通过。 |
| 正式发布 | 仅说明 | 当前请求是发布准备；待明确发布指令后使用通过验收的候选提交及安装包。 |

## 验证记录

- 已核对两阶段实施账本、工作区、发布流程与上次 v1.6.1 发行记录。上轮识别预设有 3 项清单遗漏已修复并定向复测；本轮重新运行最终组合的全量检查。
- 全量前端逻辑 833 项全部通过。版本同步、图标、JavaScript 语法及差异检查通过；打包契约与发行说明／附件／ZIP 共 40 项执行，39 通过、1 条件跳过。
- 全量 Python 执行 2414 项，2391 通过、23 项条件跳过（476 秒）；使用隔离配置与合成媒体，已完成最终组合检查，没有重现上轮清单遗漏。
- 更新中英文首页与安装说明，明确 1.7.0 为发布准备状态，移除过时的 macOS 暂缺提示与 1.6.0 更新链接。锁文件仅同步项目版本；依赖及许可证未改动。
- 发行预演增加两端识别、预设／配置管理、启动器编码、剧本保存、键盘和时间选区回归。构建仅使用 `workflow_dispatch`；公开发布步骤仍要求版本标签推送。
- [三平台预演 43600727428](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/43600727428) 固定候选 `3a282cd55889a6be54c5366c53d4e16b34161c50`，Windows、macOS arm64 与 Linux x86_64 均已开始执行。旧辅助脚本的本机代理不可用，改为直接连接 GitHub 后正常启动；没有改动项目网络配置。
- 首次 Linux 预演通过：Python 2375 项（110 条件跳过）、随包媒体 80 项（2 条件跳过）、AppImage 启动与冻结 ASR 通过。macOS 的 2375 项 Python 通过（110 跳过），随包媒体发现新手动烧录测试比较临时目录原路径与已解析路径：`/var/...` 和 `/private/var/...` 实为同一文件。断言改为比较 `resolve()` 后的路径，保留真实烧录、画面和参数断言；首轮失败如实保留，修正后重新预演。
- 路径修正后真实烧录单项本机复测通过。新预演 [43601588586](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/43601588586) 固定到 `c87e0e5f4f07b87ee775b1a26e1d7bf0a3a58d1e`。旧 Windows 英文／视频导出步骤已通过，随后主动取消已不可能通过的旧预演，剩余检查在新候选完整重跑；旧运行的取消不计作通过。
- 新候选的 macOS 与 Linux 预演均成功：各自 Python 2375 项（110 条件跳过）、随包媒体 80 项（2 条件跳过）；macOS 标准／lite 与 Linux AppImage 的冻结编辑器启动通过。macOS 路径断言问题未再出现。Windows 已通过英文／视频导出阶段，继续处理、配音及编辑器回归。
- 本机浏览器长回归发现波形历史两条旧用例仍按含边框宽度定位，分别导致跨行空隙范围断言失败及 9000ms 预期得到 9010ms。统一使用实际绘图区后，两条原断言均通过；保持精确时间要求，不修改产品坐标或放宽容差，继续整组复测。
- 本机 198 项长回归首轮完成：196 通过、上述 2 项失败，无其他失败；两项已通过定向复测。整组波形复测继续执行。最终预演 [43602826271](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/43602826271) 固定 `cb43f044ece5e63b27f29f46fbf10c59b0b48f69`，主动停止仍使用旧定位测试的第二轮，避免重复占用构建资源。旧包仅为过程证据，最终候选包以本轮预演为准。
- 波形历史整组 54 项最终复测全部通过（5.5 分钟）。本机浏览器按用例去重后 198 项全部通过；不将重复运行计作新增覆盖。产品代码在回归阶段没有改动，修正的都是跨平台路径和旧指针定位断言。
- 最终 `cb43f044` 三平台构建全部成功。Windows Python 执行 2375 项（103 条件跳过），Node 833 项通过；三组 Chromium 分别 36、147、278 项通过，共 461 项。Windows 标准／lite 冻结启动及随包媒体 80 项（2 跳过）通过。最终 macOS／Linux 各执行 Python 2375 项（110 跳过）、媒体 80 项（2 跳过），各自冻结启动通过；上述结果来自最终预演日志，不以旧候选替代。
- 最终预演及五包统一验收成功，发布步骤为 `skipped`。五包下载后再次通过 ZIP 内容／CRC、AppImage 标识、敏感文件排除、许可证与运行清单检查，SHA-256 与云端发行说明完全一致；四个 ZIP 中新增预设脚本、样式及两种独立运行环境模块均与候选源码一致。
- 本地补充版本校验最初将 macOS Frameworks 中的符号链接当成说明正文，正确解析 ZIP 内链接目标后，四包说明版本均为 1.7.0；安装包无需修改。
- Windows 标准／lite 下载后在隔离目录实际启动：1.7.0 页面、共享预设创建／删除／恢复和背景持久化均通过。标准包另通过随包 FFmpeg、真实冻结 OpenAI 子进程（本机合成响应）、来源时间偏移结果、应用验证及原生 QPK1 波形生成。lite 正确报告当前未配置媒体工具且正常启动，未混入标准包 FFmpeg。
- 未创建版本标签或 GitHub Release；核对公开 latest 仍为 v1.6.1。后续正式发布应采用下述候选提交及同一次预演的五包，避免未验收的重建附件覆盖候选。

## 可复核检查入口

所有本机测试显式设置隔离的配置／数据目录、现有 Python 与 Chromium，以及测试专用 FFmpeg；不读取真实 Key。

```text
python -m unittest discover -s tests -p "test_*.py"
node --test tests/test_*.mjs
python scripts/sync_launcher_version.py --check
python scripts/build_macos_icon.py --check
python scripts/prepare_release_notes.py --tag v1.7.0 --output <候选说明文件>
python scripts/check_release_assets.py --directory <候选包目录> --tag v1.7.0
git diff --check
```

浏览器使用 Chromium，覆盖 `asr-presets`、`editor-asr`、`speaker-rows`、`find-script`、`find-script-save`、`script-exchange`、`flat-production-flow`、`boundary-feedback`、`hover-seek-preview`、`waveform-history`、`editor-time-range`、`keyboard-timing`、`editor-video-export`、`editor-i18n-save`、`launcher-config-output`、`config-manager`，排除已退役的 portable 用例。完整云端检查入口为 `.github/workflows/release.yml`。

## 验证边界

本轮检查没有未解决失败，发布准备无阻塞。收费云服务使用合成响应，没有实测真实计费调用；macOS／Linux 证据来自对应原生 CI、启动及随包媒体检查，不等同于所有用户桌面环境。本轮未公开发布，`main` 保持原状。

## 发布交接

- 候选提交：`cb43f044ece5e63b27f29f46fbf10c59b0b48f69`。
- 成功预演：[43602826271](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/43602826271)。`MSW-*` artifacts 包含五个安装包，`release-preflight` 提供已审阅且附校验和的发行说明；正式发布时先确认 artifacts 尚未过期。
- 本任务最终记录提交仅更新验收文档，不改变候选程序。版本说明、两端界面和包内说明统一为 1.7.0；保持 800ms 默认停顿切句，不增加自动烧录。
- 原有 `debug.log` 与个人测试目录保留且不提交。正式发布仍待维护者明确指令。

| 候选安装包 | SHA-256 |
| --- | --- |
| `MSW-Linux-x86_64-v1.7.0.AppImage` | `be0f904935c8beb65c8b2305cf3f323d5dacbd9f7cd777649df81826f763cd55` |
| `MSW-Windows-x64-v1.7.0.zip` | `e03bbe298de78b071756ecadee18933ad6025d59f0b5e65084f9986578684d50` |
| `MSW-lite-Windows-x64-v1.7.0.zip` | `6a4b9bbedc9bc21bdc393ac55ad38a521d4cf35c5b2694baf46554838a8b648b` |
| `MSW-lite-macOS-arm64-v1.7.0.zip` | `719e58849f4361a0e0e952d102bb35e3bfd639cbbf05024d58cc405faf83f1a8` |
| `MSW-macOS-arm64-v1.7.0.zip` | `b2b6d4ffdd364c3aac9aff5f3fabfc17e00fd0f560e6b2bc0b5bc4470825da3e` |
