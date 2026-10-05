# 统一多层字幕 A–C 实施记录

基线：`my-feature / b8abd97`；原有 `.test-appdata/` 保留。用户本轮授权缩小素材变动圆点，并执行 `PLAN_UNIFIED_SUBTITLE_LAYERS_20261005.md` 的 A、B、C 阶段。

| 项目 | 状态 | 范围 |
| --- | --- | --- |
| 缩小斜切圆点 | 已修复 | 9 px 圆点／1.2 px 斜切缝，浏览器测试和截图核验通过 |
| A：契约与查询核心 | 已修复 | v2、身份、区间索引、Python／浏览器迁移一致；正式写出已保护 |
| B：编辑与波形分层 | 已修复 | 创建／拖动／边界／拆分／合并／删除／粘贴、自动分层和撤销已接入开发预览 |
| C：列表与播放命中 | 已修复 | 全命中、稳定锚点、双语单卡片与明确编辑目标、右键优先级及来源选择已验证 |
| 文档与验证 | 已修复 | 最终 66 项 Python、341 项 JS，通过本轮 117 项浏览器检查；生成产物、语法、编码及 diff 检查通过 |

本轮遵循计划的阶段边界：A–C 为开发态交互，D–G 的处理回填、完整导出与生产启用不在本轮授权范围。实施时须保留旧工程、不在打开时写盘，不把尚未适配的处理／保存路径当作多层功能已完成。

## 实际进度与证据

- 已读取计划、上轮账本和工作区；基线仅保留原有本机测试数据。
- Python 验证必须使用 `tests.*` 包入口并显式指定隔离 `MSW_APP_DATA_ROOT`，避免绕过测试隔离。
- 圆点从 12 px 缩至 9 px，切缝从 1.6 px 缩至 1.2 px；浏览器测试通过并已查看截图，保持实心圆与单条斜切缝。
- A 首轮：8 组迁移夹具 Python／JS 输出一致；验证隐藏旧轨、ID 碰撞、颜色／表情包引用、来源引用、嵌套区间、半开边界与原文件不改写。`node --test tests/test_subtitle_layers.mjs` 15 项通过；隔离环境下 `python -m unittest tests.test_subtitle_layers` 4 项通过。
- 已确定版本 `msw.project.v2`；显示层不写入正文。A–C 以 `?subtitle-layers=1` 开发入口体验；正式保存、恢复与未适配处理仍关闭。旧工程初次升级备份定为 `<原文件名>.v1-backup.mosp`，已存在时追加 UTC 时间与序号；实际写出及备份事务在 F 实施，当前序列化明确拒绝 v2，避免误降级。
- B/C 首轮 10 项真实 Chromium 测试通过：四层／跨行显示、跨行拖动与稳定选择、非相邻数组项的同层共享边界、单手柄不联动、指定条目合并预览、颜色粘贴、主副卡片多命中、明确副字幕编辑、拆分删除撤销、关闭重叠限制、绑定字幕移动。
- 旧版浏览器回归 99 项通过（overlay-track、waveform-history、waveform-clipboard、project-schema）；圆点专项 1 项通过并人工查看截图。截图与日志保留于工作区外的验证目录，不纳入工程。
- Python 首次回归暴露 schema 为数组／对象时集合成员检查抛 TypeError，已改为安全比较；修复后 66 项通过。

- 最终多层专项浏览器回归 15 项通过，新增真实 `.mosp` 拖入、从普通模式打开帧时间 v2、多选时间移动、按住拖动期间键盘微调。生成器 `python edit.py --blank` 已成功，四层跨行界面截图已人工查看。
- 导入用例先暴露直接调用旧主轨时间修复导致合法嵌套段后移，又发现结构校验仍拒绝重叠。现在迁移先于旧处理、逐条修复，帧转换以传入工程版本判断，合法重叠不再被挤开或拒绝；开发工程不交给旧服务器接管写出。
- 帧时间导入还暴露 `fmtShortCompact` 将单个时间码误拆为起点／箭头／终点，导致 `undefined.startsWith`。已按单个时间码紧凑显示修复，相关导入用例通过。
- 拖动中键盘微调的指针基线及绑定副字幕基线已修复；取消拖动恢复主／副原值且不增加撤销，提交后的组合操作仅需一次撤销。

## A：逐文件假设审计与迁移边界

