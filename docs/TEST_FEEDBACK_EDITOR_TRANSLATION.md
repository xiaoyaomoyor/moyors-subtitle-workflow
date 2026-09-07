# 编辑器翻译 A0 + A1 实施记录

基线：`my-feature` / `7b20929`。保留现有 Web 编辑器；不合并上游、不提交或推送。本任务开始时仅有未跟踪的架构提案 `docs/dev/MSW_EDITOR_PROCESSING_ARCHITECTURE.md`。

## 需求与当前状态

| 编号 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 核对工程、选区、绑定、任务与翻译配置的契约；明确歧义 | 已修复 |
| 2 | A0：工程扩展往返、统一历史、后台任务、取消/恢复、结果冲突与工程会话隔离 | 已修复 |
| 3 | A1：复用已有 LLM 处理与配置，在“字幕 → 批量操作”增加“字幕翻译” | 已修复 |
| 4 | 无选择翻译全部主字幕；选中副字幕映射绑定主字幕；去重；忽略未绑定副字幕 | 已修复 |
| 5 | 无副轨则新建并对齐；已有副轨优先替换对应文本、保持位置；避免重叠 | 已修复 |
| 6 | 前端风格、进度、自动应用无冲突结果、一次撤销、便携模式说明 | 已修复 |
| 7 | 定向测试、完整必要检查、浏览器交互、便携产物与文档/更新日志 | 已修复 |

## 已确认的边界

- 用户确认：只选中未绑定副字幕时，提示没有可翻译主字幕，不能退回全量翻译。
- 已有副轨但没有绑定目标时，按已告知的默认方案：在起止均相差不超过 300ms 的未绑定副字幕中寻找唯一最近目标；有歧义或新建会重叠时保留结果并提示，不覆盖其他字幕。
- 本轮实现 A0+A1，不提前实现 TTS、音频素材或贴片。
- 后台使用提交时的内存快照，正常完成后自动应用仍有效的结果；来源/目标被修改时保留结果并提示，不覆盖用户输入。

## 过程记录（早期失败保留；最终结果见下节）

- 基线检查：已读 AGENTS.md、旧反馈记录、架构提案、git status 和 git diff；运行代码初始无改动。
- 已完成后台任务、工程扩展、翻译核心和面板的初步接线，正在验证；尚不标记功能完成。
- `python -m unittest discover -s tests -p 'test_postprocess*.py'`：126 项通过，原启动器处理行为保持兼容。
- `node --check`：editor.js、msw-processing.js、msw-translation-core.js 通过。
- 新增 Python 契约/任务/保存测试 10 项通过；Node 翻译、编辑器、波形测试共 279 项通过（首次旧 XML 测试因缺少 uv 失败，指定 `MSW_TEST_PYTHON` 后通过）。
- 第一轮真实浏览器已通过选中副字幕、只选未绑定副字幕、翻译期间编辑、取消任务等用例；空白导入菜单等待和刷新对话框处理正在修正测试条件。
- 完整 Python 检查首次 1179 项：存在隔离环境变量影响路径断言、子进程输出为 None 的既有测试干扰，以及需更新的服务页面/打包断言；正在逐项区分并重跑，尚未宣称全量通过。
- 当前机器无 uv 命令，使用仓库 `.venv/Scripts/python.exe`（Python 3.11.16）执行等效验证；启动此解释器需要沙箱外运行权限，已获自动批准。未调用真实云端服务。
- 不读取或输出用户 `.env`；后续自动化使用隔离配置和模拟服务。

## 最终交付与验证

