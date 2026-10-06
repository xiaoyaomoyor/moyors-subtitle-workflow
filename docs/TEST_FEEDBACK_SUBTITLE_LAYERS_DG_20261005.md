# 统一多层字幕 D–G 实施记录

用户授权：先提交并推送 A–C，再实施 D–G；2026-10-06 追加授权提交并推送 D–G。基线为 `559cb9b`；原有 `.test-appdata/` 保持原状，不纳入提交。

| 项目 | 状态 | 事实与下一步 |
| --- | --- | --- |
| 提交 A–C | 已修复 | `559cb9b`，27 文件；既有验证见 A–C 账本 |
| 推送 A–C | 已修复 | 用户要求重试后，查明 Git 旧代理端口 7897 与 Windows 当前端口 7900 不一致；临时使用 7900 推送成功，远端 my-feature 已核对为 559cb9b |
| D：处理与素材关联 | 已修复 | 指定 ID 应用、绑定翻译与素材回插；闭环覆盖局部识别→翻译→模拟 TTS→贴片→保存重载，七引擎来源／时长快照测试通过 |
| E：预览与导出 | 已修复 | 主副成组避让、CSS／ASS 预览、烧录、合并显示 SRT、旧版限制；合成媒体截图已检查，四行实际烧录抽帧通过 |
| F：保存、启动器、性能 | 已修复 | 原字节备份和原子替换、恢复及 .assets 复制；大工程浏览器实测见下，未适配启动器后处理拒绝 v2 |
| G：生产启用及完整回归 | 已修复 | 已默认启用，完整流程、便携产物、语法与差异检查通过；付费服务与可选 OTIO 官方校验边界见下 |

## 约束

- 正文仍为主／副数组，视觉层不成为新角色；使用稳定 ID 与半开整数毫秒。
- ASR 覆盖重叠范围必须明确目标；没有字词时间码的区外剩余片段保留文字并标记复核。
- 音频三层限制、原配方重生成与媒体增益规则不变。
- 不访问密钥，不对真实云端发起收费验证；模拟结果不能宣称真实供应商验证。
- 旧文件只读入；首次 v2 写回先备份，失败不改原文件。不静默降级旧格式。

## 验证记录

每阶段记录实际测试、失败修复与未验证边界；最终生产开关仅在闭环验证通过后开放。

### 首轮回归

- JS 核心／结果回归 29 项通过；此前 ASR／翻译／素材／结果 54 项通过。
- Python 保存备份、跨端排布、翻译、样式、ASR 共 51 项通过，4 项因当前测试进程未配置 FFmpeg 跳过，后续使用隔离 FFmpeg 重跑。
- 首轮浏览器 15 项均受新增迁移函数误写变量 `source` 影响；已修正为 `input`，正在重跑。此轮失败不计入通过数。
- 初次 Python 命令缺少 `PYTHONPATH=tests` 导致 ASR 测试导入失败；补齐测试环境后通过。

### 保存／渲染整合回归

- 多层编辑与识别／翻译候选面板浏览器回归：25/25 通过（含默认启用路径、取消目标选择、3 层以上 SRT 导入、主副预览）。
- Python 多层保存、恢复、音频随工程复制、视频烧录、工程契约与启动器队列：99/99 通过，包含真实 FFmpeg 四条双语字幕抽帧、字幕结束帧无残留。
- 纯核心性能夹具：1,000／10,000 条 × 2／4／8 层，首次索引 0.48–8.45 ms，单目标局部更新＋查询 p95 0.013–0.048 ms。此值不包含浏览器绘制，不能当作整页帧率；测试确认拖动期间不重建或排序整棵索引。
- 修复保存快照遗漏副字幕颜色／主副待校对标记的历史白名单路径；正在进行更广浏览器保存、素材和 TTS 回归。
- 第二次 Python 批量命令误列不存在的 `tests.test_project`，其余 75 项通过；已改用实际的 `tests.test_project_contract` 并在上述 99 项测试中验证。

### 扩大回归及失败处理

- 全部前端纯逻辑 `node --test tests/test_*.mjs`（PowerShell 枚举实际文件）：465 项通过。后续新增旧版导出跨组颜色引用测试，最终结果另记。
- Python 19 个相关模块 225 项运行、224 通过、1 跳过；跳过项为未安装的可选 `opentimelineio` 官方解析器，其他 OTIO 结构、导出与媒体测试仍运行。没有用跳过项冒充通过。
- 首轮 121 项浏览器有 12 失败、109 通过：旧测试期待 v1、旧菜单数量、原紧凑轨高和重叠拒绝；此外修正未知版本中文提示、手动位置 ASS 的事件边距覆盖。按当前产品语义修订断言后，相关 84 项全通过，含新增完整处理闭环。
- 多层浏览器 21 项全通过，另对实际媒体预览及含单层基线的性能重测 2 项全通过。原截图只在无媒体状态下验证了几何、被占位层遮挡，已补真实合成音频加载并重拍，检查四条可见字幕。
- 预览几何、鼠标悬停播放、Seek 竞态 16 项全通过，覆盖拖动／缩放／键盘／撤销／服务器保存及便携导入。
- 新增启动器拒绝测试初次误把字符串传给要求 `Path` 的测试读取函数；已修正测试夹具，后续结果另记。

