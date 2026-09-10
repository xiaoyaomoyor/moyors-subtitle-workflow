# MSW 对齐 MAW 1.6.0-beta.2：实施账本

## 已批准的边界（2026-09-10）

用户已审查升级评估报告并批准全部建议。A～E 本地工作已完成；2026-09-10 用户明确授权进入 F 阶段，允许本次提交、推送和最终发布 `v1.6.0-beta.2`。以下历史阶段中的“尚未授权”描述保留当时事实，以本节与 F 阶段记录为当前状态。

| 决策 | 已确认的行为 |
|---|---|
| D1 | 新写入 `_msw`／`视频名_msw`，兼容读取 `_maw` 和旧路径，不自动移动旧文件；持续兼容上游工程 |
| D2 | 上游涉及的导出／后处理后缀跟随界面语言；稳定 ID、素材包内部路径、MSW 专属配音输出命名保持 |
| D3 | 新 OTIO 选项先用于源媒体 OTIO／OTIOZ；保留含配音 OTIOZ，界面明确区别 |
| D4 | 保留 MSW 设置窗口与搜索，补分类持久化／导航；帮助采用纵向分类和 MSW 主题 |
| D5 | 不引入固定费用估算；采纳完整耗时／RTF 统计 |
| D6 | `main` 纯镜像上游最新主线；实际同步使用固定版本引用，本次只到 beta.2 |

## 事实基线

- MSW 起点：`55db0d27706ac50c069d0680095267b666a7408a`（已发布 MSW beta.1，`my-feature`）。开始时工作区干净。
- 上次上游：`c9452da8546cec1b56d579628c271060cc535066`（MAW beta.1）。
- 本次目标：`860f354d74e81979e0d7a17f5e64f470a5b0fbef`（MAW beta.2），独立引用 `upstream-release/v1.6.0-beta.2`。
- 上游主线：`bc5262cd7f9f972d1efc299d4537fd13eaa657ce`；本地 `main` 已仅快进到该提交。未推送 `origin/main`。
- 本地集成分支：`sync/upstream-1.6.0-beta.2`，从 MSW 起点创建；`my-feature` 未改变。
- 范围：22 个非合并提交、1 个合并提交。A 阶段只适配工程契约相关增量（`0381b23`、`1a1177b`、`b527d0e`、`7883213`、`2095530`）。
- 分阶段保留可运行状态，不提前引入 B～E 的改动或记录“整个 beta.2 已合并”。最终完整同步时再核对全部采纳／舍弃项及合并关系。

## 阶段清单

| 阶段 | 状态 | 内容 |
|---|---|---|
| A | 已修复 | 基线与已批决策、历史回归夹具、顶层工程 schema、元数据保真与 MSW 保存／恢复验证已完成 |
| B | 已修复 | 输出命名、目录、配置别名、后处理素材路径及打包依赖适配完成 |
| C | 已修复 | Launcher 设置／布局／本地环境／英文文案及耗时统计完成 |
| D | 已修复 | 空隙填充、设置／帮助、源媒体 OTIO 选项完成，保留 MSW 配音与工程兼容 |
| E | 已修复 | 本地源码／Windows 验证与三平台五包原生 CI 预演均已完成；桌面真机、真实模型及外部剪辑软件边界另列 |
| F | 进行中 | 已获提交、推送及发布授权，执行候选固化、五包预演、分支同步和最终预发布 |

## A 阶段执行记录

| 项目 | 状态 | 处理与证据 |
|---|---|---|
| A0 基线与决策 | 已修复 | 已核对原工作区，建立集成分支和独立上游版本引用；本地 main 仅快进 |
| A1 历史工程夹具 | 已修复 | 新增 `tests/fixtures/msw_beta1_legacy_project.json` 与说明；已用 `55db0d2` 的原始 Python 校验器验证输入可用且字节未变；合成素材在临时目录生成 |
| A2 Python 契约与写出 | 已修复 | 顶层与 MSW 扩展同时检查；写出拒绝未知版本；独立匹配脚本检查输入并标记输出；恢复数据库读取时也验证；57 项定向 Python 回归通过 |
| A3 浏览器保真与状态保护 | 已修复 | 7 项新增 Chromium 回归通过：旧配音工程打开、编辑下载重开、动态扩展、未知版本文件选择／拖入／恢复／回载拒绝、工程切换隔离；有效回载在本机服务器页面验证 |
| A4 回归、规范与产物 | 已修复 | 已更新 JSON_SCHEMA／CHANGELOG、重建 blank-editor.html；Python 全量、Node 全部单元、76 项 Chromium 覆盖及本机服务启动检查完成，见下方结果与环境边界 |

### 最终验证结果

以下均为本地实际运行结果。Python 使用项目 `.venv/Scripts/python.exe`，等效使用现有项目虚拟环境；当前终端没有 `uv` 命令。

