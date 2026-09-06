# Moyor's Subtitle Workflow (MSW)

[![中文 README](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-2563eb?style=flat-square)](README.md)

[![GitHub Release](https://img.shields.io/github/v/release/xiaoyaomoyor/moyors-subtitle-workflow?display_name=tag&sort=semver)](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/latest)
[![GitHub Stars](https://img.shields.io/github/stars/xiaoyaomoyor/moyors-subtitle-workflow)](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/stargazers)
[![License](https://img.shields.io/github/license/xiaoyaomoyor/moyors-subtitle-workflow)](LICENSE)

> Local media → ASR → SRT + `.mosp` project → MSWE editor → export.
> Planned Chinese name: **我的字幕流** — “我的” (my) abbreviates Moyor and echoes “moy”.

MSW (Moyor's Subtitle Workflow) is an API-first subtitle generation and editing workflow, personally maintained: it continuously merges features and fixes from the upstream [Moyf/moys-asr-workflow](https://github.com/Moyf/moys-asr-workflow) and adds deep customization of editor interaction and appearance. It provides Windows/macOS desktop packages, a public CLI, and a local Server editor. Editing and project storage stay on your machine.

## Quick start

1. [Download the latest release](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/latest). The default Windows package is `MSW-Windows-x64-v*.zip` and includes FFmpeg; if `ffmpeg` and `ffprobe` are already available, choose the smaller `MSW-lite-Windows-x64-v*.zip`. macOS users can choose the corresponding `MSW.app` or `MSW-lite.app` package.
2. Extract the package and launch `MSW.exe` or `MSW.app`.
3. Configure an ASR provider API key in the Launcher, choose your media, and start transcription.
4. Review and edit the subtitles in MSWE, then export SRT, ASS, or another supported format.

For installation, provider setup, editing, and troubleshooting, start with the [complete workflow guide](docs/WORKFLOW.md) (currently in Chinese).

## Core capabilities

- Transcribe with Qwen, Fun-ASR, Soniox, or an OpenAI-compatible ASR endpoint and generate SRT plus a `.mosp` project.
- Edit in the MSWE Server editor with waveform navigation, split/merge, silence-gap handling, video preview, and multiple export formats.
- Use the public CLI for batch jobs and AI automation: [CLI documentation](docs/CLI.md) (Chinese).
- [Local Qwen3-ASR / FunASR](docs/LOCAL_ASR.md) and the key-free Bcut ASR path are experimental.

## Documentation

- [Complete workflow](docs/WORKFLOW.md) — installation, provider setup, transcription, editing, export, and troubleshooting.
- [ASR providers and configuration](docs/PROVIDERS.md) — provider choices, API keys, pricing, and privacy boundaries (Chinese).
- [Editor guide](docs/EDITOR_GUIDE.md) — MSWE editing, saving, and export (Chinese).
- [Keyboard timing adjustments](docs/KEYBOARD_ADJUSTMENT.md) — shortcuts and timing rules (Chinese).
- [CLI and automation](docs/CLI.md) — full options, examples, Server management, and exit codes (Chinese).
- [LLM subtitle post-processing protocol](docs/LLM_POSTPROCESS_PROTOCOL.md) — input/output and security boundaries (Chinese).
- [JSON project schema](JSON_SCHEMA.md) — `.mosp` / `.json` data contract (Chinese).
- [Development notes](docs/DEVELOPMENT.md) — product boundaries, data contracts, and development checks (Chinese).

## Data and limitations

- When a cloud provider is selected, media is uploaded directly to that provider. MSW has no hosted transcription service and does not manage your API keys.
- The `.mosp` project is the source of truth. SRT is useful for ordinary delivery, while ASS preserves the selected main-subtitle preview font, size, and text color; neither format preserves all word-level timing, waveform, or project metadata.
- Pricing, retention, and availability depend on each provider; see [ASR providers and configuration](docs/PROVIDERS.md).
- [Three-minute video overview](https://www.bilibili.com/video/BV1hXum6yELT)

## Support and license

Please use [GitHub Issues](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/issues) for questions and bug reports. Chinese-language discussion is available in [QQ group 1079160201](https://qm.qq.com/q/4YtxZIpzxC).

Licensed under [AGPL-3.0-only](LICENSE).
