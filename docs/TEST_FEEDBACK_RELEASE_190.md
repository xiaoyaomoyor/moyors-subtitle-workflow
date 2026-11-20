# MSW v1.9.0 正式版修复与验证

基线 `my-feature` / `7b360427`，范围为筛选报告的工程切换与去空隙 SRT 两项，以及回归后的正式版发行。初始工作区已有 `debug.log` 的 35 行改动及 `.test-appdata/`、`output/`、`tests/test_data/_msw/`。测试用隔离配置和合成媒体。

| 项目 | 状态 | 验证 |
| --- | --- | --- |
| 工程切换竞态 | 已修复 | 服务端读盘及绑定专项 29 项通过。Chromium 打开工程、媒体关联及保存 27 项通过，导出保存选择器另见 SRT 组。 |
| 去空隙 SRT | 已修复 | 正常字幕及时间线配套 SRT 复用有效裁剪区间，Chromium 25 个场景均有通过记录。 |
| 旧格式翻译 | 仅说明 | 用户选定前两项，兼容翻译留作独立工作。 |
| 全量回归与发行 | 已完成 | 本机 Node 846 项、Python 2556 项、Chromium 定向 52 项通过。正式版三平台构建和 Chromium 626 项通过，五个安装包已公开。 |

筛选依据见[上游正式版评估](UPSTREAM_190_ASSESSMENT.md)。

工程切换在浏览器按用户操作排序，在服务端读盘前登记并在绑定前复核。覆盖文件选择、拖入、最近工程、新建／另存位置和恢复副本。读取仍在保存锁外。迟到的接管返回冲突，迟到的媒体/BWF 回调不提交到新工程。字幕和源时间线保存选择器依据当前工程代次保护旧导出。

- Python `test_delayed_recent_project_cannot_replace_newer_binding`＋`test_msw_persistence` 29 项通过。新增测试第一次缺少 `load_project` 所需的波形采样参数，补全夹具后通过。
- Chromium `project-switch`、`media-association`、`editor-editing-save` 共 27 项通过。受控延迟浏览器 File 读取及真实本地服务接管，验证最新文本、媒体、保存绑定及重开行为。

去空隙 SRT 在分组、合并和对齐起点前排除无保留画面的字幕。合并生成的行再检查一次，避免仅在切除区间内的合并片段出现。时间线配套 SRT 复用筛选规则，没有字幕时不生成空文件。跨切点保持现有时间映射。

- Chromium `subtitle-export-panel`＋`audio-gaps` 首轮 24 项通过。新用例把锁定空隙标记误当作保留画面，导致期望中的字幕实际仍在删除区间。改用两段真实切除区间和其中一处锁定标记，定向重跑 1 项通过。覆盖普通、合并、说话人、时间线配套 SRT，及原时间轴和切换工程后终止旧导出。

Python 全量首轮 2579 项中 4 失败、23 条件跳过。三个 Launcher 清理测试虽使用临时注册表，仍从全套测试共用的最近工程设置中合并额外记录。新增服务端竞态测试在单独运行时通过，全量中却被已有设置覆盖其内存夹具，未到达预期的延迟读盘点。为这四项测试显式提供临时最近工程设置，保留原断言，重跑完整套件。

最终 `python -m unittest discover -s tests -p 'test_*.py' -v` 共 2579 项，2556 通过、23 条件跳过、无失败。跳过涉及平台条件、历史波形样本、可选 NumPy／OTIO／Yukkuri 及真实对齐示例。全部 `tests/test_*.mjs` 共 846 项通过。Chromium 定向组去重 52 项通过。测试日志位于仓库外 `msw-checks/190-stable/`，所有媒体及设置均为合成或隔离测试数据。

同步 pyproject、锁文件、Launcher、编辑器与安装说明，归档 `CHANGELOG.md` 的正式版小节，生成实际的 v1.9.0 发行说明。两个新增浏览器文件纳入现行发行回归组。真实收费服务、完整本地模型推理及各桌面端人工全流程不作为本轮自动化验证。

