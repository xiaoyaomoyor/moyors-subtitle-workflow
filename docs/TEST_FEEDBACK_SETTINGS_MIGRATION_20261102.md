# 设置窗口拆分：阶段 2 保存规则与旧数据迁移

基线：`738b7189`；日期：2026-11-02。

按阶段 1 的归属清单落实读写隔离、旧值迁移和失效字段处理；两个设置窗口的界面拆分留待后续阶段。保留当前个人设置和工程，禁止将本机密钥或项目内容加入普通配置包。

| 项目 | 状态 | 证据／边界 |
| --- | --- | --- |
| 字段归属与统一默认值、保存接口 | 已修复 | `settings_fields.py` 登记归属与导出边界；去掉 editor.js 的重复默认；公共 scoped preferences 仅写实际变更字段 |
| 工程工作区与个人默认隔离 | 已修复 | 服务／便携浏览器验证工程 A/B、工作区撤销／重做、保存重开；个人默认与工程有效显示分别保存 |
| 旧字段迁移与过时内容清理 | 已修复 | 旧连接符、跳转秒数、编号开关、双轨高度有条件迁移；新字段优先；清理无消费的 splitAutoSubmit；保留旧工程读取用色表 |
| 配置导入导出与多窗口回归 | 已修复 | 字段级导出过滤，导入保留本机迁移标记，拒绝工程内容；部分导入、多窗口合并／冲突、换端口／浏览器／重启检查通过 |
| 浏览器验证、便携产物、文档与提交 | 已修复 | 便携产物重新生成；源码语法、LF 与 diff 检查通过，文档及 changelog 更新；按仓库默认流程提交推送 |

无关 WIP：`debug.log`、`.test-appdata/`、`output/`，保留且不提交。

## 阶段验证

- `python -m unittest tests.test_user_config tests.test_config_transfer tests.test_settings_fields tests.test_config_end_to_end`：36 项通过。迁移幂等、新值优先、原始备份、部分导入、敏感字段拒绝已覆盖。
- `node --test tests/test_user_config.mjs tests/test_editor_utils.mjs tests/test_waveform_js.mjs`：352 项通过；包含服务／离线的有效显示与个人默认隔离、导入后局部修改、自动波形振幅不回写。
- 初次验证发现测试调用不存在的 `empty` helper、误判 `prepare` 返回结构，已纠正夹具后重跑通过。最初 Node 全量调用缺少 Python PATH，使用项目环境重跑后全部通过，不算产品失败。
- Python 扩展检查加入启动器配置、工程读写、正式样式、说话人及方案，共 133 项通过。没有外部模型请求。
- 迁移原始备份增强后重跑 `test_settings_fields / test_user_config / test_config_transfer`：33 项通过；前端 scoped preferences 最终版 10 项通过。
- Playwright 配置专项 `settings-ownership / user-config / config-manager / config-final`：12 项通过，覆盖两套运行方式的工程 A/B 切换、工作区撤销／重做、保存重开、导入不修改项目正式样式／说话人／时间基准。浏览器页内异常为空。
- 扩展 `settings-ownership / wave-settings / track-settings / media-settings-layout`：16 项通过，9 项失败。用 HEAD（738b7189）中本轮涉及的五份前端源码替换测试响应并重跑旧 22 项，得到相同 9 项失败、13 项通过；未发现本轮新增失败。基线复核夹具只在忽略的 output 目录，不覆盖工作源码。
- 旧失败明细：`media-settings-layout` 7 项仍寻找播放器内已迁走的属性／旧自定义预设等控件；`track-settings` 1 项对绑定 source_id 的既有断言失败；`wave-settings` 1 项假定悬停详情初值关闭，但同一服务前一用例已保存开启。后续分别更新旧界面夹具、核对绑定断言、隔离服务配置，不将这些失败包装成全量通过。
- 第一遍基线复核脚本未避开 editor.js 的模板参数，导致响应替换失败，已修正后重新完整运行；该脚本失败不计产品结果。

## 保存与兼容决定

- 继续沿用 `.mswconfig` v1 和现有 `.mosp` 协议，未新建另一套用户文件或提高工程版本。
- 字段元数据放在 `maw/settings_fields.py`，随现有配置登记表注入服务版、启动器和便携版。默认值仍来自各自规范化器，不在元数据里复制数值。
- `MSWConfig.createPreferences` 管理个人默认与当前有效显示，临时显示变化通过 restore/observe 标记，只提交后续真实修改；模块发送的旧键忽略，配置文件中的未知键明确拒绝。
- 个人预览开关不进入项目撤销；项目外观／说话人撤销不带回导出默认。工作区撤销包含列表／编辑器显示，仍不回写个人偏好。
- 无消费的 `splitAutoSubmit`、旧 `cueListAutoScrollOnClick/cueListKeepSplitVisible` 清理；`cueEditorSplitAutoClose` 仍服务现用“自动切换”，保留键名与行为。旧 ASS／五色输入只保留兼容读取，不公开新入口、不混进普通导出。
- 升级前的公共配置、旧 sidecar 输入分别保留原始迁移副本；后续普通保存不会覆盖它们。浏览器原迁移副本继续保留。导入配置不会清空本机内部标记及旧工程仍需的兼容输入。
- 本轮未移动菜单和控件，未修改字幕、绑定、正式渲染规则或正在运行的任务；两个窗口的实际拆分留待下一阶段。
- 当前检查未发现 8250 监听服务，不启动或打断个人编辑会话；下次启动服务及重新打开页面时自动加载新保存规则。
