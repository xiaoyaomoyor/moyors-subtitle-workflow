# MSW v1.6.1 第二阶段：两项模型更新

用户批准继续实施 Qwen-Audio 3.1 与 DeepSeek 默认名称更新。起点 `83aa8fa3`，分支 `my-feature`。保留已有用户配置；Qwen 3.0 继续默认。不扩展自动烧录，不调整版本或发布。

## 进度

| 项目 | 状态 | 处理与证据 |
| --- | --- | --- |
| Qwen 3.1 协议、能力与计费 | 已修复 | 新增模型、参数与独立版本标记；按地域计算 Token 参考费用，缺失用量保留未知。模拟协议与集成测试 8 项通过，未调用付费服务。 |
| 启动器与编辑器内 ASR | 已修复 | 启动器与编辑器的两项浏览器用例通过：按能力显隐、地域价格、保存恢复、中英文。修正验证发现的启动器初始化遗漏；任务结果可携带用量。 |
| DeepSeek 默认名称 | 已修复 | 更新内置默认和示例；验证旧模型名、自定义地址、推理配置保留。新旧模型的推理参数均有回归覆盖。 |
| 回归与文档 | 已修复 | 最终 Python 2359 项：2263 通过、96 跳过；Node 376 项、浏览器 2 项通过。文档、打包契约与提交范围已核对，原有日志、缓存和测试数据不提交。 |

本阶段不使用真实云端 Key 发起收费任务，使用模拟协议与隔离配置验证；不会读取维护者 `.env`。

## 实施细节

- Qwen 3.1 复用 MSW 已有的句子／时间戳适配和说话人处理，不引入上游的编辑器结构。3.1 上下文按当前官方文件转写示例传入 `input.context`；3.0 保持既有行为。新版本具备独立输出标记，默认模型仍为 3.0。
- `keep_dialect` 仅传给 3.1。启动器偏好进入现有用户配置仓库，编辑器使用自己的识别设置；切换模型、重新打开和中英文切换不会丢失选择。编辑器任务配方包含该值，避免复用不同识别条件的结果。
- 仅为 3.1 添加地域 Token 参考价，不恢复 MSW 已移除的通用按秒费用估计。服务未返回、计数无效或地域未知时不假定零费用。进程传递经过筛选的用量信息，费用由已保存的任务地域重新计算；用量进入编辑器任务结果，不改变字幕工程契约。
- DeepSeek 仅调整内置默认、启动器演示候选和 `.env.example`；不迁移已保存的旧模型名、不覆盖第三方地址、不改变推理选项。

## 验证记录

所有测试使用隔离配置与合成数据。测试产物保存在工作区检查目录，不进入仓库。

| 层级 | 命令／检查 | 结果 |
| --- | --- | --- |
| 定向 Python | `python -m unittest test_upstream_models test_qwen_audio test_gui_config test_gui_workflow test_msw_asr test_cli test_postprocess`，另含 3 项启动器配置测试；`PYTHONPATH=tests` | 285 项，279 通过、6 跳过（当次没有媒体工具）。 |
| 最终完整 Python | `python -m unittest discover -s tests -p "test_*.py"`，独立应用数据目录、UTF-8 与本机回环测试环境 | 2359 项：2263 通过、96 跳过。 |
| 编辑器与波形 | `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_asr.mjs` | 376 项全部通过。 |
| 浏览器 | `playwright test tests/e2e/upstream-models.spec.mjs --project chromium` | 2 项通过；编辑器使用真实本机后端与隔离配置，启动器模拟原生桥接。涵盖能力显隐、偏好恢复、语言切换、已保存地域价格；截图排版已检查。 |
| 静态检查 | 修改的 JS 语法检查、UTF-8/LF、`git diff --check`；修改 Python 文件的 Ruff 与 HEAD 对比 | 无新增诊断；原有 `asr.py` 和 `test_msw_asr.py` 合计 50 项存量诊断未扩大。 |
| 真实媒体任务 | `python -m unittest -v test_msw_asr.AsrTests.test_qwen31_usage_survives_job_storage`，显式使用已安装的 FFmpeg | 1 项通过：真实截取合成音频，模拟识别，验证方言配方与用量保存在任务结果。 |

完整回归首轮（显式 `FFMPEG_PATH`）2397 项，5 项失败、76 项跳过。复核：3 项由环境中的媒体工具路径覆盖测试自建配置造成；1 项是增加模型后需要更新的列表顺序断言；1 项发现 OCR 独立运行环境缺少共享 `qwen_audio.py`。已补齐打包依赖和断言；清除工具路径覆盖后，打包契约及前述失败用例共 30 项全部通过。最终清洁环境完整回归通过：2359 项，2263 通过、96 跳过，用时约 209 秒；跳过项保留项目原有的媒体工具、平台或可选依赖条件，不等于这些路径均已实测。

未验证边界：真实 Qwen 云端转写质量、额度及账单；真实 DeepSeek 服务请求；完整发行构建与安装。后续发布仍需单独归档版本与发行说明。

## 来源

- 固定上游 `upstream-release/v1.6.1`（`a8bf4384`），按 MSW 现有流程选择性适配。
- [Qwen-Audio 文件转写协议](https://help.aliyun.com/en/model-studio/qwen-audio-asr-filetrans-http-api)与[3.1 地域参考价](https://help.aliyun.com/en/model-studio/qwen-audio-3-1-asr-flash-filetrans)，2026-11-14 核对。
- [DeepSeek 官方模型名称](https://api-docs.deepseek.com/quick_start/)，默认名称调整，旧配置保留。

本轮只提交上述适配与验证文件，目标为 `origin/my-feature`。`main` 保持原状，不调整版本、不创建标签或 Release。
