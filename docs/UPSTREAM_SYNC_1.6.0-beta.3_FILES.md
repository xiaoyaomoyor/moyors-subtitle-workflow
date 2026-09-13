# beta.3 上游文件处置索引

固定范围：860f354 → bc5262c，共 144 个变更路径（重命名按目标路径计）。本索引与实施账本、回归结果共同使用；文件级归类不代替功能验收。真实云端账户未调用，各平台结果由 E/F 账本记录。

| 上游路径 | 处置 | MSW 落点/理由 |
| --- | --- | --- |
| `.env.example` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `.github/workflows/deploy-editor-pages.yml` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `.github/workflows/release.yml` | 按 MSW 改写 | 保留 MSW 固定 FFmpeg、五包门槛、中文归档和专属发行说明；新增 beta.3 回归入口 |
| `.gitignore` | 仅说明 | MSW 已有本机缓存、构建产物、隔离环境忽略规则 |
| `AGENTS.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `CHANGELOG.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `DESIGN.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `JSON_SCHEMA.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `MAW.spec` | 按 MSW 改写 | 落到 MSW.spec，保留 MSW frozen 入口与模块收集 |
| `README-en.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `README.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `THIRD_PARTY_NOTICES.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `blank-editor.html` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `desktop/README.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/CLI.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `docs/DEVELOPMENT.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `docs/EDITOR_GUIDE.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `docs/LOCAL_ASR.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `docs/PROVIDERS.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `docs/RELEASE_REVIEW_1.3.2_TO_1.4.0.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/TEST_FEEDBACK_AUDIO_TRACKS.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/TEST_FEEDBACK_E2E_DRIFT.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/TEST_FEEDBACK_NEW_PROJECT.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/TEST_FEEDBACK_PUNCT_SETTINGS.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/WORKFLOW.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `docs/assets/1.6.0/accent-color.webp` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/assets/1.6.0/backup-settings.webp` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/assets/1.6.0/doubao-asr.webp` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/assets/1.6.0/speaker-preview.webp` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/dev/MAWE 前端渐进式重构企划案.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `docs/dev/MAWE 前端重构基线.md` | 明确舍弃 | 上游历史账本、截图或架构计划，不覆盖 MSW 当前资料 |
| `edit.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `generate_subtitle_bcut_api.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `generate_subtitle_doubao_api.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `generate_subtitle_local.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `generate_subtitle_openai_api.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `generate_subtitle_qwen_api.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `generate_subtitle_soniox_api.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `generate_subtitle_tencent_api.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/cli.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/doubao.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/gui_config.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/gui_web.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/gui_workflow.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/local_asr.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/media.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/media_cache.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/mopeaks.py` | 已采纳 | 最终 MPK1/QPK1 容器与原生/纯 Python 路径；额外保护所选源轨身份 |
| `maw/output_naming.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/postprocess_match.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/postprocess_pipeline.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/project.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/project_backups.py` | 按 MSW 改写 | 由 maw/msw/versions.py 替代，接入现有保存锁、SQLite 与素材持久化 |
| `maw/project_io.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/project_preview.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/quapeaks.py` | 已采纳 | 最终 MPK1/QPK1 容器与原生/纯 Python 路径；额外保护所选源轨身份 |
| `maw/runtimes/local_spec.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw/waveform.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `maw_gui.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `pyproject.toml` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `scripts/build-appimage.sh` | 按 MSW 改写 | 保留 MSW 固定 FFmpeg、五包门槛、中文归档和专属发行说明；新增 beta.3 回归入口 |
| `scripts/mosp_match_text.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `scripts/prepare_release_notes.py` | 按 MSW 改写 | 保留 MSW 固定 FFmpeg、五包门槛、中文归档和专属发行说明；新增 beta.3 回归入口 |
| `scripts/run-e2e.ps1` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `server-align/README.md` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `server-align/index.html` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `server-align/serve.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `server-editor/README.md` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `server-editor/serve.py` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `tests/e2e/ass-export.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/click-behavior.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/cue-color-filter.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/cue-list-layout.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/editor-i18n-save.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/helpers.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/hover-seek-preview.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/launcher-interactions.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/layout-feedback.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/multi-subtitle.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/new-project.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/open-project-drop.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/playback-refresh.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/speaker-labels.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/subtitle-preview-boot.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/subtitle-preview-geometry.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/waveform-deletion.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/waveform-history.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/e2e/waveform-marquee.spec.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_bcut.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_cli_cache_contract.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_data/tone_selfwave.wav.quapeaks` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_data/tone_stereo_selfwave.wav.quapeaks` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_doubao.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_editor_assets.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_editor_utils.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_gui_config.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_gui_web.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_gui_workflow.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_local_asr.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_local_editor_server.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_local_runtime.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_media_cache.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_mopeaks.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_openai_asr.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_packaging_contract.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_postprocess_match.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_postprocess_pipeline.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_project_backups.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_project_contract.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_project_io.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_quapeaks_container.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_quapeaks_generation.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_qwen.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_reapeaks.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_reapeaks_fixture.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_release_notes.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_runtimes.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_server_align.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_waveform.py` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `tests/test_waveform_js.mjs` | 按 MSW 改写 | 对应 Python/Node/Chromium 回归；使用合成媒体和原生生成验证替代上游固定媒体夹具 |
| `uv.lock` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/editor-i18n.js` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/editor-onboarding.js` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/editor-template.html` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/editor-utils.js` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/editor.css` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/editor.js` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/launcher/batch.js` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/launcher/index.html` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/launcher/launcher.js` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/launcher/postprocess.js` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `web/waveform.css` | 按 MSW 改写 | 对应增量落入 MSW 当前 waveform.js/editor.css 样式与轨道头体系 |
| `web/waveform.js` | 按 MSW 改写 | 并入对应 A～D 实现；保留 MSW 独立编辑器、命名与素材边界 |
| `website/docs/DEPLOYMENT.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/cli.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/development.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/editor-guide.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/getting-started.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/json-schema.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/llm-postprocess.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/local-asr.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/ocr-subtitle-dedup.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/providers.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
| `website/src/pages/docs/workflow.md` | 按 MSW 改写 | 更新 MSW 文档与生成站点，不覆盖独立编辑器改动和历史 Changelog |
