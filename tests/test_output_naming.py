from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maw import gui_config, output_naming as naming
from maw.env_config import apply_msw_env_aliases


class OutputNamingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.env_path = self.root / "settings.env"
        self.env_patch = patch.dict(os.environ, {"MAW_ENV_FILE": str(self.env_path)}, clear=True)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def config(self, content):
        self.env_path.write_text(content, encoding="utf-8")

    def test_defaults_and_inactive_per_media_preference(self):
        cfg = gui_config.effective_config()
        self.assertEqual((cfg.output_subfolder, cfg.per_video_subfolder, cfg.attach_model_name), (False, False, True))
        self.config("MSW_GUI_PER_VIDEO_SUBFOLDER=true\n")
        self.assertTrue(gui_config.effective_config().per_video_subfolder)
        self.assertEqual(naming.maw_root(self.root / "视频.mp4"), self.root / "_msw")
        self.config("MSW_GUI_OUTPUT_SUBFOLDER=true\nMSW_GUI_PER_VIDEO_SUBFOLDER=true\n")
        self.assertEqual(naming.maw_root(self.root / "视频.mp4"), self.root / "视频_msw")

    def test_process_beats_file_and_modern_beats_legacy_within_each_source(self):
        self.config("MAW_GUI_OUTPUT_SUBFOLDER=false\nMSW_GUI_OUTPUT_SUBFOLDER=true\n")
        self.assertTrue(gui_config.effective_config(environ={}).output_subfolder)
        self.assertFalse(gui_config.effective_config(environ={"MAW_GUI_OUTPUT_SUBFOLDER": "false"}).output_subfolder)
        self.assertFalse(gui_config.effective_config(environ={"MAW_GUI_OUTPUT_SUBFOLDER": "true", "MSW_GUI_OUTPUT_SUBFOLDER": ""}).output_subfolder)
        scope = {"MSW_GUI_LANG": "en", "MAW_GUI_LANG": "zh"}
        apply_msw_env_aliases(scope)
        self.assertEqual(scope["MAW_GUI_LANG"], "en")

    def test_saving_alias_updates_existing_keys_without_stale_values(self):
        self.config("# preserve\nMSW_GUI_LANG=zh\nMAW_GUI_LANG=zh\nUNRELATED=keep\n")
        gui_config.save_env(self.env_path, {"MAW_GUI_LANG": "en"})
        self.assertEqual(self.env_path.read_text(encoding="utf-8"), "# preserve\nMSW_GUI_LANG=en\nMAW_GUI_LANG=en\nUNRELATED=keep\n")
        gui_config.save_env(self.env_path, {"MSW_GUI_OUTPUT_SUBFOLDER": "true"})
        self.assertTrue(gui_config.effective_config().output_subfolder)

    def test_read_candidates_include_all_layouts_and_do_not_create_directories(self):
        media = self.root / "clip.mp4"
        self.assertEqual(naming.maw_root_candidates(media), [self.root / name for name in ("_msw", "clip_msw", "_maw", "clip_maw")])
        candidates = naming.postprocess_workspace_candidates(media, "en")
        self.assertIn(self.root / "_maw" / "后处理", candidates)
        self.assertIn(self.root / "MAW-Postprocess", candidates)
        self.assertIn(self.root / "MSW-Postprocess", candidates)
        self.assertFalse(any(path.exists() for path in candidates))

    def test_localized_names_keep_english_ids_and_unknown_operations(self):
        for operation, zh, en in (
            ("translate_zh-bilingual", ".翻译为中文.双语合一", ".translate-zh-bilingual"),
            ("translate-en", ".翻译为英文", ".translate-en"),
            ("postprocess", ".后处理", ".postprocess"),
            ("unknown", ".unknown", ".unknown"),
        ):
            with self.subTest(operation=operation):
                self.assertEqual(naming.operation_suffix(operation, "zh"), zh)
                self.assertEqual(naming.operation_suffix(operation, "en"), en)

    def test_elapsed_and_rtf_invalid_values(self):
        self.assertEqual(naming.format_elapsed(65, "en"), "1 min 5 s")
        self.assertEqual(naming.format_elapsed(3661, "zh"), "1 小时 1 分")
        for value in (None, 0, -1, float("nan"), float("inf")):
            self.assertIsNone(naming.format_maw_stat(value))
        self.assertEqual(naming.parse_maw_stat(naming.format_maw_stat(.125)), {"rtf": "0.125"})
