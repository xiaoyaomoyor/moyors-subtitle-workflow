# 配置阶段 1–2（2026-10-21）

基线 `d299701d / my-feature`。保留 `debug.log`、`.test-appdata/` 和 `output/`。不读取本机 `.env`，不修改用户工程，不调用云端服务。

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 六阶段范围与 .mswconfig 契约 | 已修复 | CONFIGURATION_PLAN.md 固定原方案；UTF-8 JSON，format/version/revision/sections |
| 全配置归属与默认来源盘点 | 已修复 | CONFIGURATION_INVENTORY.md：公共偏好、项目、任务、环境／凭据、专用处理库与缓存逐项归属；REGISTRY 共用 |
| 公共配置读写与旧数据迁移 | 已修复 | UserConfig：登记白名单、原值比较、文件锁、原子替换、原件／迁移快照／上版备份；10 个专项 Python 测试通过 |
| 编辑器与启动器接入 | 已修复 | 存储适配、启动器 bridge、样式库、工作区及引导状态已接入。工程布局仅更新当前显示基准，后续修改仍比较持久化原值，避免误报冲突。启动器连续修改合并保存 |
| 跨窗口、跨端口及回归 | 已修复 | 浏览器现行流程 24 项全部通过；Node 347 项通过（含配置专项 6 项）；全量 Python 2207 项，28 跳过，其余通过 |

仅完成前两阶段；第三阶段导入导出和第四阶段配置管理界面不提前实施。

验证边界：sandbox 默认临时目录不可写、HTTP 探测受限，初轮后端回归的环境错误不算通过；改用工作区临时目录和隔离的提权本机测试重跑。旧测试中“GUI 偏好写进 .env”的断言随新保存契约更新，保留密钥／无关行不变的断言。TTS／后处理带资源依赖的专用库本轮保持唯一后端来源，分类导出适配在阶段 3。

## 阶段汇总

- 浏览器：`subtitle-properties.spec.mjs` 11 项通过，`user-config.spec.mjs` 2 项通过，`launcher-asr-options.spec.mjs` 4 项通过，`launcher-modules.spec.mjs` 7 项通过。配置专项覆盖三个独立浏览器上下文、不同端口、服务重启、同字段冲突恢复副本、不同字段合并、权限拒绝、未知分类拒绝、预设保存和工作区库。未启动真实 PyWebView 窗口，启动器桥接层另有 Python 测试。
- Node：`MSW_TEST_PYTHON=.venv/Scripts/python.exe node --test tests/test_user_config.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs`，347/347 通过。
- 定向 Python：输出目录／设置／工程恢复／打包／配置用例已复验；生成页面原有时间控件的旧断言同步为当前“方向＋秒数”控件。
- 初轮全量的环境失败：Windows 子进程未固定 UTF-8；空的 `MSW_ENV_FILE` 会遮蔽测试 `MAW_ENV_FILE`。最终运行移除前者并启用 `PYTHONUTF8=1`，所有测试数据使用隔离目录。旧测试直接改写环境文件反复更新 GUI 偏好，现改为通过公共保存接口；首次迁移后的旧文件保持原件不再反向覆盖。
- 初轮旧 `style-preset-workflow.spec.mjs` 3 项使用已迁走的媒体设置入口而失败；没有把它们计入通过数，本轮用现行 `subtitle-properties.spec.mjs` 覆盖预设、单条／多选外观、预览与实际 ASS 烧录像素范围一致性。
- 尚未验证的边界：真实 Firefox／其他浏览器内核、原生 PyWebView 窗口、实际冻结包与新机器迁移；这些列入阶段 6，不用 Chromium 独立上下文冒充跨内核测试。

## 最终验收（2026-10-22）

- `PYTHONUTF8=1 .venv/Scripts/python.exe -m unittest discover -s tests -p test_*.py`：2207 项，28 项按测试条件跳过，其余通过；末次启动器基准调整另跑 `test_gui_web test_user_config`，277 项，1 跳过，其余通过。
- 24 项不同的浏览器流程全部通过；其中 2 项配置专项在最终接口权限检查加入后再次通过。Node 347 项全部通过。
- 所有修改的 JS 文件 `node --check` 通过；`edit.py --blank` 已重新生成；`git diff --check` 与 UTF-8/LF 检查通过。
- 已按用户长期授权重启原 8250 服务，沿用原工程和参数。实际页面与受保护配置接口均返回 200；配置格式为 `msw-config` v1，44 个浏览器键登记生效。没有通过测试操作改写用户工程。
- 首次迁移浏览器偏好仍需在原浏览器／原端口刷新一次；原生启动器重开后读取新代码。已打开的其他窗口不被强制覆盖，刷新后读取公共配置。原 `.env` 的凭据和机器字段不迁出；旧 GUI 行作为历史原件保留，不再作为迁移后的偏好来源。

本轮前两阶段完成；后续按 CONFIGURATION_PLAN.md 推进阶段 3–6。
