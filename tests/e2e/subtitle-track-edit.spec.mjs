import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { cleanupTempDir, generateBlankEditor, findFreePort, generateWaveformPayload, makeTempDir, startStaticServer } from './helpers.mjs';

let tempDir, server;
test.beforeAll(async () => {
  tempDir = makeTempDir('subtitle-track-edit');
  server = await startStaticServer(generateBlankEditor(join(tempDir, 'blank.html')), await findFreePort());
});
test.afterAll(async () => { await server?.stop(); cleanupTempDir(tempDir); });
const cue = (id, start, end, text = id) => ({ id, start, end, text, items: [] });
async function open(page, segments = [cue('a', 1000, 3000), cue('b', 2000, 4000), cue('c', 5000, 7000)], extra = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('moy.asr.editor.onboarding.v1', 'skipped'));
  await page.goto(server.url + '?subtitle-tracks=1');
  expect(errors).toEqual([]);
  await page.evaluate(project => {
    applyCanonicalProject(project, 'tracks.mosp');
    waveformEditor.settings.mode = 'multi'; waveformEditor.settings.secondsPerRow = 10;
    waveformEditor.settings.rowHeight = 140; waveformEditor.render();
    updateEditorSettings({ clickBehavior: 'select-only', autoSaveProject: false });
  }, { segments, waveform: generateWaveformPayload(30000), ...extra });
  expect(errors).toEqual([]);
  return errors;
}

test('opt-in boots fixed lanes, headers, list ownership and serializes the project', async ({ page }) => {
  const errors = await open(page);
  expect(await page.evaluate(() => DATA.schema)).toBe('msw.project.v3');
  await expect(page.locator('.fixed-track-head').first()).toBeVisible();
  await expect(page.locator('#fixed-track-toolbar')).toBeVisible();
  await expect(page.locator('#fixed-track-filter')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(buildJson()).subtitle_tracks.assignments.length)).toBe(3);
  await page.locator('#fixed-track-toolbar button').click();
  await page.getByRole('button', { name: '添加画面文字轨道', exact: true }).click();
  expect(await page.evaluate(() => DATA.subtitle_tracks.tracks.length)).toBe(3);
  expect(errors).toEqual([]);
});

const bilingual = () => ({ multi_subtitle: { schema: 'moy.asr.multi_subtitle.v1', enabled: true, display_mode: 'both',
  tracks: [{ id: 'zh', role: 'extension', segments: [cue('sub-a', 1200, 3200, '第一句话'), cue('sub-c', 5200, 7200, '第二句话')] }],
  bindings: ['a', 'c'].map(id => ({ id: `pair-${id}`, track_id: 'zh', main_segment_ids: [id], extension_segment_ids: [`sub-${id}`], start_offset_ms: 200, end_offset_ms: 200 })) } });
const state = page => page.evaluate(() => structuredClone({ segments: DATA.segments, multi: DATA.multi_subtitle, tracks: DATA.subtitle_tracks }));
const owner = (p, id, role = 'main') => p.tracks.assignments.find(a => a.cue_id === id && a.role === role).subtitle_track_id;

test('headers rename, collapse, reorder and retain empty tracks through undo and reopening', async ({ page }) => {
  const errors = await open(page);
  const input = page.locator('.fixed-track-head input').first();
  await input.fill('采访'); await input.press('Enter');
  await expect(page.locator('#fixed-track-filter')).toContainText('采访');
  await page.locator('.fixed-track-head').first().getByRole('button', { name: '折叠轨道' }).click();
  await expect(page.locator('.waveform-cue-block[data-cue-id="a"]')).toHaveCount(0);
  await expect(page.locator('.waveform-cue-block[data-cue-id="b"]').first()).toBeVisible();
  await page.locator('.fixed-track-head').first().getByRole('button', { name: '轨道操作' }).click();
  await page.getByRole('button', { name: '下移轨道', exact: true }).click();
  expect((await state(page)).tracks.tracks[1].name).toBe('采访');
  await page.evaluate(() => performUndo());
  expect((await state(page)).tracks.tracks[0].name).toBe('采访');
  await page.evaluate(() => fixedAddTrack('annotation'));
  const saved = await page.evaluate(() => JSON.parse(buildJson()));
  await page.evaluate(saved => applyCanonicalProject(saved, 'reopened.mosp'), saved);
  expect((await state(page)).tracks).toEqual(saved.subtitle_tracks);
  expect(errors).toEqual([]);
});

