# 说话人表排序与删除（2026-11-11）

范围：项目设置 → 说话人；保留现有稳定人物 ID、主副字幕及跨轨引用模型。

| 请求 | 状态 | 实施及验证 |
| --- | --- | --- |
| 手动调整说话人行顺序 | 已修复 | 左侧拖动手柄、右侧上下移动；第 0 行固定；固定身份不变，数字快捷键随新顺序。单元测试及本机浏览器第五行移至第二行、上下移动、撤销重做和快捷键测试通过。 |
| 删除单行说话人 | 已修复 | 显示受影响数量后确认；清除直接／跟随／跨轨引用，保留正文和绑定；锁定保护、至少一行、一次撤销。浏览器确认取消、删除、撤销重做、保存重开、锁定保护和确认过期检查通过。 |

实现：`web/msw-speaker.js` 负责排序与引用计划，`web/editor.js` 复用标记事务并将人物表纳入同一撤销记录；模板、样式及英文翻译同步更新。

验证记录：

- `node --test tests/test_speaker_palette.mjs tests/test_speaker_schemes.mjs tests/test_speaker_follow.mjs`：27 项通过。
- `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_editor_i18n.mjs tests/test_speaker_palette.mjs tests/test_speaker_schemes.mjs tests/test_speaker_follow.mjs`：373 项通过；相关脚本语法检查、`git diff --check` 和 LF 检查通过。
- `playwright test tests/e2e/speaker-rows.spec.mjs tests/e2e/speaker-palette.spec.mjs tests/e2e/speaker-follow.spec.mjs --project=chromium`：25 项通过；1 项跨工程方案测试首次在配置导出请求处超时，按原测试单独复跑通过（26 项均已验证）。新增 6 项全部通过，截图核对常规布局，600px 窗口可操作。
- 浏览器使用临时 `.mosp` 和合成音频、本机服务。初轮发现删除前过早刷新会重新发现旧标记，已将人物表刷新移至标记清除之后；撤销重做及重开验证通过。切换空工程时旧区间索引越界，已在更换字幕数组内容后立即失效缓存，新工程取消待删除操作测试通过。
- `python -m unittest discover -s tests -p "test_*.py"`：2338 项执行完成，结果 OK，95 项按环境条件跳过。使用项目虚拟环境、UTF-8 和隔离配置路径；未进行发行包或远端 CI 验证。
- 不改工程 schema，不生成停止维护的根目录便携 HTML，不修改用户工程或已保存的说话人方案。