| 层次 | 命令／覆盖 | 结果 |
|---|---|---|
| 旧输入基线 | 读取 `55db0d2:maw/project.py`，用原始校验器验证合成夹具 | 接受；输入不含顶层 schema，原始字节未变 |
| Python 定向 | `python -m unittest test_msw_project_schema test_project_io test_project_contract test_msw_persistence`，`PYTHONPATH=tests` | 57 项通过；包括磁盘工程、备份、绑定版本、真实合成音频字节及数据库旧快照 |
| Python 全量 | `python -m unittest discover -s tests -p 'test_*.py' -v` | `Ran 1307 tests`，`OK (skipped=29)` |
| Node 单元 | `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs`，再执行 runtime／audio／audio_render／translation／tts 五个测试文件 | 272 + 37 = 309 项全部通过 |
| Chromium 新契约 | `project-schema.spec.mjs` | 7 项通过：打开、编辑下载重开、扩展实时保存、切换隔离及未知版本各入口拒绝 |
| Chromium 交叉回归 | 新契约及 `open-project-drop`、`open-project-attach`、`new-project`、`editor-persistence`、`editor-tts`、`editor-translation`、`editor-audio-export` 共 8 个 spec | 76 项覆盖；主批次 73 通过、3 项因 FFmpeg 开发版不兼容失败；改用 FFmpeg 8.1.2 后音频 spec 6 项全部通过，覆盖的 76 项均已有通过证据 |
| 本机服务 | 手动运行 `python server-editor/serve.py --blank --no-waveform --port 18763 --no-open` | 仅监听 127.0.0.1；HTTP 200，实际页面包含两层 schema 检查与 MSW 模块；验证后已停止 |
| 产物与格式 | `python edit.py --blank`；四个前端文件 `node --check`；`git diff --check`；26 个改动／新增文本文件编码检查 | 便携编辑器已重建；语法、差异、UTF-8 无 BOM 与 LF 全部通过 |

全部测试使用隔离的 `MAW_ENV_FILE`／`MSW_APP_DATA_ROOT` 及合成媒体，未读取真实 `.env`、调用真实供应商或加载用户素材。虚拟环境的 uv trampoline 在沙箱内不能启动子进程，获自动审核允许后在沙箱外执行测试。浏览器命令使用项目的 `node_modules/@playwright/test/cli.js test … --project=chromium` 与 `MSW_E2E_PYTHON`；Node XML 回归通过 `MSW_TEST_PYTHON` 指定同一解释器。

本地完整日志保留于工作区的 `msw-checks/phase-a-validation/`（仓库之外）：`python-verified.log`、`node-unit.log`、`browser-final.log`、`browser-audio-verified.log`。后续复现不依赖这些日志或其中的个人绝对路径。

### 复测中处理的问题

- Python 初次完整运行的 12 个失败：2 个保存预期补新 schema；1 个内联源码断言解除对函数第一行的依赖；9 个默认目录测试局部屏蔽外部覆盖变量。产品默认路径没有修改。随后遇到一次 Windows 本机 HTTP 连接中止，该用例单独复测及最终全量运行均通过。
- 浏览器新测试修正了提示容器选择器和有效另存为回载所需的服务器页面。既有测试补展开文件菜单、允许既有帧字段并检查交换字幕后的全部字段保真。外部音频导入重开用例单独复测及后续主批次均通过，未改其产品逻辑。
- Node 首次日志目录缺失时测试未启动；目录补齐后实际运行通过。两个已结束测试的超长日志读取进程被核实并停止，未终止其他任务。

### FFmpeg 兼容性记录（仅说明，交 E 阶段验收）

本机 FFmpeg 开发版 `N-126435-gf93cd72dde-20260906` 对现有 `-filter_complex_script` 返回 `Unrecognized option`，因此已有配音混音导出失败。此调用在 A 阶段未改动。改用本机 MAW 发行包附带的 `8.1.2-essentials_build-www.gyan.dev` 后，6 项音频导出浏览器测试全部通过；本轮未下载、替换或修改用户的 FFmpeg 配置。

E 阶段需核对五包实际附带的 FFmpeg 并重跑配音／视频／OTIOZ 导出；不要把本轮结果理解为兼容任意 FFmpeg 开发版。

### 延续的 MSW 语义

普通保存及草稿恢复保留工程 ID、任务应用记录、配音素材／贴片与主副轨。另存为创建新 ID 并记录 `source_project_id`，按原实现清空 `applied_results`、`translation_applications`、`translation_target_tracks`；保留字幕、素材 ID、音频字节、删除记录及其他扩展字段。此差别是既有任务隔离规则，不按“所有字段逐字相同”误改另存为。

### 未验证与后续

A 阶段没有未完成项。Python 的 29 个跳过记录涉及未向该测试进程提供 FFmpeg 的媒体／导出集成测试、另装油库里资源、可选 numpy、平台符号链接与真实对齐样例等；Chromium 中已另外用 FFmpeg 8.1.2 验证 WAV 导出，但不替代其余被跳过的集成覆盖。

