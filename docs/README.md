# MSW 文档目录

项目官网暂为 [GitHub 仓库](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow)。当前使用说明以本目录与根 README 为准；`website/` 暂留作后续官网维护，历史同步页面不作为 MSW 新功能说明。

## 第一次使用

- [安装与升级](INSTALLATION.md)：选择发行包、启动和迁移工程。
- [可选环境配置](ENVIRONMENT.md)：哪些功能开箱可用，哪些需要 Key、资源包或本机服务。
- [完整工作流](WORKFLOW.md)与[常见问题](FAQ.md)。

## 编辑、翻译与配音

- [编辑器指南](EDITOR_GUIDE.md)、[快捷键微调](KEYBOARD_ADJUSTMENT.md)。
- [TTS 与素材库](EDITOR_TTS.md)、[油库里资源](EDITOR_YUKKURI.md)、[IndexTTS 本机服务](EDITOR_INDEXTTS.md)。
- [音频贴片](EDITOR_AUDIO_CLIPS.md)、[工程保存与恢复](EDITOR_PERSISTENCE.md)。
- [导出音频](EDITOR_AUDIO_EXPORT.md)、[导出视频与剪辑工程](EDITOR_VIDEO_TIMELINE_EXPORT.md)。
- 编辑器字幕翻译见[完整工作流](WORKFLOW.md)；启动器批处理见[后处理流程](POSTPROCESS_PIPELINE.md)。

## 扩展与开发

- [ASR 服务](PROVIDERS.md)、[本地 ASR](LOCAL_ASR.md)、[命令行](CLI.md)、[OCR](OCR_SUBTITLE_DEDUP.md)。
- [开发概览](DEVELOPMENT.md)、[工程格式](../JSON_SCHEMA.md)、[品牌资源](BRANDING.md)。
- [构建与发布](RELEASING.md)：五种安装包、构建预演和发布门禁。

`TEST_FEEDBACK_*.md` 是开发验证账本，`archived/` 是历史说明，均不作为当前用户指南，也不随 GUI 安装包分发。保留它们用于回归与追溯；工程兼容键名、上游致谢和许可不因品牌更新而批量改名。
