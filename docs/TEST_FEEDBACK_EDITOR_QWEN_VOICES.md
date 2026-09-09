# 百炼三类配音模式与音色选择

用户要求：先提交推送已有油库里／素材管理，再完善百炼三类 ModelType；默认 CustomVoice，丰富可选音色。沿用 MSWE 名称，未涉及本地 Qwen 或其他引擎。

| 编号 | 内容 | 状态 | 决定与验证 |
| --- | --- | --- | --- |
| P0 | 提交并推送现有成果 | 已修复 | `3052b1896dd7efd6fe7dd94138796975c1b7b343` 已推送 `origin/my-feature`，`ls-remote` 与 HEAD 一致；进入新功能前工作区干净 |
| P1 | 三类模型与系统音色契约 | 已修复 | 48 个默认 Flash 音色、24 个 Instruct 音色、17 个旧快照音色；兼容旧配置并保留带空格 ID。3 项隔离契约测试通过 |
| P2 | 自定义音色创建、复用及本机记录 | 已修复 | 15 项隔离测试通过：协议、预览、幂等／重开、密钥隔离、关闭保留晚到结果、无效参考拒绝、真实 FFmpeg 转换 MP3／M4A、HTTP 访问保护；跨端口孤立任务能结束为中断 |
| P3 | 模式切换、丰富音色与创建交互 | 已修复 | 最终 10 项 Chromium 通过，包含三类选择／创建／合成、预览与配置重开、丢失响应确认、地域／工程／引擎切换、720×600 滚动布局、旧后端重启提示；已查看真实截图 |
| P4 | 回归、文档与便携产物 | 已修复 | 完整 Python 1297 项（1278 通过、19 跳过），Node 305、Chromium 63 全通过；文档／契约／changelog 已更新，便携模块与源码逐字一致，18 个改动文件扫描无问题 |

实施使用隔离配置和模拟云响应，不读取真实 `.env`，不重启用户服务。此轮先推送的范围为 P0；新功能完成后保留可审查改动。

P1 核对来源：百炼[非实时音色表](https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list)、[合成 API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)、[声音设计](https://help.aliyun.com/zh/model-studio/voice-design-user-guide)、[声音复刻](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)。VD 使用 `qwen3-tts-vd-2026-01-26`，VC 使用 `qwen3-tts-vc-2026-01-22`，两地域均可用。界面中的 VoiceClone 表示声音复刻，对应本地 Base 的相关用途，不伪造云端名为 Base 的模型。

P1 测试第一次启动时自动权限审查超时；按工具指引重试一次成功，不属于代码测试失败。部分补充 API 页面网络读取失败；实现以已获取的 Qwen-TTS 官方指南和示例为准，不混用 Omni／CosyVoice 接口。

P3 首轮 Chromium 5/7 通过：两个新用例的预期有误（粤语有阿强和阿清两种音色，外加占位项；工程加载后使用编辑器已有规范化文本）。按实际音色表及提交前字幕快照修正断言，并补充切换工程的晚到结果测试。已有 Python TTS 21 项回归通过。未调用真实百炼。

P3 阶段复核：切换引擎后的音色请求始终使用独立 Qwen 配置，不借用油库里 recipe；更换 API Key 后可以手填已有同地域／模型 ID，实际账号权限由百炼校验，避免误判正常的密钥轮换。音色列表仍按本机密钥配置分组，不混入其他配置的列表。

Node 首次在沙箱内启动 XML 校验所需 Python 子进程遇到系统权限限制，扩展权限重跑相同命令已通过；未更改测试断言规避环境问题。

P4 首轮完整 Python 1297 项中，唯一失败是脚本加载清单测试尚未登记 `msw-qwen-voices.js`；已按实际依赖顺序补齐，重新全套验证。Node 305/305、既有 Chromium 53/53 通过。复核补上旧后端版本检测，提示重启服务；未给旧服务发送空模型请求。测试服务夹具的路径引导导入沿用必要的 E402 注释，Ruff 通过。

## 最终验证与交付边界

| 层级 | 命令／方式 | 实际结果 |
| --- | --- | --- |
| Python | 外部隔离驱动调用 `unittest` 的 `discover('tests', pattern='test_*.py')`；阻止真实 `.env` 访问，使用临时应用数据，提供测试 FFmpeg／油库里运行时／OTIO 工具 | 1297 项，1278 通过、19 跳过，136.8 秒；新增音色 15 项全部执行，无真实百炼调用 |
| Node | `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_translation.mjs tests/test_msw_tts.mjs tests/test_msw_audio.mjs tests/test_msw_audio_render.mjs` | 305/305 通过 |
| 新功能浏览器 | `node node_modules/@playwright/test/cli.js test tests/e2e/editor-qwen-voices.spec.mjs --project=chromium` | 10/10 通过，云端请求经隔离夹具替换为模拟服务；真实浏览器播放预览和生成音频 |
| 既有浏览器 | Chromium 执行 `editor-yukkuri`、`editor-tts`、`editor-video-export`、`editor-audio-export`、`subtitle-preview-geometry` 五份 spec | 53/53 通过，包含素材、字幕选区、保存重开、导入／删除、贴片播放和导出 |
| 静态检查 | 修改的 Python 模块及测试执行 Ruff；前端及新增 spec 执行 `node --check`；`git diff --check` | 全部通过 |
| 便携与分发 | 隔离配置运行 `edit.py --blank`，检查音色／TTS 模块完整源码包含于产物；扫描全部改动文本的 UTF-8、LF、BOM、密钥、私人路径及媒体 | 源码一致，18 文件无发现；新增资源由既有 `web/` 打包目录包含 |

真实百炼的账号权限、可用额度、设计／复刻效果尚未用付费调用验证；本次没有读取真实 Key 或上传用户参考音频。未构建新版 EXE／发布包，未改动其他 TTS 引擎接入范围。

此前实现已按要求推送 `3052b18`；本轮三模式新增改动保留在 `my-feature` 工作区，尚未再次提交或推送。更新运行中的本机服务需要重启后再刷新网页；操作步骤见 [EDITOR_TTS.md](EDITOR_TTS.md)。没有未完成实现项。
