# 预制步骤模型与识别连接配置（2026-11-01）

基线 `74982cc3`。保留已有 debug.log、output/、.test-appdata/。按已确认方案实施；不读取个人 .env，不调用付费云端服务，不改动工程。

| 事项 | 状态 | 实施与验证 |
| --- | --- | --- |
| LLM 步骤独立配置与任务快照 | 已修复 | 校对、断句、翻译可分别覆盖模型和思考强度，默认继承，启动后固定 |
| LLM 模型搜索与强度界面 | 已修复 | 供应商／模型／强度统一一行，支持手动输入、恢复继承及按能力显示强度 |
| 识别布局与连接配置迁移 | 已修复 | 预制页保留制作参数，凭据及连接参数移入更多设置，兼容已保存配置 |
| 回归及交付 | 已修复 | 隔离配置验证、同供应商不同模型、启动后默认值变更、失败恢复、配置兼容、浏览器与布局已通过；空白编辑器已重新生成 |

- 后端专项：`test_postprocess_pipeline test_launcher_queue test_llm_connection` 77 项通过。新增同供应商三步骤独立模型／强度、保存恢复、环境变化后仍使用快照的验证；兼容旧任务按供应商保存的快照。
- 初次测试命令误写不存在的 test_postprocess_llm 模块，已更正为 test_llm_connection，重跑通过。
- 界面回归进行中：旧用例仍断言六个设置分类（实际原有七个），以及在预制页直接填密钥；已按真实界面和新入口调整断言。
- 能力依据（2026-11-01）：Google thinking / OpenAI compatibility、智谱深度思考、DeepSeek thinking mode 官方文档。GLM 5.3 的关闭值兼容为低强度，提供 low/high/max；Gemini 不再提供其不支持的关闭档位。列表接口不代表对应模型生成权限。

- 扩大后端回归：最初运行 439 项，1 项既有环境跳过，其余通过（日志 output/prefab-python-tests.log）。实际处理链验证校对与翻译分别收到自己的模型与强度；处理中改变环境配置不影响后续步骤。批量队列在读取首个文件前冻结所有步骤配置。
- 浏览器首轮 35 项：33 通过，2 处旧断言已修正；扩大 39 项：38 通过，剩余为旧“五色”提示断言；修正后专项 7 项全部通过。新交互覆盖模型搜索/直接输入、独立强度、恢复继承、切换供应商、过期异步响应、密钥迁移及草稿隔离。
- 界面截图已检查，修正三列字段的顶端对齐；窄窗口英语布局通过。输出截图仅本机 output/，不提交。

## 最终验证

- `python -m unittest test_postprocess_pipeline test_launcher_queue test_llm_connection test_postprocess test_gui_web`：440 项，439 通过、1 项原有跳过；新增失败后恢复仍使用原步骤模型、强度和凭据的验证。
- `python -m unittest test_config_transfer test_config_end_to_end test_user_config`：31 项通过。旧导出配置缺少新字段时按继承处理；新覆盖值可随配置往返，不携带密钥。
- `npx playwright test tests/e2e/launcher-step-models.spec.mjs tests/e2e/launcher-config-output.spec.mjs tests/e2e/launcher-interactions.spec.mjs tests/e2e/launcher-asr-options.spec.mjs --reporter=line`：40 项通过，包含步骤选择保存重开。
- `python edit.py --blank` 已完成，生成结果未产生差异；两份 Launcher JS 语法检查、`git diff --check`、UTF-8/LF 检查通过。
- 启动器已重启加载本轮代码。个人工程和云端服务均未用于验证；没有真实识别／翻译请求及计费测试。
- 已知边界：能力选项依据已知模型系列，未知兼容接口不猜测档位；模型列表不保证账户权限。旧独立工程处理接口 `run_prefab_plan` 的专用失败恢复入口不在本轮界面范围，本轮验证当前队列、转录后处理链及管线恢复。

能力参考：[Google 思考](https://ai.google.dev/gemini-api/docs/thinking)、[Google OpenAI 兼容](https://ai.google.dev/gemini-api/docs/openai)、[智谱思考](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)、[DeepSeek 思考](https://api-docs.deepseek.com/guides/thinking_mode/)。
