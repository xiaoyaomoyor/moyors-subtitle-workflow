from __future__ import annotations

import json
import subprocess
import unittest
from copy import deepcopy
from pathlib import Path

from maw.msw import subtitle_layers as layers
from maw.msw import subtitle_tracks as core

ROOT = Path(__file__).resolve().parents[1]


def fixture(name):
    return json.loads((ROOT / "tests/fixtures" / (name + ".json")).read_text(encoding="utf-8"))


def ref(cue_id, role="main", track_id=None):
    return dict(role=role, track_id=track_id, cue_id=cue_id)


class SubtitleTracksTests(unittest.TestCase):
    def test_migration_matches_browser_and_preserves_all_content(self):
        fixtures = fixture("subtitle-layers") + fixture("subtitle-tracks") + [dict(name="assets", project=fixture("msw_beta1_legacy_project"))]
        script = "const c=require('./web/msw-subtitle-tracks.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s).map(f=>c.migrate(f.project)))));"
        browser = json.loads(subprocess.check_output(["node", "-e", script], input=json.dumps(fixtures), cwd=ROOT, text=True, encoding="utf-8"))
        for f, expected in zip(fixtures, browser):
            with self.subTest(fixture=f["name"]):
                before = deepcopy(f["project"])
                actual = core.migrate_project(before)
                self.assertEqual(actual, expected)
                self.assertEqual(core.migrate_project(actual), actual)
                self.assertEqual(before, f["project"])
                content = {k: v for k, v in actual.items() if k != "subtitle_tracks"}
                content["schema"] = layers.SCHEMA
                self.assertEqual(content, layers.migrate_project(before))

    def test_stable_membership_queries_hidden_and_disabled(self):
        p = core.migrate_project(fixture("subtitle-tracks")[0]["project"])
        index = core.TrackIndex(p)
        self.assertNotEqual(index.track_for(ref("a"))["id"], index.track_for(ref("b"))["id"])
        for cue_id in ("a", "b"):
            self.assertEqual(index.track_for(ref(cue_id)), index.track_for(ref(cue_id, "extension", "zh")))
        owners = deepcopy(p["subtitle_tracks"]["assignments"])
        p["segments"].reverse()
        p["segments"][0]["end"] += 1
        p["subtitle_tracks"]["tracks"].reverse()
        self.assertEqual(core.TrackIndex(p).resolve(ref("a"))["cue"]["start"], 1001)
        self.assertEqual(p["subtitle_tracks"]["assignments"], owners)
        self.assertFalse(any(r["cue_id"] == "b" for r in core.TrackIndex(p).records(role="main", include_disabled=False)))
        hidden = core.TrackIndex(core.migrate_project(fixture("subtitle-tracks")[1]["project"]))
        self.assertEqual([r["cue_id"] for r in hidden.records()], ["translated"])
        self.assertFalse(hidden.track_for(ref("hidden-alone"))["enabled"])
        self.assertEqual(len(hidden.records(include_hidden=True)), 3)
        gap = core.migrate_project(fixture("subtitle-tracks")[2]["project"])
        self.assertEqual(len(gap["subtitle_tracks"]["tracks"]), 1)
        self.assertFalse(gap["multi_subtitle"]["enabled"])

    def test_assignment_is_atomic_bound_and_lock_aware(self):
        p = core.migrate_project(fixture("subtitle-tracks")[0]["project"])
        p["subtitle_tracks"]["tracks"].append({**p["subtitle_tracks"]["tracks"][0], "id": "new", "name": "画面文字", "kind": "annotation"})
        before = deepcopy(p)
        moved = core.assign(p, [ref("a", "extension", "zh")], "new")
        self.assertEqual(core.TrackIndex(moved).track_for(ref("a"))["id"], "new")
        self.assertEqual(moved["segments"], p["segments"])
        self.assertEqual(moved["multi_subtitle"], p["multi_subtitle"])
        with self.assertRaisesRegex(ValueError, "重叠"):
            core.assign(p, [ref("a")], core.TrackIndex(p).track_for(ref("b"))["id"])
        self.assertEqual(p, before)
        core.TrackIndex(p).track_for(ref("a"))["locked"] = True
        with self.assertRaisesRegex(ValueError, "锁定"):
            core.assign(p, [ref("a", "extension", "zh")], "new")

    def test_invalid_ownership_binding_versions_and_times_rejected(self):
        changes = [
            lambda p: p["subtitle_tracks"]["assignments"].pop(),
            lambda p: p["subtitle_tracks"]["assignments"].append(p["subtitle_tracks"]["assignments"][0]),
            lambda p: p["subtitle_tracks"]["assignments"][0].update(cue_id="missing"),
            lambda p: p["subtitle_tracks"]["assignments"][0].update(subtitle_track_id="missing"),
            lambda p: p.update(schema="msw.project.v4"),
            lambda p: p["subtitle_tracks"].update(schema="msw.subtitle_tracks.v2"),
            lambda p: p["subtitle_tracks"]["tracks"].append(p["subtitle_tracks"]["tracks"][0]),
            lambda p: p["subtitle_tracks"]["tracks"][0].update(locked=1),
            lambda p: p["subtitle_tracks"]["tracks"][0].update(show_secondary="yes"),
            lambda p: p["subtitle_tracks"]["tracks"][0].update(style={"mode": "future"}),
            lambda p: p["multi_subtitle"]["bindings"][0].update(main_segment_ids=["missing"]),
            lambda p: p["multi_subtitle"]["bindings"][0].update(start_offset_ms=999),
            lambda p: p["subtitle_tracks"]["assignments"][0].update(subtitle_track_id=p["subtitle_tracks"]["tracks"][1]["id"]),
            lambda p: [a.update(subtitle_track_id=p["subtitle_tracks"]["tracks"][0]["id"]) for a in p["subtitle_tracks"]["assignments"]],
            lambda p: p["segments"][0].update(start=True),
        ]
        for i, change in enumerate(changes):
            with self.subTest(case=i):
                p = core.migrate_project(fixture("subtitle-tracks")[0]["project"])
                change(p)
                with self.assertRaises(ValueError):
                    core.validate(p)
        with self.assertRaisesRegex(ValueError, "无法安全覆盖"):
            core.migrate_project(dict(segments=[], subtitle_tracks={}))
        with self.assertRaises(ValueError):
            layers.migrate_project(core.migrate_project(dict(segments=[])))

    def test_ten_thousand_overlaps_keep_all_memberships(self):
        p = core.migrate_project(dict(segments=[dict(id=f"c{i}", start=i//8*1000, end=i//8*1000+1000, text="x") for i in range(10000)]))
        self.assertEqual(len(p["subtitle_tracks"]["tracks"]), 8)
        self.assertEqual(len(core.TrackIndex(p).records()), 10000)

    def test_editing_metadata_roundtrip(self):
        p = core.migrate_project(fixture("subtitle-tracks")[0]["project"])
        p["subtitle_tracks"]["tracks"][0].update(name="采访", show_secondary=True, collapsed=True, locked=True)
        self.assertTrue(core.validate(p))
        self.assertEqual(core.migrate_project(p), p)

    def test_presentation_metadata_matches_browser_validation(self):
        p = core.migrate_project(fixture("subtitle-tracks")[0]["project"])
        p["subtitle_tracks"]["presentation"] = "fixed"
        track = p["subtitle_tracks"]["tracks"][0]
        snapshot = dict(schema="msw.subtitle-style.v1", main=dict(fontSize=64), secondary=dict(fontSize=40))
        track.update(style=dict(mode="snapshot", value=snapshot, custom=snapshot, selection="current"), position=dict(x=0.5, y=0.1))
        for row in core.TrackIndex(p).records(include_hidden=True):
            row["cue"]["subtitle_position"] = dict(x=0.2, y=0.25)
        candidates = [p]
        for field, value in [("position", None), ("position", dict(x=True, y=0)), ("position", dict(x=-0.1, y=0)),
                             ("style", dict(mode="snapshot", value={})), ("style", dict(mode="inherit", value=snapshot))]:
            bad = deepcopy(p)
            bad["subtitle_tracks"]["tracks"][0][field] = value
            candidates.append(bad)
        bad = deepcopy(p)
        bad["segments"][0]["subtitle_position"] = dict(x=0.7, y=0.2)
        candidates.append(bad)
        for patch in [dict(pairLayout=None), dict(pairLayout=dict(order="main-above", gap=True)),
                      dict(main=dict(wrapMode="unknown")), dict(main=dict(charsPerLine=0))]:
            bad = deepcopy(p)
            bad["subtitle_tracks"]["tracks"][0]["style"]["value"].update(patch)
            candidates.append(bad)
        expected = []
        for candidate in candidates:
            try:
                core.validate(candidate)
                expected.append(True)
            except ValueError:
                expected.append(False)
        self.assertEqual(expected, [True] + [False] * 10)
        script = "const c=require('./web/msw-subtitle-tracks.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s).map(p=>{try{return c.validate(p)}catch{return false}}))));"
        browser = json.loads(subprocess.check_output(["node", "-e", script], input=json.dumps(candidates), cwd=ROOT, text=True, encoding="utf-8"))
        self.assertEqual(browser, expected)
        self.assertEqual(core.migrate_project(p), p)

    def test_v1_missing_language_id_and_overlay_settings(self):
        source = dict(segments=[dict(id="a", start=0, end=1000, text="a")],
                      overlay_track=dict(name="旧注释组", enabled=False, settings={"x": 0.2}, segments=[dict(id="note", start=0, end=1000, text="note")]),
                      multi_subtitle=dict(tracks=[dict(segments=[dict(id="translated", start=20, end=1020, text="sub")])],
                                          bindings=[dict(main_segment_id="a", extension_segment_id="translated")]))
        before = deepcopy(source)
        p = core.migrate_project(source)
        self.assertEqual(p["multi_subtitle"]["tracks"][0]["id"], "extension-001")
        self.assertEqual(p["subtitle_tracks"]["legacy_overlay_settings"], dict(name="旧注释组", enabled=False, settings={"x": 0.2}))
        self.assertEqual(core.TrackIndex(p).track_for(ref("note"))["name"], "旧注释组 1")
        self.assertFalse(core.TrackIndex(p).track_for(ref("note"))["enabled"])
        self.assertEqual(source, before)
