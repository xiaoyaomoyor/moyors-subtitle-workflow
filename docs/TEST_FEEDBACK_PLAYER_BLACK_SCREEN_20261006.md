# 本机播放器初始黑屏（2026-10-06）

## 反馈与事实

- 用户反馈：新工程的视频黑屏，播放后仍黑屏，打开媒体播放器设置才恢复。环境为 Chrome／Edge 的 localhost 编辑器。
- 工作分支 `my-feature`，起点为 `d5d3712`；无关 `.test-appdata/` 保留。
- 打开设置只显示浮窗，没有修复解码或重新载入视频的逻辑；现象与重新合成画面有关，但无法仅凭现象确定用户机器的具体 GPU 路径。
- 合成蓝色视频在修复前的自动浏览器中没有出现同样的持续黑屏。新增回归确实复现了另一项相关缺陷：替换播放器后旧字幕画布仍留在 DOM。

## 处理清单

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 视频与字幕图层初始化 | 已修复 | 播放器隔离层级；画布在完成初始化、重绘及下一次合成帧前保持隐藏 |
| 媒体及工程切换的画布生命周期 | 已修复 | 替换播放器／清空媒体立即移除旧画布；监听首帧可用事件，检查工程、元素及来源，丢弃迟到结果 |
| 渲染失败回退与异常处理 | 已修复 | 移除失败画布，显示原因并恢复近似字幕；播放／跳转事件重绘处理异步失败 |
| 用户机器上的原始持续黑屏验收 | 已修复 | 最终采用视频 screen 混合与纯黑背景；用户刷新原窗口后确认「已恢复，播放正常」 |

## 第一轮验证记录

- 修复前：初始画面及延迟 Worker 的用例通过；替换播放器后的旧画布数量断言失败（预期 0，实际 1）。
- 修复后第一轮 Chromium：播放器与工程字幕样式 10/10 通过；覆盖暂停、播放、延迟初始化、初始化中切换工程、失败回退、样式编辑、预设保存及导出预览恢复。
- 最终本机 Edge：`playwright test tests/e2e/video-first-frame.spec.mjs tests/e2e/project-subtitle-style.spec.mjs --project=chromium`，通过 `MSW_E2E_CHROMIUM_PATH` 指向 Edge，11/11 通过；额外覆盖隐藏播放器重新显示及窗口尺寸变化。已查看未打开设置前的画面截图，蓝色视频正常显示。
- Node：`node --test tests/test_editor_utils.mjs tests/test_waveform_js.mjs tests/test_project_subtitle_style.mjs`，326/326 通过；`node --check web/msw-subtitle-renderer.js` 通过。
- 生成产物：`python edit.py --blank` 已重新生成 `blank-editor.html`，便携编辑器的样式设置与近似预览用例通过；`git diff --check` 通过。文本 UTF-8/LF。
- 边界：以上浏览器测试运行于无头模式，未验证用户显卡驱动／硬件加速组合或原始媒体；本轮没有改动 Python 后端，未重跑完整 Python 套件。
- 测试只生成合成媒体和本地截图；不提交用户视频、截图、配置或绝对路径。

本轮完成后按既有授权提交并推送 `origin/my-feature`；不修改 `main`，不创建 PR、tag 或 Release。

## 第二轮：设置浮窗恢复视频的显示路径

- 用户确认 `63897c2` 后仍然黑屏；打开波形设置也能恢复，排除媒体设置独有的配置操作。第一轮修正了画布生命周期，但没有解决用户的原始问题。
- 已只读核对实际服务器页面，确认加载了第一轮代码。将原工程复制到仓库外的诊断目录，用同一视频及相同主题检查，未修改原工程、原媒体或用户设置。
- 独立 Edge 的无头和屏幕外原生窗口均能解码该视频；原生窗口确认启用 D3D11、GPU 合成和硬件视频解码。这仍不能覆盖用户显示器上的硬件叠加平面，不能以截图正常宣称原始问题已经复现或消除。
- 设置浮窗使用 `backdrop-filter: blur(10px)`。[Chromium 的叠加合成逻辑](https://chromium.googlesource.com/chromium/src/+/11d7305a72a5937c2659208c73fedbe876c69dd2/components/viz/service/display/overlay_strategy_underlay.cc) 对被背景滤镜覆盖的视频放弃硬件叠加；[Windows 合成测试](https://chromium.googlesource.com/chromium/src/+/82958fb24b91a04ac0be7087f8f7861d62bd9038/components/viz/service/display/overlay_dc_unittest.cc) 也说明截图／捕获会关闭视频叠加。这解释了弹窗和截图可能掩盖问题，但具体驱动根因仍是推断。
- 曾验证 `brightness(1)` 的透明背景滤镜，独立窗口中的图层与像素检查通过，但用户刷新原窗口后仍然黑屏；这说明仅出现一个合成图层不足以验证实际显示路径。该中间方案已移除，未提交。
- 最终修正：libass 视频预览使用纯黑背景及 `mix-blend-mode: screen`，播放器保留 `isolation: isolate`。Screen 与黑色混合在数学上保持源颜色，同时要求页面完成混合；[Chromium 的硬件叠加候选检查](https://chromium.googlesource.com/chromium/src/+/8d2e0605df2ae9aa19b476d60ad7b0886b77567f/components/viz/service/display/overlay_candidate_factory.cc) 拒绝此类混合方式。字幕、徽标和控制条仍在视频上方，纯音频和近似字幕预览不受该规则影响。移除未解决问题的 `translateZ(0)`，保留第一轮画布生命周期保护。
- 用户已在原浏览器／原工程上刷新验证，明确回复「已恢复，播放正常」。本轮确认解决了实际故障；没有更改浏览器全局硬件加速或驱动设置。
- 新增浏览器回归先检查视频采用非普通混合（在截图之前），再对照深／浅主题下普通视频与兼容模式的显示颜色，并检查点击播放／暂停。两种模式的蓝色视频中心像素均为 `[53, 123, 193]`。`drawImage` 读取得到 `[41, 122, 193]`，这是另一条颜色转换路径，不能拿它作为屏幕输出的逐像素基准。
- 原视频独立原生 Edge 对照：同一暂停帧使用普通视频与兼容混合，视频及字幕区域像素一致；完整截图的差异仅位于播放器底部 2 px 边界。真实媒体与诊断截图保留在仓库外。
- 最终 Edge：`playwright test tests/e2e/video-first-frame.spec.mjs tests/e2e/project-subtitle-style.spec.mjs --project=chromium`，使用本机 Edge，12/12 通过。包括深浅主题的颜色对照、点击播放／暂停、初始化／切换工程、失败回退、字幕编辑及导出预览恢复。
- `edit.py --blank` 已生成最终混合规则；检查不含中间滤镜或旧 3D 变换。UTF-8/LF、`git diff --check` 通过。本轮仅修改 CSS、相应生成文件及浏览器测试，未重跑无关 Python／Node 全套测试。