以上为 A 阶段结束时的记录，当时 B～F 尚未执行；当前 B、C 进展见下节。五包构建、外部剪辑软件导入、WebKit／跨平台视觉验收或真实付费模型测试留待后续。发行版本暂保持 beta.1，用户可感知变更写入 Unreleased。当前改动在集成分支工作区，尚未创建提交；没有推送、创建 tag 或发布。

## B、C 阶段执行记录

开始时核对了 A 阶段的实际 diff、26 个已修改／新增文件和固定 beta.2 引用。继续在原集成分支工作，不覆盖 A 阶段成果，不引入 beta.3。

| 项目 | 状态 | 内容与验收重点 |
|---|---|---|
| B1 统一命名与配置别名 | 已修复 | 新模块、MSW／MAW 别名和三个默认开关已落地；37 项命名与配置回归通过；进程优先于文件，同来源 MSW 优先（包括空值） |
| B2 路径、缓存与批量 | 已修复 | 三偏好组合、显式输出、HTML 占用／批量预留、默认 manifest、旧 MSW／MAW／相邻缓存已验证；有效旧缓存原地复用，错误媒体／音轨／过期波形继续查下一候选 |
| B3 后处理与素材 | 已修复 | 中间与最终工程复用 MSW 素材收集并锚定媒体；合成 WAV 字节、素材 ID、轨道增益、贴片参数跨目录保留；两种旧后处理目录均可原地恢复；50 项相关回归通过（跳过 2 项） |
| B4 导出及打包依赖 | 已修复 | 浏览器／Python／可选 Tauri 名称及旧英文回查已适配，MSW 配音命名保持；中英文实际 SRT 下载通过；补 local/OCR 包依赖，音频大小常量下沉 assets 防止 OCR 包拉入 TTS 依赖；原生构建留 E 阶段 |
| C1 工具箱与布局 | 已修复 | 切句移入处理设置、实用工具纵向分类／独立滚动、缩放贴底；修正小窗口 150% 时工具箱越界；Launcher 共 41 项浏览器回归通过 |
| C2 本地运行环境 | 已修复 | 安装／修复移至设置，目录保存／重启回读、MOSS 独立和进程覆盖已验证；前后端同时限制安装、准备、单项及批量任务期间切换；浏览器选择／手输／拖入均通过 |
| C3 英文文案与耗时 | 已修复 | 英文按稳定 ID 映射并保留 DLL 等诊断；六脚本与自动后处理／批量记录耗时／RTF；去除固定费用估算、RTF 文件名，OpenAI 转写与流程耗时分开 |
| BC 验证与文档 | 已修复 | 最终 Python 1349 项通过（跳过 25）、Node 309 项通过、Chromium 56 项覆盖均有通过证据；文档／便携产物／75 个文本文件格式已检查，见下表 |

### B、C 适配说明

- 输出设置默认关闭／关闭／开启；总开关关闭时保留每媒体偏好，但缓存采用共享 `_msw`。Launcher 的 HTML 基于源媒体定位，单项及批量预留同时检查 SRT／MOSP／HTML；显式路径继续优先。
- `maw/env_config.py` 统一相关读写入口的 MSW／MAW 别名。`TranscriptionRequest` 保留显式配置来源并传入子进程，自动后处理在本线程绑定配置和界面语言，避免测试配置或不同入口的输出偏好失效。真实 `.env` 未读取或修改。
- 后处理派生与最终发布均用 `write_derived_project()` 收集素材和锚定媒体；恢复时不移动旧目录。补足直接从完成步骤重试发布时的缺失素材警告。素材内部相对路径、稳定 ID、轨道与贴片保持原规则。
- 只吸收编辑器的 12 处上游可读文件名替换；不提前替换源媒体 OTIO 构轨与 MSW 设置／帮助。可选 Tauri 媒体回查同步识别中文后缀、旧英文翻译和碰撞编号。
- Launcher 实用工具分两列独立滚动，切句设置与本地 ASR 环境管理迁入设置；保留模型面板状态与跳转。前后端均保护活动任务期间的目录设置，MOSS／OCR 仍独立；小窗口在 150% 缩放时，工具箱尺寸按实际可视高度限制。
- 六个底层识别脚本补开始／结束、转写耗时与 RTF，后处理与批量补步骤／流程耗时。保留 `MAW_STAT` 机器协议；不加入固定费用估算、RTF 文件名或公开 CLI 新参数。

### 回归中修正的问题