### 浏览器性能（本机合成夹具）

下表加载包含导航和列表／波形渲染；拖动数值为同步指针处理耗时，不等同于屏幕帧率，也不包含全部异步绘制。每个场景检查拖动中区间索引对象保持，不全量排序重建。首次操作包含撤销快照；1 万条列表仍有约 4.6–5.6 秒加载开销。

| 字幕数 | 同时层数 | 加载 ms | 首次拖动 ms | 后续拖动 p95 ms |
| --- | --- | --- | --- | --- |
| 1,000 | 1（基线） | 555 | 4.6 | 1.7 |
| 1,000 | 2 | 426 | 2.2 | 1.8 |
| 1,000 | 4 | 808 | 4.4 | 3.8 |
| 1,000 | 8 | 1187 | 4.7 | 3.9 |
| 10,000 | 1（基线） | 4543 | 34.8 | 18.5 |
| 10,000 | 2 | 5432 | 35.0 | 20.2 |
| 10,000 | 4 | 5186 | 33.9 | 20.7 |
| 10,000 | 8 | 5291 | 36.9 | 27.3 |

表格为最终复测，较前轮有调度波动；8 层大工程仍比单层多一些处理时间，不声称零开销。进一步让播放器的命中索引也按拖动目标局部更新；拖动过程中暂保留画面组的排布位置，提交／取消后统一刷新。测试同时检查波形与播放器索引不重建，并核对移动后的播放命中。

### 最终收尾

- JS 全集最终 **466/466 通过**；全部编辑器脚本 `node --check` 通过。
- 最后新增启动器边界与产物契约合计 **53/53 通过**；最终重新生成 `blank-editor.html` 后，产物契约再次 **19/19 通过**。
- 最终多层浏览器 **22/22 通过**；另有 ASS 导出边界 **7/7**、说话人／可见预览 **3/3**、几何与 Seek **16/16**、广泛处理／素材／保存 **84/84**。这些轮次存在重叠，不相加冒充独立用例总数。
- 修正 ASS 隐藏旧组后的颜色引用和首条从零时间；兼容导出先物化跨组颜色／表情包引用。CSS 恢复背景、阴影、下划线和控制条避让，ASS 保留换行。预览正文不参与 UI 翻译。
- `git diff --check` 曾检出一处源文件及生成副本行尾空格；源文件修正、重新生成后检查通过。文件保持 UTF-8、LF。原有 `.test-appdata/` 保持未跟踪且未改动。

主要复现命令（使用隔离应用数据目录、测试 Python 和 FFmpeg 路径，不读取真实密钥）：

```powershell
$files = @(rg --files tests -g 'test_*.mjs')
node --test @files
python -m unittest tests.test_subtitle_layers tests.test_subtitle_layers_dg tests.test_project_io tests.test_project_contract tests.test_msw_project_schema tests.test_msw_beta3_project tests.test_msw_asr tests.test_msw_beta3_asr tests.test_msw_persistence tests.test_msw_audio_plan tests.test_msw_audio_exports tests.test_msw_subtitle_export tests.test_msw_subtitle_style tests.test_msw_timeline_export tests.test_msw_subtitle_assets tests.test_postprocess_io tests.test_postprocess_pipeline tests.test_launcher_queue tests.test_msw_video_render
node node_modules/@playwright/test/cli.js test tests/e2e/ass-export.spec.mjs tests/e2e/asset-library.spec.mjs tests/e2e/editor-tts.spec.mjs tests/e2e/new-project.spec.mjs tests/e2e/project-schema.spec.mjs --workers=1 --reporter=line
node node_modules/@playwright/test/cli.js test tests/e2e/subtitle-layers.spec.mjs --workers=1 --reporter=line
node node_modules/@playwright/test/cli.js test tests/e2e/subtitle-preview-geometry.spec.mjs tests/e2e/hover-seek-preview.spec.mjs tests/e2e/subtitle-seek-race.spec.mjs --workers=1 --reporter=line
python edit.py --blank
python -m unittest tests.test_editor_assets tests.test_launcher_queue tests.test_subtitle_layers tests.test_subtitle_layers_dg
git diff --check
```

### 边界与交付

- 旧版兼容出口明确拒绝同角色重叠及无法还原的旧组绑定／处理记录；不承诺旧上游可直接打开 v2。
- CSS 外观与 ASS／烧录样式仍是现有独立选择；共用成组避让规则，不承诺所有字体像素级一致。字幕过多／字号过大仍须调整排布。
- 未调用付费 ASR／LLM／TTS，也未测试用户真实供应商音质。外部结果使用模拟服务，FFmpeg 烧录和 WAV 文件操作是真实执行。
- A–C 初次推送因旧代理端口不可连接、直连被重置而失败。用户要求重试后，核实 Git 使用 7897、Windows 当前代理为 7900；以单次命令代理覆盖推送成功，当时远端 `my-feature` 与本地均为 `559cb9b251b63968953951b81131badbdad02239`。未改变永久代理、远端或 main，未推到上游。
- 2026-10-06：D–G 按用户追加授权纳入本次提交，包含已验证的源码、测试、文档与便携产物，推送目标为 `origin/my-feature`；本机测试数据不纳入提交。本轮未新增功能代码，沿用上述验证结果。