test('move menu moves bound partners together, filters cards and rejects occupied targets atomically', async ({ page }) => {
  const errors = await open(page, undefined, bilingual());
  const original = await state(page);
  await page.locator('.waveform-cue-block[data-track="main"][data-cue-id="a"]').first().click({ button: 'right' });
  await page.locator('.fixed-track-move-menu summary').click();
  await page.locator('.fixed-track-move-menu').getByRole('button', { name: '新建画面文字轨道' }).click();
  const moved = await state(page), target = owner(moved, 'a');
  expect(target).not.toBe(owner(original, 'a'));
  expect(owner(moved, 'sub-a', 'extension')).toBe(target);
  expect(moved.segments).toEqual(original.segments); expect(moved.multi).toEqual(original.multi);
  await page.locator('#fixed-track-filter').selectOption(target);
  await expect(page.locator('#cues-container > .cue:not(.hidden)')).toHaveCount(1);
  await page.evaluate(() => performUndo()); expect(await state(page)).toEqual(original);
  await page.evaluate(() => performRedo()); expect(await state(page)).toEqual(moved);
  await page.evaluate(() => fixedMove([fixedRef(DATA.segments.find(c => c.id === 'a'))], fixedOwner(DATA.segments.find(c => c.id === 'b'))));
  await expect(page.locator('#fixed-track-status')).toContainText('重叠');
  expect(await state(page)).toEqual(moved);
  await page.evaluate(() => performUndo()); expect(await state(page)).toEqual(original);
  expect(errors).toEqual([]);
});