- 首次完整 Python 运行的 14 个失败涉及旧布局／旧输出名／manifest 位置、别名空值优先级预期、运行环境子进程夹具依赖，以及 OCR 打包依赖闭包。对应测试更新为批准的行为；将音频大小常量从 TTS 下沉到 assets，解除 OCR 对 TTS 的间接依赖。修正后 414 项定向测试通过。
- Launcher 回归发现旧测试仍点击已移入设置的隐藏安装按钮，演示配置被带入上游 beta.2 版本文案，以及小窗口 150% 时工具箱越界。入口预期、MSW beta.1 演示文案和尺寸计算已修正，41 项通过；随后扩充的目录手输／拖入检查也通过。
- 实际文件名下载测试最初只注入空隙数据，没有刷新空隙菜单，导致隐藏菜单超时；补正确的测试准备后中英文两项均通过。
- 启用 FFmpeg 的完整 Python 回归运行了 1349 项，唯一错误来自 `test_msw_qwen_voices` 把 `MSW_TEST_FFMPEG` 视作目录，而首次提供的是可执行文件。按用例约定改为 FFmpeg 8.1.2 的 `bin` 目录后，最终全量 `OK (skipped=25)`；未修改该用例或用户安装。

### B、C 最终验证结果

| 层次 | 命令／覆盖 | 实际结果 |
|---|---|---|
| Python 全量 | `.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py' -v`；隔离配置、`PYTHONUTF8=1`，`MSW_TEST_FFMPEG` 指向 FFmpeg 8.1.2 的目录 | `Ran 1349 tests in 123.870s`，`OK (skipped=25)`；包括配音 WAV／视频／时间线及新路径、素材、恢复、批量、运行环境和打包依赖回归 |
| Node 单元 | `node --test` 执行 `test_editor_utils`、`test_waveform_js`、`test_editor_runtime`、`test_msw_audio`、`test_msw_audio_render`、`test_msw_translation`、`test_msw_tts` 七个 `.mjs`；`MSW_TEST_PYTHON` 指定项目解释器 | 309 项全部通过，0 跳过 |
| Chromium Launcher | `launcher-interactions`、`launcher-zoom`、`launcher-upgrade-bc` | 41 项通过；随后对新 spec 的 10 项复测也通过，包含新增选择／手输／拖入目录、批量活动禁用、英文诊断与两种窗口 × 三档缩放 |
| Chromium 编辑器 | `export-naming`、`project-schema`、`editor-audio-export` | 15 项均有通过证据：主批次 13 项通过，2 项下载测试修正准备后均通过；与 Launcher 合计 56 个独立用例 |
| 本机服务 | `python server-editor/serve.py --blank --no-waveform --port 18763 --no-open`，请求首页 | 127.0.0.1 返回 HTTP 200，实际页面包含本地化导出函数与 MSW schema；检查后 Ctrl+C 停止 |
| 便携与语法 | `python edit.py --blank`；编辑器、波形、i18n、utils、Launcher、batch、postprocess 七个前端文件 `node --check` | 便携 HTML 已重新生成；语法全部通过 |
| 格式与差异 | `git diff --check`；检查当前累计 75 个修改／新增文本文件（含 A 阶段成果） | UTF-8 无 BOM、LF 和差异检查通过 |

测试均使用合成工程／媒体和隔离配置，没有调用真实付费供应商。25 个跳过项仍包含仅从 PATH 查找 FFmpeg 的旧用例、可选 numpy、油库里／真实对齐资源及平台条件；显式提供 FFmpeg 已覆盖相关 MSW 媒体导出，但不把跳过项算作通过。实际五包构建仍未执行。

日志保留于仓库外 `msw-checks/phase-bc-validation/`：`python-verified.log`、`node-final.log`、`launcher-third.log`、`browser-final.log`、`export-verified.log`。`browser-final.log` 的两项失败已由 `export-verified.log` 的通过结果补齐；历史失败日志保留供核对。首次便携产物重建的自动审批超时，重试获准并执行成功，未形成阻塞。

### 文档与后续边界

新增 `docs/OUTPUT_LAYOUT.md`，并更新 WORKFLOW、CLI、LOCAL_ASR、`.env.example` 与 CHANGELOG；便携编辑器由源码重建。D 阶段的空隙填充、编辑器设置／帮助和源媒体 OTIO 选项尚未执行。E 阶段再做版本归档、五包真实构建和跨平台／剪辑软件验收；可选 Tauri 未执行 Cargo 编译，本轮打包证据只包括依赖闭包与隔离子进程测试。F 阶段发布仍需维护者单独授权。

## D、E 阶段执行记录

以上是 B、C 结束时的记录。当前已核对集成分支累计 75 个修改／新增文件、实际差异、报告与固定 beta.2 引用，并在仓库外保存本轮起点副本。