| 文件／组件 | 原假设 | A–C 处理及后续边界 |
| --- | --- | --- |
| `maw/project.py` | 主／副逐条以前一条结尾校验和修复 | v2 只修本条范围；合法重叠可读，v1 校验保持 |
| `maw/project_io.py` | 默认写出旧版本 | 暂拒绝 v2 正式写出；F 实现带备份的事务升级 |
| `maw/msw/subtitle_layers.py`、`web/msw-subtitle-layers.js` | 没有统一身份／查询契约 | 稳定 role＋track_id＋cue_id、半开整数区间、任意数量层、确定性迁移 |
| `maw/msw/project_codec.py`、`web/msw-project.js` | 管理 `msw` 扩展而非正文版本 | 不混用版本号；本轮保持原扩展契约，迁移已知来源身份；D 贯通真实任务与素材来源 |
| `web/editor-utils.js` | 只接受 v1；通用修复默认顺序不重叠 | 读取识别 v2；旧通用函数不改语义，由 v2 宿主逐条调用 |
| `web/editor.js` | 下标兼作选择身份、单一播放命中、邻居约束时间 | 渲染前按稳定 ID 恢复选择，v2 时间命令原子预检，所有播放命中与单一编辑目标分开；文件读取与帧同步保留嵌套 |
| `web/msw-subtitle-layers-editor.js` | 缺少迁移／UI 边界 | 开发开关、身份映射、旧隐藏组、合并预览、稳定滚动锚点、未适配功能保护 |
| `web/waveform.js`、`web/waveform.css` | 一轨一行、邻居就是前后数组元素 | 区间查询＋稳定分层，真实同层共享边界、跨行／多选／键盘调整，行高随字幕层数增加 |
| `web/editor-template.html`、`web/editor.css`、`web/editor-i18n.js` | 旧 V叠 独立入口 | 开发态隐藏转换入口、显示预览标识及旧隐藏组控制；保留 MSW 卡片反馈 |
| `web/msw-asr*`、`web/msw-processing.js`、`web/msw-tts*` | 某些回填／异步应用仍依赖单层时间目标 | C 已验证所选层进入翻译／TTS 快照；提交及结果应用暂受保护，D 才开放实际处理 |
| `web/msw-asset-library.js`、`web/msw-audio-actions*` | 插入、补齐、来源复核仍用旧冲突规则 | C 验证复制明确字幕到素材库；回插与音频关联在 D，不在本轮声称完成 |
| `web/msw-persistence.js`、服务器、便携工程下载 | 自动保存／恢复可能走旧格式 | 开发态阻止正式保存／自动草稿／版本写出与不兼容导出；F 贯通恢复、启动器与备份 |
| 样式预览、ASS／视频／SRT／OTIO 输出 | 单条／旧叠加或格式表达限制 | E 统一画面排布与导出，当前开发模式明确阻止未适配工程／字幕导出 |

技术定稿：`msw.project.v2`＋`msw.subtitle_layers.v1`；正文仍只有主／副数组，不持久化视觉层号。旧隐藏组单独记载 cue IDs 和可见性；ID 碰撞确定性重映射；旧 headIdx 颜色／表情包先物化再排序。未能恢复的历史绑定不猜测重建。备份名称与恢复策略见 `JSON_SCHEMA.md`，本轮只读迁移，不创建或覆盖用户工程。

## 验证范围与开发入口

- URL 添加 `?subtitle-layers=1`（已有查询参数时用 `&subtitle-layers=1`），或读取 v2 文件，即进入开发预览；工具栏明确显示状态。普通 v1 打开方式继续使用现行生产行为。
- 浏览器使用本地生成空壳页与合成夹具，覆盖真正 DOM 鼠标、键盘、拖入、弹窗、卡片和撤销；不调用付费 ASR／TTS／翻译服务。
- 8 组迁移夹具包括空／单主／双语绑定、旧轨显示与隐藏、ID 碰撞、颜色／表情包引用、来源和候选；Python／JS 输出一致，迁移不改输入。
- 生产保存、磁盘备份／恢复、Launcher 往返、所有播放器叠字及导出一致性、真实云端处理和 1,000／10,000 条性能压测，属于 D–G，未验证且未启用。8 层排布通过不等于大型工程性能达标。
- `blank-editor.html` 已由源码重新生成，作为仓库跟踪的便携产物同步更新；截图／运行数据位于工作区外验证目录，未加入仓库；原有 `.test-appdata/` 保留。

## 验证命令

在隔离测试数据根目录运行；Python 使用项目现有验证环境，浏览器注入该 Python 和已验证 FFmpeg 路径。

```powershell
node --test tests/test_subtitle_layers.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs
python -m unittest tests.test_subtitle_layers tests.test_project_contract tests.test_project_io tests.test_editor_assets tests.test_msw_project_schema
node node_modules/@playwright/test/cli.js test tests/e2e/subtitle-layers.spec.mjs --workers=1 --reporter=line
node node_modules/@playwright/test/cli.js test tests/e2e/overlay-track.spec.mjs tests/e2e/waveform-history.spec.mjs tests/e2e/waveform-clipboard.spec.mjs tests/e2e/project-schema.spec.mjs --workers=1 --reporter=line
node node_modules/@playwright/test/cli.js test tests/e2e/editor-tts.spec.mjs -g 'audio cards use review badges' --workers=1 --reporter=line
python edit.py --blank
git diff --check
```


最终结果：341 项 JS、66 项 Python 通过；15 项新多层用例、99 项原有编辑／历史／粘贴／工程回归、1 项圆点专项、2 项最终帧时间保存／处理回归通过，共 117 项浏览器检查。所有新增／修改文本通过 UTF-8、无 BOM、LF 检查，修改的 JS／MJS 语法通过；生成页面包含新的查询及适配模块，`git diff --check` 通过。本轮 A–C 无剩余待处理或阻塞项，D–G 边界如上；未执行提交或推送。
