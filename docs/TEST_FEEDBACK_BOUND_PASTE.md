# 绑定字幕复制粘贴：轨道映射、引用与撤销

2026-10-26。对应 `PLAN_BOUND_CUE_OPERATIONS.md` 第二阶段。保留第一阶段整组拖动规则；不修改用户工程。

| 项目 | 状态 | 处理决定与证据 |
| --- | --- | --- |
| 组到组、普通多轨粘贴 | 已修复 | 复用物理轨道映射，复制时保存源轨道结构；不复用源轨道、不自动增轨；任一目标冲突则整笔拒绝。主副任一目标、反向绑定、显示换侧浏览器验证通过。 |
| 副本 ID、绑定与标记引用 | 已修复 | 按实际选区复制；内部引用重建，外部引用物化；源字幕及源轨道删除后仍可粘贴。词级、帧级时间和单条外观保留。 |
| 撤销重做、剪切及入口 | 已修复 | 一次粘贴一条历史；失败不改变工程或历史；原生文本复制优先。剪切按实际复制对象删除，留下未复制的伙伴并解除其绑定，撤销完整恢复。 |
| 性能边界 | 已修复 | 去掉复制阶段全工程转换与重复旧剪贴板流程；减少粘贴往返转换。仍使用完整历史快照；局部新增历史和长工程基准属于第三阶段。 |
| 验证与产物 | 已修复 | 459 项 JS、23 项 Python、46 项相关浏览器用例分组通过；编辑器和离线对比工具已重新生成。 |

基线：`0fb4871e`；已有 `debug.log`、`.test-appdata/`、`output/` 变动保留。

阶段证据：新增 12 项纯数据测试、10 项真实浏览器测试。首次测试失败来自夹具字段、编号及未加载媒体时未实际设置播放头，修正后通过。保存重开对比按实际 ID／内容核对，纯模型用例忽略显示投影带来的数组顺序差异。

收尾补充：在锁定轨道前插入其他轨道字幕，会改变显示数组中的标记下标；旧锁定校验误认为源字幕发生编辑。新增回归先复现失败，再改为比较引用的稳定字幕 ID；真实改指向仍被拒绝。单元与浏览器撤销重做验证通过。

## 验证命令与结果

- `node --check`：本轮四个 JS 源文件通过。
- `MSW_TEST_PYTHON=.venv/Scripts/python.exe node --test tests/test_bound_paste.mjs tests/test_production_project.mjs tests/test_flat_editing.mjs tests/test_flat_processing.mjs tests/test_flat_subtitles.mjs tests/test_subtitle_tracks.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs`：459 项通过。
- `.venv/Scripts/python.exe`，测试临时目录设在 `output/bound-paste-python-temp`，运行 `test_subtitle_tracks`、`test_subtitle_tracks_io`、`test_flat_production`：23 项通过。
- Playwright 本机 Edge、临时合成工程：`flat-production.spec.mjs` 26 项、`bound-move.spec.mjs` 10 项、`bound-paste.spec.mjs` 10 项通过。最终锁定引用修改后复验后两组 20 项全过。
- `uv run --frozen python edit.py --blank`、`uv run --frozen python scripts/build_comparison_tools.py`：通过。UTF-8/LF 与 `git diff --check` 通过。
- 只读检查 8250 页面：HTTP 200，已包含新剪贴板及粘贴路径；前端刷新生效，无需重启。

本阶段无阻塞项。未操作用户工程、未运行付费处理。粘贴仍使用完整撤销快照和全量提交；第三阶段继续局部新增事务、增量刷新与约 6000 条字幕的实测，不宣称本轮已彻底消除大工程粘贴停顿。
