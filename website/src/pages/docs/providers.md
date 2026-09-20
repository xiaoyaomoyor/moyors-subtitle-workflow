---
layout: "../../layouts/DocLayout.astro"
title: "ASR 服务与配置"
description: "服务商选择、API Key、费用和隐私边界。"
source: "docs/PROVIDERS.md"
---

<!-- Generated from docs/PROVIDERS.md. Run npm run sync:docs to refresh. -->

# ASR 服务与配置

MSW 本身不托管转写服务。你选择的服务商会直接接收待转写媒体；MSW 只负责本地流程、工程生成和编辑。

## 选择转写方式

| 方式 | 适合场景 | 备注 |
| --- | --- | --- |
| Qwen-Audio / Qwen3-ASR / Fun-ASR | 默认云端路径、中文和说话人分离 | 使用阿里云百炼 API Key；Launcher 默认优先 Qwen-Audio。 |
| Soniox | 多语言、小语种和说话人分离 | 使用 Soniox Console API Key。 |
| 腾讯云录音文件识别 | 中文/英文长音频的异步文件识别 | 使用 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`；大于 5MB 的媒体需使用 COS/公网 URL。 |
| OpenAI（及兼容接口） | 使用 OpenAI 官方服务或自己的兼容服务 | 官方服务可使用 Whisper 或 diarize 时间戳模型；也支持 OpenRouter 与自定义兼容接口，必须返回可靠时间戳。 |
| 豆包录音文件 ASR | 中文/多语言异步识别 | VOLC_API_KEY；支持资源 ID、热词与说话人参数。 |
| 必剪 ASR | 不想申请 Key 的中文快速体验 | 实验性、非官方接口，可能限流或失效。 |
| 本地 Qwen3-ASR / FunASR | 希望离线转写且有合适硬件 | 实验性，需要单独安装运行环境和模型。 |

## API Key 配置

- 图形版：在 Launcher 或编辑器「全局设置 → 环境配置 → ASR」填写连接并保存到本机环境。调用面板的模型/语言/热词等参数可单独调整。
- Release 包：优先读取应用程序同目录的 `.env`；不存在时使用 MSW 用户数据目录中的 `.env`，Windows 路径为 `%LOCALAPPDATA%\MSW\.env`。
- 源码或 CLI：继续使用仓库根目录的 `.env`；可从 `.env.example` 复制后填写 `DASHSCOPE_API_KEY`、`SONIOX_API_KEY`、腾讯云的 `TENCENT_SECRET_ID` 与 `TENCENT_SECRET_KEY`，或 OpenAI（及兼容接口）的 `MSW_OPENAI_ASR_API_KEY`。
- OpenAI（及兼容接口）：在 Launcher 选择“OpenAI（及兼容接口）”，从“模型”下拉列表选择官方模型；选择“自定义（Custom）”后再填写自定义模型名。兼容服务需要填写 `MSW_OPENAI_ASR_BASE_URL`，模型与 API Key 分别保存到 `MSW_OPENAI_ASR_MODEL` 和 `MSW_OPENAI_ASR_API_KEY`；程序调用 `POST {Base URL}/audio/transcriptions`。
- API Key 只应保存在环境变量或本机 `.env` 中，不要放进命令行、工程、日志、截图或 AI 对话。
- Qwen Key 获取或查看见[阿里云百炼](https://platform.qianwenai.com/home/)；Soniox Key 见 [Soniox Console](https://console.soniox.com)。
- OpenAI 官方 API Key 见 [OpenAI Platform](https://platform.openai.com/api-keys)。
- 腾讯云密钥见[API 密钥管理](https://console.cloud.tencent.com/tokenhub/apikey)；录音文件识别使用 `CreateRecTask` / `DescribeTaskStatus`，默认引擎为 `16k_zh_en_2.0`。
- 腾讯云的 `Words` 结果包含字词级毫秒时间码；传入 `--speaker` 会启用说话人分离并保留匿名 speaker 标签。完整示例见[完整工作流](../workflow/)。
- 默认 Base URL 为 `https://api.openai.com/v1`，模型为支持词级时间戳的 `whisper-1`；使用兼容服务时，按服务商文档修改这两项。若服务只返回 `{ "text": "..." }` 而没有时间戳，MSW 会拒绝生成字幕，因为无法可靠对轨。

区域、模型、热词、上下文和完整参数见[完整工作流](../workflow/)与[CLI 文档](../cli/)。

## beta.3 模型与时间戳

- 豆包使用异步录音文件接口，支持 volc.seedasr.auc、volc.bigasr.auc、volc.bigasr.auc_idle 资源。资源需与账户授权匹配；设置中的资源 ID 会实际进入调用。当前适配器限制 120 分钟/编码后 25 MiB，轮询支持超时与取消。
- OpenAI 官方 whisper-1 请求词/句时间戳；gpt-4o-transcribe-diarize 使用 diarized_json。官方仅文本的 transcribe 模型会在调用前提示不支持字幕时间戳。Prompt、Keywords、说话人选项随模型能力显示，隐藏参数不会继续发出。
- OpenRouter 标准地址会规范化为 /api/v1，仅已知预设补模型前缀；自定义模型 ID 保持原样。兼容服务的时间戳需经真实响应校验，不能用纯 text 捏造时间轴。
- Qwen 句级锚点降级拆句会标注近似时间，混合词/句精度保留；不增加强制对齐后端。

## 费用

- Qwen 和 Soniox 的免费额度、计费方式与价格会变化，请以[阿里云模型定价](https://help.aliyun.com/zh/model-studio/model-pricing)和 [Soniox Pricing](https://soniox.com/pricing) 为准。
- 必剪 ASR 没有稳定的配额或服务承诺，请只把它当作应急体验入口。
- 本地模型不产生云端转写费用，但会消耗本机的存储、显存/内存和计算资源。

## 数据与隐私边界

- MSW 没有自己的云端服务器；云端转写时，媒体直接发送给你选择的服务商。
- 编辑器、工程保存和导出默认在本机完成。`.mosp` 是字幕工程真源，SRT 只保留交付所需的基本字幕信息。
- Launcher 的 LLM 后处理只发送带临时 ID 的字幕文字，不发送媒体路径、时间码或工程元数据；详见 [LLM 字幕后处理协议](../llm-postprocess/)。
- 使用任何第三方服务前，请自行确认其数据保留、训练使用和账户政策。
