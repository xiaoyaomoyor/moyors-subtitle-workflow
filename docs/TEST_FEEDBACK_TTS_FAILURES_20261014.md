# TTS 失败检查与修复（2026-10-14）

## 范围与基线

检查选中字幕的 Edge、百炼 Qwen 合成失败，修复确认的问题，并使错误详情可以定位原因。保留其他引擎、音频资产和失败任务；不自动重发可能计费的请求。

开始于 `9550a2d`，工作分支 `my-feature`。已有 `debug.log`、`.test-appdata/`、`output/` 为本机 WIP，不纳入提交。

| 项目 | 状态 | 证据与处理 |
| --- | --- | --- |
| Edge 在线合成失败 | 已修复 | 7.2.8 的 WebSocket 握手稳定返回 HTTP 403，音色列表正常；显式使用本机代理也相同。升级官方 7.3.1 后，同一固定英文短句返回完整 MP3（15984 字节）。补充分类错误，保留异常类型及 HTTP 状态，不保存签名链接。 |
| 百炼 Qwen 错误信息缺失 | 已修复 | HTTP 错误保留服务端错误码、请求编号、脱敏说明和模型／地域。网络错误区分请求与下载；HTTP 200 携带业务错误不再尝试下载。音色创建复用诊断。 |
| 百炼原声音设计模型恢复 | 阻塞 | 用户实测及本机任务确认：`qwen3-tts-flash` 成功；`qwen3-tts-vd-2026-01-26` 返回 HTTP 404、`InvalidParameter`、`Model not exist.`。模型名和 HTTP 端点与官方文档一致；当前调用被云端拒绝，无法靠修改本地选择或下载代码恢复。需服务商核对当前账号／北京地域的模型可用性，不能据此声称全局下线。已加入专用提示，保留自定义音色及模型，不自动替换或重建音色。 |
| 选中字幕、任务结果与错误反馈 | 已修复 | 服务级失败记录到实际字幕，后续未发送项保持未完成，已成功音频保留；开始请求时正确标记合成阶段。实际选择快照覆盖七引擎，未发现把选中字幕变为空文本或错误模型的问题。 |
| 回归与服务加载 | 已修复 | 最终 150 项 Python（146 通过、4 跳过）、20 项 Node、10 项 Chromium 通过；8250 服务重启并核对实际 API 返回 Edge 7.3.1。提交范围仅含本任务源码、产物、文档及测试，保留原 WIP。 |

## 验证记录

- Edge 官方在 2026-10-13 加入 Sec-MS-GEC v2 握手；采用 PyPI 正式版 7.3.1，`uv.lock` 仅升级该包。来源：[上游修复](https://github.com/rany2/edge-tts/commit/ba61d94442c18893f0c4d3c5ad253718b21ab93e)。没有修改第三方源代码或关闭 TLS 校验。
- 真实在线：旧版音色列表 322 项、合成 HTTP 403；新版固定英文短句成功。仅测试免费 Edge，不提交个人字幕或付费百炼合成。
- 真实完整链路：固定英文／中文短句经 Edge、生产 `AudioImporter` 转换、`TtsService` 与 `AssetStore` 入库成功，均为 48 kHz 双声道 WAV，时长 2.664／2.640 秒。全部使用临时隔离资产，没有写入用户工程。
- Python：`test_msw_tts*`、`test_msw_edge_tts`、`test_msw_qwen_voices`、`test_msw_index_tts`、`test_msw_gpt_sovits`、`test_msw_cloud_tts`、`test_msw_yukkuri`、`test_flat_processing`、`test_editor_assets` 共 150 项，146 通过、4 跳过（需单独安装油库里资源的真实合成测试）；这些服务回归使用模拟接口，不代表七种外部服务均已在线实测。
- Node：`node --test tests/test_msw_tts.mjs tests/test_flat_processing.mjs`，20 项通过。
- Chromium：`editor-tts-cd.spec.mjs` 六项通过（含新增失败项诊断、不继续合成、缓存与取消）；`editor-tts.spec.mjs` 四项通过（草稿失败重试、副字幕素材、重生成、任务记录保持）。
- 前端源码重新生成 `blank-editor.html`；`node --check web/msw-edge-tts.js` 和 `git diff --check` 通过。
- 用户在线验证：2026-10-14 原声音设计模型失败；切到预设音色 `qwen3-tts-flash` 后 1/1 成功。未对真实云端请求做自动重试。官方参考：[模型与地域及 HTTP 端点](https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide)、[声音设计模型](https://help.aliyun.com/zh/model-studio/tts-model/)。尚不能区分账号访问、临时服务异常或云端部署变化，后续向服务商提供失败任务中保存的请求编号。
- `ruff check` 本轮四个 Python 源码文件通过；新增模型不存在和音色创建脱敏测试采用合成错误夹具，没有将用户音色、文本、请求编号或本机路径写入仓库。