| 项目 | 状态 | 范围与验收 |
|---|---|---|
| D1 空隙填充 | 已修复 | 已加入计算／菜单／N 提示及手工来源，提示标记与有效移除时长；217 项编辑器单元、2 项 Chromium 配音保护／随媒体裁切／主副轨／撤销重做通过。重复填充按移除区间并集判定，无额外历史 |
| D2 设置与帮助 | 已修复 | 分类跨刷新持久化、不可用回退／恢复、方向键与 Home/End 导航，保留搜索及 LLM／TTS 子导航；8 个帮助分类纵向平铺，MSW 主题和引导保留。新交互与原引导共 10 项 Chromium 通过，480×520 浅色与 1024×760 深色布局通过 |
| D3 源媒体 OTIO | 已修复 | 三个同步持久选项、同步快照／取消、独立 SRT、表情包合轨与安全打包完成；13 项 D 浏览器回归通过（含 16 组合），服务器 66 项通过。保留独立配音 OTIOZ；扩展历史波形 spec 中旧菜单断言另行核对 |
| E1 版本与文档 | 已修复 | pyproject／uv.lock 根包及五个版本标记为 beta.2；依赖锁定值未改变；版本同步、离线锁检查、macOS 图标及说明预览通过；22 项映射见下表 |
| E2 本轮回归与产物 | 已修复 | Python 1353 项通过（跳过 25），Node 311 项通过；发行与扩展 Chromium 134 个独立用例均有通过证据；便携产物、源码启动、深浅／自定义主题、多轨与配音导出通过 |
| E3 五包构建预演 | 已修复 | E 阶段已完成本地 Windows 两包；F 阶段获得授权后，预演 `34465587331` 补齐同一候选提交的三平台五包构建、媒体回归与完整性校验 |
| E4 历史测试差异 | 仅说明 | 完整旧 waveform-history spec 仍有 24 项未清理失败，均在重建的 D 前源码重现；保留诊断清单，不将其算作通过或声称全部浏览器测试通过 |

### D 阶段适配结果

- 空隙填充使用当前活动空隙的边界，忽略停用区间，未知媒体末端时拒绝越界推算。保存手工来源并接入既有撤销；重复操作按区间并集比较，避免来源分段造成重复历史。配音保护与随媒体裁切仍由 MSW 的有效空隙计算处理。
- 设置分类使用独立本机键记忆位置；分类不可用时回到「全部」，重新可用时恢复导航。保留搜索、LLM／TTS 子导航、主题与窗口管理；搜索时同步清理旧分类的无障碍选中状态。帮助八个分类纵向显示，保留引导重播和上下／Home／End 导航。已实际检查小窗口浅色与普通窗口深色截图，自定义颜色保存后刷新回读通过。
- 源媒体 OTIO／OTIOZ 的三个选项默认全开，在两个菜单间同步并持久化。SRT 是独立文件；时间线、SRT 和文件名在第一次异步操作前固定。主文件取消／保存失败时停止附带下载，SRT 单独失败时说明时间线已导出。
- 表情包沿用原有单轨构建规则：重叠或无法解析时提示修复或关闭选项；OTIOZ 只读取服务器绑定的源媒体及已校验根目录下的图片，去重并处理同名、中文和空格。客户端任意媒体 URL 不作为文件读取依据，越界、缺失和无效引用拒绝打包。静态图片补有限可用时长。原始时间线的音轨元数据缺省兼容、多音轨映射、BWF 起点和有效去空隙逻辑均保留。
- MSW「含配音的剪辑工程（OTIOZ）」继续调用独立导出模块，保留轨道、增益、静音、稳定素材 ID、素材包与输出命名；源媒体三个选项不改变该入口。

### E 阶段验证证据

下列日志与候选产物均位于仓库外 `msw-checks/phase-de-validation/`。所有媒体为合成夹具，配置与应用数据隔离；没有读取真实 `.env`、调用付费供应商或操作用户素材。

| 层次 | 实际执行与结果 | 证据 |
|---|---|---|
| Python 全量 | `.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py' -v`；FFmpeg 8.1.2；`Ran 1353 tests in 141.158s`，`OK (skipped=25)` | `python-final.log` |
| Node 单元 | editor-utils／waveform／editor-runtime／audio／audio-render／translation／tts 七个 `.mjs`，指定 `MSW_TEST_PYTHON`；311 通过，0 跳过 | `node-full.log` |
| Chromium 发行与交叉回归 | branding、translation、tts、editor-upgrade-d、project-schema、launcher-upgrade-bc、export-naming、onboarding、audio-export、video-export、launcher-interactions、launcher-zoom：129 个独立用例均有通过证据，见复验说明 | `browser-release.log`、`browser-media-final.log` |
| Chromium 历史定向 | 帮助 Home／End、中英文帮助、去空隙文件名、多源音轨与 BWF 起点：5 个用例全部通过；与上行不重复，合计 134 | `history-targeted.log` |
| 源码与便携 | `edit.py --blank` 重建，7 个前端脚本语法通过；实际启动 `serve.py --blank --no-waveform --port 18763 --no-open`，127.0.0.1 返回 200 且包含 beta.2、OTIO 选项与填充功能，检查后停止 | `blank-editor.html`；本轮终端记录 |
| 版本与依赖 | `sync_launcher_version.py --check`、`build_macos_icon.py --check`、`uv lock --check --offline`；锁文件只改根包版本，182 个包解析一致；全量 Python 同时覆盖构建契约 | `candidate-source-manifest.json`；本轮终端记录 |
| Windows 实际构建 | 隔离 `uv sync --group build --frozen`，运行原 `scripts/build-windows.ps1`；五份 local／MOSS／OCR requirements 冻结成功，PyInstaller 6.16.0 构建成功 | `build-env.log`、`windows-build.log` |
| Windows 两包完整性 | 标准／lite ZIP CRC、许可、bootstrap、运行环境清单及模块、FFmpeg 分离通过；打包的 web／Server／便携 HTML 与当前源码逐字节一致 | `windows-packages.log`、`windows-candidates.sha256.json` |
| Windows 实际操作 | 两个候选程序的 `--smoke-import`、`--help` 和本机 Server 启动；Chromium 实际导出源媒体 OTIO／OTIOZ、配音 WAV、含配音 OTIOZ、混音 MP4；标准使用内置 FFmpeg，lite 指定外部 FFmpeg | `native-smoke-final.log`、`native-lite-final.log`、`native-results/`、`native-lite-results/` |
| 官方 OTIO 解析 | OpenTimelineIO 0.18.1 成功读取本轮打包程序生成的源媒体与配音 OTIOZ；均为 5 秒、3 个 Clip，解包引用全部存在 | `otio-parser-final.log` |
| 格式与来源 | `git diff --check`；92 个修改／新增文本均 UTF-8 无 BOM、LF。503 个源码文件 SHA-256 清单（排除持续更新的本账本） | `candidate-source-manifest.json` |

