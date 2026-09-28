# TTS C+D 实施记录（2026-09-27）

范围：按修订后的 TTS 多引擎规划接入 GPT-SoVITS 与 Edge TTS；保留当前工作区已有修改，本轮不提交或推送。

| 项目 | 状态 | 内容 |
| --- | --- | --- |
| C：GPT-SoVITS 适配器 | 已修复 | 已接入；8 项模拟契约与真实 V2Pro 日语／日跨中 WAV 验证通过 |
| C：面板与现有工作流 | 已修复 | 2 项新浏览器场景通过，含预设、素材重生成和贴片替换；原服务 6 场景通过 |
| D：Edge TTS | 已修复 | 固定 7.2.8，音色缓存／筛选、常用参数、取消、完整 WAV；任务身份遗漏已修复并复测 |
| 回归与产物 | 已修复 | Python 120 项、Node 17 项、Chromium 32 个不同场景通过；文档、打包契约与 blank-editor 同步 |
| 其他真实环境与音质 | 仅说明 | 当前 Windows V2Pro 实测；其他 GPT 模型族、macOS／Linux 自有服务及主观音质未验收 |

## 基线与决定

- 已核对 AGENTS、A+B 记录、规划、当前状态及相关实际 diff。工作区已有大量未提交的编辑器与启动器改动，均保留。
- GPT-SoVITS API v2：参考音频仍必须存在，主参考需 3–10 秒；V3/V4 不支持省略参考文字。两个权重切换均成功才进入推理。
- 模型/参考资源在本机管理，工程配方仅持有稳定标识，不携带本机绝对路径。关闭面板不取消任务；取消只丢弃该任务输出，不使用全局 control。
- Edge 是在线服务，无 API Key；缓存失败不能清除当前音色。真实服务、浏览器与模拟验证分别记录。

## 验证

- 既有 TTS／服务 Python 42 项、新增 GPT 8 项、Edge 7 项、Index 14 项、打包契约 25 项、发行资源 5 项、编辑器资源 19 项，合计 120 项通过。
- Node TTS／批量操作 17 项通过，包含 GPT 模型／主辅参考／语言／高级参数及 Edge 三项参数的冻结回放，不携带本机路径或服务地址。
- Chromium：原本机服务 6 项，Index 14 项，TTS 工作区 8 项，新 C+D 4 项，合计 32 个不同场景通过。最终 C+D 4 项在提示／试听关闭修订后再次通过（22.5 秒），包含 WAV 下载、素材重生成、贴片替换、预设、筛选、断网缓存与取消。
- 首轮 C+D 浏览器 2 通过、2 失败：Edge 的统一 JobManager 指纹要求 base_url，适配设置缺此字段，导致提交失败。补齐固定端点身份后，两项失败场景及完整回归均通过。新增 Edge 任务契约测试首次清理时遇到 SQLite 异步关闭占用；改为等待 close_complete 后清理，7 项复测通过。
- 实际 Edge 7.2.8：读取 318 个音色，中／英／日完整 MP3→PCM WAV 成功。
- 实际 GPT-SoVITS：受控启动当前安装包，V2Pro + s1v3，使用 Edge 生成的通用日语参考，输出中文 3.10 秒、日语 2.78 秒；已关闭本次自有服务。没有读取用户私人参考或凭据。这里只验证推理与音频完整性，不代表主观音质验收。
- 测试音频、截图和服务日志均在仓库之外的检查目录；没有打包发行二进制。

## 完成记录（2026-09-28）

- 代码：`maw/msw/gpt_sovits.py`、`edge_tts.py`、注册表/API/音频转换，以及两个前端控件模块；共享保存、快照、素材、贴片和服务管理继续复用。GPT 的模型切换与推理增加服务级线程锁与跨编辑器文件锁；外部客户端并不受 MSW 的锁约束。
- 布局：沿用双列字段、主题控件和高级折叠项；根据 Chromium 截图减小行距，音色置于 Edge 参数之前；GPT 面板提供快捷启动和缺配置提示，参考关闭/切引擎时停止试听。
- 文档：新增 GPT、Edge 使用说明，更新原 TTS／本机服务说明、计划进度、JSON_SCHEMA、CHANGELOG 和第三方说明。
- `python edit.py --blank` 已生成；`python -m unittest discover -s tests -p test_editor_assets.py` 19 项验证生成结构。Ruff、新旧相关 JS 语法、`git diff --check`、`uv lock --check --offline` 通过；新文件与相关源文件无 BOM/CRLF 或个人安装路径。验证 `copy_metadata('edge-tts')` 能收集版本与 LICENSE。
- 真实验证结束后，9880／7860 端口均已关闭。未提交、未推送，保留工作区原有 WIP。

复现自动化：在安装项目依赖与 FFmpeg 的隔离检查环境中运行 `python -m unittest discover -s tests -p test_msw_gpt_sovits.py`、`test_msw_edge_tts.py`、`test_msw_tts*.py`、`test_msw_index_tts.py`；运行 `node --test tests/test_msw_tts.mjs tests/test_msw_audio_actions.mjs`；Chromium 使用 `tests/e2e/editor-tts-cd.spec.mjs`、`editor-tts-services.spec.mjs`、`editor-index-tts.spec.mjs`、`editor-tts-workspace.spec.mjs`。`MAW_ENV_FILE` 与 `MSW_APP_DATA_ROOT` 应指向隔离测试位置。

本次未覆盖：实际模型声音的主观质量、每个 GPT 模型族的真实推理、跨平台服务启动、完整 PyInstaller 二进制构建。MiniMax、Mossland 和七引擎总回归属于后续 E/F/G，本轮不执行。
