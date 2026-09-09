# Moyor's Subtitle Workflow（MSW）

[![English README](https://img.shields.io/badge/README-English-2563eb?style=flat-square)](README-en.md)

[![GitHub Release](https://img.shields.io/github/v/release/xiaoyaomoyor/moyors-subtitle-workflow?display_name=tag&sort=semver)](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/latest)
[![GitHub Stars](https://img.shields.io/github/stars/xiaoyaomoyor/moyors-subtitle-workflow)](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/stargazers)
[![License](https://img.shields.io/github/license/xiaoyaomoyor/moyors-subtitle-workflow)](LICENSE)

> 本地媒体 → AI 转写 → SRT + `.mosp` 工程 → MSWE 编辑 → 导出。
> 中文名（计划）：**我的字幕流** —— “我的”（my）既是 Moyor 的缩写，也是 moy 的谐音。

MSW（Moyor's Subtitle Workflow）是一个以 API 转写为主的字幕生成与编辑工作流，个人维护版：基于 [Moyf/moys-asr-workflow](https://github.com/Moyf/moys-asr-workflow) 长期同步上游新功能与修复，并在编辑器交互与外观上深度定制。它提供 Windows/macOS 图形版、公开 CLI 和本机 Server 编辑器；字幕编辑与工程保存都在本机完成。

## 快速开始

1. [下载最新版](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/latest)。默认下载带 FFmpeg 的 `MSW-Windows-x64-v*.zip`；如果已安装 `ffmpeg` / `ffprobe`，也可以选择体积更小的 `MSW-lite-Windows-x64-v*.zip`，macOS 下载对应的 `MSW.app` 或 `MSW-lite.app`。
2. 解压并启动 `MSW.exe` 或 `MSW.app`。
3. 在 Launcher 配置转写服务的 API Key，选择媒体并点击生成。
4. 在 MSWE 中检查、编辑字幕，导出 SRT、ASS 或其他格式。

第一次使用、API 配置、编辑和排错：请从[完整工作流](docs/WORKFLOW.md)开始。

## 核心能力

- 使用 Qwen / Fun-ASR / Soniox / 腾讯云录音文件识别，或 OpenAI（及兼容接口）转写，生成 SRT 与 `.mosp` 工程。
- MSWE Server 编辑器支持波形定位、拆分合并、静音空隙处理、画面预览和多种导出格式。
- MSWE 的「媒体 → TTS」可用百炼 Qwen3 为选中或整轨字幕配音；素材库支持逐条试听、搜索分页、WAV 导出和工程音频包。用法见 [TTS 与素材库](docs/EDITOR_TTS.md)。
- 「媒体 → TTS」也支持 [本地油库里配音](docs/EDITOR_YUKKURI.md)：中英文输入、八音色与语速调节；可在编辑器安装资源或加载单独离线资源包，无需 API Key。
- 把素材库音频拖到波形显示器即可放置[音频贴片](docs/EDITOR_AUDIO_CLIPS.md)，支持重叠子行、裁剪、静音、RMS 热力图、空隙保护与 1× 同步试听。
- [工程保存与恢复](docs/EDITOR_PERSISTENCE.md)：另存为自动收集 TTS 音频，可勾选收集原媒体；提供素材完整性检查、本机恢复草稿与保存历史。
- [音频导出](docs/EDITOR_AUDIO_EXPORT.md)：从音频贴片导出配音轨或原声混音 WAV，支持空隙移除、峰值保护与后台任务。
- [视频与配音剪辑工程导出](docs/EDITOR_VIDEO_TIMELINE_EXPORT.md)：导出混音 MP4，或包含独立配音音轨、原始 TTS 和字幕的 OTIOZ 素材包。
- MSWE 支持可选的多重字幕：拖入第二条字幕作为副轨，支持主副字幕交换、绑定/解绑、联动编辑、跨轨道吸附，以及 `G` / `Shift+G` / `H` / `B` 快捷操作。
- 公开 CLI 可用于批处理和 AI 自动化，详见[命令行文档](docs/CLI.md)。
- [本地 Qwen3-ASR / FunASR / Faster-Whisper](docs/LOCAL_ASR.md) 和免 Key 的必剪 ASR 均属于实验性入口，仅适合体验。

## 文档

- [完整工作流](docs/WORKFLOW.md) ：安装、配置、转写、编辑、导出和排错。
- [常见问题](docs/FAQ.md) ：Windows 下载解压、启动故障与问题反馈。
- [ASR 服务与配置](docs/PROVIDERS.md) ：服务商选择、Key、费用和隐私边界。
- [编辑器指南](docs/EDITOR_GUIDE.md) ：MSWE 的编辑、保存和导出。
- [字幕按键调整](docs/KEYBOARD_ADJUSTMENT.md) ：快捷键和时间微调规则。
- [命令行与自动化](docs/CLI.md) ：完整参数、范例、Server 管理和退出码。
- [LLM 字幕后处理协议](docs/LLM_POSTPROCESS_PROTOCOL.md) ：后处理的输入输出与安全边界。
- [OCR 字幕去重](docs/OCR_SUBTITLE_DEDUP.md) ：画面字幕识别、禁用规则、视频输入、报告和性能说明。
- [转写后自动处理](docs/POSTPROCESS_PIPELINE.md) ：固定步骤、配置预检、LLM 验证、中间产物和失败恢复。
- [JSON 工程文件规范](JSON_SCHEMA.md) ：`.mosp` / `.json` 数据契约。
- [开发说明](docs/DEVELOPMENT.md) ：产品边界、数据契约和开发检查。

## 重要说明

- 选择云端服务转写时，媒体会直接上传到对应服务商；MSW 没有自己的云端服务器，也不会代管 API Key。
- `.mosp` 工程是字幕真源；SRT 适合普通交付，ASS 可保留主字幕预览选择的字体、字号和文字颜色，但两者都不会保留全部字级时间码、波形和其他工程数据。
- 费用、数据保留和服务可用性以服务商当前政策为准，详见[ASR 服务与配置](docs/PROVIDERS.md)。
- [3 分钟视频速览](https://www.bilibili.com/video/BV1hXum6yELT)

## Star History

<a href="https://www.star-history.com/?repos=xiaoyaomoyor%2Fmoyors-subtitle-workflow&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=xiaoyaomoyor/moyors-subtitle-workflow&type=date&theme=dark&legend=top-left&sealed_token=_PToQhiZM0l9HWee443BsVO_Ent6c7W9XhetqS-GqzovCVxrR29_zMbiDuhZOZRQd-vsEaQhUvF262_K7KBgtzedaZ57WJ3lkgoDR9-QocuvQgw7_My_06JAPfChISW3AJh0fgpAJWVAi1XXRPs7I-5caimIiS5mNri_lJrB_9iBnvtf8_vvhtgAh-fL" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=xiaoyaomoyor/moyors-subtitle-workflow&type=date&legend=top-left&sealed_token=_PToQhiZM0l9HWee443BsVO_Ent6c7W9XhetqS-GqzovCVxrR29_zMbiDuhZOZRQd-vsEaQhUvF262_K7KBgtzedaZ57WJ3lkgoDR9-QocuvQgw7_My_06JAPfChISW3AJh0fgpAJWVAi1XXRPs7I-5caimIiS5mNri_lJrB_9iBnvtf8_vvhtgAh-fL" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=xiaoyaomoyor/moyors-subtitle-workflow&type=date&legend=top-left&sealed_token=_PToQhiZM0l9HWee443BsVO_Ent6c7W9XhetqS-GqzovCVxrR29_zMbiDuhZOZRQd-vsEaQhUvF262_K7KBgtzedaZ57WJ3lkgoDR9-QocuvQgw7_My_06JAPfChISW3AJh0fgpAJWVAi1XXRPs7I-5caimIiS5mNri_lJrB_9iBnvtf8_vvhtgAh-fL" />
 </picture>
</a>

## 反馈与许可

问题和建议请提 [GitHub Issues](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/issues)；交流可加入 [QQ 群 1079160201](https://qm.qq.com/q/4YtxZIpzxC)。

本项目采用 [AGPL-3.0-only](LICENSE)。
