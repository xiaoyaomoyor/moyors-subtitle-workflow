# v1.9.0-beta.1 四组可靠性修复

范围：用户批准实施筛选报告 A1–A4；不含三项流程增强、可选新功能、版本升级或发布。

基线：`my-feature` / `5fd296d2`。保留原有 `debug.log`（35 行增加）、`.test-appdata/`、`output/`、`tests/test_data/_msw/`。使用独立配置和合成数据，不读取个人 `.env`。

| 项目 | 状态 | 处理与验证 |
| --- | --- | --- |
| A1 本地 LLM JSON 兼容和本机免 Key | 已修复 | 明确格式拒绝才按 object/schema/text 有界降级，按端点和模型缓存；前置思考块过滤和尾部结构修复，保留正文和严格校验；免 Key 接通启动器、管线和编辑器。相关 Python 回归 446 项通过（1 项既有跳过），真实本机服务浏览器场景通过。 |
| A2 基础波形多声道聚合 | 已修复 | FFmpeg 保留声道，通过有界 WAV 头读取 PCM 布局，按帧计时并聚合声道极值；保留取消、进度、QPK/MPK 格式。102 项相关测试通过（1 项既有跳过）。 |
| A3 Linux 冻结运行时与源码清单 | 已修复 | 宿主运行时、启动探测、桌面通知/目录打开恢复库路径，不改父环境；补齐 local/OCR 原始源码依赖。169 项相关测试通过，包括隔离目录实际导入。 |
| A4 ASR 错误分类与任务密钥脱敏 | 已修复 | 启动器、混合队列、旧批处理及编辑器共用输入检查和明确错误分类；子进程日志及报告先脱敏，空结果利用现有音轨信息提示。526 项相关回归通过（1 项既有跳过），后续针对输入空白及中文最终错误的 48 项复查通过。 |

## 验证记录

- A1：`unittest tests.test_llm_local_compat tests.test_llm_retry tests.test_llm_connection tests.test_postprocess tests.test_postprocess_pipeline tests.test_msw_processing tests.test_gui_web`：446 项，成功，1 项既有跳过。覆盖格式协商缓存、流式响应、取消边界、文本保真、尾部修复、各入口 Key 策略及本机 HTTP 测试。
- 首轮受运行环境的本机套接字限制和临时目录原子替换失败影响；改用独立工作区临时目录并允许本机测试服务连接后通过。一个新测试将包含闭合标签的文本误写为“未闭合思考块”，修正夹具后通过；原有非法 JSON 测试改用不可安全修复的未闭合字符串，以保留协议重试覆盖。
- A1 相关 JS 语法与 `git diff --check` 通过。浏览器已验证本机无 Key、Schema 降级及译文应用。
- 真实 Linux 冻结包和外部模型服务尚未验证，需要与模拟/契约测试区分记录。
- A2：`unittest test_waveform_multichannel test_waveform test_mopeaks test_media_cache test_cache_management test_msw_media_jobs`（测试目录加入导入路径）：102 项成功，1 项既有跳过。真实本机 FFmpeg 验证单声道、同相/反相双声道、仅右声道、六声道、静音、非整除峰率、帧时长、进度、错误及取消。首轮两个模块因测试间导入路径未配置而未加载，补齐路径后通过。
- A2 缓存策略：不变更二进制格式、不批量使旧缓存失效；旧平线通过波形设置的“重新生成波形”按需刷新。新增实际回归确认该操作绕过旧平线并更新共享缓存，下一次正常读取即可得到修复后的波形。此边界需在用户交付中明确，不宣称旧缓存会自动刷新。
- A3：`unittest tests.test_host_runtime_environment tests.test_local_runtime tests.test_ocr_runtime tests.test_runtimes tests.test_notify tests.test_packaging_contract tests.test_gui_workflow`：169 项全部通过。模拟 Linux 冻结/非冻结和其他系统、原路径缺省/空/非空，检查父环境不变；把打包清单源码复制到隔离目录，使用独立子进程实际导入 local/OCR 入口，禁止源码目录兜底。
- A3 隔离导入发现 MSW 样式依赖漏装：除 `moss_runtime`、`runtimes.freezer`，补齐 `cue_style`、背景、渐变和动画源码。原依赖图测试漏掉 `from package import module`，修正后同时覆盖这些子模块。MSW TTS/油库里已有环境白名单，不继承包内库路径，保持现有行为。
- A3 首轮有新测试调用错内部方法名，以及测试进程默认 GBK 解码 UTF-8 子进程输出；修正方法名、启用测试进程 UTF-8 后通过。实际 Linux 安装包运行仍未验证，不以模拟及源码导入替代。

