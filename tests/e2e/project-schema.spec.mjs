import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { disableOnboarding, findFreePort, generateBlankEditor, makeTempDir, startBlankServer, startStaticServer } from './helpers.mjs';

const legacy = JSON.parse(readFileSync(new URL('../fixtures/msw_beta1_legacy_project.json', import.meta.url), 'utf8'));
const schema = 'moy.asr.project.v1';
let server, liveServer;

test.beforeAll(async () => {
  const dir = makeTempDir('project-schema');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env');
  process.env.MSW_APP_DATA_ROOT = join(dir, 'app-data');
  server = await startStaticServer(generateBlankEditor(join(dir, 'editor.html')), await findFreePort());
  liveServer = await startBlankServer(await findFreePort(), join(dir, 'server-settings'));
});
test.afterAll(async () => { await server?.stop(); await liveServer?.stop(); });
test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
  await page.goto(server.url);
});

async function open(page, project, name = 'legacy.mosp') {
  await page.locator('#open-project-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#json-name')).toHaveText(name);
  if (project.media) {
    await expect(page.locator('#project-media-modal')).toHaveClass(/show/);
    await page.locator('#project-media-later').click();
  }
}

function snapshot(page) {
  return page.evaluate(() => window.MSWE.resolve('persistence-host').snapshot());
}

test('legacy voice project opens, edits and downloads with current metadata and live MSW state', async ({ page }) => {
  await open(page, legacy);
  const opened = await snapshot(page);
  expect(opened.schema).toBe(schema);
  for (const key of ['msw', 'fixture_metadata', 'fixture_optional_null', 'language_source', 'split_mode', 'timestamp_granularity']) {
    expect(opened[key]).toEqual(legacy[key]);
  }
  expect(opened.multi_subtitle.bindings).toEqual(legacy.multi_subtitle.bindings);
  expect(opened.multi_subtitle.tracks[0].segments[0].id).toBe('translation-001');
  await page.locator('.cue[data-idx="0"]').first().click();
  await page.locator('#cue-panel-text').fill('修改后的字幕');
  // Model an audio edit and asset removal after load: serialization must not
  // replay the MSW namespace captured when the project was opened.
  await page.evaluate(() => {
    const ext = window.MSWE.resolve('persistence-host').data.msw;
    ext.audio_clips = [];
    ext.removed_asset_ids.push(ext.assets[0].id);
    ext.assets = [];
    ext.translation_applications['translation-job-002'] = ['main-001'];
  });
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.MSWE.resolve('persistence-host').downloadLocal(null, 'round-trip.mosp'));
  const download = await downloadPromise;
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(saved.schema).toBe(schema);
  expect(saved.segments[0].text).toBe('修改后的字幕');
  expect(saved.msw.assets).toEqual([]);
  expect(saved.msw.audio_clips).toEqual([]);
  expect(saved.msw.removed_asset_ids).toContain(legacy.msw.assets[0].id);
  expect(saved.msw.translation_applications['translation-job-002']).toEqual(['main-001']);
  expect(saved.fixture_metadata).toEqual(legacy.fixture_metadata);
  await open(page, saved, 'round-trip.mosp');
  expect((await snapshot(page)).msw).toEqual(saved.msw);
});

