import copy
from dataclasses import replace
import json
import shutil
import threading
from pathlib import Path
from unittest.mock import patch

from test_msw_persistence import PersistenceTests
from maw.msw.versions import directory
from maw.msw.assets import AssetStore


class DiskVersionTests(PersistenceTests):
    # Reuse the real isolated server/asset fixture, without duplicating its tests.
    def setUp(self):
        super().setUp()
        self.api.env_path = self.root / 'isolated.env'

    def snapshot(self, **changes):
        return self.service.versions.write({'project': copy.deepcopy(self.server.project.data),
            'backupOnly': True, **self.api.context(), **changes})

    def test_zero_cue_snapshot_is_deduplicated_without_saving_project(self):
        before = self.path.read_bytes()
        first = self.snapshot()
        second = self.snapshot()
        self.assertEqual(first['name'], second['name'])
        self.assertTrue(second['deduplicated'])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(len(self.service.versions.list()['versions']), 1)
        data = json.loads((directory(self.path)/first['name']).read_text(encoding='utf-8'))
        self.assertEqual((directory(self.path)/data['media']).resolve(), self.media.resolve())

    def test_slow_backup_does_not_block_save_and_keeps_captured_contents(self):
        entered, release = threading.Event(), threading.Event()
        result, errors = [], []
        persist = self.api.assets.persist_project
        def slow(*args, **kwargs):
            entered.set()
            if not release.wait(10):
                raise TimeoutError('test backup was not released')
            return persist(*args, **kwargs)
        def run():
            try:
                result.append(self.snapshot())
            except Exception as error:
                errors.append(error)
        with patch.object(self.api.assets, 'persist_project', side_effect=slow):
            thread = threading.Thread(target=run)
            thread.start()
            try:
                self.assertTrue(entered.wait(5))
                context = self.api.context()
                updated = copy.deepcopy(self.server.project.data)
                updated['language'] = 'en'
                self.server.save_project(updated, expected_binding=context['binding'], expected_revision=context['saveRevision'])
                self.assertEqual(json.loads(self.path.read_text('utf-8'))['language'], 'en')
            finally:
                release.set()
                thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        saved = json.loads((directory(self.path)/result[0]['name']).read_text('utf-8'))
        self.assertNotEqual(saved.get('language'), 'en')

    def test_audio_is_collected_once_and_recovery_uses_backup_assets(self):
        asset = self.asset()
        first = self.snapshot()
        self.assertEqual(first['assets']['copied'], 1)
        self.server.project.data['language'] = 'en'
        second = self.snapshot()
        self.assertNotEqual(first['name'], second['name'])
        self.assertEqual(second['assets']['copied'], 0)
        self.server.project.data['msw']['assets'] = []
        recovered = self.service.versions.restore({'name':first['name'], **self.api.context()})
        project_id = recovered['project']['msw']['project_id']
        self.assertNotEqual(project_id, 'original')
        trusted, origin = self.api.asset_reference(project_id, asset['id'])
        self.assertEqual(origin.parent, directory(self.path))
        self.assertTrue(self.api.assets.resolve(project_id, trusted, origin).is_file())
        self.assertEqual(self.path.name, self.server.project.json_path.name)

    def test_background_backup_remains_with_its_source_after_project_switch(self):
        entered, release = threading.Event(), threading.Event()
        result, errors = [], []
        persist = self.api.assets.persist_project
        original = copy.deepcopy(self.server.project.data)
        def slow(*args, **kwargs):
            entered.set()
            if not release.wait(10):
                raise TimeoutError('test backup was not released')
            return persist(*args, **kwargs)
        def run():
            try:
                result.append(self.snapshot())
            except Exception as error:
                errors.append(error)
        next_path = self.root / 'another' / 'project.mosp'
        next_path.parent.mkdir()
        next_data = copy.deepcopy(original)
        next_data['msw']['project_id'] = 'another-project'
        next_path.write_text(json.dumps(next_data), encoding='utf-8')
        with patch.object(self.api.assets, 'persist_project', side_effect=slow):
            thread = threading.Thread(target=run)
            thread.start()
            try:
                self.assertTrue(entered.wait(5))
                with self.server.save_lock:
                    self.server.project = replace(self.server.project, json_path=next_path, data=next_data)
                    self.api.invalidate_binding()
            finally:
                release.set()
                thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        captured = json.loads((directory(self.path) / result[0]['name']).read_text('utf-8'))
        self.assertEqual(captured['msw']['project_id'], original['msw']['project_id'])
        self.assertFalse(directory(next_path).exists())
        self.assertEqual(self.server.project.data, next_data)

    def test_revision_binding_and_source_guard(self):
        for change in ({'binding':'wrong'}, {'saveRevision':'stale'}, {'backupOnly':False}):
            with self.assertRaises(ValueError):
                self.snapshot(**change)
        other = copy.deepcopy(self.server.project.data); other['media'] = 'unregistered.wav'
        with self.assertRaisesRegex(ValueError, '媒体'):
            self.snapshot(project=other)

    def test_entire_project_directory_can_relocate_without_the_original_asset_store(self):
        asset = self.asset()
        self.server.project.data['media'] = 'source.wav'
        self.server.project.data['sticker_root'] = 'stickers'
        (self.root/'stickers').mkdir()
        version = self.snapshot()
        moved = self.root/'relocated'
        shutil.copytree(directory(self.path), moved/'_msw'/'backups')
        shutil.copy2(self.media, moved/'source.wav')
        (moved/'stickers').mkdir()
        target = moved/'_msw'/'backups'/version['name']
        saved = json.loads(target.read_text(encoding='utf-8'))
        self.assertEqual((target.parent/saved['media']).resolve(), (moved/'source.wav').resolve())
        self.assertEqual((target.parent/saved['sticker_root']).resolve(), (moved/'stickers').resolve())
        store = AssetStore(self.root/'fresh-store')
        self.assertTrue(store.resolve('original', asset, target).is_file())

    def test_another_server_deduplicates_and_busy_save_never_creates_a_version(self):
        from maw.msw.versions import DiskVersions
        first = self.snapshot()
        other = DiskVersions(self.service)
        result = other.write({'project': self.server.project.data, 'backupOnly': True, **self.api.context()})
        self.assertEqual(result['name'], first['name'])
        with self.server.save_lock:
            with self.assertRaisesRegex(ValueError, '正在保存'):
                self.snapshot()

    def test_prune_only_owned_versions_after_publish_and_reports_recycle_failure(self):
        self.service.versions.configure({'enabled':True, 'interval':300, 'limit':1})
        first = self.snapshot()
        folder = directory(self.path)
        manual = folder/'manual.mosp-bak'; manual.write_text('{}')
        self.server.project.data['language'] = 'en'
        with patch('maw.msw.versions.send2trash', side_effect=OSError('busy')) as recycle:
            result = self.snapshot()
        self.assertTrue(result['warning'])
        self.assertEqual(Path(recycle.call_args.args[0]), folder/first['name'])
        self.assertTrue((folder/result['name']).is_file())
        self.assertTrue(manual.is_file())


# Inherit only fixture helpers: unittest should not run the parent's test suite twice.
for _name in dir(PersistenceTests):
    if _name.startswith('test_'):
        setattr(DiskVersionTests, _name, None)
del PersistenceTests
