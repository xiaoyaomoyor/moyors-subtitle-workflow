# Gemini 官方兼容接口连接测试（2026-11-01）

基线 `955380a5`。用户使用 Google 官方 OpenAI 兼容 URL，模型 `models/gemini-3.8-flash`，列表成功但测试报 read timeout=30。未读取个人密钥或 `.env`，保留原有 debug.log 和测试产物。

| 事项 | 状态 | 决策及证据 |
| --- | --- | --- |
| 根因定位 | 仅说明 | 目录与生成是不同请求；旧生成测试 max_tokens=1、读取超时 30 秒、仅检查 HTTP 状态；官方 Gemini 3.8 默认中等思考且不能关闭。旧报错只能证明读取超时，不能证明具体网络或云端等待原因 |
| Gemini 名称与参数 | 已修复 | 仅官方域名规范化 models/ 前缀；思考关闭映射到受支持的最低强度，界面明确标注；正式处理复用规则且不再发送旧采样温度。其他服务保留模型 ID 与行为 |
| 测试与反馈 | 已修复 | Gemini／启用思考测试最多 4096 token，其他关闭思考测试 64 token；读取等待 90 秒，验证非空文本；区分连接／读取超时、空回复、无效响应，不自动重试 |
| 验证 | 已修复 | Python 402 项运行通过（1 项平台跳过），包含真实本地 HTTP 成功、空回复、HTML 和读取超时；浏览器 5 项通过。语法、产物、UTF-8/LF 和差异检查通过；云端实际生成尚未验证 |

资料：[Google OpenAI 兼容接口](https://ai.google.dev/gemini-api/docs/openai/)、[Gemini 3.8 变更](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8)。官方示例使用 gemini-3.8-flash；不能证明 models/ 前缀是本次超时原因，规范化属于兼容处理。

## 验证记录

- 不带密钥的 Google 官方链路探测：GET models 返回 HTTP 404、POST chat/completions 返回 HTTP 400，均约 0.94 秒。仅证明当次可收到官方 HTTP 响应，不验证账户、模型调用或历史超时成因。
- 第一次受限 Python 运行因测试临时目录访问失败；隔离配置、允许临时目录访问后重新执行 `.venv/Scripts/python.exe -m unittest test_llm_connection test_postprocess test_postprocess_pipeline test_gui_web`：402 项，401 通过、1 项平台跳过，无失败。
- 新增测试覆盖官方模型名规范化／去重、第三方 ID 原样保留、最低／自动／显式思考、正式 JSON 处理、45 秒模拟响应可通过新等待配置、空或 null 回复、协议错误、超时分类与敏感内容不泄漏／不重试。
- `npx playwright test tests/e2e/launcher-interactions.spec.mjs --project=chromium --grep 'LLM|Gemini|Custom provider'`：5 项通过，覆盖设置保存、不同语言、最低思考标签及其他服务不受影响、超时与协议反馈、HTTP 错误提示。
- 两份改动 JS 的 `node --check` 通过；隔离设置下 `edit.py --blank` 成功，生成产物无差异；`git diff --check` 通过。
- 未读取用户密钥或调用真实模型。当前启动器运行旧进程，需保存表单设置并重启后，由用户复测带密钥的生成请求。