for (const quick of [false, true]) test(`bound split ${quick ? 'quick' : 'confirmed'} keeps ownership and one undo`, async ({ page }) => {
  const errors = await open(page, [cue('a', 1000, 3000, 'hello world'), cue('b', 2000, 4000), cue('c', 5000, 7000)], bilingual());
  const before = await state(page), track = owner(before, 'a');
  await page.evaluate(quick => requestSubtitleSplit('main', DATA.segments.findIndex(c => c.id === 'a'), { timeMs: 2000, quick }), quick);
  if (!quick) { await expect(page.locator('#current-cue-panel')).toHaveClass(/splitting/); await page.evaluate(() => confirmLinkedSplit()); }
  const after = await state(page);
  expect(after.segments.length).toBe(4); expect(after.multi.tracks[0].segments.length).toBe(3);
  expect(after.tracks.assignments.filter(a => a.subtitle_track_id === track)).toHaveLength(6);
  expect(await page.evaluate(() => fixedTrackCore.validate(DATA))).toBe(true);
  await page.evaluate(() => performUndo()); expect(await state(page)).toEqual(before);
  await page.evaluate(() => performRedo()); expect(await state(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test('same-track merge spans interleaved other tracks but cross-track merge is rejected', async ({ page }) => {
  const errors = await open(page, [cue('a', 1000, 3000), cue('b', 2000, 4000), cue('c', 5000, 7000)], bilingual());
  const before = await state(page), track = owner(before, 'a');
  expect(await page.evaluate(() => layerMergeSelected([0, 1]))).toBe(false);
  await expect(page.locator('#fixed-track-status')).toContainText('跨轨');
  expect(await state(page)).toEqual(before);
  expect(await page.evaluate(() => layerMergeSelected([0, 2]))).toBe(true);
  const after = await state(page);
  expect(after.segments).toHaveLength(2); expect(after.multi.tracks[0].segments).toHaveLength(1);
  expect(after.tracks.assignments.filter(a => a.subtitle_track_id === track)).toHaveLength(2);
  await page.evaluate(() => performUndo()); expect(await state(page)).toEqual(before);
  await page.evaluate(() => performRedo()); expect(await state(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test('locked tracks reject text, split, delete, markers and movement without breaking redo', async ({ page }) => {
  const errors = await open(page, undefined, bilingual());
  await page.evaluate(() => fixedUpdateTrack(fixedOwner(DATA.segments[0]), { locked: true }));
  const before = await state(page);
  await page.locator('.waveform-cue-block[data-cue-id="a"][data-track="main"]').first().click();
  await expect(page.locator('#cue-panel-text')).toBeDisabled();
  await expect(page.locator('#fixed-cue-owner')).toContainText('已锁定');
  await page.evaluate(() => {
    requestSubtitleSplit('main', 0, { timeMs: 2000, quick: true });
    deleteSegments([0]);
    pushUndo('test marker'); DATA.segments[0].disabled = true; renderAll();
  });
  expect(await state(page)).toEqual(before);
  await page.evaluate(() => performUndo());
  expect((await state(page)).tracks.tracks[0].locked).toBe(false);
  await page.evaluate(() => performRedo()); expect(await state(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('resizing only collides on its own fixed track, retains lanes and cancels/undoes exactly', async ({ page }) => {
  const errors = await open(page, [cue('a', 1000, 3000), cue('b', 2000, 4000), cue('c', 6007, 8007)]);
  const before = await state(page);
  const block = await page.locator('.waveform-cue-block[data-cue-id="a"]').first().boundingBox();
  const row = await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.move(block.x + block.width - 1, block.y + block.height / 2); await page.mouse.down();
  await page.mouse.move(row.x + row.width * .85, block.y + block.height / 2);
  expect(await page.evaluate(() => DATA.segments.find(c => c.id === 'a').end)).toBe(6007);
  await page.mouse.up();
  expect((await state(page)).tracks.assignments).toEqual(before.tracks.assignments);
  await page.evaluate(() => performUndo()); expect(await state(page)).toEqual(before);
  if (process.env.MSW_TRACK_EVIDENCE) { mkdirSync(process.env.MSW_TRACK_EVIDENCE, { recursive: true }); await page.screenshot({ path: join(process.env.MSW_TRACK_EVIDENCE, 'fixed-tracks.png') }); }
  expect(errors).toEqual([]);
});

test('saved download reopens via the file chooser and output entry points remain gated', async ({ page }) => {
  const errors = await open(page, undefined, bilingual());
  await page.evaluate(() => fixedAddTrack('annotation'));
  const download = page.waitForEvent('download');
  await page.evaluate(() => MSWE.resolve('persistence-host').downloadLocal(null, 'tracks.mosp'));
  const saved = readFileSync(await (await download).path());
  expect(JSON.parse(saved).schema).toBe('msw.project.v3');
  await page.locator('#open-project-file').setInputFiles({ name: 'saved-tracks.mosp', mimeType: 'application/json', buffer: saved });
  await expect(page.locator('#json-name')).toHaveText('saved-tracks.mosp');
  expect(await page.evaluate(() => fixedTrackCore.validate(DATA))).toBe(true);
  const before = await state(page);
  for (const id of ['download-full-srt', 'download-legacy-project', 'subtitle-translate-btn', 'msw-asr-open', 'tts-open']) {
    await page.locator(`#${id}`).dispatchEvent('click');
    await expect(page.locator('#fixed-track-status')).toContainText('后续阶段');
  }
  expect(await state(page)).toEqual(before); expect(errors).toEqual([]);
});

test('first upgrade preserves original bytes, cancellation and concurrent changes prevent overwriting', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const raw = ' {"segments":[]}\n', original = new File([raw], 'old.mosp');
    let target = original, saved = '';
    const handle = { name: original.name, getFile: async () => target };
    const backup = { getFile: async () => new File([], 'backup.mosp'), isSameEntry: async () => false,
      createWritable: async () => ({ write: async data => { saved = await data.text(); }, close: async () => {} }) };
    const next = fixedTrackCore.migrate(JSON.parse(raw));
    window.showSaveFilePicker = async () => backup;
    await layerProtectHandle(handle, next);
    const errors = [];
    window.showSaveFilePicker = async () => { throw new DOMException('cancelled', 'AbortError'); };
    try { await layerProtectHandle(handle, next); } catch (e) { errors.push(e.name); }
    window.showSaveFilePicker = async () => { target = new File(['{"segments":[],"changed":true}'], 'old.mosp'); return backup; };
    try { await layerProtectHandle(handle, next); } catch (e) { errors.push(e.message); }
    return { saved, raw, errors };
  });
  expect(result.saved).toBe(result.raw); expect(result.errors[0]).toBe('AbortError'); expect(result.errors[1]).toContain('已变化');
});

test('independent secondary split unbinds only that cue and inherits the original fixed owner', async ({ page }) => {
  const errors = await open(page, [cue('a', 1000, 3000, 'hello world'), cue('b', 2000, 4000), cue('c', 5000, 7000)], bilingual());
  const before = await state(page), track = owner(before, 'a');
  await page.evaluate(() => requestSubtitleSplit('extension', 0, { timeMs: 2000, quick: true, independent: true }));
  const after = await state(page);
  expect(after.segments).toEqual(before.segments); expect(after.multi.bindings).toHaveLength(1);
  expect(after.multi.tracks[0].segments).toHaveLength(3);
  expect(after.tracks.assignments.filter(a => a.role === 'extension' && a.subtitle_track_id === track)).toHaveLength(3);
  await page.evaluate(() => performUndo()); expect(await state(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('hidden language bindings still constrain and follow main drag without changing ownership', async ({ page }) => {
  const extra = bilingual(); extra.multi_subtitle.enabled = false;
  const errors = await open(page, undefined, extra);
  const before = await state(page);
  const block = await page.locator('.waveform-cue-block[data-cue-id="a"]').first().boundingBox();
  const row = await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.move(block.x + block.width / 2, block.y + block.height / 2); await page.mouse.down();
  await page.mouse.move(row.x + row.width * .85, block.y + block.height / 2); await page.mouse.up();
  const moved = await state(page), a = moved.segments.find(c => c.id === 'a'), sub = moved.multi.tracks[0].segments.find(c => c.id === 'sub-a');
  expect(a.end).toBe(5000); expect(sub.end).toBe(5200); expect(sub.start - a.start).toBe(200);
  expect(moved.tracks.assignments).toEqual(before.tracks.assignments);
  await page.evaluate(() => performUndo()); expect(await state(page)).toEqual(before); expect(errors).toEqual([]);
});

test('new cues use the clicked empty fixed lane and secondary row can be explicitly shown', async ({ page }) => {
  const errors = await open(page, undefined, bilingual());
  await page.locator('#fixed-track-toolbar button').click();
  await page.getByRole('button', { name: '添加对白轨道', exact: true }).click();
  const id = (await state(page)).tracks.tracks.at(-1).id;
  const head = page.locator(`.fixed-track-head[data-subtitle-track-id="${id}"]`).first();
  await head.getByRole('button', { name: '轨道操作' }).click();
  await page.getByRole('button', { name: '始终显示副字幕行' }).click();
  const result = await page.evaluate(id => {
    fixedActiveTrackId = id;
    return layerCreateCue(1500, 2500, 'extension');
  }, id);
  expect(result).toBe(true);
  expect((await state(page)).tracks.assignments.filter(a => a.subtitle_track_id === id)).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const mode of ['basic', 'multi']) test(`frame-aware fixed-track resize and cross-row cancellation in ${mode} mode`, async ({ page }) => {
  const errors = await open(page, [cue('a', 1000, 3000), cue('b', 2000, 4000), cue('c', 6000, 8000)], { timebase: { unit: 'frames', fps: 25 } });
  await page.evaluate(mode => { waveformEditor.settings.mode = mode; waveformEditor.settings.visibleSeconds = 10; waveformEditor.render(); }, mode);
  const before = await state(page);
  await page.locator('.waveform-cue-block[data-cue-id="a"]').first().scrollIntoViewIfNeeded();
  const block = await page.locator('.waveform-cue-block[data-cue-id="a"]').first().boundingBox();
  const row = await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.move(block.x + block.width - 1, block.y + block.height / 2); await page.mouse.down();
  await page.mouse.move(row.x + row.width * .75, block.y + block.height / 2);
  expect(await page.evaluate(() => [DATA.segments[0].start_frame, DATA.segments[0].end_frame])).toEqual([25, 150]);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await state(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('shared edge editing and cross-row drag keep fixed track ownership and stable heights', async ({ page }) => {
  const errors = await open(page, [cue('a', 1000, 3000), cue('b', 2000, 4000), cue('c', 3000, 5000)]);
  const before = await state(page);
  await page.evaluate(() => waveformEditor.settings.adjacentDragMode = 'linked');
  const block = await page.locator('.waveform-cue-block[data-cue-id="a"]').first().boundingBox();
  const row = await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.move(block.x + block.width - 1, block.y + block.height / 2); await page.mouse.down();
  await page.mouse.move(row.x + row.width * .35, block.y + block.height / 2); await page.mouse.up();
  const edges = await page.evaluate(() => [DATA.segments.find(c => c.id === 'a').end, DATA.segments.find(c => c.id === 'c').start]);
  expect(edges[0]).toBe(edges[1]); expect(Math.abs(edges[0] - 3500)).toBeLessThanOrEqual(20);
  await page.evaluate(() => performUndo()); expect(await state(page)).toEqual(before);
  // The overlapping b cue occupies another stable track with no later cue.
  const b = await page.locator('.waveform-cue-block[data-cue-id="b"]').first().boundingBox();
  const next = await page.locator('.waveform-row[data-start-ms="10000"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(next.x + next.width * .5, next.y + next.height / 2);
  const crossed = await page.evaluate(() => DATA.segments.find(c => c.id === 'b').start);
  expect(crossed).toBeGreaterThan(10000);
  await page.mouse.move(next.x + next.width * .5, (row.y + row.height + next.y) / 2);
  expect(await page.evaluate(() => DATA.segments.find(c => c.id === 'b').start)).toBe(crossed);
  expect((await page.locator('.waveform-row').first().boundingBox()).height).toBe(row.height);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await state(page)).toEqual(before); expect(errors).toEqual([]);
});

test('disabled tracks remain editable and visible, only preview visibility changes', async ({ page }) => {
  const errors = await open(page);
  const id = owner(await state(page), 'b');
  await page.evaluate(id => fixedUpdateTrack(id, { enabled: false }), id);
  await expect(page.locator('.waveform-cue-block[data-cue-id="b"]').first()).toHaveClass(/fixed-disabled/);
  await expect(page.locator('#cues-container > .cue[data-idx="1"]')).toHaveClass(/fixed-disabled/);
  expect(await page.evaluate(() => layerActive(DATA.segments, 2500))).toEqual([0]);
  await page.locator('.waveform-cue-block[data-cue-id="b"]').first().click();
  await expect(page.locator('#cue-panel-text')).toBeEnabled();
  await page.locator('#cue-panel-text').fill('可编辑'); await page.locator('#cue-panel-text').blur();
  expect(await page.evaluate(() => DATA.segments.find(c => c.id === 'b').text)).toBe('可编辑');
  expect(errors).toEqual([]);
});

test('large fixed projects retain interval indexes and lanes throughout a drag', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await open(page, Array.from({ length: 10000 }, (_, i) => cue(`p${i}`, Math.floor(i / 8) * 1000, Math.floor(i / 8) * 1000 + 900)));
  await page.evaluate(() => {
    window.__fixedTree = waveformEditor.subtitleLayout('main').index.entries;
    window.__fixedPlayback = layerIndex(DATA.segments).entries;
    window.__fixedLanes = [...waveformEditor.subtitleLayout('main').lanes];
  });
  const block = await page.locator('.waveform-cue-block[data-cue-id="p0"]').first().boundingBox();
  await page.mouse.move(block.x + block.width / 2, block.y + block.height / 2); await page.mouse.down();
  await page.mouse.move(block.x + block.width / 2 + 20, block.y + block.height / 2, { steps: 12 });
  expect(await page.evaluate(() => window.__fixedTree === waveformEditor.subtitleLayout('main').index.entries
    && window.__fixedPlayback === layerIndex(DATA.segments).entries)).toBe(true);
  expect(await page.evaluate(() => [...waveformEditor.subtitleLayout('main').lanes])).toEqual(await page.evaluate(() => window.__fixedLanes));
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.evaluate(() => fixedTrackCore.validate(DATA))).toBe(true); expect(errors).toEqual([]);
});
