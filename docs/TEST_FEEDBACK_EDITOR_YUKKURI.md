# E 阶段：本地油库里 TTS

基线：`my-feature` / `f2e6fe225f0b77c3f2c6fd27fb38658c76cbb681`。用户要求先提交并推送现有成果，再实施油库里 TTS，支持中文／英文文本、音色切换并说明资源获取。其他 TTS 引擎不在本轮范围。

| 编号 | 内容 | 状态 | 决定与验证 |
| --- | --- | --- | --- |
| P1 | 提交推送当前成果 | 已修复 | 36 文件扫描与 diff 检查通过；`f2e6fe2` 已推送，`git ls-remote` 核对远端一致，提交后工作区干净 |
| E0 | 真实合成与资源包 | 已修复 | 指定包装 `3709c378`、英文规则 `fa8ff762` 已核对；`aquestalk.js 1.0.7` + 固定 npm 依赖在 Node 24.19.0 实测中文／英文／混合 × 八音色共 24 条 WAV 成功，音色 SHA256 各异。资源保留原音声 ZIP 及许可，不需要日文专有词典 |
| E1 | 后台引擎与配置 | 已修复 | 真实固定资源安装成功；真实中文／英文／混合 × 八音色、长文本分段、语速、取消恢复及素材元数据通过；本机接口无 Key、鉴权与原百炼回归通过 |
| E2 | TTS 界面与资源入口 | 已修复 | Chromium 3 项真实本机测试通过：选中副字幕、全部主轨、引擎切换与偏好、读音修正、资源检测／缺失提示、900×600 滚动布局；截图已目检 |
| E3 | 持久化与导出回归 | 已修复 | Python 1274 项（19 跳过）、Node 304 项、Chromium 49 项通过；真实本地配音入库／试听／贴片／保存重开／引擎不可用时 WAV 导出通过；便携页已生成，Windows 离线 ZIP 解压检测与试合成通过 |

本轮不调用真实百炼 API、不读取用户 `.env`，不重启用户正在使用的编辑器；所有开发合成使用隔离运行时和合成文本。引擎源码／资源应逐项核对，不整库覆盖。

E0 决定：指定包装的预编译文件面向浏览器，并无顶层许可文件；不复制其实现进入 MSW。参考其转换路径，独立适配已声明 MIT 的拼音／数字模块和 `bakak2k` 独立英文规则，后者无需加载专有日文词典。英文为假名近似读法。安装器直接读取固定 URL／摘要的发布包，不运行 npm 安装脚本；另固定 Node 官方发行版，提供可复现的离线资源包生成入口。GitHub API 限流时使用隔离源码 checkout 核对，没有扩展全局 Git 信任配置。

E1 小结：新增固定摘要安装器、可取消资源任务、独立 Node 子进程；每条字幕完成后沿用 AssetStore。资源配置仅存本机，工程保留实际读音和版本。英文规则的 Windows checkout 带 CRLF，首次摘要不符被安装器正确拒绝；改用固定 Git 提交 blob 的原始字节 SHA256 后完整安装及试合成通过。源码命令见 `docs/EDITOR_YUKKURI.md`。PyInstaller 清单已包含适配器和资源清单；尚未执行整包发布构建。下一步验证浏览器交互及持久化导出。

E2 小结：保留百炼控件和配置契约，油库里单独本机配置、不发 API Key；运行时安装／检测非阻塞，资源失效不覆盖既有配置。真实 Python 引擎／接口 13 项通过，原百炼 21 项通过；浏览器 3 项通过。后续完整回归不调用真实云服务。

## 最终验证与边界

- `python -m unittest discover -s tests -p "test_*.py"`（通过隔离配置驱动执行、已提供真实油库里资源和 FFmpeg）：1274 项通过，19 项为既有可选依赖／平台跳过。
- `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_msw_translation.mjs tests/test_msw_tts.mjs tests/test_msw_audio.mjs tests/test_msw_audio_render.mjs`：304 项通过。
- Playwright Chromium：`editor-yukkuri`、`editor-tts`、`editor-video-export`、`editor-audio-export`、`subtitle-preview-geometry` 共 49 项通过。包括原百炼模拟协议、字幕选择、贴片拖放、混音／视频压制／OTIOZ 回归；真实油库里生成的 WAV 已实际试听与导出。
- `node --check`：editor、waveform、msw-tts、yukkuri_worker 通过；Ruff 通过；`edit.py --blank` 已生成；`git diff --check` 通过。24 个变化文件扫描无秘密、媒体、个人路径或编码问题；发布扫描器原本不认识 `.spec`，人工核对其两条资源声明并纳入文本检查后通过。
- 单独 Windows x64 资源 ZIP：40,516,278 字节；SHA256 `c3e49d4ccfb80f501e22d34f8e122af7963dc88832a735ba47ed340a43664fa7`。从固定来源安装、打包、另目录解压、重新逐文件校验与试合成通过；资源及测试媒体在仓库外，没有加入 Git。
- 已验证平台为 Windows x64；其他平台资源清单已固定，尚未在 macOS／Linux／Windows ARM64 真机验证。未执行新的 PyInstaller 整包发布构建，未创建 Release。英文为假名近似发音，非自然英语引擎。
- 当前问题表无待处理／进行中／阻塞项。旧进度 `f2e6fe2` 已提交并推送；本轮 E 改动留在 `my-feature` 工作区，未再次提交或推送。其他 TTS 引擎未接入。
