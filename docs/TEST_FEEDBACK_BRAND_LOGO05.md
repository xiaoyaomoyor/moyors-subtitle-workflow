# MSW LOGO05 接入记录

## 授权与基线

- 2026-09-13：用户选定自制的 LOGO05 几何水母，要求编辑器标志跟随主题主色、不保留外框；启动器沿用此前指定的黑色版本，深色界面反白。
- 当前分支为 `sync/upstream-1.6.0-beta.3`，已有上游同步 A/B、C/D 未提交改动。保留这些改动，只增量修改品牌资源与主题接线，不提交或推送。
- 原稿包含 6 个触手 polygon 与 1 个带镂空的伞盖 path。本次保留全部坐标，仅整理 SVG 元数据、正方形画布与单色填充。

## 清单

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| 替换几何水母资源、移除旧方框 | 已修复 | `web/favicon.svg`、`web/launcher/logo.svg` 保留原稿 7 个形状；仅改为正方形画布与填充，旧框随旧资源移除 |
| 编辑器主题联动 | 已修复 | `syncEditorBrandColor` 在主题应用、强调色输入预览时更新菜单、关于页和 Favicon；嵌入 data URL 无外部资源依赖，浏览器验证通过 |
| 桌面图标与生成页同步 | 已修复 | 更新 PNG / 七尺寸 ICO / ICNS，重新生成 blank-editor.html；原生图标使用固定紫色以兼顾桌面明暗背景 |
| 浏览器与资源验证 | 已修复 | 品牌 E2E 3/3、编辑器资源 Python 19/19；检查 Launcher 明暗模式、三个主题预设、实时自定义颜色及刷新、便携与服务器页面，截图核对 |

## 实际验证

- `node --check web/editor.js` 与 `node --check tests/e2e/branding.spec.mjs`：通过。
- `python edit.py --blank`：成功，生成页保留当前工作区的上游同步修改。
- `node scripts/build_brand_icons.mjs`、`python scripts/build_macos_icon.py` 及 `--check`：生成与一致性检查通过。
- `python -m unittest discover -s tests -p test_editor_assets.py`：19/19 通过。
- `playwright test tests/e2e/branding.spec.mjs --project=chromium --workers=1`：3/3 通过；移动 HTML 后无外部资源依赖，菜单/关于页/Favicon 使用相同图形和颜色，32px 四角透明。
- 人工查看 Chromium 截图：编辑器菜单和关于页显示自定义粉色，启动器浅色黑色／深色白色。保留原稿形状，不调整小尺寸下的镂空结构。
- `git diff --check`：通过。

## 验证边界

未构建 EXE / AppImage / macOS 应用、未执行其他浏览器或操作系统实机验证，也未提交、推送或发布。品牌检查不等同于整批上游同步验收。
