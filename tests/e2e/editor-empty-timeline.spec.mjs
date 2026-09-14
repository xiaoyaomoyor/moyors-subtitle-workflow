import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { disableOnboarding, findFreePort, makeTempDir, startBlankServer, clickBatchOperation,
  generateBlankEditor, startStaticServer } from './helpers.mjs';

let server, portable, root;
test.beforeAll(async () => {
  root = makeTempDir('empty-timeline');
  process.env.MAW_ENV_FILE = join(root, 'isolated.env');
  process.env.MSW_APP_DATA_ROOT = join(root, 'app-data');
  server = await startBlankServer(await findFreePort(), join(root, 'settings'));
  portable = await startStaticServer(generateBlankEditor(join(root, 'editor.html')), await findFreePort());
});
test.afterAll(async () => { await server?.stop(); await portable?.stop(); });
test.beforeEach(async ({ page }) => { await disableOnboarding(page); });

for (const mode of ['server', 'portable']) {
  test(`${mode}: an empty timeline supports creating the first cue without inventing peaks or export duration`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(mode === 'server' ? server.url : portable.url);
    await expect(page.locator('.waveform-row').first()).toBeVisible();
    expect(await page.evaluate(() => ({ peaks: waveformEditor.getPayload(), duration: waveformEditor.contentDurationMs,
      viewport: waveformEditor.durationMs, count: DATA.segments.length })))
      .toEqual({ peaks: null, duration: 0, viewport: 20000, count: 0 });
    const row = await page.locator('.waveform-row').first().boundingBox();
    const y = row.y + row.height * .25;
    await page.keyboard.down('Control');
    await page.mouse.move(row.x + row.width * .2, y); await page.mouse.down();
    await page.mouse.move(row.x + row.width * .4, y, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up('Control');
    await expect.poll(() => page.evaluate(() => DATA.segments.length)).toBe(1);
    const saved = await page.evaluate(() => JSON.parse(buildJson()));
    expect(saved.waveform).toBeFalsy();
    expect(saved.segments[0].end).toBeGreaterThan(saved.segments[0].start);
    await page.evaluate(project => applyCanonicalProject(project, 'empty.mosp'), saved);
    await expect(page.locator('.waveform-cue-block').first()).toBeVisible();
    await page.locator('.waveform-cue-block').first().click();
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => DATA.segments.length)).toBe(0);
    await expect(page.locator('.waveform-row').first()).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => DATA.segments.length)).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('all main cues can be cut and restored in one undo without waveform data', async ({ page }) => {
  await page.goto(server.url);
  await page.evaluate(() => {
    applyCanonicalProject({ media: '', segments: [
      { id: 'one', start: 1000, end: 2000, text: 'One' },
      { id: 'two', start: 3000, end: 4000, text: 'Two' },
    ] }, 'cut.mosp');
  });
  await page.locator('.waveform-cue-block').first().click();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
  await expect.poll(() => page.evaluate(() => DATA.segments.length)).toBe(0);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => DATA.segments.map(cue => cue.id))).toEqual(['one', 'two']);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => page.evaluate(() => DATA.segments.length)).toBe(0);
});

test('clear empty subtitles includes hidden secondary tracks and survives save/reopen', async ({ page }) => {
  await page.goto(server.url);
  await page.evaluate(() => {
    applyCanonicalProject({ media: '', segments: [{ id: 'main', start: 0, end: 1000, text: '' }],
      multi_subtitle: { schema: 'moy.asr.multi_subtitle.v1', enabled: false, display_mode: 'both',
        tracks: [{ id: 'translation', name: 'Translation', role: 'translation', language: 'en',
          segments: [{ id: 'secondary', start: 0, end: 1000, text: '  ' }] }], bindings: [] } }, 'pair.mosp');
  });
  await clickBatchOperation(page, 'clear-empty-cues');
  expect(await page.evaluate(() => [DATA.segments.length, DATA.multi_subtitle.tracks[0].segments.length])).toEqual([0, 0]);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => [DATA.segments.length, DATA.multi_subtitle.tracks[0].segments.length])).toEqual([1, 1]);
  await page.keyboard.press('Control+Shift+z');
  const saved = await page.evaluate(() => JSON.parse(buildJson()));
  await page.evaluate(project => applyCanonicalProject(project, 'pair.mosp'), saved);
  expect(await page.evaluate(() => [DATA.segments.length, DATA.multi_subtitle.tracks[0].segments.length])).toEqual([0, 0]);
  await expect(page.locator('.waveform-row').first()).toBeVisible();
});

