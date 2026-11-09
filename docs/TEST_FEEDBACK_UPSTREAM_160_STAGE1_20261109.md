# 上游 v1.6.0 跟进第一阶段

范围：补齐本地识别依赖，修复 Premiere XML 字体载荷；分别验证干净环境安装与导出。便携页面仅分析用途与维护成本，本轮不删除。不创建标签、不发布版本。

起点：`44c0bacb`，工作分支 `my-feature`。保留既有 debug.log、output、测试数据及本机配置。

| 项目 | 状态 | 证据与验收 |
| --- | --- | --- |
| 本地识别依赖 | 已修复 | Python 绑定与 core 明确固定为 1.13.8，uv 重新生成锁文件，无其他包升级；运行环境版本改为 8，旧安装提示修复，旧冻结清单重新生成。Windows 独立空环境安装和原生 API 导入通过；41 项运行环境测试通过；正式主／CPU 清单冻结成功 |
| Premiere XML 字体 | 已修复 | 移除上游确认不兼容的 mUnderline 字段；276 项工具测试和 1 项浏览器原生字幕导出测试通过，覆盖字体、字号、主副字幕、换行和禁用筛选 |
| 便携页面 | 仅说明 | 建议不再作为完整编辑器持续扩展，后续退出默认分发；保留共享页面生成代码。本轮未删除入口或产物 |

验证记录随实际结果更新。若没有 Premiere 实机或其他操作系统，明确区分载荷／包完整性检查和实际应用运行结果。

## 本地识别验证

- 官方 PyPI 1.13.8 元数据确认 Python 包要求同版本 core；通过 uv 生成锁文件并显式声明两者，让已有直接依赖覆盖检查能识别缺 core 的旧清单，CPU 变体也保留此依赖。没有复制整份上游锁文件。
- `uv lock --check` 通过；`python -m maw.runtimes.freezer freeze --runtime local --force` 生成正式打包所用的主清单和 CPU 清单。标准版与 lite 版共用该运行时清单。
- 从冻结清单提取这次修复的两个包，在全新 `output/upstream160-clean-local` 环境安装，导入 `sherpa_onnx.OfflineRecognizer`、创建 `OfflineRecognizerConfig`、确认 FireRed CTC 构造入口均通过。这是原生依赖干净安装验收，没有下载所有识别模型或重新验证识别质量。
- `PYTHONUTF8=1 PYTHONPATH=tests;.` 下运行 `test_runtimes test_local_runtime`，41 项通过。首次未设 UTF-8 时 1 项测试因 GBK 解码中文输出失败；复核后通过，未将该失败计入成功。
- macOS／Linux 仅核对包与清单，尚未在对应系统实机执行；本轮没有重新打完整发行包。

## Premiere XML 验证

- `web/editor-utils.js` 只移除 GraphicAndType 样式表的 `mUnderline`，沿用 MSW 的导出计划与筛选，不引入上游旧轨道界面。
- `node --test tests/test_editor_utils.mjs`：276 项通过。新增载荷检查覆盖 1080p／2160p 的字体字号、中英文、换行、emoji、主副文本、禁用字幕排除及输入工程不变。
- `npx playwright test tests/e2e/fcp7-export.spec.mjs --project=chromium --grep 'emits GraphicAndType'`：1 项通过。浏览器真实导出生成 3 个原生字幕对象，逐个解码确认字体和字号，不包含不兼容字段。
- 第一次工具测试因受限环境无法访问 uv 的解释器缓存而失败；在允许执行测试子进程的环境重新运行后全部通过，不是产品导出失败。
- `uv run python edit.py --blank` 已重新生成页面。三个改动的 JS 文件通过 `node --check`，11 个任务文件通过 UTF-8／LF 检查，Python 语法与 `git diff --check` 通过；锁文件对照确认只新增 core 1.13.8，没有改动其他包版本。
- 尚未在 Premiere GUI 内实际导入，也没有执行 macOS／Linux 实机安装；本轮结论限于原生依赖安装、载荷与浏览器导出验证。

## 便携页面的保留建议

- 便携页面是 `blank-editor.html` 或包含工程及波形的 `.edit.html`，用于无本机服务时打开、简单编辑和离线检查；并不包含源视频，也不能独立提供后台识别、完整渲染等能力。它与解压运行的 MSW 发行包是不同概念。
- 日常本机服务通过 `edit.render_editor_page()` 从 `web/` 源码生成页面，并不读取 `blank-editor.html`。启动器便携导出、发行包和在线编辑器入口也使用同一套生成代码。
- 没有必要为便携模式继续追求与本机编辑器完全一致的功能。建议后续从默认发行包、常用入口和默认产物中退出，按需保留离线生成；这能减少测试与使用分支，但不会显著提升正常编辑器的速度。
- 若以后彻底移除便携功能，应单独清理生成命令、工作流选项、发行和在线页面入口、专属测试及文档；保留本机服务依赖的共享渲染函数。本轮只给建议，没有删除这些内容。

## 来源

- [sherpa-onnx 1.13.8](https://pypi.org/project/sherpa-onnx/1.13.8/) 与 [sherpa-onnx-core 1.13.8](https://pypi.org/project/sherpa-onnx-core/1.13.8/)
- 上游依赖提交 `ca03de2041aa6b77bfda188b7b0e279bf32bf08f`；Premiere 修复提交 `38c3f6f8e5cbb323f957bc187ad5e4c064289a35`。
