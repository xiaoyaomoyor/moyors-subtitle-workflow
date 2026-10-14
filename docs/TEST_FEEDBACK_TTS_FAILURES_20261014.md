# TTS 失败检查与修复（2026-10-14）

## 范围与基线

检查选中字幕的 Edge、百炼 Qwen 合成失败，修复确认的问题，并使错误详情可以定位原因。保留其他引擎、音频资产和失败任务；不自动重发可能计费的请求。

开始于 `9550a2d`，工作分支 `my-feature`。已有 `debug.log`、`.test-appdata/`、`output/` 为本机 WIP，不纳入提交。

| 项目 | 状态 | 证据与处理 |
| --- | --- | --- |
| Edge 在线合成失败 | 已修复 | 7.2.8 的 WebSocket 握手稳定返回 HTTP 403，音色列表正常；显式使用本机代理也相同。升级官方 7.3.1 后，同一固定英文短句返回完整 MP3（15984 字节）。补充分类错误，保留异常类型及 HTTP 状态，不保存签名链接。 |
| 百炼 Qwen 错误信息缺失 | 已修复 | HTTP 错误保留服务端错误码、请求编号、脱敏说明和模型／地域。网络错误区分请求与下载；HTTP 200 携带业务错误不再尝试下载。音色创建复用诊断。 |
| 百炼原声音设计模型失效原因 | 仅说明 | 官方 2026-10-10 下线 `qwen-voice-design`／`qwen-voice-enrollment`，旧声音设计只读查询也返回模型不存在；`qwen3-tts-vd-2026-01-26` 合成失败、普通 Flash 成功。原音色、凭据命名空间及配方未变；MSWE 无法恢复云端旧服务，改为迁移现行服务。 |
| 新版自定义音色与旧试听迁移 | 已修复 | 已接入 Qwen-Audio-TTS、Workspace ID、私有临时上传及旧试听复刻入口。按用户授权，用原试听创建一个新复刻音色，实际合成 3.28 秒／24 kHz WAV 成功。原音色、试听和工程不变；18 项浏览器专项通过，8250 已更新并保存新音色，生产页面本机试听正常。 |
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
- 用户在线验证：2026-10-14 原声音设计模型失败；切到预设音色 `qwen3-tts-flash` 后 1/1 成功。未对真实云端合成请求做自动重试。最初根据搜索缓存中的旧官方文档，只能判定模型不可用；后续找到下线公告，更新结论如下。
- `ruff check` 本轮四个 Python 源码文件通过；新增模型不存在和音色创建脱敏测试采用合成错误夹具，没有将用户音色、文本、请求编号或本机路径写入仓库。

## 自定义音色后续定位

- 对比本机 2026-10-05 成功任务与 2026-10-14 失败任务：完整合成配方无字段变化；当前凭据命名空间仍能找到同一音色的成功创建记录。代码对比也确认此期间 Qwen HTTP 端点与请求体构造没有变化。
- [官方语音主线模型下线公告](https://platform.qianwenai.com/docs/changelog/model-deprecations/speech-mainline-models)及[延期公告](https://platform.qianwenai.com/docs/changelog/model-deprecations/delayed-deprecation)明确列出 `qwen-voice-design` 和 `qwen-voice-enrollment`，下线日期为北京时间 2026-10-10。公告没有单独列出 `qwen3-tts-vd-2026-01-26`，不要把其具体下线日期表述为已证实；该合成模型当前不可用由真实任务证实。
- 复用应用配置，只对原百炼端点执行一次官方 `qwen-voice-design / query` 免费只读查询，同样收到 HTTP 404、`InvalidParameter`、`Model not exist.`。没有合成、创建、删除音色，也没有把音色描述或凭据写入诊断记录。查询失败无法证明云端音色本身是否已删除。
- 最新[声音设计文档](https://help.aliyun.com/zh/model-studio/voice-design-user-guide)使用 Qwen-Audio-TTS／CosyVoice 的 `voice-enrollment / create_voice`，返回 `voice_id`，合成端点和参数也与原 Qwen3 HTTP 实现不同。原文档仍可能出现在搜索缓存中，不能据此断定旧服务继续可用。
- 用户选择优先复用旧试听／已有音频并提供业务空间 ID。新版可使用业务空间域名；官方说明原兼容域名仍可用，因此 Workspace ID 是可选连接字段，不作为音色或工程配方字段。旧 ID 不可直接改绑其他模型。

## 新版迁移实施

- 新模型 `qwen-audio-3.0-tts-flash` 的设计与复刻共用 `voice-enrollment / create_voice`；合成改用 `SpeechSynthesizer`、WAV／24 kHz 与语言提示。旧预设音色请求保持兼容。依据[设计 API](https://help.aliyun.com/zh/model-studio/voice-design-api-references)、[复刻 API](https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api)、[合成 API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)。
- 参考音频经百炼签发的 OSS 私有策略上传，凭据只发往固定 API，上传主机验证为百炼 OSS 域名；OSS 不接收 API Key。临时文件有效期 48 小时；本机不保存参考音频字节到音色数据库。
- 实际使用原 5.2 秒试听创建一个新音色。首次结果暴露旧 ID 正则不允许句点；修正后按确定前缀只读查询找回同一个云端结果、确认状态 OK 并恢复本机记录，没有重复创建。随后通过生产合成与完整 WAV 校验得到 3.28 秒／24 kHz／单声道音频。音色名称追加「（新版复刻）」。只进行了这一次新音色创建和一次短句合成，可能按服务商规则计费。
- 原音色与试听不覆盖；新版复刻能否达到用户期望的相似度仍需用户试听。新版按描述设计仅进行协议及浏览器模拟验证，未额外付费创建。
- Python 分模块共 155 项，151 通过、4 跳过（油库里真实资源未安装）；含真实 MP3／M4A 转换。最初测试命令误写两个不存在的模块名，补跑正确的 `test_msw_tts_services` 18 项通过。Node 20 项通过，前端语法与空白编辑器重新生成通过。
- 浏览器首轮扩大到 72 项，58 通过、14 失败。测试进程 PATH 缺少 FFmpeg，导致克隆转换和 Edge/GPT 夹具共 8 项失败；旧音色搜索断言未计入保留的当前选项，已改为核对匹配组与当前选项。配置 PATH 后，`editor-qwen-voices.spec.mjs`、`editor-tts-cd.spec.mjs` 共 18 项最终通过（迁移用例修正 option 属性断言后单独复验通过）。没有重复发起真实云端创建或合成。
- 其余 5 项在隔离的 `ab957b7` 修改前副本中全部复现：三项另存为／恢复用例仍读取旧 `segments[0]` 数据形态；一项部分失败重试期望两个素材但只有一个；一项旧固定轨道整体验证构造的翻译来源被拒绝。它们不是本轮引入，但仍是未通过项，需后续更新平级轨道测试及单独检查部分失败重试；不将本次专项通过表述为全量浏览器通过。
- 8250 按原启动参数重启。通过生产保存接口记住业务空间及新复刻音色，复用已有验证 WAV 作为音色试听；真实浏览器确认新版模型、复刻模式和新音色默认选择，试听时长 3.28 秒，页面异常 0。此检查不发送云端请求、不改变工程字幕。
- `ruff check` 覆盖本轮五个 Python 文件通过，前端 JS 语法与 `git diff --check` 通过。没有将用户业务空间、音色 ID、音频或诊断绝对路径加入提交。
