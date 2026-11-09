# ASR 提交修复与上游 1.6.0 评估

用户本轮要求：停止 v1.6.0 发布；修复编辑器 ASR 提交／失败；解释 GitHub 历史比较。最初要求筛选 v1.6.1，随后确认旧发行仍存在，明确改为上游 v1.6.0，仅评估不合并。

| 项目 | 状态 | 事实与计划 |
| --- | --- | --- |
| 停止发布 | 仅说明 | 预检运行 42562981545 已取消；远端最近发行仍为 beta.6，无 v1.6.0 标签或公开发行。此前准备提交保留 |
| ASR 提交 | 已修复 | 范围识别仅携带目标及引用闭包，jobs 上限与其他工程请求统一为 64 MiB；前端预检超限。请求发送中显示“正在提交”，没有收到回复才显示“确认上次提交”；沿用同一请求标识，避免重复任务。万条字幕及丢回复场景通过 |
| ASR 错误呈现 | 已修复 | 保存最后一条异常的脱敏摘要；失败记录不再附加“正在等待识别结果”。凭据、签名、地址与路径过滤测试及失败记录浏览器测试通过 |
| 原失败任务根因 | 仅说明 | 最近快照 6738 条，存储 4561982 字节、紧凑编码 4175190 字节，略低于 4194304 上限。该任务已受理，不能把其退出码 1 归因于请求上限；旧子进程输出已丢弃，无法反推出余额／模型／网络原因，也不能证明截图的网络丢确认必由请求上限导致 |
| GitHub 比较 | 仅说明 | 原上游 beta.6 已为 MSW 祖先；新旧 beta.6 产品树一致，仅文档一处用户名脱敏。当前上游 main 已改写历史，共同祖先退到 fbdfff23；提交计数不是功能缺失清单 |
| 上游筛选 | 仅说明 | 按最新要求固定 v1.6.0 为 73691c29，相对 beta.6 为 10 个提交／22 个路径。完整筛选见 UPSTREAM_1.6.0_ASSESSMENT_20261109.md；没有实施上游适配 |

不读取 .env，不修改个人工程，不重新提交云端识别；保留现有标签页。上游另建审计引用，不合并产品代码。

## 验证结果

- 前端范围快照／结果应用：26 项通过，包含万条工程、目标冲突、范围外说话人引用、绑定、撤销及空结果。
- Python ASR、API 上限、任务、结果与模型验证：44 项通过，使用合成音频和模拟识别。最初未指定 FFmpeg 时 28 项有 4 项跳过，补齐显式工具路径后全部执行；一次扩展命令误用了不存在的 test_msw_jobs，改为实际 test_msw_processing 后通过，不把导入错误算通过。
- 日志回归：`test_local_log` 31 项通过，确认上游对应日期夹具问题已在 MSW 修复，无需重复适配。
- 浏览器：`editor-asr.spec.mjs` 与 `processing-track-scope.spec.mjs` 共覆盖 34 个场景。扩展回归 33 项通过、1 项失败，暴露发送中提前显示“确认上次提交”；修正后补测 4 项全部通过，覆盖丢回复、部分批次恢复、失败记录和万条工程提交。真实本机任务仅模拟云端识别，不产生云端调用。
- 测试维护：旧脚本仍查找已移走的 ASR 子导航、点击折叠历史中的隐藏记录，已对齐当前界面。冷启动本机后台检查超出旧 5 秒断言或 10 秒拦截请求超时，改为有上限地等待实际状态：断言 15 秒，两个真实请求丢回复测试的请求与确认等待 30 秒，不用固定睡眠掩盖错误。调整过程中的失败保留在本机输出目录，未计为通过；最后 4 项结果位于 `output/asr-confirmation-verified-e2e`。
- `uv run python edit.py --blank` 已重新生成便携页面；源码／测试语法、UTF-8 LF 和 `git diff --check` 检查通过。
- 旧进程退出码 1 的子进程输出没有持久保存，无法恢复历史根因。未重新调用真实百炼服务，因此不能宣称该云端任务已经识别成功。使用新版前需保存工作、重新启动编辑器服务并刷新页面；后续若再次失败，依据新记录的具体原因处理。

主要验证命令：

```text
node --test tests/test_flat_processing.mjs tests/test_msw_results.mjs
python -m unittest test_msw_rejected_request test_msw_asr.AsrDiagnosticTests test_msw_asr.AsrTests test_flat_processing test_msw_result_contract test_msw_processing
python -m unittest test_local_log
npx playwright test tests/e2e/editor-asr.spec.mjs tests/e2e/processing-track-scope.spec.mjs --project=chromium
npx playwright test tests/e2e/editor-asr.spec.mjs tests/e2e/processing-track-scope.spec.mjs --project=chromium --grep "partly submitted|missing submit response|failed ASR records|ASR on an empty"
```

Python 使用仓库虚拟环境、`PYTHONPATH=tests;.`，媒体／浏览器检查显式指定有效的 FFmpeg 路径。没有修改个人工程、合并上游或发布版本；必要的上游适配留给下一阶段。
