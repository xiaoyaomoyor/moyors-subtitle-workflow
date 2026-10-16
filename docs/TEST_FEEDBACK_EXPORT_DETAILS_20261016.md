# 预设默认值与导出详情收尾（2026-10-16）

- 基线 `87ed012e`，工作分支 `my-feature`。保留 `debug.log`、`.test-appdata/`、`output/`；不读取 `.env`。
- 本轮逐项完成后提交推送；V1 兼容入口仅解释，不改行为。

| 项目 | 状态 | 决策与验证 |
| --- | --- | --- |
| 去掉继承选项、按当前预设恢复 | 已修复 | 移除继承选项，新增轨道使用默认白字快照；保留旧工程实际样式，恢复采用所选预设最后保存的参数。`style-preset-workflow` 浏览器 3 项通过，覆盖内置、覆盖后的用户预设、旧自定义与新轨道。 |
| 导出分类间距与成品统计 | 已修复 | 分秒毫秒、实际烧录字幕块及唯一贴片数；统计放在开始按钮左侧。`editor-video-export -g 'track master'` 通过，验证轨道选择计数、分类间距至少 10 px、窄窗口无横溢。 |
| 导出记录详情图标 | 已修复 | 后端保存实际计划统计、开始/结束时间；信息图标位于下载之前，三行快照，悬停查看、点击固定，旧数据缺失显示未知。接口 16 项通过，视频浏览器 18 项首轮通过，旧断言更新后 2 项复验通过，合计 19 项覆盖。 |
| 透明胶带样式 | 已修复 | 52 × 14 px 透明膜、反光及轻微主题色；保留定位、跟随、开关与动画时机。`merge-unified` 29 项浏览器通过，检查列表与波形截图。 |
| V1 兼容说明 | 仅说明 | 旧 v2 → v1 降级入口，遇多层重叠或不兼容绑定拒绝。当前 v4 未接入该转换：Node 只读复核输出仍为 v4，按钮只加 `.v1.mosp` 文件名；不应作为平级轨道兼容导出。本轮按请求只解释，不改入口。 |
| 回归、生成与交付 | 已修复 | Python 2119 项（2096 通过、23 跳过）；Node 670 通过；相关浏览器 51 项覆盖通过。Ruff、JS 语法、UTF-8/LF、diff 检查通过；生成 HTML 与源码完全一致。8250 无监听服务，无须重启；本轮文件按授权提交推送，回执见交付消息。 |

## 验证与边界

- `npx playwright test tests/e2e/style-preset-workflow.spec.mjs`：3 通过。
- `npx playwright test tests/e2e/editor-video-export.spec.mjs`：18 首轮通过；一条旧文本断言改为验证新信息浮层后，与详情轮询用例一同复验 2 通过，共覆盖 19 条；实际合成 MP4、烧录、轨道选择、编码、音画对齐均验证。
- `npx playwright test tests/e2e/merge-unified.spec.mjs`：29 通过；查看胶带及导出信息浮层截图，检查深浅色导出面板和窄窗口布局。
- `python -m unittest discover -s tests -p test_msw_audio_exports.py`：16 通过。首轮统计夹具忽略旧重叠字幕自动分轨，修正预期后通过；非产品错误。
- `python -m unittest discover -s tests -p 'test_*.py'`：2119 项，无失败，23 项按各测试条件跳过；没有调用真实计费服务。
- `node --test` 全部顶层 `.mjs`：670 通过。修改 JS 的 `node --check` 通过，Ruff 检查 3 个 Python 文件通过；修正所改文件内原有单行 `continue` 格式。
- `uv run --frozen --no-sync python edit.py --blank`：已生成；字节对比 `edit.build_blank_html()` 一致。修改文件均 UTF-8/LF，`git diff --check` 通过。
- V1 遗留入口只读检查结果：输入 v4，输出仍 v4，内容完全相同。本轮未改入口；不能向用户宣称它能把平级轨道转换为旧格式。
- 用户日志、本地应用数据与测试输出未纳入提交；当前无未完成的本轮代码项。