- A4 首轮 526 项完成，仅一个既有通用失败测试仍以“未识别到任何内容”模拟错误，现已改用通用模型失败文本；空结果新增专门测试。另一次首次加载因编辑位置匹配错误产生缩进错误，已定位修复并通过模块语法检查。

- A4：`unittest test_asr_errors test_audio_diagnostics test_asr_reliability test_gui_config test_gui_workflow test_gui_web test_launcher_batch test_launcher_queue test_msw_asr test_host_runtime_environment test_packaging_contract`：526 项成功，1 项既有跳过。最后补充编辑器输入去除首尾空白、中文最终错误覆盖此前重试日志，`unittest test_asr_errors test_asr_reliability test_msw_asr`：48 项全部成功。
- ASR 空结果只检查本次生成的字幕中间结果、最终明确错误和已有音轨元数据，不做静音扫描、不额外请求服务。混合队列保留 MSW 原有多轨处理与单任务失败隔离；取消仍显示取消。
- 前端逻辑：`node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_flat_processing.mjs`：361 项全部通过。首次未指定测试 Python，XML 测试经 `uv` 启动失败；改为指定仓库虚拟环境后通过。
- 浏览器首轮：24 场景中 9 项通过、15 项失败；免 Key + Schema 协商 + 应用译文场景通过。失败集中在保存配置仅等待 5 秒，跟踪记录显示请求仍未响应；单独延长等待至 30 秒后，真实服务上的原主字幕回填场景通过（总计 18.9 秒）。保留实际服务验证、不伪造保存响应；后续完整复查及失败项重测结果见下。

- 浏览器复查发现一个旧测试仍寻找已移除的 LLM 二级导航；改为定位当前服务设置中的 LLM 控件，保持原有配置/调用断言。

- 全量 Python：`unittest discover -s tests -p "test_*.py"` 执行 2517 项，28 项跳过；仅离线对比产物一致性的两个子项失败。实际生成 diff 确认是前次复核标记文字色更新未进入两份离线页面，非本轮 ASR/LLM 实现错误。执行 `scripts/build_comparison_tools.py` 同步既有源码后，`unittest test_comparison_build` 通过（1 项含两个页面检查）。不重建历史便携编辑器。
- LLM 中英文各有一处过期的二级导航选择器，均已调整至现有 LLM 服务控件；中文配置管理场景单独复查通过。最后的错误文案标点优化经 `unittest test_asr_reliability test_msw_asr.AsrDiagnosticTests` 8 项通过。

- 浏览器最终结果：`playwright test tests/e2e/editor-translation.spec.mjs tests/e2e/launcher-asr-options.spec.mjs tests/e2e/launcher-queue.spec.mjs` 共 38 场景，整组 36 成功，另两项仅失败于旧设置导航定位。适配后分别以 `-g 'LLM management'`、`-g 'English translation panel'` 重测，均通过。覆盖真实本机编辑器服务、模拟 LLM 的 JSON 协商与免 Key 请求、主副字幕应用/撤销、取消/冲突/恢复，以及启动器双语错误提示、队列状态和窄屏交互；启动器使用既有桥接模拟，未启动实际桌面 WebView。
- 最终静态检查：本任务文件 UTF-8/LF、Python 语法、相关 JS 语法及 `git diff --check` 通过；`main` 保持 `a8bf4384`，原有 `debug.log` 仍为 35 行增加，其余原有 WIP 保留。

## 完成与验证边界

四组修复均已完成，无待实施项。Python 全量执行发现的两个生成产物子项已同步并专项复查通过；没有在生成文件同步后重跑整个 Python 套件。361 项前端逻辑测试通过；38 个浏览器场景均取得通过证据（包含两个失败项的单独复查）。Linux 仅完成模拟冻结环境和隔离源码实际导入，未构建或运行真实 Linux 安装包；未调用真实云端 ASR/LLM，也未安装真实本地模型。旧平线缓存仍需按需点击「重新生成波形」。本轮不升级版本、不创建 tag 或 Release。
