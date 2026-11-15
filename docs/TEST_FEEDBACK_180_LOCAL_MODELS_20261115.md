# 上游跟进：本地模型可靠性

用户授权实施筛选建议第 2 项：ModelScope 回退、双缓存识别、模型目录记忆和 Qwen macOS 设备策略。基线 `07d2ff1d`，分支 `my-feature`。复用现有服务，不新增模型管理器，不实施插值吸附或字幕输出修复，不发布。

| 项目 | 状态 | 范围 |
| --- | --- | --- |
| 双源下载与缓存 | 已修复 | Qwen／MOSS／Whisper／Qwen 对齐器，缓存完整性、错误分类、取消、来源与版本。 |
| MOSS 环境兼容 | 已修复 | 新依赖、环境版本、修复提示与冻结清单。 |
| 模型目录记忆 | 已修复 | Launcher 与 Editor 按模型存储本机目录，切换和重开复用；便携预设排除路径。 |
| Qwen macOS 设备策略 | 已修复 | 自动 CPU、显式 MPS；两端、CLI、能力校验一致。 |
| 回归与文档 | 已修复 | 单元、浏览器、打包契约及实际下载边界如实记录。 |

保留原有 `debug.log`（35 行新增）、`.test-appdata/`、`output/`、`tests/test_data/_msw/`；测试使用独立目录，不读取真实 `.env`。上游参照固定为 `upstream-release/v1.8.0-beta.1`。

## 阶段验证

- 下载助手与对齐模型测试 13 项通过；验证了网络回退、鉴权／本机错误不回退、取消、完整分片和固定版本选择。
- 官方 MOSS HF `e8681d68` 与 ModelScope `5999c187` 的 16 个运行文件摘要一致；主分支 Python 模型代码已不同，因此镜像固定为对应历史版本。
- 首次扩展测试 147 项：4 失败、12 错误。主要是旧测试固定依赖列表和 MOSS 环境版本；另有 Windows 受限临时目录的原子重命名错误。正在更新测试夹具并换用隔离的工作目录重跑。
- 依赖锁定首次因受限缓存目录权限失败，使用已有本机缓存重跑 `uv lock --offline` 成功（195 包）。

- 修正旧夹具并使用工作目录下的隔离临时文件后，上述 147 项全部通过；路径保存／共享／清空／旧配置迁移／导出排除／平台设备校验等另 26 项通过。
- 实际使用 huggingface-hub 0.36.2 与 modelscope 1.39.1 下载了 Qwen 配置及固定版本的 MOSS 配置和模型代码（仅小文件）：两个 Qwen 配置 SHA256 一致，MOSS 固定代码与目标摘要一致；确认 ModelScope 新布局为 `models/<owner>--<name>/snapshots/<revision>`。未下载 GB 级权重或运行真实推理。
- 浏览器首轮 3 项未通过：保存响应尚未完成即超时、Playwright 对 option 的禁用判定，以及启动器高级选项尚未展开。改为等待实际保存响应、检查 disabled 属性并展开面板后复测。

- 浏览器第二轮 2 项通过，编辑器保存仍偶发超过 10 秒。独立线程采样显示首次字体扫描同时占用 CPU，保存执行仍在推进，非死锁；调试轮完整通过。目录读取改为复用已有配置快照，参数校验避免重复扫描全部模型；测试等待首次字体枚举结束后再验证保存，不改动字体系统。

- 浏览器最终一轮 5 项通过：编辑器／启动器保存、切换、重开、清空不被扫描结果覆盖，模拟 macOS 的 MPS 选项限制，以及既有预设／提示词／配置导出回归。MPS 仅验证设备策略，未在真实 Mac 上推理。
- 打包契约最初发现 OCR 运行包也间接依赖新增的路径偏好模块，已在 local／OCR 运行包补齐。随后针对性 Python 178 项通过（含包依赖闭包、冻结器和编辑器装配）；Node 预设测试 3 项通过。

- 全量 Python 首轮 2390 项：4 失败、1 错误、96 跳过。4 项默认路径测试只清空 MAW_ENV_FILE，未清空等价的 MSW_ENV_FILE，与隔离运行配置冲突；另 1 项运行环境安装夹具漏建 ModelScope 目录。已补齐这两类测试夹具，重新运行全量。没有因此修改实际默认路径行为。
- 全量 Node 833 项通过。

- Python 第二轮 2392 项，96 跳过；只剩工程列表测试看到首轮留在隔离应用目录的 `guard.mosp` 合成记录。该测试在首轮无此失败；改用全新临时／应用数据目录重跑，不修改工程列表产品逻辑。
- 最终浏览器复验 5 项全部通过（44.9 秒）。补测下载异常包装：HF 的 LocalEntryNotFoundError 可能继承 FileNotFoundError，仍须沿原因识别网络错误；HTTPX ReadError 按父类识别。针对性 121 项通过，1 项因可选工具未配置而跳过。

## 下载版本证据

- [HF 固定版本文件](https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize/tree/e8681d68e7042738ffca8ac8212bc8fcb1131ab8)
- [ModelScope 对应版本文件清单](https://modelscope.cn/api/v1/models/OpenMOSS/MOSS-Transcribe-Diarize/repo/files?Revision=5999c187e773f139040f1147df8446b1e600c520&Recursive=true)
- 固定 MOSS 模型代码 SHA256：`1a6f1ea11e187f04ab20d94f44c261dbfa65a17d670dcbb8b552e4a20c52877b`；权重公开摘要：`9a0ceb4ab7330357db3ff583dba8d83625d5b733b00e1d55d6970e11b07026c4`。核对公开权重摘要不等于已实际下载或完成推理验收。

## 最终验证与边界

- `.venv/Scripts/python.exe -X utf8 -m unittest discover -s tests -p "test_*.py"`：全新隔离目录，2393 项，191.0 秒，成功，96 项因现有可选工具／平台条件跳过。
- `node --test` 执行 `tests` 下全部 833 项 Node 测试：全部通过。
- Playwright `local-model-settings.spec.mjs` 与 `asr-presets.spec.mjs`：最终 5 项通过。
- Python AST、三份变更 JavaScript 的 `node --check`、UTF-8／LF／末尾换行、`git diff --check`：通过。依赖锁定清单只增加显式 ModelScope 依赖，没有升级其他包。
- 运行包依赖闭包、MOSS 版本 1 修复提示、版本 2 依赖检查、冻结清单契约及临时编辑器装配均通过；未实际重新生成发行包。无需更新已退役的根目录便携 HTML。
- 小文件实际下载验证独立于模拟测试；未下载完整大模型、未执行真实 ASR 推理、未在 macOS／CUDA 实机验证。不存在待解决的实现阻塞，以上属于保留的验收边界。
- 涉及 `maw/hub_download.py`、两端本机路径偏好与设备能力、现有模型／对齐加载器、运行环境声明、打包清单及回归测试；没有调整字幕结构、输出样式、字体系统或波形算法。
- `main` 仍为 `a8bf4384`；原有 `debug.log`（35 行新增）及三个测试／输出目录原样保留。本任务按既有授权提交并推送 `origin/my-feature`，版本号和发行标签不变。