复验中处理的情况：首次全量 Python 仅剩旧菜单分隔线数量断言失败，按新增源媒体选项分组更新后全量通过。首次 Node 未指定 Python 解释器导致 XML 用例无法启动，补正确环境后 311 项通过。首次 129 项浏览器运行是 122 通过、7 失败：视频 5 项因误将可执行文件传给要求目录的测试夹具而无法启动；自定义主题测试未等待服务器持久化；一项音频异步任务使用了比同类用例更短的等待时间。改为 FFmpeg 目录、等待实际持久化响应和同类 30 秒完成等待后，三个相关 spec 共 25 项全部通过，没有跳过失败用例。Windows 原生检查中合成工程缺波形时长触发了既有视频尾部选择，补与媒体一致的 5 秒波形后两包全部导出通过；没有修改生产尾部逻辑。官方 OTIO 解析首次缺少解析器要求的解包目录，创建后通过。

25 个 Python 跳过项仍涉及仅从 PATH 查找 FFmpeg 的旧用例、可选 numpy／OTIO 验证器、真实油库里／对齐资源及平台条件。显式配置 FFmpeg 已运行 MSW 音频／视频回归，官方 OTIO 验证器另行读取了真实产物；这些证据不会把原跳过项改计为通过。浏览器未执行 WebKit；没有 macOS／Linux 真机、外部剪辑软件或真实模型验收。

### 历史波形测试对照

补充运行完整 `waveform-history.spec.mjs` 时，初次 D 版本连同 13 项新用例共 67 项，39 通过、28 失败。随后在隔离目录用 `55db0d2` 源码加本轮开始保存的 B／C 文件副本重建 D 前状态：同一个历史 spec 的 54 项中，27 通过、27 失败。新增的唯一失败是旧断言认为帮助 End 应选中「播放与导航」；纵向平铺八分类后应为最后一项「关于」，已修正并通过。

另外修正了三项与本轮验收直接相关的历史用例：英文切换进入实际设置入口、去空隙 OTIO 文案／本地化文件名，以及音频工程不应期待视频轨。五项定向回归全部通过，剩余 24 项失败均在 D 前状态重现，明细保留于 `history-comparison.json`。它们涉及旧撤销按钮定位、隐藏菜单、已经不同的手工空隙／配色／英文空格规则、帮助与旧延长字幕入口，以及合并时列表滚动等现状；未统一判定为测试问题，也未改变当前 MSW 行为来迁就旧断言。后续需独立维护这组测试并复核滚动行为，本轮不声称完整历史浏览器套件通过。

### Windows 候选与尚缺的平台

候选位于 `msw-checks/phase-de-validation/windows-candidates/`：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `MSW-Windows-x64-v1.6.0-beta.2.zip` | 128904822 | `72c7ed77ec9e9d140155a570e6119060ee76102238dc0047fd5311a0ff5913d0` |
| `MSW-lite-Windows-x64-v1.6.0-beta.2.zip` | 54715207 | `5bc411d042459a39bb1cdb7436a9b92f6db5a42bcfd23ea1c422e056cf968201` |

标准包 FFmpeg 8.1.2 使用现有发行工作流指定的公开归档，SHA-256 为 `db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec`，许可、README 与来源说明随包保留。构建工具 uv 0.12.9 从官方版本下载并校验；没有升级项目锁定依赖。

