# 启动器 C+D 实施记录

日期：2026-09-22。基线为 `de20723` 加工作区已完成的 A+B；保留全部既有改动、测试数据目录与 TTS 规划，不提交或推送。

依据：[修缮计划](PLAN_LAUNCHER_INPUT_MODULES_20260921.md)。本轮只实施 C+D 及其必要验证，E/F 的其余全局调整留后续。

| 工作项 | 状态 | 验证与说明 |
| --- | --- | --- |
| C1 独立供应商、模型展示与预设提示词 | 已修复 | 已接入独立供应商、已保存模型和后端模板；专项浏览器与保存契约通过 |
| C2 翻译三种写入方式及工程保真 | 已修复 | 副字幕、回填、双语；主副轨及音频保留 |
| C3 文稿/Markdown、OCR 与模块布局 | 已修复 | 逐任务来源、实际预览、必要双列及长说明 |
| D1 原文/译文/双语发布契约 | 已修复 | 翻译前快照、独立输出、仅 SRT、恢复与碰撞 |
| D2 输出界面与配置迁移 | 已修复 | 明确位置/命名、条件显示、旧双语输出提示 |
| D3 共用缓存服务与独立波形工具 | 已修复 | 工程保真、重关联、多音轨、复用/重建、进度取消 |
| 验证、文档及生成产物 | 已修复 | 隔离测试、浏览器、真实 FFmpeg、UTF-8/LF |

## 基线检查

- 已阅读 AGENTS.md、A+B 实施记录、C+D 规划、工作区状态与差异概况。A+B 尚未提交，当前继续在其上开发。
- 当前后处理后端已支持逐步骤 provider，但前端仍写入共同供应商；翻译回填/双语仍由两个复选框表达。
- 当前发布层把最终 SRT 当作原文发布，需区分翻译前快照；已有项目缓存需复用保持扩展字段的派生写入链。

## 中途验证

- 队列及流程浏览器回归：19/19 通过，无脚本异常。
- 首轮后端组合运行 115 项，旧模块通过；新增测试发现 3 个夹具未包含规范化副轨字段的断言失败、1 个 Windows 默认编码读取错误、1 个构造参数错误，正在修正测试夹具后重跑。不是按通过处理。
- 一次测试命令误用了不存在的 test_quapeaks 模块名；已改用仓库实际的 test_reapeaks。
- 新输出服务按组防重名，原文取翻译前快照；中间适配工程改放临时目录，恢复输入存入后处理目录。独立波形工具已接入共用执行链，结果单独登记。

## 阶段验证

- 后端相关套件 481 项：480 通过、1 项既有平台跳过。包含实际 FFmpeg/Rust 波形与频谱生成、已有工程原始字节不变、完整 msw 字段和音频素材字节保真；API 结果登记验证使用隔离索引。
- 浏览器：队列/流程 19 项通过，模块 7 项通过；最新 beta4、C+D、交互、壳与设置升级组合 47 项全部通过。曾发现批量路径栏未及时收起，已修复；旧复选框与工具数量断言随新控件更新。
- 新专项覆盖逐模块供应商、三种译文写入、上下行序记忆、输出关闭草稿失效、仅 SRT 暂停缓存、键盘提示浮层、独立波形输入与取消、迟到事件过滤和英文窄窗。
- 已运行 uv run --active --no-sync python edit.py --blank，成功再生成便携产物；没有手改内联文件。
- Chromium 1440×900 的翻译与独立波形工具截图已人工查看，无脚本异常与横向溢出；在检查后补齐波形工具字段间距。截图位于工作区检查目录，不加入仓库。

## 最终边界与交付检查

- 最后增补了空白占位字幕的仅 SRT 拦截、强制刷新有效但不需要的 mopeaks 缓存。受影响 106 项后端测试全部通过。前一轮 481 项套件通过（其中 1 项既有平台跳过）；合计新增后端用例 15 项。
- 语法：7 个启动器脚本 node --check 通过；33 个改动/新增文本文件通过严格 UTF-8 与 LF 检查；git diff --check 通过。既有 A+B 与其他任务 WIP 均保留，未提交或推送。
- 未调用真实云 ASR/LLM，不产生计费请求；OCR 参数、区域和模型传递已有契约回归，OCR 模型推理未作实机调用。浏览器演示桥接及真实 Python/FFmpeg 测试不冒充 Windows WebView2 手动文件选择、拖入、多窗口实机验收。
- E/F 保持待处理：全局语言迁移、工具/设置分类缩进与全页面说明统一，以及完整跨宿主验收仍由后续阶段执行。本轮没有进入 TTS 扩展或更换编辑器业务流程。

- 最后一组 C+D / 队列 / 流程浏览器回归 25/25 通过；本轮覆盖共 73 个不同浏览器用例。150% 缩放下提示浮层边界实测处于窗口内，无 pageerror；最终工具字段间距已复核。

主要验证命令（使用隔离测试应用目录和测试用 FFmpeg）：

```text
python -m unittest tests.test_gui_web tests.test_launcher_r4 tests.test_launcher_queue tests.test_launcher_cd tests.test_postprocess_pipeline tests.test_postprocess tests.test_media_cache tests.test_reapeaks tests.test_project_io
python -m unittest tests.test_launcher_cd tests.test_launcher_queue tests.test_media_cache tests.test_gui_web.LauncherAssetContractTests -q
node node_modules/@playwright/test/cli.js test tests/e2e/launcher-config-output.spec.mjs tests/e2e/launcher-queue.spec.mjs tests/e2e/launcher-workflow.spec.mjs --project=chromium --reporter=line
uv run --active --no-sync python edit.py --blank
git diff --check
```
