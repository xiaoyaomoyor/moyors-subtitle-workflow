"""Recent view and concurrent settings contracts using only synthetic projects."""
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from test_local_editor_server import server_editor as server
from maw import launcher_projects as projects


class RecentSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.env = mock.patch.dict(os.environ, {"MSW_APP_DATA_ROOT": str(self.root), "MAW_ENV_FILE": str(self.root / "isolated.env")})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.settings_path = self.root / "server-editor-settings.json"
        self.paths = [self.root / f"project-{i}.mosp" for i in range(12)]
        for path in self.paths:
            path.write_text(json.dumps({"segments": [], "media": ""}), encoding="utf-8")

    def test_stale_and_concurrent_settings_preserve_latest_openings(self):
        stale = server.remember_project(server.ServerSettings(), self.paths[0])
        server.write_server_settings(self.settings_path, stale)
        snapshots = [server.replace(stale, recent_projects=(
            server.RecentProject(path, path.name, f"2099-01-01T00:00:0{i}+00:00"), *stale.recent_projects,
        )) for i, path in enumerate(self.paths[1:8], 1)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda value: server.write_server_settings(self.settings_path, value), snapshots))
        server.write_server_settings(self.settings_path, server.replace(stale, auto_open_last_project=False))
        result = server.read_server_settings(self.settings_path)
        self.assertEqual({item.path for item in result.recent_projects}, set(self.paths[:8]))
        self.assertEqual(result.recent_projects[0].path, self.paths[7])
        self.assertFalse(result.auto_open_last_project)
        self.assertNotIn(b"\r", self.settings_path.read_bytes())

    def test_shared_view_pin_relocate_remove_and_cap(self):
        settings = server.ServerSettings()
        for path in self.paths:
            settings = server.remember_project(settings, path)
        server.write_server_settings(self.settings_path, settings)
        projects.set_recent_project_pinned(self.paths[0], True)
        with server.EditorServer(("127.0.0.1", 0), server.load_blank_project(None), settings_path=self.settings_path, no_waveform=True) as app:
            view = app.recent_projects_payload()
            self.assertEqual(view, projects.recent_projects_payload())
            self.assertEqual(len(view["projects"]), 9)
            self.assertEqual(view["projects"][0]["path"], str(self.paths[0]))
            relocated = self.root / "relocated.mosp"
            relocated.write_bytes(self.paths[0].read_bytes())
            projects.relocate_recent_project(self.paths[0], relocated)
            view = app.recent_projects_payload()
            self.assertEqual(view["projects"][0]["path"], str(relocated))
            self.assertTrue(view["projects"][0]["pinned"])
            projects.set_recent_project_pinned(relocated, False)
            self.assertFalse(any(item["pinned"] for item in app.recent_projects_payload()["projects"]))
            projects.set_recent_project_pinned(relocated, True)
            app.open_recent_project(str(relocated))
            self.assertEqual(app.project.json_path, relocated)
            projects.remove_recent_project(relocated)
            # A stale settings write must not resurrect either alias endpoint.
            server.write_server_settings(self.settings_path, settings)
            visible = {item["path"] for item in app.recent_projects_payload()["projects"]}
            self.assertNotIn(str(relocated), visible)
            self.assertNotIn(str(self.paths[0]), visible)
            with self.assertRaises(server.RecentProjectError):
                app.open_recent_project(str(relocated))

    def test_authenticated_read_and_open_only_current_trusted_view(self):
        with server.EditorServer(("127.0.0.1", 0), server.load_blank_project(None), settings_path=self.settings_path, no_waveform=True) as app:
            thread = threading.Thread(target=app.serve_forever, daemon=True)
            thread.start()
            try:
                def request(endpoint, *, token=True, body=None):
                    headers = {"X-MSW-Token": app.request_token} if token else {}
                    if body is not None:
                        headers["Content-Type"] = "application/json"
                    req = urllib.request.Request(f"http://127.0.0.1:{app.server_port}{endpoint}",
                        headers=headers, data=None if body is None else json.dumps(body).encode())
                    try:
                        with urllib.request.urlopen(req) as response:
                            return response.status, json.loads(response.read())
                    except urllib.error.HTTPError as error:
                        return error.code, json.loads(error.read())

                self.assertEqual(request('/api/recent-projects', token=False)[0], 403)
                self.assertEqual(request('/api/recent-projects/open', token=False, body={"path": str(self.paths[0])})[0], 403)
                # New launcher metadata is visible without restarting the editor.
                projects.note_project_opened(self.paths[0])
                self.assertEqual(request('/api/recent-projects')[1], projects.recent_projects_payload())
                self.assertEqual(request('/api/recent-projects/open', body={"path": str(self.paths[0])})[0], 200)
                projects.remove_recent_project(self.paths[0])
                self.assertEqual(request('/api/recent-projects/open', body={"path": str(self.paths[0])})[0], 400)
                self.assertEqual(request('/api/recent-projects/open', body={"path": str(self.paths[1])})[0], 400)
            finally:
                app.shutdown()
                thread.join(3)