本地没有可用的 macOS arm64 构建主机，WSL 尚未安装，不能在本轮 Windows 环境完成另外三包原生构建。现有 `.github/workflows/release.yml` 的手动预演会构建五包并进行总校验；已把本轮工程兼容、源媒体导出和 Launcher 回归纳入该流程。需提交并推送候选分支后才能运行。仓库 `AGENTS.md` 明确要求推送须维护者授权，因此本轮未推送或启动远端预演；旧 beta.1 的成功 CI 与已下载旧产物不作为当前版本证据。五包总验收、各平台真实桌面 Launcher／剪辑软件／真实模型操作仍未完成，F 发布继续待单独授权。

### 全部上游提交的最终处理映射

| # | 上游提交 | 本轮实际处理 |
|---|---|---|
| 1 | `cf040ca` | B：MSW 命名、路径、别名、后处理素材与日志；保留旧路径读取 |
| 2 | `5ab76bc` | B：可读导出／媒体后缀本地化；MSW 专属配音与稳定素材路径不变 |
| — | `3465d0d` | 仅历史合并节点，不重复施加功能补丁 |
| 3 | `ffa659c` | C：工具箱分类／切句迁移，保留 MSW 桥接与设置 |
| 4 | `5fb94e8` | C：左右独立滚动并验证小窗口 |
| 5 | `af7814a` | D：保留 MSW 已有无音轨元数据兼容分支，补源媒体回归 |
| 6 | `cb3e6ec` | 文档归纳已覆盖，不宣称为 MSW 新修复 |
| 7 | `d446a56` | D：空隙填充，接入手工来源、并集去重、撤销与配音保护 |
| 8 | `0381b23` | A：MOSP 顶层 v1 验证，继续校验 MSW 扩展 |
| 9 | `1a1177b` | A：Python 保存／恢复各边界写入版本 |
| 10 | `b527d0e` | A：文本匹配校验与统一工程 schema |
| 11 | `7883213` | A：浏览器未来版本拒绝、未知元数据保真，MSW 状态从当前工程读取 |
| 12 | `2dc7ce4` | E：从当前 MSW web 源码重建便携 HTML |
| 13 | `2095530` | A／E：融合 MOSP v1 与 MSW 扩展兼容说明 |
| 14 | `dd521a7` | 按批准报告舍弃 Parakeet 调研文档，无新模型实现 |
| 15 | `ac3e5f9` | 按批准报告舍弃上游 Paseo／开发者配置 |
| 16 | `6c91048` | C：缩放操作栏贴底与几何验证 |
| 17 | `6c67f74` | E：缩放改进归入 MSW beta.2 changelog |
| 18 | `b52377a` | B／C：运行环境设置、目录回读、别名与任务期间保护、英文诊断 |
| 19 | `4f3924d` | D：保留 MSW 设置／搜索，补分类记忆；帮助纵向化与主题适配 |
| 20 | `af5ceca` | D：源媒体三个选项、快照／取消与安全表情包打包；配音 OTIOZ 保持独立 |
| 21 | `8cb0151` | E：独立 MSW beta.2 版本、changelog、说明预览与发行检查 |
| 22 | `860f354` | A／E：保留 Windows 临时路径 resolve 断言意图；最终代码仍固定此引用 |

当前结果仍是集成分支上的未提交工作区；`HEAD` 为 MSW 起点 `55db0d27706ac50c069d0680095267b666a7408a`。候选源码清单摘要为 `e5215d06a605ef62ce5bef293b06137605b2fbadcafc992367b58221b1f0d06a`，用于本地结果复核，不能冒充提交 SHA。版本号与锁文件根包已更新，依赖声明与锁定版本保持 MSW 原规则；许可正文与第三方声明未改变。尚未建立最终集成提交／合并父节点、改变 `my-feature`、推送、创建标签或发布；下次推进远端预演前应先核对本账本及工作区，再固化候选来源。

## F 阶段执行记录

2026-09-10 已获得本次提交、推送及发布授权。开始时重新读取工作区、实际差异和账本，503 个候选源码文件与 E 阶段 SHA-256 清单全部一致。远端 `my-feature` 与 beta.1 标签均为 `55db0d2`，尚无 MSW beta.2 标签；远端 main 仍为上游 beta.1。

| 项目 | 状态 | 处理与证据 |
|---|---|---|
| F1 固化适配与上游关系 | 已修复 | 适配提交 `b67faca`；集成提交 `ba5a189` 的两个父节点为该适配提交与上游 `860f354`，合并前后产品树完全一致；已推送集成分支。全部 22 项处理见上表 |
| F2 五包原生预演 | 已修复 | [第四轮预演 34465587331](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/34465587331) 针对 `d6fb3ebf5c66bad5bad2fa3b4bbae12849e05b18`，三平台构建及五包总校验全部成功；已下载并核对实际发行说明 |
| F3 产品分支与标签 | 进行中 | 固化本次验收记录后快进 my-feature 并创建 beta.2 标签；从通过预演的提交起仅更新本账本，产品代码与构建配置相同 |
| F4 公开预发布验收 | 待处理 | 标签构建会重建、校验并上传五包；随后检查 Release 状态、提交、实际下载与说明；保留桌面／真实模型等未验证边界 |

