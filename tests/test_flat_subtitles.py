from __future__ import annotations

import json
import subprocess
import unittest
from copy import deepcopy
from pathlib import Path

from maw.msw import flat_subtitles as core, subtitle_tracks as old
from maw.msw.subtitle_style import styled_ass
from maw.msw.subtitle_preview import preview_ass
from maw.project_subtitle_style import builtin_presets
from maw.project import validate_project

ROOT = Path(__file__).resolve().parents[1]


def fixture(name):
    return json.loads((ROOT / "tests/fixtures" / f"{name}.json").read_text(encoding="utf-8"))


def browser(expression, data):
    script = "const c=require('./web/msw-flat-subtitles.js');let s='';process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>{const data=JSON.parse(s);process.stdout.write(JSON.stringify(" + expression + "))});"
    return json.loads(subprocess.check_output(["node", "-e", script], input=json.dumps(data, ensure_ascii=False), cwd=ROOT, text=True, encoding="utf-8"))


def sample():
    return core.migrate_project(fixture("subtitle-tracks")[0]["project"])


def ref(cue_id, role="main", track_id=None):
    return dict(cue_id=cue_id, role=role, track_id=track_id)


class FlatSubtitlesTests(unittest.TestCase):
    def test_migration_roundtrips_and_matches_javascript(self):
        fixtures = fixture("subtitle-layers") + fixture("subtitle-tracks") + [dict(name="assets", project=fixture("msw_beta1_legacy_project"))]
        unicode_project = dict(segments=[dict(id="字幕🎬", start=0, end=1001, text="a\nb", start_frame=0, end_frame=30,
                                             items=[dict(start=0, end=0, text=""), dict(start=0, end=1001, text="a\nb")])], timebase=dict(unit="frames", fps=30000/1001),
                               multi_subtitle=dict(enabled=False, tracks=[dict(id="ja", name="注"*154+"🎬🎬", language="ja", segments=[]),
                                                                          dict(id="empty-2", segments=[])], bindings=[]))
        fixtures.append(dict(name="unicode-empty-languages", project=unicode_project))
        expected = browser("data.map(f=>c.migrate(f.project))", fixtures)
        for f, js in zip(fixtures, expected):
            with self.subTest(fixture=f["name"]):
                before = deepcopy(f["project"])
                actual = core.migrate_project(before)
                self.assertEqual(actual, js)
                self.assertEqual(core.migrate_project(actual), actual)
                self.assertEqual(before, f["project"])
                self.assertEqual(core.legacy_projection(actual), old.migrate_project(before))
                self.assertEqual(len(actual["subtitles"]["cues"]), len({c["id"] for c in actual["subtitles"]["cues"]}))
                self.assertFalse(set(core.STRUCTURAL) & set(actual))
                self.assertFalse(validate_project(actual).ok)  # Not enabled in production yet.

    def test_move_bind_unbind_are_symmetric_and_role_independent(self):
        p = sample()
        p = core.add_track(p, {**p["subtitles"]["tracks"][0], "id": "free", "name": "普通轨道"})
        before = deepcopy(p)
        index = core.SubtitleIndex(p)
        a, b = index.resolve_legacy(ref("a")), index.resolve_legacy(ref("a", "extension", "zh"))
        self.assertNotEqual(a["id"], b["id"])
        moved = core.move(p, [b["id"]], "free")
        self.assertEqual(core.SubtitleIndex(moved).track_for(a["id"])["id"], a["track_id"])
        self.assertEqual(core.SubtitleIndex(moved).track_for(b["id"])["id"], "free")
        self.assertEqual(moved["subtitles"]["bindings"], p["subtitles"]["bindings"])
        unbound = core.unbind(moved, "pair-a")
        rebound = core.bind(unbound, b["id"], a["id"], "reverse")
        js = browser("c.bind(c.unbind(c.move(data.p,[data.b],'free'),'pair-a'),data.b,data.a,'reverse')", dict(p=p, a=a["id"], b=b["id"]))
        self.assertEqual(rebound, js)
        self.assertEqual(rebound["subtitles"]["bindings"][-1]["start_offset_ms"], 298)
        self.assertEqual(p, before)
        with self.assertRaisesRegex(ValueError, "降级"):
            core.legacy_projection(moved)

    def test_processing_sources_and_tombstones_never_resolve_by_position(self):
        p = sample()
        index = core.SubtitleIndex(p)
        main, translated = index.resolve_legacy(ref("a")), index.resolve_legacy(ref("a", "extension", "zh"))
        refs = [dict(id="a", kind="subtitle", track_id=None), dict(id="a", kind="subtitle", track_id="zh"),
                dict(id="asset-id", source_cue_id="a", track_id="zh"), dict(subtitle_cue_id=translated["id"]),
                dict(subtitle_cue_id="missing", id="a"), dict(kind="editor_text", id="a"), dict(id="missing")]
        expected = [main, translated, translated, translated, None, None, None]
        self.assertEqual([index.resolve_source(r) for r in refs], expected)
        self.assertEqual(browser("data.refs.map(r=>c.createIndex(data.p).resolveSource(r))", dict(p=p, refs=refs)), expected)
        p = core.unbind(p, "pair-a")
        p["subtitles"]["cues"] = [c for c in p["subtitles"]["cues"] if c["id"] != main["id"]]
        p["subtitles"]["cues"].reverse()
        self.assertIsNone(core.SubtitleIndex(p).resolve_source(refs[0]))
        self.assertEqual(core.SubtitleIndex(p).resolve_source(refs[1])["id"], translated["id"])
        self.assertTrue(core.validate(p))  # Provenance aliases may outlive deleted cues.
        with self.assertRaisesRegex(ValueError, "表达能力"):
            core.legacy_projection(p)

    def test_markers_opaque_body_fields_and_frames_survive_migration(self):
        p = old.migrate_project(dict(segments=[dict(id="head", start=0, end=1000, text="h"), dict(id="tail", start=1000, end=2000, text="t")]))
        p["segments"][0]["color"] = dict(name="blue", value="#3043cf")
        p["segments"][1].update(color_ref=dict(headIdx=0, name="blue", cue_id={"future": False}), track_id={"opaque": 0}, hidden="opaque")
        flat = core.migrate_project(p)
        self.assertEqual(browser("c.migrate(data)", p), flat)
        self.assertEqual(core.legacy_projection(flat), p)
        flat["subtitles"]["cues"].reverse()
        self.assertTrue(core.validate(flat))
        tail = core.SubtitleIndex(flat).resolve_legacy(ref("tail"))
        self.assertEqual(core.SubtitleIndex(flat).resolve(tail["content"]["color_ref"]["cue_id"])["content"]["color"]["name"], "blue")

    def test_invalid_contracts_match_browser_and_leave_input_unchanged(self):
        changes = [
            lambda p: p.update(schema="msw.project.v5"), lambda p: p.update(segments=[]),
            lambda p: p["subtitles"].update(schema="msw.subtitles.v2"),
            lambda p: p["subtitles"]["cues"].append(deepcopy(p["subtitles"]["cues"][0])),
            lambda p: p["subtitles"]["cues"][0].update(track_id="missing"),
            lambda p: p["subtitles"]["tracks"][0].update(locked=1),
            lambda p: p["subtitles"]["tracks"][0].update(children=[]),
            lambda p: p["subtitles"]["tracks"][0].update(style=dict(mode="inherit", slot="source", base="dialogue")),
            lambda p: p["subtitles"]["tracks"][0].update(position=dict(x=True, y=0)),
            lambda p: p["subtitles"]["cues"][0]["content"].update(items=None),
            lambda p: p["subtitles"]["cues"][0]["content"].update(start=True),
            lambda p: p["subtitles"]["cues"][0]["content"].update(speaker=""),
            lambda p: p["subtitles"]["cues"][0]["content"].update(start_frame=0),
            lambda p: p["subtitles"]["cues"][0]["content"].update(items=[dict(text="bad", start=0, end=10)]),
            lambda p: p["subtitles"]["cues"][0]["content"].update(items=[dict(text="x", start=1001, end=2000), dict(text="overlap", start=1001, end=2000)]),
            lambda p: p["subtitles"]["cues"][0]["content"].update(color_ref=dict(cue_id="missing")),
            lambda p: p["subtitles"]["cues"][0]["content"].update(color=dict(name="")),
            lambda p: p["subtitles"]["bindings"][0].update(start_offset_ms=0),
            lambda p: p["subtitles"]["bindings"].append(deepcopy(p["subtitles"]["bindings"][0])),
            lambda p: p["subtitles"]["migration"]["identities"][0].update(cue_id="wrong"),
            lambda p: p["subtitles"]["migration"]["identities"][0].update(reference_extras=dict(color_ref=dict(headIdx=1))),
            lambda p: p["subtitles"]["migration"]["structure"].update(segments=[{}]),
            lambda p: p["subtitles"]["migration"]["structure"]["multi_subtitle"].update(tracks={}),
            lambda p: p.update(timebase=dict(unit="frames", fps=True)),
        ]
        candidates = [sample()]
        for change in changes:
            p = sample()
            change(p)
            before = deepcopy(p)
            with self.assertRaises(ValueError):
                core.validate(p)
            self.assertEqual(p, before)
            candidates.append(p)
        self.assertEqual(browser("data.map(p=>{try{return c.validate(p)}catch{return false}})", candidates), [True] + [False]*len(changes))

    def test_lock_collision_and_reserved_field_failures_are_atomic(self):
        p = sample()
        index = core.SubtitleIndex(p)
        a, b = index.resolve_legacy(ref("a")), index.resolve_legacy(ref("b"))
        before = deepcopy(p)
        with self.assertRaisesRegex(ValueError, "重叠"):
            core.move(p, [a["id"]], b["track_id"])
        self.assertEqual(p, before)
        index.track_for(a["id"])["locked"] = True
        for operation in (lambda: core.move(p, [a["id"]], b["track_id"]), lambda: core.unbind(p, "pair-a")):
            with self.assertRaisesRegex(ValueError, "锁定"):
                operation()
        with self.assertRaisesRegex(ValueError, "未覆盖"):
            core.migrate_project(dict(segments=[], subtitles={}))
        recursive = {}
        recursive["cycle"] = recursive
        with self.assertRaisesRegex(ValueError, "循环"):
            core.migrate_project(recursive)

    def test_lossless_legacy_view_keeps_exact_preview_and_burn_output(self):
        source = old.migrate_project(fixture("subtitle-tracks")[0]["project"])
        source["subtitle_tracks"]["presentation"] = "fixed"
        source["preview"] = dict(project_style=builtin_presets()[0])
        track = source["subtitle_tracks"]["tracks"][0]
        track.update(purpose="annotation", layout="fixed", position=dict(x=.3, y=.15), style_base="annotation")
        restored = core.legacy_projection(core.migrate_project(source))
        plan = dict(intervals=[dict(start_ms=0, end_ms=43200000, output_start_ms=0)])
        video = dict(width=1920, height=1080)
        self.assertEqual(styled_ass(restored, plan, "both", video), styled_ass(source, plan, "both", video))
        self.assertEqual(preview_ass(dict(project=restored, target="both", video=video)), preview_ass(dict(project=source, target="both", video=video)))

    def test_ten_thousand_cues_keep_unique_ownership(self):
        source = dict(segments=[dict(id=f"c{i}", start=i//8*1000, end=i//8*1000+1000, text="字") for i in range(10000)])
        p = core.migrate_project(source)
        self.assertEqual(len(p["subtitles"]["tracks"]), 8)
        self.assertEqual(len(core.SubtitleIndex(p).records()), 10000)
        self.assertEqual(core.legacy_projection(p), old.migrate_project(source))
