# 识别工程复测：旧标签页与空白片段（2026-10-18）

| 项目 | 状态 | 事实与处理 |
| --- | --- | --- |
| 新工程仍有句尾标点 | 仅说明 | 实际新文件共 844 块、每轨 422 条，两轨句尾逗号／句号均为 0；原文 2 个问号、译文 2 个问号，符合保留名单。8250 仍加载 1072 块旧工程；用户确认可能查看了原标签页。 |
| 截图中的 meta 孤立短尾 | 仅说明 | 旧工程 359500–362180ms 前句与 362180–362460ms 的 meta, 分离；新工程合为 359500–362460ms 完整一句，译文也完整。截图与旧工程精确一致。 |
| 标点清理后残留空白片段 | 已修复 | 识别各入口在最终清理后删除空白片段，再进入翻译；非识别文字处理保持默认一一对应，不删除绑定字幕。444 项相关测试通过。 |

## 边界与基线

- 分支 `my-feature`，基线 `1d1b5d38`；不改写用户工程、备份及无关日志／测试数据，不调用计费服务。
- 新工程其余少于 3 词的片段包含 `but yeah`、`high fantasy`、`obviously` 等，不能仅凭短就认定断句错误；没有原始云端响应，保留云端句界、说话人及停顿边界，不盲目拼接。
- 启动器卡片勾选用于选择目标；需要执行启动编辑器并使用实际打开的新工程页面。刷新旧工程标签页不会切换工程。

## 验证

- 云端句界及本地段级流程复现纯标点 40ms 片段，最终输出只留下两条有效字幕，前后时间不移动；验证非 ASR 调用不会删除文字变空的绑定字幕。
- `python -m unittest tests.test_subtitle_punctuation tests.test_segmentation tests.test_qwen tests.test_local_asr tests.test_bcut tests.test_doubao tests.test_soniox tests.test_tencent tests.test_openai_asr tests.test_postprocess tests.test_postprocess_pipeline tests.test_launcher_flat_processing tests.test_packaging_contract`：444 项通过。
- `ruff check` 与 `git diff --check` 通过；本轮没有前端改动，无需重建编辑器或新增浏览器 UI 验证。没有重复计费识别，也没有写回现有工程。
- 已保存的新工程中 6 对空白块保留原样；过滤作用于后续新识别结果。未改动正常短句或原有字幕绑定。
