# MSW：上游精选改进的发布准备

用户要求完成全部已建议内容、检查后准备发布。基线 `my-feature` / `22aefd20`；以 [v1.8.0-beta.1 筛选](UPSTREAM_180_BETA1_ASSESSMENT_20261115.md) 中已接受的建议为范围，已明确不采用／暂缓的功能继续保持原决定。

> 2026-11-16 状态更新：用户曾确认使用 v1.7.1，随后明确取消此次发布安排，转为重新筛选上游 v1.8.0-beta.1。没有执行版本变更或候选构建；已完成的代码和回归检查保留。最新范围见[重新筛选报告](UPSTREAM_180_BETA1_REASSESSMENT_20261116.md)。以下验证数据为原任务实际结果。

| 项目 | 状态 | 决定与证据 |
| --- | --- | --- |
| 已接受建议的实施核对 | 已修复 | 第 1–4 项及用户确认的描边／阴影不透明度已落地；无其他已接受但遗漏的功能。 |
| 新版发布回归覆盖 | 已修复 | 发布流程新增 4 组浏览器专项与三平台实际 FFmpeg 检查；本机浏览器 24 项、媒体／打包 134 项通过（5 条件跳过）。 |
| 版本、说明与候选包 | 仅说明 | 用户确认 v1.7.1 后，于 2026-11-16 取消此发布安排；未改版本、归档说明或触发候选构建。 |
| 候选包验收与交接 | 仅说明 | 随此次发布安排取消，未构建或验收新的三平台五包；不能把已有源码回归视为新包验收。 |

## 已核对事实

- GitHub 实时只读核对：`v1.7.0` 为当前正式版本，非草稿／预发行，公开于北京时间 2026-11-15 16:30:07，包含五份附件。[正式发布](https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/releases/tag/v1.7.0) 与 [发布记录](TEST_FEEDBACK_RELEASE_170_20261115.md) 一致。
- 已接受内容分别对应 `07d2ff1d`（正文取消／光标）、`496ccb70`（模型下载／缓存／目录／设备策略）、`c794d91f`（缺字／macOS FFmpeg）及 `22aefd20`（插值切点／ASS 不透明度）。各任务专项已有通过记录；当前代码的最近完整回归为 Python 2415 项（97 条件跳过）、Node 835 项通过。
- 发布流程既有浏览器组合尚未包含 `editor-text-reliability`、`local-model-settings`、`subtitle-glyphs`、`ass-opacity`；实际媒体组也未显式带入新缺字和不透明度专项。本轮补入正式发布门槛。
- 保留用户原有 `debug.log`（35 行新增）、`.test-appdata/`、`output/`、`tests/test_data/_msw/`；不读取真实 `.env`，只用隔离配置和合成素材。`main` 保持 `a8bf4384`。

## 验证记录

- `playwright test editor-text-reliability local-model-settings subtitle-glyphs ass-opacity find-script-save`（完整文件名均位于 `tests/e2e/*.spec.mjs`）：24 项通过，3.4 分钟。验证正文取消／重做、延迟光标、剧本保存、目录保存／清空／重开、MPS 能力限制、缺字／字体回退及不透明度实际预览。
- 配置真实 FFmpeg 后运行 `python -X utf8 -m unittest tests.test_msw_audio_render tests.test_msw_video_render tests.test_msw_timeline_export tests.test_launcher_r6_real tests.test_launcher_cd tests.test_timestamp_alignment tests.test_subtitle_glyphs tests.test_ass_opacity test_packaging_contract test_release_notes test_release_assets test_release_zip`：134 项，221.1 秒，`OK (skipped=5)`。实际视频烧录、音频时序、时间轴导出、缺字拒绝输出和透明度渲染均在此组执行；平台／可选条件跳过不冒充已验收。
- `.github/workflows/release.yml` 新增四组浏览器检查并纳入失败诊断附件；Windows／macOS／Linux 的随包媒体检查增加缺字和不透明度专项。
- `scripts/smoke_beta3_bundle.py` 新增冻结程序的默认不透明度与实际 ASS 编译检查，并检查 local／OCR 运行包中新模块是否存在。新请求夹具已在当前后端验证成功，脚本 AST 检查通过；实际冻结候选程序仍待构建后执行，不以此冒充安装包启动验收。
- `scripts/sync_launcher_version.py --check` 通过，现有各处版本均为 1.7.0；`scripts/build_macos_icon.py --check` 通过；Python 脚本语法及 `git diff --check` 通过。当前源码全量 Python／Node 证据复用基线 `22aefd20` 已完成的回归，本轮没有改动产品实现。

## 发布安排取消与交接

- 用户先通过异步回复确认 `v1.7.1`，随后于 2026-11-16 明确表示无需发布该版本。本任务不再等待版本回复，不继续执行此次发布；既有 v1.7.0 标签、说明及附件不变。
- 若以后另行安排发布，再按最终功能范围确定版本，完成元数据／说明、三平台五包构建、摘要与内容核对、实际程序启动及交接；这些步骤没有因取消而被标记为已完成。
- 未触发新构建或创建 Release。当前转入仅筛选上游的任务，见[重新筛选报告](UPSTREAM_180_BETA1_REASSESSMENT_20261116.md)。
- 本轮三个文件的发布检查与任务记录按既有授权提交推送 `my-feature`。`main`、原 v1.7.0 发行版、用户已有日志和测试目录保持不变；未调用收费云服务或真实大模型推理。