- A0/A1 主链路已通过真实本机 HTTP + Chromium + 模拟 LLM：无选择翻译全部、已绑定副字幕映射、仅未绑定选区禁用、边编辑边处理、取消晚到结果、刷新后手动恢复、切工程隔离及一次撤销/重做共 7 项全部通过。工程保存和服务器接管的既有浏览器用例也已通过。
- `maw/msw` 负责队列、SQLite、权限、共享配置与扩展校验；`web/msw-*` 负责纯选择/冲突计算和任务面板。主编辑器只提供窄接口、统一历史和保存挂接。
- 10000 条字幕的纯选择/应用计算在本机 Node 测试约 53ms（不是浏览器整页渲染性能保证）。译文预览每次展开 50 条，避免大量 DOM 一次插入。
- 已修复首次部分成功新建副轨后的剩余结果恢复；用 `translation_target_tracks` 跟踪该任务自己创建的副轨，轨道被替换时仍拒绝应用。单元及真实浏览器验证均通过。
- 完整 Python suite 在 UTF-8、隔离配置的本机验证环境下运行 1179 项，全部通过，按原测试条件跳过 19 项。验证进程屏蔽真实 `.env`；初次输出 None 的原因确认为 Windows GBK 读取子进程 UTF-8 产生解码失败，并非功能异常。
- 最新 Node 检查 281 项全部通过。新增 Python 定向检查最终 11 项全部通过，包含任务幂等、持久化、取消/中断、密钥遮蔽、工程绑定、磁盘版本冲突及已有中文/长 ID 的兼容。
- 已用仓库虚拟环境执行 `edit.py --blank`，从源文件生成便携产物；窄窗口截图已目视检查，面板不会横向溢出且限制在视口内。
- 最后一轮 `playwright test editor-translation + editor-i18n-save + open-project-attach --grep-invert 'English locale covers'`：20 项全部通过（47.6s），其中翻译 10 项、保存/连接 8 项、接管 2 项。翻译包含英文标签、保存并复用配置、部分结果再次应用和生成便携页；实际 Python 服务监听 127.0.0.1，LLM 为同机模拟服务。
- 最后复核新增「字幕拖动时结果返回」保护：实际按住鼠标拖动期间不应用，松手后正常应用；单独浏览器测试 1 项通过（5.1s）。翻译浏览器覆盖合计 11 项，定向浏览器检查合计 21 项。文本编辑、字幕拖动、预览拖动和播放头拖动期间自动应用会等待。
- 最终契约复核保留了旧工程允许的中文及最长 160 字符字幕/轨道/绑定 ID；仅新任务和 MSW 工程身份使用自己的 ASCII ID 规则，避免合法旧工程被翻译接口误拒绝。此追加检查在全量 Python 检查后完成，定向 Python 11 项和 Node 281 项通过，便携产物再次重新生成。
- 原 `editor-i18n-save` 的全页面英文遍历检查停在现有搜索框占位文字断言（预期 Filter subtitles，当前 Type text to match）；未把此检查算作通过。另扩大执行 `waveform-history` 时发现撤销按钮定位、菜单等待、合并文本/滚动预期等失败，在执行到 37/72 时停止，尚未逐条排查；这些属于后续 UI 测试维护范围，本轮没有改动其产品行为。
- 尚未进行真实云端 API 调用或完整发行包构建；打包依赖清单与导入图契约已纳入通过的 Python 检查。

## 验证入口与范围

本机使用仓库 `.venv/Scripts/python.exe` 执行等价命令；未安装可直接调用的 uv。Python 全量检查通过临时隔离驱动调用 `unittest.defaultTestLoader.discover('tests', pattern='test_*.py')`，屏蔽真实 `.env`，并对需要子进程的测试注入独立空配置；启动解释器前设置 `PYTHONUTF8=1`。19 项跳过来自原测试的运行环境/可选能力条件，不是本轮人为排除。

```powershell
node --check web/editor.js
node --check web/waveform.js
node --check web/editor-i18n.js
node --check web/msw-project.js
node --check web/msw-translation-core.js
node --check web/msw-processing.js
node --test tests/test_msw_translation.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs
python -m unittest discover -s tests -p "test_msw_processing.py"
python edit.py --blank
node node_modules/@playwright/test/cli.js test tests/e2e/editor-translation.spec.mjs tests/e2e/editor-i18n-save.spec.mjs tests/e2e/open-project-attach.spec.mjs --grep-invert "English locale covers" --reporter=line
node node_modules/@playwright/test/cli.js test tests/e2e/editor-translation.spec.mjs --grep "active subtitle drag" --reporter=line
git diff --check
```

Node 的 XML 子进程和 Playwright 分别通过 `MSW_TEST_PYTHON`、`MSW_E2E_PYTHON` 指向仓库虚拟环境。模拟服务和字幕、媒体夹具均在临时目录，不加入仓库；未读取或输出用户密钥。

| 仅说明/未验证项 | 状态 | 后续 |
| --- | --- | --- |
| 原有全页面英文与扩大波形回归未全绿 | 仅说明 | 后续逐条对齐当前菜单入口、文案与交互预期；本轮不宣称全浏览器套件通过 |
| 真实服务商输出质量、账号权限、额度和网络 | 仅说明 | 在编辑器使用用户自己的配置实测；本轮没有发起付费 API 请求 |
| 完整发行包启动 | 仅说明 | 发版前构建并验证；当前仅通过打包清单/导入契约 |
| TTS 与音频贴片 | 仅说明 | 保持为架构提案的后续阶段 |

最后一轮验证曾因自动审批返回「额度已达上限」而未启动；用户要求继续后，同一验证成功运行，当前没有权限阻塞。所有本轮实现项均已完成，工作保留在 `my-feature` 的未提交更改中。

最终文件检查：33 个新增或修改文本文件均为 UTF-8、LF、无 BOM；新增 MSW 脚本与生成页面内容一致，`git diff --check` 通过。
