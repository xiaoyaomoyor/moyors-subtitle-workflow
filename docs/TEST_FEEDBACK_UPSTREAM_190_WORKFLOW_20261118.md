# v1.9.0-beta.1 流程改进与小修

用户批准实施筛选报告 B1–B3 及两项小修。本轮不含 C 类新功能、自动烧录、版本号调整或发布。

基线：`my-feature` / `1448e06b`。保留原有 `debug.log`（35 行增加）、`.test-appdata/`、`output/`、`tests/test_data/_msw/`；测试使用独立配置及合成数据，不读取个人 `.env`。

| 项目 | 状态 | 处理与验证 |
| --- | --- | --- |
| B1 重新断句保留局部可靠时间码 | 已修复 | 逐条选用字词或整句时间，补可选长度上限与数字/单位保护，保留 MSW 多轨和绑定处理。 |
| B2 普通文稿匹配可取消 | 已修复 | 接入现有取消和进度机制，检查长循环及提交边界。 |
| B3 复核列表批量操作 | 已修复 | 多选、全选筛选结果、批量状态/删除、搜索高亮；一次操作一条撤销记录。 |
| 小修：翻译文本幂等写入 | 已修复 | 相同内容不重复赋值，核对正文与剧本编辑。 |
| 小修：错误反馈版本和时间 | 已修复 | 复用当前错误卡片与复制报告。 |

## 验证记录

以下按实际运行结果记录；真实云端模型和桌面 WebView 不纳入模拟测试结论。

- B1：`unittest test_resegment_boundaries test_postprocess test_postprocess_pipeline test_launcher_queue` 164 项通过。首轮发现数字单位后接汉字时英文单词边界判断失效，已修正；调整原测试以核对未变化字幕 ID 和可靠 items 保留。一次测试模块名写错，已纠正。长度上限复用当前断句标点；粗时间字幕整条保留，不能安全满足上限时给出警告。浏览器与 v4 专项待集成验证。

- B2：`unittest test_script_match_cancel test_postprocess_match test_postprocess_pipeline test_launcher_flat_processing test_flat_processing test_gui_web` 363 项通过（1 项跳过）。覆盖真实 difflib 长匹配中断、保存前取消、保存期间拒绝取消、失败后重新执行、队列取消不发布和 v4 其他轨道保留。首轮测试发现既有配置锁文件需从无产物断言中排除，旧断句夹具模拟改写正文需改为原子切点协议，已修正；本机网络探测改在允许本机服务的环境重跑通过。误写的 CLI 测试模块名已移除，核心 CLI 匹配通过取消测试直接覆盖。

- B3：真实 localhost 编辑器 + Chromium 的 `review-markers.spec.mjs` 9 项通过，包括批量状态/删除的一次撤销、筛选勾选边界、字面搜索高亮、安全显示备注、保存重开、拖动和取消、跨行端点、标记颜色和关闭后重开。检查了深色 280px 窄面板、浅色全界面截图，控件与文字无横向溢出。

- 小修（界面翻译）：文本节点增加相同值判断；属性原先已有相同值保护，保留。正文/剧本浏览器检查结果见最终汇总，新增检查直接观察重复切换同一语言时的 DOM 修改记录，并补批量复核英文文案。上游光标问题没有在 MSW 复现，本项作为防护优化。

- 阶段汇总：B1–B3 和两项小修均已完成。正文与剧本的真实浏览器回归 26 项通过；启动器错误报告/脱敏/复制和字数设置保存恢复 3 项通过。错误卡片显示版本和本地时间，复制报告使用出错时固定的版本及 ISO 时间，不使用复制时的时间。另补 2 项 Python 专项通过，确认提交时的断句标点覆盖后来保存的设置，v4 混合时间精度只影响所选未绑定轨道且保留其他轨道与绑定。
- 集成验证：已运行完整 Python 回归与核心 Node 回归；真实云端服务、桌面 WebView、跨平台发行包不以模拟测试替代。

- 整体验证进度：核心 Node 回归 361 项通过。首轮完整 Python 回归运行 2532 项，28 项跳过，唯一失败为媒体取消测试绕过 Launcher 初始化后未补新增提交状态字段；已更新该夹具，复跑结果见下文。后续边界复查补齐 m、摄氏温度等常见单位与旧模式额外断句符号，相关 Python 回归 422 项通过（1 项跳过）。
- 浏览器总计 38 个不同场景通过（复核 9、正文/剧本 26、启动器 3）；另重跑 2 项检查英文批量复核和错误卡片布局，通过。错误卡片显示与复制的时间固定在事件发生时，原脱敏仍通过。

## 最终核对

- 完整 Python：`python -m unittest discover -s tests -p "test_*.py" -v` 运行 2532 项（28 项跳过）。复跑仅 `test_unregister_removes_entry_only` 失败：沿用首轮隔离目录，前一轮 `RealUserDataZeroWriteGuard` 留下的合成 `guard.mosp` 登记混入最近工程；并非本轮产品代码回归。换全新隔离配置与应用数据目录后，`unittest test_launcher_projects test_media_tool_cancellation test_script_match_cancel` 64 项全部通过。没有为此修改工程登记行为或放宽断言。
- 核心 Node：`node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_flat_processing.mjs` 361 项通过。
- 浏览器：39 个不同场景通过；在前述 38 项基础上，补跑 `launcher-queue.spec.mjs` 的停止与旧任务事件隔离检查。英文批量复核和错误卡片重复检查 2 项通过，已检查真实截图。
- 所有本轮 Python 文件语法检查、变更 JS 的 `node --check`、`git diff --cached --check` 通过；30 个提交文件均为 UTF-8/LF，扫描未发现个人绝对路径或疑似真实凭据。新边界模块已列入 ASR/OCR 外部运行时源码清单；未实际构建发行包。
- 无待处理功能项或代码阻塞。真实云端模型、桌面 WebView、其他操作系统及发行包未在本轮实测；LLM 返回采用本地可控响应检查协议与数据保护。
- 仅提交本轮文件到 `my-feature`；`main` 保持 `a8bf4384`，原有日志 35 行及三个未跟踪目录保留，不创建 tag 或 Release。