## 正式构建

首轮发行候选 `4b46c8b34eb743e06e682774119fb589397b2747`，标签 `v1.9.0`。离线锁检查、版本同步、26 项打包契约、UTF-8／LF 与提交范围检查通过。许可证及第三方清单沿用已核验版本。正式构建按同一标签执行，待三平台及五包校验通过后公开。[GitHub Actions 44674703561](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44674703561)

- macOS／Linux 已通过，各运行 Python 2537 项（116 条件跳过）、打包契约 26 项、随包媒体专项 94 项（2 条件跳过），冻结入口及原生 QPK1 生成均通过。
- 首轮已下载并独立核验上述三个安装包，macOS 相关前端文件与首轮提交字节一致。
- 首轮 Windows 构建及既有浏览器组通过，最后新增组 44 通过、1 失败。失败点是新 SRT 测试末尾的整份工程快照比较，CI 此时才完成已启用的波形自动倍率计算，唯一变化为工作区 `waveformScale` 从 1 到 6。各 SRT 内容与时间断言均已通过。把此断言限定为字幕（含轨道与绑定）和裁剪源数据，保留全部 SRT 断言，再跑完整发行流程。首轮五包汇总与公开步骤均未执行。
- 修订后本机 `subtitle-export-panel.spec.mjs` 12 项通过。此轮修订仅含测试和本记录。首轮未公开发行，保留原标签对象 `0dce8fdd` 的本地备份，按原远端值校验后更新未发布候选标签。
- 第二轮候选 `e9309ed4a201cb7b7438321c6b202c620f4c1ed7`，包含测试断言与记录修订，产品文件与首轮相同。恢复推送时有一次连接中断，重试成功。后续仅使用第二轮五包。[GitHub Actions 44682244981](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/44682244981)

## 正式版发行结果

GitHub Actions 第二轮全程通过，`v1.9.0` 于 2026-11-20 14:40:58（北京时间）公开，GitHub 已将其列为最新正式版。发布标签指向 `e9309ed4a201cb7b7438321c6b202c620f4c1ed7`。[正式版](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.9.0)

- Windows、macOS、Linux 各通过 26 项打包契约，分别运行 2537 项 Python 检查（Windows 跳过 109 项，macOS 和 Linux 各跳过 116 项）。三平台各运行 94 项随包 FFmpeg 专项（2 项条件跳过），冻结入口和原生 QPK1 生成通过。
- Windows Chromium 七组共 626 项通过，含 v1.9 编辑、工程切换和字幕导出组的 45 项。首轮受波形自动倍率影响的 SRT 用例在第二轮通过。
- 独立下载核验第二轮五个安装包，校验值与 GitHub 发版文件及说明逐项一致。Windows 两个发行包在隔离目录中均通过直接启动检查，并验证了随包的工程切换接口和 SRT 代码，标准版另通过随包媒体工具、合成音频识别和生成波形检查。

| 发行文件 | SHA-256 |
| --- | --- |
| `MSW-Linux-x86_64-v1.9.0.AppImage` | `c75950f57e7c4bd9da9d4c87c995fc8273138e15097146b2efdfc7a65b15e15c` |
| `MSW-Windows-x64-v1.9.0.zip` | `1d2c296cd1a7d2e3986e8347edb8badb6ca84719dd569634f94d212c696e5ae7` |
| `MSW-lite-Windows-x64-v1.9.0.zip` | `afb47d0af189ff067addc7f088d8b8f197c23c5854fbaa7f24a45c51aadefb27` |
| `MSW-lite-macOS-arm64-v1.9.0.zip` | `d8f58512e51150cf2dc71209c5c7968fc6d07ac55d5881e93195416e420a99c9` |
| `MSW-macOS-arm64-v1.9.0.zip` | `4de86bb01d8b367ee024f2547df0066278f78d99df9b50387d06000b030b54f1` |
