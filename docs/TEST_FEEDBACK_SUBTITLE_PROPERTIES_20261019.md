# 字幕属性第一阶段（2026-10-19）

本轮范围：新增可停靠的“属性”模块，统一轨道默认与所选字幕的外观、现有定位及动画入口；新增逐条、跨轨多选的部分外观覆盖，接通保存、撤销、ASS 预览与导出。暂不新增背景形状、渐变或关键帧系统。

基线：`my-feature` / `bca1edbe`。开始时已有 `debug.log`、`.test-appdata/`、`output/` 本地改动，保持不动。

| 项目 | 状态 | 处理与验证 |
| --- | --- | --- |
| 单条外观覆盖数据、继承与共享 ASS 排布 | 已修复 | `subtitle_style` 仅保存外观字段；JS/Python 同构校验，测量与 ASS 编译使用同一合成样式，显式颜色优先于颜色标记。Node 编辑专项 13/13、Python 新专项 2/2；既有模型／渲染专项 63/63 |
| 属性模块、选择范围、混合值及入口迁移 | 已修复 | 新增 properties 停靠窗口；只编辑实际选区，混合值与逐项恢复；预览校对设置留在播放器。最终属性专项 7/7；320px 深色及 260px 浅色布局截图已检查 |
| 保存撤销、切分合并、预设及定位联动 | 已修复 | Node 全量 680/680；既有样式、定位与属性浏览器回归 28/28，布局与属性复验 8/8。保存重开、撤销重做、锁定保护及 ASS 预览与烧录像素比对通过 |
| 回归、生成产物与文档 | 已修复 | 最终 Python 专项 85/85；增补批量预设、单条覆盖保留另一侧预设及注释外观另存。重新生成空白编辑器和两个离线工具；语法、UTF-8/LF、diff 检查通过 |
| 全量 Python 的既有 FFmpeg 兼容失败 | 阻塞 | 全量 fail-fast 执行 1164 项，1 error、3 skipped；失败是未修改的音频混音模块使用 `-filter_complex_script`，本机测试 FFmpeg 不支持该参数；隔离复测相同。属本轮字幕属性范围外，不声称全量通过 |

未请求云端服务，未修改个人工程。初次浏览器用例误将默认已勾选的粗体当作变更，已改用斜体后通过；一次 Python 专项命令误填两个不存在的测试模块，其余 55 项通过，已以实际模块名重新执行并全部通过。收尾检查 8250 无监听服务，因此没有停止或重启个人服务；下次由启动器启动即加载新后端。

验证命令（使用仓库 `.venv`、隔离临时工程及测试 FFmpeg）：

- `node --test tests/test_*.mjs`：680/680。设置 `MSW_TEST_PYTHON` 为仓库虚拟环境。
- `python -m unittest test_cue_style test_flat_subtitles test_flat_subtitles_io test_selected_position test_project_subtitle_style test_editor_assets test_subtitle_tracks test_subtitle_tracks_io test_flat_production test_project_io test_msw_subtitle_style`（`PYTHONPATH=tests`）：85/85。
- `npx playwright test tests/e2e/project-subtitle-style.spec.mjs tests/e2e/selected-subtitle-position.spec.mjs tests/e2e/subtitle-properties.spec.mjs`：当时 28/28；属性专项增加后独立复验 7/7。另跑布局与属性组合 8/8。覆盖真实浏览器存取、混合值、锁定、预览切换、定位、预设及 FFmpeg 烧录像素比对，不能代表所有 E2E 均已执行。
- `uv run --frozen --no-sync python edit.py --blank`、`uv run --frozen --no-sync python scripts/build_comparison_tools.py`：成功。
- `node --check web/msw-project-style-ui.js`、`git diff --check`、本任务 35 个文本文件 UTF-8/LF 检查：通过。
- 全量 Python `python -m unittest discover -s tests -p test_*.py -f`：上述 FFmpeg 参数兼容问题阻止全量通过；下一步需单独校验测试 FFmpeg 版本或调整混音命令兼容性，本轮没有修改无关音频引擎。未验证云端识别、翻译和 TTS 实际请求。
