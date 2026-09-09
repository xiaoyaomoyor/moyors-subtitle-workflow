MSW 1.6.0-beta.1 · 我的字幕流
Moyor's Subtitle Workflow

官网与下载：https://github.com/xiaoyaomoyor/moyors-subtitle-workflow
文档目录：https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/my-feature/docs/README.md
问题反馈：https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/issues

1. 完整解压应用包，运行 MSW.exe / MSW.app；Linux 运行 AppImage。
   不要只移动 EXE，也不要从压缩软件中直接运行。
2. 标准版内置 ffmpeg 和 ffprobe；lite 需要自行配置这两个程序。
3. 需要识别时，在启动器配置 ASR；然后打开本机 Server 字幕编辑器。
4. 编辑器「编辑 → 全局设置 → 环境配置」管理 LLM 与 TTS 连接。
   云端服务需要用户自己的 Key 和额度。
   油库里可单独安装资源；IndexTTS 需要用户先安装并启动本机服务。
5. TTS 音频进入素材库，可拖到波形显示器作为配音贴片。
   保存工程会收集 TTS 音频；迁移时一并复制 .mosp 和 .assets 素材目录。
6. 本版本为预发布版。升级前备份工程和原媒体，保留旧版便于回退。

本包不含开发者的 Key、用户项目、ASR/TTS 模型权重或本机服务环境。
首次配置与可选资源清单：
https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/blob/my-feature/docs/ENVIRONMENT.md

更多启动排错见随包 FAQ-常见问题.txt。MSW 基于开源 MAW 项目发展，
许可证与第三方说明位于随包 LICENSE 和 THIRD_PARTY_NOTICES.md。
