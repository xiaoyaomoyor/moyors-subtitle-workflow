# TTS E–G 实施记录

范围：MiniMax、Mossland 云端常用配音与七引擎回归；不提交或推送。
保留当前 my-feature 分支已有编辑器、启动器与 A–D 工作区改动。

| 阶段 | 状态 | 交付与验证 |
| --- | --- | --- |
| E | 已修复 | MiniMax 地域密钥、音色查询／手动 ID、常用参数、完整音频与原配方重生成 |
| F | 已修复 | Mossland 同步单人配音、音色查询／登记及参考创建 |
| G | 已修复 | 七引擎回归、紧凑界面、文档、schema 与便携页面 |

## 接口核验

- MiniMax 官方 `/v1/t2a_v2` 支持同步 hex 音频，`/v1/get_voice` 查询系统／账号音色。区域与账号分别缓存，不用临时 URL 作为工程资源。
- Moss API 官方 `/v1/audio/speech` 支持同步音频二进制，故本轮无需异步付费任务轮询。`/v1/audio/voices` 提供列表与参考上传创建；参考上限 10 MB／30 秒。
- 云端合成不自动重试；取消拒收迟到音频；未确认的云端结果需用户决定重新提交。
- 真实云端账号、余额与音质尚未验证；验证使用隔离测试凭据，不读取用户 .env、不执行真实计费合成。

## 实施决定

- 新增小型公共云端连接层与两个显式适配器，沿用既有 requests／FFmpeg，不添加供应商 SDK 或新依赖。连接仅允许官方地域端点；不跟随带凭据的重定向，不接受任意下载 URL。
- 环境配置保存密钥、地域和等待上限；调用面板使用现有主题的两列字段，窄屏单列。大段说明收纳到提示图标，中英文均保留账号音色名称与手动 ID 原文。
- MiniMax 冻结速度／音量／音高／情绪／语言与实际朗读文本；Mossland 只暴露已核验的模型／语言／音色，Pro 不显示可编辑语言参数。两种重生成继续复用素材库与三层贴片保护。
- Mossland 创建音色前持久登记请求，成功保存 ID，未知结果不会以相同请求再次上传；用户可刷新列表找回已创建音色。使用同步二进制结果，无需额外的异步任务产品。
- 参考上传路由的外层请求上限原为 4 MB，会拦截允许的参考文件；补齐 Mossland 与已有 GPT 路由上限，适配器继续分别执行实际文件／时长限制。

## 验证记录

测试使用隔离配置／本机模拟服务，媒体和截图在仓库外。没有读取用户 .env。

| 层级 | 命令／范围 | 实际结果 |
| --- | --- | --- |
| Python 引擎／公共流程 | `python -m unittest test_msw_tts test_msw_tts_services test_msw_gpt_sovits test_msw_edge_tts test_msw_cloud_tts test_msw_index_tts test_msw_yukkuri test_msw_qwen_voices test_msw_audio_plan test_msw_audio_exports test_packaging_contract test_release_assets`（PYTHONPATH=tests） | 160 项：155 通过，5 跳过 |
| 跳过项补测 | 配置已有 `MSW_TEST_FFMPEG` 后单独执行 `QwenVoiceServiceTests.test_reference_conversion_requires_ffmpeg_and_rejects_long_audio` | 通过；剩余 4 项 Python 跳过属于未指定油库里真实运行资源 |
| 页面产物 | `python -m unittest test_editor_assets -v` | 19 项通过；脚本顺序、模板与生成页面一致 |
| 前端纯逻辑 | `node --test tests/test_msw_tts.mjs tests/test_msw_audio_actions.mjs tests/test_msw_audio.mjs tests/test_msw_audio_render.mjs` | 58 项通过；七引擎参数不串用、凭据剥离、副轨／草稿、重叠与音量导出 |
| 新云端 Chromium | `editor-tts-cloud.spec.mjs` | 最终 6 项通过（初轮 5 项后补英文／认证）；完整 HTTP／解码、素材重生成、贴片替换、创建音色、取消拒收、模型约束、地域隔离、窄屏与英文亮色界面 |
| 既有引擎 Chromium | `editor-tts-services.spec.mjs`、`editor-tts-cd.spec.mjs`、`editor-index-tts.spec.mjs`、`editor-tts-workspace.spec.mjs`、`editor-yukkuri.spec.mjs` | 32 项通过；5 项油库里实机测试因未指定运行资源跳过 |
| 静态与依赖 | 新增 Python 文件 Ruff；JS `node --check`；`git diff --check`；`uv lock --check --offline` | 通过；依赖锁无需变更 |
| 便携页面 | `python edit.py --blank` | 已重新生成 `blank-editor.html`；新引擎模块已加入 manifest 与 MSW.spec |

合计去重后：Python 179 项中 175 通过、4 跳过；前端逻辑 58 通过；Chromium 43 项中 38 通过、5 跳过。新云端协议专属测试 9 项包含在 Python 汇总中。

## 发现与修正

- 首次新增七引擎 Node 断言因 VM 对象原型不同而失败，数据字段实际相同；改为序列化比较后 58 项全部通过。
- 首次 Ruff 指出新增测试中的 5 处同行语句；拆行后通过。
- MiniMax 不完整／畸形业务状态、HTTP 重定向、超时与大小超限均拒绝入库；测试涵盖无重试和错误脱敏。云端账户缓存刷新失败保持之前完整列表。

## 未验证边界（仅说明）

- 未执行真实 MiniMax／Mossland 付费请求；官方契约与模拟通过不代表用户账号具备模型、音色授权或余额，也不代表实际音质验收。
- 本轮未加载真实油库里资源；其纯逻辑／API 测试已运行，真实发音和浏览器播放保留上述跳过项。既有 GPT／Edge 的真实验证见 C+D 记录，本轮没有重复模型推理。
- 未完整生成 PyInstaller 发行包；已更新动态模块打包名单、通过打包契约和便携页面检查。跨平台实际模型服务与完整二进制启动未作为本轮通过项。
- 没有新增依赖、复制供应商模型、提交或推送；原工作区其他 WIP 保持。
