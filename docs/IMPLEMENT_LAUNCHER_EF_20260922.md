# 启动器 E+F 实施记录（2026-09-22）

承接 `PLAN_LAUNCHER_INPUT_MODULES_20260921.md` 与 A+B、C+D 记录。用户授权完成 E/F 后提交并推送 `origin/my-feature`。既有 A–D 工作区属于同一修缮任务；`.test-appdata/` 与 TTS 引擎规划不纳入提交。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| E1 界面语言迁移 | 已修复 | 迁至外观与语言，保存只包含 guiLang；识别语言另行标注，保留所有表单草稿 |
| E2 说明浮层 | 已修复 | 明确选择可收纳说明；支持悬浮、聚焦、点击、Esc，不隐藏错误/进度/输出位置 |
| E3 导航与响应布局 | 已修复 | 统一层级缩进、收展动画、窄窗栏焦点与状态；亮暗主题/英文/缩放检查 |
| F1 自动化回归 | 已修复 | Python 全量、JS 契约与语法、启动器浏览器矩阵；如有失败记录真实原因 |
| F2 产物与文档 | 已修复 | 重新生成编辑器、更新计划/工作流/CHANGELOG、UTF-8 LF 与差异审查 |
| F3 提交与推送 | 已修复 | 功能提交 fc9acb1 已成功推送 origin/my-feature；main/upstream 未修改，本文随文档收尾提交同步 |
| 原生宿主/外部服务 | 仅说明 | 浏览器不能代替原生多选、拖入、窗口重开；不调用收费云端服务，不读取个人凭证 |

## 验证过程

- 基线：核对 AGENTS.md、实际源码、工作区及 A–D 记录；尚未把之前测试结果作为本轮完成证据。

- E 首轮 25 项：24 通过，聚焦自动滚动导致说明关闭 1 项失败；改为滚动时重定位浮层。
- E 新矩阵初轮：13/15 通过；一处测试点击落在浮层内部改为真实外部点击；另一处真实缺陷为设置页 Escape 先退出页面，已改为优先关闭导航抽屉并还原焦点。
- E 修正后 21/21 浏览器用例通过：12 个主题/语言/尺寸缩放组合、草稿保留、帮助交互、窄窗键盘、C/D 表单输出与工具。
- Node 首轮 XML 子进程无法启动；指定 MSW_TEST_PYTHON 后 285/285 通过，未改产品代码。
- Python 首轮 1625 项：4 failures、22 errors、17 skips。错误主要来自不兼容本仓库测试模块互导的 discover 顶层参数及 GBK/UTF-8 不一致；改按仓库默认 discover 并启用 PYTHONUTF8。两个缓存测试仍期待自检失败产物写入正式路径，已按 D 阶段原子发布契约调整，仍验证来源身份和最终数据；日志测试混用真实当前时间与固定时钟，统一使用已有固定时钟，避免日期漂移。

- 完整 Python 重跑：1799 tests，OK（skipped=24）。包括实际 FFmpeg 夹具、缓存重建、原始/译文/双语内容及工程扩展字段保真；未调用真实云端 API。
- 全部启动器浏览器：127 项，125 通过；2 项旧测试未按默认折叠展开卡片／英文首启后选择错误目标语言，修正操作步骤。最终定向复验 26/26 通过（覆盖两项失败、语言、设置、说明浮层及 12 组视觉参数），127 项唯一用例均取得通过结果。
- 真实 Windows WebView2 隐藏窗口冒烟：启动器使用 real 原生桥接正常加载，语言切换为 en、无缺失翻译键；后端 get_config 确认偏好已保存到临时配置。首次冒烟脚本误将真实标识预期写成 pywebview，按源码实际 real 修正后通过，产品无此故障。
- 视觉截图核对：1440×900 暗色预制/设置、亮色英文设置、960×800 英文 150% 工具页。无横向溢出，长路径/说明正常换行；截图仅保留在工作区外的检查目录。

## 未验证边界

- 真实原生文件选择器的多选、从资源管理器拖入、网络目录权限以及多窗口反复重开未做人工验收；原生桥接加载/配置保存与路径/队列契约分别有验证，不互相冒充。
- 云 ASR/LLM、完整 OCR 模型推理未实调；不使用个人工程或凭证。24 个 Python skip 的平台/依赖条件保留，没有将跳过项算作通过。

## 最终检查命令与产物

- Python：先 import tests 隔离应用数据，再 unittest discover -s tests -p "test_*.py"；PYTHONUTF8=1，FFmpeg 使用检查环境已有二进制。1799 项中 1775 通过、24 条件跳过。
- Node：node --check web/editor.js、web/waveform.js 及全部 web/launcher/*.js；node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs（指定 MSW_TEST_PYTHON）。285 通过。
- 浏览器：Playwright test launcher --project=chromium；最终定向复验 beta3-launcher、beta4-launcher、launcher-finish-ef、launcher-shell，26 通过，合计 127 项唯一启动器用例通过。
- 产物：uv run --active --no-sync python edit.py --blank 已成功生成；launcher-only 修改未造成 blank-editor.html 差异。
- 提交前 41 个任务文件 UTF-8、无 BOM、LF 检查及 git diff --check 通过；未纳入凭证、媒体、个人工程与截图。暗色语言选择框过渡完成后使用既有 #141414 背景与主题文字色。

## 交付

功能提交 `fc9acb1` 已由 `git push origin my-feature` 成功推送，远端从 `de20723` 前进到该提交。无关的 `.test-appdata/`、`docs/PLAN_TTS_ENGINES_20260921.md` 保持未跟踪；本记录与计划的完成状态作为文档收尾提交。