F 阶段原始日志及 API 结果保留在仓库外 `msw-checks/phase-f-validation/`；凭据只经已配置的 Git 凭据管理器在内存中使用，不写入日志、工程或发布包。

### 首次预演与修正

首次预演的 Windows／macOS Python 各运行 1326 项，均有两项路径字符串断言失败：批量默认 manifest 防覆盖、后处理已有媒体优先于备用媒体。实际输出已规范化，分别与 Windows 临时目录短名称、macOS `/var` 符号链接写法不同。两项断言改为比较预期的 `Path.resolve()` 结果，继续校验文件名、防覆盖和媒体优先级，产品路径逻辑没有改变。本地启用 FFmpeg 后的总数较多，是部分媒体测试类在 CI 缺少工具时整体跳过所致；不能把 CI 跳过项计为通过。

远端 main 已仅快进至 `bc5262cd7f9f972d1efc299d4537fd13eaa657ce`，与本次查询的上游 main 一致。中英文 README 已移除“准备发布”文案。

路径修正本地 96 项回归通过，提交 `0464894`；[第二轮预演](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/34464304329) 继续核对三平台。首轮 Linux Python 为 1326 项、跳过 29 项，其后的构建失败来自旧 BtbN 每日归档 HTTP 404；原脚本未启用 curl `--fail`，错误页面最终触发 SHA-256 不匹配。首次预演已经自行结束，尝试停止旧运行返回 409，没有取消任何其他任务。

修正为 [2026-08-31 月末 8.1 稳定分支构建](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-08-31-13-27) `n8.1.2-50-g1a748fe2cd`。实际下载的 125758156 字节归档 SHA-256 为 `c733b4b2951e5957e15505f788b2c65a7a41b6da4b289e295852cc38079b4d2b`，与发布 API digest 和构建方 checksums 文件一致。按[构建方保留政策](https://github.com/BtbN/FFmpeg-Builds#release-retention-policy)，月末归档保留两年；脚本补 HTTP 失败退出、有限重试／超时和按版本隔离缓存。三平台增加随包 FFmpeg 的现有合成音频、视频及配音时间线测试，实际执行结果在后续预演记录。

本地打包契约、发行说明／资产校验及三组媒体回归共 61 项，`OK (skipped=1)`；唯一跳过为未安装到该进程的可选 OTIO 官方解析器（E 阶段有单独产物解析证据）。`bash -n scripts/build-appimage.sh` 与差异检查通过。第二轮 macOS 两包已成功，Windows 进入产物上传，Linux 仍因同一旧地址失败；下一轮统一使用修正后的提交。

[第三轮预演](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/actions/runs/34464993419) 使用 `7b28b43`：Linux 已完成 AppImage 构建、污染库环境下的 FFmpeg 启动、27 项媒体回归及无界面 Launcher 启动，任务成功。macOS 新启用的媒体测试运行 27 项，一处既有断言仍将规范化后的外部媒体 URL 与未经 resolve 的临时路径比较；改为 `self.source.resolve().as_uri()`，保留“不收集媒体时引用正确源文件”的检查。全部 48 个工作流嵌入脚本经 YAML 解析及 PowerShell／Bash 语法检查通过。

第三轮 Windows 的 83 项 Chromium 全部通过，媒体回归也仅在同一外部 URL 路径断言失败。该断言修正本地定向复测通过后提交为 `d6fb3eb`。第四轮 macOS 已通过新增媒体回归并进入两包上传；继续等待同一提交的五包总校验。

### 最终候选验收

第四轮预演现已整体 `success`，公开发布步骤按手动预演规则跳过。候选提交为 `d6fb3ebf5c66bad5bad2fa3b4bbae12849e05b18`。Windows、macOS、Linux 的打包契约均为 25 项通过；Python 全量分别为 1326 项、跳过 28／29／29 项；三平台额外使用各自随包 FFmpeg 执行的 27 项媒体回归均为 `OK (skipped=1)`。Windows Chromium 83 项全部通过。上述 CI 计数与 E 阶段的本地扩展覆盖分别保留，不重复累计。

五包总校验成功，包括准确的包集合、非空文件、ZIP CRC、标准／lite 差异、资源／许可、AppImage 标识和 SHA-256。下载 `release-preflight` 后再次校验，其正文与当前 `prepare_release_notes.py` 根据 CHANGELOG 生成的正文逐字一致；固定标签文档链接、预发布下载说明和五行 SHA-256 表全部正确。候选包校验和只属于预演，最终 Release 由标签重新构建，其实际校验和以后者为准。

已解决发布阻塞：三项跨平台临时路径断言和 Linux FFmpeg 归档失效。没有升级 MSW Python 锁定依赖、修改配音命名或扩大到上游 beta.3。未验证边界仍为真实付费／本地模型、macOS／Linux 用户桌面交互、WebKit 与外部剪辑软件导入；历史波形套件的 24 项失败仍按前述基线保留，未声称完整浏览器套件全部通过。
