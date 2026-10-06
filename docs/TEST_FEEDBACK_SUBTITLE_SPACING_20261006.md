# 主副字幕间距一致性与测试失败说明（2026-10-06）

- 基线 `05c259d`，工作分支 `my-feature`，原有 `.test-appdata/` 保留。

| 项目 | 状态 | 证据与处理 |
| --- | --- | --- |
| 解释全量 Python 的 5 项失败／错误 | 仅说明 | 3 项与输出目录偏好和目录权限模拟有关；1 项依赖旧 HTML 字面量；1 项是从后处理中间结果恢复时原工程路径不存在，流程提前读取原工程报错。本轮说明实际失败点，不将其笼统认定为无害。 |
| 相同间距在自定义与预设中观感不同 | 仅说明 | 基准单位均为 1080p；间距指估算行框之间的附加距离，同为 -46 不保证不同字号／字体的字形可见空白相同。已核对“更大字号”参数，补充中英文提示。 |
| 纵向缩放被排布忽略 | 已修复 | 等效字号／缩放的前后端复现先失败、修复后通过；设置位置推算、预览与导出统一计入 scaleY。 |
| 当前运行服务加载修复 | 已修复 | 用户确认工程已保存且无任务后，正常关闭并以原工程、原端口重启；实际接口返回布局协议 2，两种等效高度样式输出相同位置。 |

## 五项具体失败

1. `test_run_transcription_passes_api_key_only_in_child_environment`：编辑器 HTML 的预期目录是 `_msw`，实际按本机偏好使用 `clip_msw`；失败点不是 API Key 传递。
2. `test_flv_conversion_defaults_to_msw_cache`：预期 `_msw/take.mp4`，实际 `take_msw/take.mp4`。
3. `test_read_only_directory_falls_back_to_source_scoped_local_binary_cache`：测试仅对名为 `_msw` 的目录模拟只读，实际使用 `source_msw`，未触发预期的本机缓存回退。
4. `test_blank_editor_inlines_modular_assets`：仍要求生成 HTML 包含旧的 `const DATA = {"segments": []` 字面量；不是浏览器加载错误报告。
5. `test_derived_pipeline_collects_voice_assets_and_keeps_relative_media_valid`：测试最后一段从已完成的中间结果恢复、向新目录发布时，传入尚不存在的原工程路径；流程读取原工程报 `PostprocessFileError`，未执行到素材缺失警告断言。这反映该恢复场景存在待核对的兼容问题，不能用字幕专项通过代替验证。

## 定位与阶段验证

- 用户确认跟随工程，对比“当前自定义”和用户预设“更大字号”，均填 -46。只读预设参数显示主／副字号为 70／88，纵向缩放均为 100%；本次观察不能归因于缩放遗漏。相同负间距是在不同高度的行框之间压缩相同数量的基准像素，字体、描边和压缩限幅仍会影响可见空白。未修改用户预设或工程快照。
- 确认独立的缩放 Bug：主字幕字号 40、纵向缩放 200% 与字号 80、缩放 100% 在单行文字中有等效高度，旧预览／烧录却输出不同的副字幕边距（98 与 146，相差 48）。新增 Node 和 Python 测试在修改前均失败，修复后通过。
- 前后端、设置中的位置推算、便携 ASS 和近似预览均传递纵向缩放，布局协议升至 2 防止旧常驻服务混用。提示明确“附加行框间距”，保留字号 × 1.2 的估算方式，不承诺不同字形边缘空白完全相同。
- Node 358/358、Python 样式和层级专项 20/20 通过。新增浏览器等效缩放测试通过，包含 -46 px、画面像素位置和便携 ASS／后端的边距一致性。
- 浏览器回归 24/24 通过：工程字幕样式 12、媒体设置 6、ASS 导出 6；包含新旧样式、绑定／未绑定主副、正负间距、FFmpeg 画面与 libass 预览位置比较。
- 当前服务重启后合成接口验证通过：字号 40／缩放 200% 与字号 80／缩放 100%，gap=-46 时主／副边距均为 96／146，布局协议版本 2。首次合成请求因未补全 v2 工程结构被正确拒绝；规范化测试数据后通过，不是产品故障。

## 最终验证与边界

- `node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_project_style.mjs tests/test_subtitle_presentation.mjs tests/test_subtitle_layers.mjs`：358/358 通过。
- `.venv/Scripts/python.exe -m unittest tests.test_project_subtitle_style tests.test_subtitle_layers_dg`：20/20 通过。
- `node node_modules/@playwright/test/cli.js test tests/e2e/project-subtitle-style.spec.mjs tests/e2e/media-settings-layout.spec.mjs tests/e2e/ass-export.spec.mjs --project=chromium`（Edge）：24/24 通过。
- `.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py'`：1980 项，4 个失败、1 个错误、74 项跳过；与基线完全相同的上述五项，未修复或忽略它们。
- `blank-editor.html` 已用 `.venv/Scripts/python.exe edit.py --blank` 重新生成；前端语法、UTF-8 / LF、`git diff --check` 通过。
- 用户的“当前自定义”在服务根页面返回的已保存工程中没有可读取的快照，因此不能逐字段证明两套用户样式只有字号不同；已核实“更大字号”的参数和排布公式，结论限于规则说明与可复现的缩放缺陷。未修改用户工程及预设。
- 原有 `.test-appdata/` 保留。本轮无待处理代码项，未制作或验证安装包。