test('clearing empty halves preserves nonempty partners and uses one undo', async ({ page }) => {
  await page.goto(server.url);
  await page.evaluate(() => {
    applyCanonicalProject({ media: '', segments: [
      { id: 'empty-main', start: 1000, end: 2000, text: '' },
      { id: 'keep-main', start: 3000, end: 4000, text: 'Keep main' }],
      multi_subtitle: { schema: 'moy.asr.multi_subtitle.v1', enabled: true, display_mode: 'both',
        tracks: [{ id: 'ext', role: 'extension', name: 'English', language: 'English', segments: [
          { id: 'keep-secondary', start: 1000, end: 2000, text: 'Keep secondary' },
          { id: 'empty-secondary', start: 3000, end: 4000, text: '' }] }],
        bindings: [
          { id: 'first', track_id: 'ext', main_segment_ids: ['empty-main'], extension_segment_ids: ['keep-secondary'] },
          { id: 'second', track_id: 'ext', main_segment_ids: ['keep-main'], extension_segment_ids: ['empty-secondary'] },
        ] } }, 'empty-halves.mosp');
  });
  const before = await page.evaluate(() => [JSON.stringify(DATA.segments), JSON.stringify(DATA.multi_subtitle), editorHistory.undoLength()]);
  await clickBatchOperation(page, 'clear-empty-cues');
  expect(await page.evaluate(() => [DATA.segments.map(c => c.id), DATA.multi_subtitle.tracks[0].segments.map(c => c.id)]))
    .toEqual([['keep-main'], ['keep-secondary']]);
  expect(await page.evaluate(() => editorHistory.undoLength())).toBe(before[2] + 1);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => [JSON.stringify(DATA.segments), JSON.stringify(DATA.multi_subtitle), editorHistory.undoLength()])).toEqual(before);
});

test('mixed paired and unbound subtitle cut keeps stable identities and one undo', async ({ page }) => {
  await page.goto(server.url);
  await page.evaluate(() => {
    applyCanonicalProject({ media: '', segments: [{ id: 'main', start: 1000, end: 2000, text: 'Main' }],
      multi_subtitle: { schema: 'moy.asr.multi_subtitle.v1', enabled: true, display_mode: 'both',
        tracks: [{ id: 'ext', role: 'extension', name: 'English', language: 'English',
          segments: [{ id: 'paired', start: 1000, end: 2000, text: 'Paired' },
            { id: 'unbound', start: 3000, end: 4000, text: 'Unbound' },
            { id: 'keep', start: 5000, end: 6000, text: 'Keep' }] }],
        bindings: [{ id: 'binding', track_id: 'ext', main_segment_ids: ['main'], extension_segment_ids: ['paired'] }] } }, 'mixed.mosp');
    selectedIdxs.add(0); selectedExtensionIdxs.add(0); selectedExtensionIdxs.add(1);
    waveformEditor.updateSelection();
  });
  await page.keyboard.press('Control+x');
  expect(await page.evaluate(() => [DATA.segments.length, DATA.multi_subtitle.tracks[0].segments.map(cue => cue.id)]))
    .toEqual([0, ['keep']]);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => [DATA.segments.length, DATA.multi_subtitle.tracks[0].segments.map(cue => cue.id), DATA.multi_subtitle.bindings.length]))
    .toEqual([1, ['paired', 'unbound', 'keep'], 1]);
});