for (const field of ['root', 'msw']) {
  test(`unknown ${field} version is rejected by file input and drop without changing the current project`, async ({ page }) => {
    await open(page, legacy);
    await page.locator('.cue[data-idx="0"]').first().click();
    await page.locator('#cue-panel-text').fill('保留当前编辑');
    const before = await snapshot(page);
    const generation = await page.evaluate(() => window.MSWE.resolve('persistence-host').generation);
    const future = structuredClone(legacy);
    if (field === 'root') future.schema = 'moy.asr.project.v2';
    else future.msw.schema = 'msw.editor.v2';
    await page.locator('#open-project-file').setInputFiles({ name: 'future.mosp', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(future)) });
    await expect(page.locator('#hint-stack')).toContainText('版本不受支持');
    expect(await snapshot(page)).toEqual(before);
    await expect(page.locator('#json-name')).toHaveText('legacy.mosp');
    await page.evaluate(() => document.querySelector('#hint-stack')?.replaceChildren());
    page.on('dialog', dialog => dialog.accept());
    await page.evaluate(project => {
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(project)], 'future-drop.mosp', { type: 'application/json' }));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    }, future);
    await expect(page.locator('#hint-stack')).toContainText('版本不受支持');
    await expect(page.locator('#multi-subtitle-import-modal')).not.toHaveClass(/show/);
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.MSWE.resolve('persistence-host').generation)).toBe(generation);
  });

  test(`unknown ${field} version cannot be adopted or restored by persistence callbacks`, async ({ page }) => {
    await open(page, legacy);
    const results = await page.evaluate(field => {
      const host = window.MSWE.resolve('persistence-host');
      const before = JSON.stringify(host.snapshot());
      const config = JSON.stringify(host.config);
      const generation = host.generation;
      const project = structuredClone(host.snapshot());
      if (field === 'root') project.schema = 'moy.asr.project.v2';
      else project.msw.schema = 'msw.editor.v2';
      const result = { project, projectId: 'future-project', filename: 'future.mosp', binding: 'future', saveRevision: 'future' };
      const errors = [];
      for (const action of [() => host.restore(result), () => host.adopt(result, { source: before, newProject: true }),
        () => host.adopt(result, { source: before, newProject: false })]) {
        try { action(); errors.push(null); } catch (error) { errors.push(error.message); }
      }
      return { errors, sameProject: JSON.stringify(host.snapshot()) === before,
        sameConfig: JSON.stringify(host.config) === config, sameGeneration: host.generation === generation };
    }, field);
    expect(results.errors).toHaveLength(3);
    for (const error of results.errors) expect(error).toContain('版本不受支持');
    expect(results.sameProject && results.sameConfig && results.sameGeneration).toBe(true);
    await expect(page.locator('#json-name')).toHaveText('legacy.mosp');
  });
}

test('switching to an upstream project clears the previous project extensions and recognition metadata', async ({ page }) => {
  await open(page, legacy);
  await open(page, { schema, media: '', segments: [{ id: 'b-001', start: 0, end: 1000, text: 'Project B' }],
    project_b: { keep: true } }, 'upstream-b.mosp');
  const next = await snapshot(page);
  expect(next.project_b).toEqual({ keep: true });
  for (const key of ['fixture_metadata', 'fixture_optional_null', 'language_source', 'split_mode', 'timestamp_granularity']) {
    expect(next).not.toHaveProperty(key);
  }
  expect(next.msw.project_id).not.toBe(legacy.msw.project_id);
  expect(next.msw.assets || []).toEqual([]);
  expect(next.msw.audio_clips || []).toEqual([]);
});

test('restoring a valid legacy project keeps metadata, while adopting a save-as preserves edited live content', async ({ page }) => {
  await page.goto(liveServer.url);
  const saved = await page.evaluate(project => {
    const host = window.MSWE.resolve('persistence-host');
    host.restore({ project, filename: 'recovered.mosp' });
    const before = host.snapshot();
    const forked = structuredClone(before);
    forked.msw.project_id = 'forked-project';
    forked.msw.source_project_id = before.msw.project_id;
    forked.msw.applied_results = [];
    delete forked.msw.translation_applications;
    delete forked.msw.translation_target_tracks;
    host.adopt({ project: forked, projectId: 'forked-project', binding: 'forked-binding', saveRevision: 'forked-revision',
      filename: 'forked.mosp' }, { source: JSON.stringify(before), newProject: false });
    return host.snapshot();
  }, legacy);
  expect(saved.schema).toBe(schema);
  expect(saved.fixture_metadata).toEqual(legacy.fixture_metadata);
  expect(saved.msw.assets).toEqual(legacy.msw.assets);
  expect(saved.msw.audio_clips).toEqual(legacy.msw.audio_clips);
  expect(saved.msw.project_id).toBe('forked-project');
  expect(saved.msw.source_project_id).toBe('legacy-beta1');
  expect(saved.msw.applied_results).toEqual([]);
  expect(saved.msw).not.toHaveProperty('translation_applications');
});
