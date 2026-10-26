# 绑定字幕移动：第一阶段

2026-10-26。范围：双向绑定平移、跨轨整组映射、整组落点及局部撤销。复制粘贴留待第二阶段；不改用户工程。

| 项目 | 状态 | 验证与边界 |
| --- | --- | --- |
| 双向绑定与跨列选区共用操作计划 | 已修复 | 以稳定 ID 收集实际选区和双向伙伴；仅克隆操作对象；同一个时间差，保留端点编辑现有语义。已通过数据单测及双向浏览器拖动。 |
| 主副组跨轨对应、完整落点与冲突回退 | 已修复 | 主副角色映射、双侧落点、目标锁定/缺失/占用整体回退；同轨平移由任一伙伴边界共同限制。撤销重做、保存重开和帧模式通过。 |
| 手动绑定参考与已有绑定保护 | 已修复 | 同组主轨默认参考；重复绑定无操作，第三方绑定明确提示先解绑。浏览器验证反向选择后仍双向平移。 |
| 浏览器及数据回归、产物生成 | 已修复 | 相关 51 项浏览器用例分组复验通过；404 项 JS 与 23 项 Python 通过。编辑器及离线对比工具已重新生成。 |

基线：工作区原有 `debug.log`、`.test-appdata/`、`output/` 均保留，不属于本任务提交。方案见 `PLAN_BOUND_CUE_OPERATIONS.md`。

阶段验证：语法检查与 129 项轨道/投影/波形单测通过。编辑器工具 275 项通过（初次 uv 缓存权限失败，改用项目解释器后通过）；浏览器在沙盒内无法启动 Edge，改为授权的本机临时浏览器运行，不操作用户工程。新增用例初次存在帧号预期与测试辅助函数错误，已更正后继续回归。

## 最终实现与验收

- `msw-production-project.js` 共用操作计划按 ID 收集双向绑定闭包，以完整物理轨道顺序及 `secondary_for` 分组映射；折叠不改变目标角色，不自动新建缺少的副轨。
- `msw-subtitle-tracks-editor.js` 的鼠标平移、局部历史和取消使用同一组对象；无论内部显示列或参考方向都统一移动。手动绑定幂等，同组主轨默认参考，保留自动同步时长设置，第三方旧绑定必须显式解绑。
- 波形显示两侧落点和目标组提示，冲突时整笔回退。Alt 拖动在平级模型内不再触发旧版副字幕独立模式，Alt 点击禁用保持不变。
- 回归发现并修复按住字幕使用 Shift+A/D 后，Shift 松开触发鼠标刷新恢复旧边界的问题；更新指针基准，同时保留整次手势初始快照用于取消。
- 键盘测试改为显式设置本例步长与吸附偏好，避免统一配置服务在不同用例间保留前例的设置；不改变产品默认设置。

验证命令与实际结果：

1. `node --check` 检查本轮 JS；`git diff --check`、UTF-8/LF 检查通过。
2. `MSW_TEST_PYTHON=.venv/Scripts/python.exe node --test tests/test_production_project.mjs tests/test_subtitle_tracks.mjs tests/test_waveform_js.mjs tests/test_editor_utils.mjs`：404 项通过。
3. Python 指定项目内临时目录、加入 `tests` 模块路径，运行 `test_subtitle_tracks`、`test_subtitle_tracks_io`、`test_flat_production`：23 项通过。初次 Windows 沙盒临时目录写入受限及直接模块导入路径不适用，修正运行环境后通过，无产品 Python 修改。
4. Playwright 使用本机 Edge 和临时工程：新增 `bound-move.spec.mjs` 10 项、`flat-production.spec.mjs` 26 项通过；`keyboard-timing.spec.mjs` 15 项在修复基准及隔离测试偏好后全过。检查了整组落点截图，保留主题色和原有卡片样式。
5. `uv run --frozen python edit.py --blank` 与 `uv run --frozen python scripts/build_comparison_tools.py` 通过。
6. 只读请求当前 8250 服务返回 HTTP 200，页面包含新移动与键盘基准代码，刷新即可加载，不需要重启。

本阶段无阻塞项。不触碰用户工程，也不迁移已有绑定时间。跨组复制粘贴和专门的大工程性能验收仍属第二、三阶段，不能把本阶段结果视为已修复粘贴映射问题。
