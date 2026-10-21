# 字体选择与中英文字体（2026-10-21）

基线 `9c7b1e16 / my-feature`。保留 `debug.log`、`.test-appdata/`、`output/`，不修改个人工程。

| # | 需求 | 状态 | 处理与证据 |
| --- | --- | --- | --- |
| 1 | 自动读取、合并两个搜索框 | 已修复 | 受保护的本机字体服务；单输入下拉栏、自动加载、手动输入、中文别名搜索与键盘选择通过浏览器测试 |
| 2 | 字体名称使用自身字形预览 | 已修复 | 候选使用实际字体族；浏览器样式断言及窄面板截图检查通过 |
| 3 | 中英文字体分别设置 | 已修复 | 中文覆盖筛选、优先中文名；单条覆盖恢复、保存重开、轨道／预设模型与实际 ASS 预览／烧录对照通过 |

设计：`fontName` 保留为中文及其他非拉丁文字字体，新增可选 `latinFontName` 用于英文、数字及半角标点；未设置时沿用原字体，旧工程外观不变。列表展示本地化名称，存储稳定字体族名。便携页面无本机服务时仍可直接输入名称，不伪称读取完整字体列表。

## 验证进度

- 字体目录初版按 typographic family 合并为 119 个；审查发现会隐藏 Arial Black／Arial Narrow，已改按可单独选择的 family 名保留，实测 143 个字体族，42 个具有常用中文字形覆盖，132 个具有完整英文字母／数字。名称按字体表读取，不按名称猜测中文支持。
- 新增 Python 专项 6/6 通过：字体目录、旧样式兼容、混排转义、两套字体换行测量、渐变／打字机与 ASS 预览导出一致，以及不能根据中文名称把纯西文字体误判为中文字体。
- Node 全量首轮 696/696；补充中英字体契约后 697/697 通过。
- 浏览器首轮 15/16 通过；新测试发现输入框滚入视野触发的 scroll 把菜单关掉，方向键再次打开完整列表。改为滚动时更新定位；失败项及新增英文字体烧录对照重新验证 2/2 通过，共 16 项独立测试通过。已检查 `chinese-font-picker.png` 与 `bilingual-fonts.png`，产物只保留本地。
- Python 全量首轮 2157 项：1 个旧布局版本断言已更新；7 个错误为默认 GBK 读取 UTF-8 子进程／文件。已确认日志中的 UnicodeDecodeError，启用 PYTHONUTF8 后全量通过（2080 通过、77 跳过）；随后补充的 1 项字体目录测试在专项 6/6 中通过。
- `edit.py --blank`、`scripts/build_comparison_tools.py` 与 `git diff --check` 已通过。未改个人配置或工程。
- 按用户已有授权重启 8250，读取启动状态保留当前工程路径；真实接口返回 147 个字体族、45 个支持常用中文，混排临时预览含 `\\fnGeorgia`，布局版本 14。实际服务目录数量高于受限进程扫描结果，以服务接口为准。

边界：中文筛选检查常用字与 CJK 字形覆盖，不承诺每个生僻字都具备字形；系统缺字仍由渲染器回退。无本机服务的便携 HTML 保留手输字体名，不弹浏览器字体授权。字幕 SRT 仍为纯文本，不携带字体。

收尾：补充中文输入法组合输入的回车保护，字体浏览器用例再验 1/1 通过。所有任务项完成，无阻塞；生成文件同步、LF 检查与 diff 检查通过。

主要验证命令（Python 统一启用 UTF-8；浏览器使用本机 Chromium、FFmpeg 与隔离临时工程）：

- `.venv/Scripts/python.exe -m unittest discover -s tests -p test_mixed_fonts.py`
- `.venv/Scripts/python.exe -u -m unittest discover -v -s tests -p "test_*.py"`
- `node --test tests/test_*.mjs`（指定 `MSW_TEST_PYTHON`）
- `npx playwright test tests/e2e/subtitle-properties.spec.mjs tests/e2e/properties-timeline-polish.spec.mjs --reporter=line`
- 失败项修复后：`npx playwright test tests/e2e/subtitle-properties.spec.mjs -g "automatic bilingual|cue preset changes only" --reporter=line`；输入法用例最终单独复验。
- `.venv/Scripts/python.exe edit.py --blank`、`.venv/Scripts/python.exe scripts/build_comparison_tools.py`、`git diff --check`
