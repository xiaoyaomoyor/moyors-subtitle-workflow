import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Use production Python inspection payloads, not invented v4 mock metadata.
let directory, metadata;
test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'msw-launcher-flat-'));
  const python = process.env.MSW_E2E_PYTHON || resolve('.venv/Scripts/python.exe');
  const result = spawnSync(python, ['-c', `
import json, sys
from pathlib import Path
from tests.test_launcher_flat_project import flat_fixture
from maw.launcher_queue import inspect_input
from maw.gui_web import LauncherApi, LauncherPaths
root=Path(sys.argv[1]); project=root/'native.mosp'; legacy=root/'legacy.mosp'
project.write_text(json.dumps(flat_fixture()),encoding='utf-8')
legacy.write_text(json.dumps({'segments':[{'start':0,'end':1000,'text':'Hello'}]}),encoding='utf-8')
env=root/'empty.env';env.write_text('',encoding='utf-8')
api=LauncherApi(paths=LauncherPaths(root=root,env_path=env,launcher_html=root/'index.html',recent_metadata=root/'recent.json',project_registry=root/'registry.json'))
print(json.dumps({'flat':inspect_input(str(project)), 'flatAlignment':api.inspect_alignment_input({'path':str(project)}), 'legacyAlignment':api.inspect_alignment_input({'path':str(legacy)}), 'legacy':str(legacy)},ensure_ascii=False))
`, directory], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', MSW_APP_DATA_ROOT: join(directory, 'appdata') } });
  if (result.status !== 0) throw Error(result.stderr || result.error?.message);
  metadata = JSON.parse(result.stdout.trim());
});
test.afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

async function open(page) {
  await page.addInitScript(data => {
    window.addEventListener('mawlauncherready', () => {
      const original = MSWLauncher.callBackend;
      window.__flatCalls = [];
      MSWLauncher.callBackend = async (name, payload) => {
        window.__flatCalls.push(name);
        if (name === 'inspect_queue_inputs') return { ok: true, items: payload.paths.map(path => ({ ok: true, ...data.flat, path })) };
        if (name === 'inspect_alignment_input') return payload.path === data.legacy ? data.legacyAlignment : data.flatAlignment;
        return original(name, payload);
      };
    }, { once: true });
  }, metadata);
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(() => MSWLauncher?.config?.providers?.length && window.MSWModules);
}

test('native project exposes real track choices and exports SRT without a version block', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.evaluate(path => { MSWNavigation.show('prefab'); return MSWQueue.addPaths([path]); }, metadata.flat.path);
  await expect(page.locator('.queue-status')).toHaveText('已添加');
  await expect(page.locator('#outputSummary')).toContainText('.srt');
  await page.locator('.queue-details summary').click();
  await expect(page.getByLabel('处理轨道', { exact: true })).toHaveValue(metadata.flat.subtitleTracks[0].id);
  await expect(page.locator('[data-export-track]')).toHaveCount(3);
  await page.locator('#prefabRail [data-module-id="translate"]').check();
  await expect(page.getByLabel('译文轨道', { exact: true })).toHaveValue(metadata.flat.subtitleTracks[1].id);
  await page.getByLabel('处理轨道', { exact: true }).selectOption(metadata.flat.subtitleTracks[2].id);
  await expect(page.getByLabel('译文轨道', { exact: true })).toHaveValue('new');
  const state = await page.evaluate(() => ({ plan: MSWPlan.build(), check: MSWPlan.preflight(MSWPlan.build()) }));
  expect(state.plan.tasks[0].sourceTrackId).toBe(metadata.flat.subtitleTracks[2].id);
  expect(state.plan.tasks[0].exportTrackIds).toEqual([metadata.flat.subtitleTracks[2].id]);
  expect(state.check.ok).toBe(true);
  expect(errors).toEqual([]);
});

test('bound structural changes and locked targets are explained before submitting a job', async ({ page }) => {
  await open(page);
  await page.evaluate(path => { MSWNavigation.show('prefab'); return MSWQueue.addPaths([path]); }, metadata.flat.path);
  await page.locator('#prefabRail [data-module-id="resegment"]').check();
  await page.locator('#start').click();
  await expect(page.locator('.queue-file')).toContainText('已绑定字幕');
  const blocked = await page.evaluate(() => {
    const file = MSWQueue.state.files[0]; file.meta.subtitleTracks[0].locked = true;
    const plan = MSWPlan.build(); plan.modules.postprocess = ['replace'];
    return MSWPlan.preflight(plan);
  });
  expect(blocked.message).toContain('未锁定');
  expect(await page.evaluate(() => __flatCalls.includes('start_prefab_queue'))).toBe(false);
});

test('per-task export track selections survive a reload', async ({ page }) => {
  await open(page);
  await page.evaluate(path => { MSWNavigation.show('prefab'); return MSWQueue.addPaths([path]); }, metadata.flat.path);
  await page.locator('.queue-details summary').click();
  await page.locator('[data-export-track]').nth(1).uncheck();
  await page.locator('[data-export-track]').nth(2).uncheck();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('MSW_LAUNCHER_INPUT_QUEUE_V2')));
  expect(draft.files[0].exportTrackIds).toEqual([metadata.flat.subtitleTracks[0].id]);
  await page.reload();
  await page.waitForFunction(() => window.MSWQueue?.state.files[0]?.meta?.subtitleTracks?.length && !MSWQueue.state.inspecting);
  expect(await page.evaluate(() => MSWQueue.tasks()[0].exportTrackIds)).toEqual([metadata.flat.subtitleTracks[0].id]);
});

test('timestamp tool lists native tracks; clearing input resets availability', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { MSWNavigation.show('tools'); MSWTools.select('timestamps'); });
  await page.locator('#timestampInput').fill(metadata.flat.path);
  await page.locator('#timestampInput').blur();
  await expect(page.locator('#timestampTrack option')).toHaveText(metadata.flatAlignment.tracks.map(t => t.label));
  await expect(page.locator('#runTimestampTool')).toBeEnabled();
  await page.locator('#runTimestampTool').click();
  await expect(page.locator('#timestampResult')).toContainText('匹配音频');
  await page.locator('#timestampInput').fill('');
  await page.locator('#timestampInput').blur();
  await expect(page.locator('#timestampTrack option')).toHaveCount(0);
  await expect(page.locator('#runTimestampTool')).toBeDisabled();
  await page.locator('#timestampInput').fill(metadata.legacy);
  await page.locator('#timestampInput').blur();
  await expect(page.locator('#runTimestampTool')).toBeEnabled();
  await expect(page.locator('#timestampTrack option')).toHaveCount(1);
  expect(await page.evaluate(() => __flatCalls.includes('run_timestamp_alignment'))).toBe(false);
});
