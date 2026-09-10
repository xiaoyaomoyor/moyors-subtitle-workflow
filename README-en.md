# Moyor's Subtitle Workflow (MSW)

<img src="web/launcher/logo.svg" width="80" height="80" alt="MSW Launcher"> <img src="web/favicon.svg" width="80" height="80" alt="MSWE Editor">

[![中文 README](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-2563eb?style=flat-square)](README.md)

[![GitHub Release](https://img.shields.io/github/v/release/xiaoyaomoyor/moyors-subtitle-workflow?display_name=tag&sort=semver&include_prereleases)](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases)
[![GitHub Stars](https://img.shields.io/github/stars/xiaoyaomoyor/moyors-subtitle-workflow)](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/stargazers)
[![License](https://img.shields.io/github/license/xiaoyaomoyor/moyors-subtitle-workflow)](LICENSE)

MSW (Moyor's Subtitle Workflow / 我的字幕流) is a local web workflow for ASR, subtitle editing and TTS voiceover. Based on [MAW](https://github.com/Moyf/moys-asr-workflow), this independently maintained fork adds translation during editing, three TTS integrations, an asset library and audio clips on the timeline. It provides Windows, macOS and Linux launchers, a CLI and a browser editor. Project editing and storage stay on your computer.

[Project home](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow) · [Releases](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases) · [Documentation](docs/README.md) · [Optional environments](docs/ENVIRONMENT.md)

The current version, **1.6.0-beta.2**, is MSW's own prerelease, based on the upstream release with the same version number. Equal version numbers do not imply identical features.

![MSWE with bilingual subtitles, voiceover clips and the asset library](docs/assets/msw-1.6.0-beta.1/editor-overview.jpg)

*The interface uses synthetic demonstration data; this image does not demonstrate a cloud voice's synthesis quality.*

## Quick start

1. Open the [release list](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases). Prereleases may not appear at the `latest` URL. Choose a standard package with FFmpeg, or a lite package if you already have `ffmpeg` and `ffprobe`. See [installation and upgrades](docs/INSTALLATION.md).
2. Extract and launch `MSW.exe` on Windows or `MSW.app` / `MSW-lite.app` on macOS. On Linux, make the AppImage executable and run it.
3. Configure an ASR provider API key in the Launcher, choose your media, and start transcription.
4. Review and edit the subtitles in MSWE, then export SRT, ASS, or another supported format.

For installation, provider setup, editing, and troubleshooting, start with the [complete workflow guide](docs/WORKFLOW.md) (currently in Chinese).

## Core capabilities

- Transcribe with Qwen, Fun-ASR, Soniox, or an OpenAI-compatible ASR endpoint and generate SRT plus a `.mosp` project.
- Edit in the MSWE Server editor with waveform navigation, split/merge, silence-gap handling, video preview, and multiple export formats.
- Translate selected subtitles in the editor; configure LLM connections under global Environment settings.
- Synthesize selected subtitles or an independent text draft with Bailian Qwen TTS, offline Yukkuri, or an existing IndexTTS 2.5 service. Manage connections, voices and presets separately from synthesis controls.
- Preview assets, place voiceover clips on the waveform, adjust timing and mute, and export audio, mixed video with optional burned-in subtitles, or OTIOZ editing projects.
- Save projects with collected TTS audio, optionally collect original media, inspect missing assets, and recover local drafts or save history.
- Use the public CLI for batch jobs and AI automation: [CLI documentation](docs/CLI.md) (Chinese).
- [Local Qwen3-ASR / FunASR](docs/LOCAL_ASR.md) and the key-free Bcut ASR path are experimental.

## Documentation

- [Complete workflow](docs/WORKFLOW.md) — installation, provider setup, transcription, editing, export, and troubleshooting.
- [Installation and upgrades](docs/INSTALLATION.md) and [environment checklist](docs/ENVIRONMENT.md) — package selection and optional dependencies (Chinese).
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
- [Upstream MAW video overview](https://www.bilibili.com/video/BV1hXum6yELT) — historical reference; it does not cover MSW's voiceover features.

## Support and license

Please use [MSW GitHub Issues](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/issues) for MSW questions and bug reports. The linked [MAW QQ group](https://qm.qq.com/q/4YtxZIpzxC) belongs to the upstream project.

Licensed under [AGPL-3.0-only](LICENSE).
