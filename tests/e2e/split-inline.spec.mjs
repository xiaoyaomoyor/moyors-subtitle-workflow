import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, startServer, openMenubarMenu } from './helpers.mjs';

let server;
test.beforeAll(async () => {
  const folder = makeTempDir('split-inline');
  const media = join(folder, 'synthetic.wav'), project = join(folder, 'project.mosp');
  generateWav(media, 8);
  writeFileSync(project, JSON.stringify({ media, segments: [], waveform: generateWaveformPayload(8000) }));
  server = await startServer(project, media, await findFreePort());
});
test.afterAll(async () => { await server?.stop(); });
test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
  await page.addInitScript(() => localStorage.setItem('moy.asr.editor.settings.v1', JSON.stringify({ autoSaveProject: false })));
  await page.goto(server.url);
  await expect.poll(() => page.evaluate(() => Boolean(window.MSWProjectStyle))).toBe(true);
});

async function fixture(page, options = {}) {
  await page.evaluate(options => {
    const items = text => text.split(' ').map((text, i) => ({ text, start: i * 2000, end: (i + 1) * 2000 }));
    const main = { id: 'main-a', start: 0, end: 8000, text: 'one two three four', items: options.mainTimed ? items('one two three four') : [], speaker: 'Speaker A' };
    const secondary = { id: 'sub-a', start: 0, end: 8000, text: '甲乙丙丁戊己庚辛', items: options.subTimed
      ? Array.from('甲乙丙丁戊己庚辛', (text, i) => ({ text, start: i * 1000, end: (i + 1) * 1000 })) : [] };
    if (options.shortSub) Object.assign(secondary, { start: 100, end: 200, text: '甲' });
    const media = DATA.media;
    applyCanonicalProject({ media, segments: [main], multi_subtitle: {
      enabled: !options.hidden, display_mode: 'both', tracks: [{ id: 'secondary', role: 'extension', split_mode: 'continuous', segments: [secondary] }],
      bindings: options.unbound ? [] : [{ id: 'binding-a', track_id: 'secondary', main_segment_ids: ['main-a'], extension_segment_ids: ['sub-a'] }],
    }, waveform: DATA.waveform }, 'split-test.mosp');
    DATA.preview = { ...DATA.preview, project_style: window.MSWProjectStyle.defaults() };
    renderAll();
  }, options);
}
const panel = page => page.locator('#multi-subtitle-split-modal');
const data = page => page.evaluate(() => ({ main: structuredClone(DATA.segments), sub: structuredClone(getActiveExtensionTrack().segments), bindings: structuredClone(DATA.multi_subtitle.bindings), style: structuredClone(DATA.preview.project_style) }));

test('uncertain linked split is inline, click-only, fixed in time, undoable and preserves styles', async ({ page }) => {
  await fixture(page);
  const before = await data(page);
  await page.evaluate(() => splitFromContextMenu(0, 0, 0, 3000));
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.modal-mask.show')).toHaveCount(0);
  expect(await panel(page).evaluate(el => el.closest('#current-cue-panel') !== null)).toBe(true);
  const left = page.locator('#multi-subtitle-split-main-text');
  const old = await page.evaluate(() => pendingLinkedSplit.mainOffset);
  await left.locator('.multi-subtitle-split-gap').last().hover();
  expect(await page.evaluate(() => pendingLinkedSplit.mainOffset)).toBe(old);
  await left.locator('.multi-subtitle-split-gap').last().click();
  expect(await page.evaluate(() => pendingLinkedSplit.cutMs)).toBe(3000);
  expect((await data(page)).main).toHaveLength(1);
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeHidden();
  const after = await data(page);
  expect(after.main.map(s => [s.start, s.end])).toEqual([[0, 3000], [3000, 8000]]);
  expect(after.sub.map(s => [s.start, s.end])).toEqual([[0, 3000], [3000, 8000]]);
  expect(after.bindings).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    expect(after.bindings[i].main_segment_ids).toEqual([after.main[i].id]);
    expect(after.bindings[i].extension_segment_ids).toEqual([after.sub[i].id]);
  }
  expect(after.style).toEqual(before.style);
  expect(after.main.map(s => s.speaker)).toEqual(['Speaker A', 'Speaker A']);
  expect(after.sub.map(s => s.items)).toEqual([[], []]);
  await page.evaluate(() => performUndo());
  expect(await data(page)).toEqual(before);
  await page.evaluate(() => performRedo());
  expect(await data(page)).toEqual(after);
});

test('secondary entry also splits a bound pair and hiding secondary does not unlink it', async ({ page }) => {
  for (const hidden of [false, true]) {
    await fixture(page, { hidden });
    await page.evaluate(() => openExtensionSplitModal(0, 4000));
    await expect(page.locator('#multi-subtitle-split-title')).toHaveText('联动切分');
    await expect(page.locator('#multi-subtitle-split-main-lane')).toBeVisible();
    await page.locator('#multi-subtitle-split-confirm').click();
    expect((await data(page)).bindings).toHaveLength(2);
    expect((await data(page)).main).toHaveLength(2);
    expect(await page.evaluate(() => DATA.multi_subtitle.enabled)).toBe(!hidden);
  }
});

test('timed waveform cutting is direct and retains the exact clicked time on both lanes', async ({ page }) => {
  await fixture(page, { mainTimed: true, subTimed: true });
  await page.evaluate(() => splitFromContextMenu(0, 0, 0, 3000));
  await expect(panel(page)).toBeHidden();
  const result = await data(page);
  expect(result.main.map(s => [s.start, s.end])).toEqual([[0, 3000], [3000, 8000]]);
  expect(result.sub.map(s => [s.start, s.end])).toEqual([[0, 3000], [3000, 8000]]);
  expect(result.bindings).toHaveLength(2);
  for (const segment of [...result.main, ...result.sub]) for (const item of segment.items) {
    expect(item.start).toBeGreaterThanOrEqual(segment.start);
    expect(item.end).toBeLessThanOrEqual(segment.end);
  }
});

test('unbound text-caret cuts work directly for both main and secondary, including edited drafts', async ({ page }) => {
  for (const kind of ['main', 'extension']) {
    await fixture(page, { unbound: true });
    await page.evaluate(kind => { setCuePanelTarget(kind, 0); }, kind);
    const text = page.locator('#cue-panel-text');
    await text.fill(kind === 'main' ? 'new text here' : '新的翻译内容');
    await text.evaluate((el, kind) => el.setSelectionRange(kind === 'main' ? 4 : 3, kind === 'main' ? 4 : 3), kind);
    await text.press('Enter');
    await expect(panel(page)).toBeHidden();
    const result = await data(page);
    expect((kind === 'main' ? result.main : result.sub).map(s => s.text)).toEqual(kind === 'main' ? ['new', 'text here'] : ['新的翻', '译内容']);
    await page.evaluate(() => performUndo());
    const undone = await data(page);
    expect((kind === 'main' ? undone.main : undone.sub)[0].text).toBe(kind === 'main' ? 'new text here' : '新的翻译内容');
  }
});

test('independent action splits only its source and explicitly releases the binding', async ({ page }) => {
  for (const kind of ['main', 'extension']) {
    await fixture(page);
    const before = await data(page);
    await page.evaluate(kind => requestSubtitleSplit(kind, 0, { timeMs: 4000 }), kind);
    await panel(page).locator('summary').click();
    await page.locator('#multi-subtitle-split-independent').click();
    await expect(panel(page)).toBeHidden();
    const result = await data(page);
    expect(result.bindings).toHaveLength(0);
    expect(result.main).toHaveLength(kind === 'main' ? 2 : 1);
    expect(result.sub).toHaveLength(kind === 'extension' ? 2 : 1);
    await page.evaluate(() => performUndo());
    expect(await data(page)).toEqual(before);
  }
});

test('an impossible bound split never silently falls back to unbinding', async ({ page }) => {
  await fixture(page, { shortSub: true });
  const before = await data(page);
  await page.evaluate(() => splitFromContextMenu(0, 0, 0, 4000));
  await expect(page.locator('#multi-subtitle-split-confirm')).toBeDisabled();
  await page.keyboard.press('Enter');
  expect(await data(page)).toEqual(before);
  await expect(page.locator('#multi-subtitle-split-error')).toContainText('仅切当前字幕并解绑');
  await panel(page).locator('summary').click();
  await page.locator('#multi-subtitle-split-independent').click();
  expect((await data(page)).main).toHaveLength(2);
  expect((await data(page)).bindings).toHaveLength(0);
  // The same choice must remain available when the short partner is the main cue.
  await fixture(page);
  await page.evaluate(() => {
    Object.assign(DATA.segments[0], { start: 100, end: 200, text: 'one' });
    openExtensionSplitModal(0, 4000);
  });
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('#multi-subtitle-split-confirm')).toBeDisabled();
  await panel(page).locator('summary').click();
  await page.locator('#multi-subtitle-split-independent').click();
  expect((await data(page)).main).toHaveLength(1);
  expect((await data(page)).sub).toHaveLength(2);
  expect((await data(page)).bindings).toHaveLength(0);
});

test('cancel, native buttons, and focus outside the panel do not accidentally confirm', async ({ page }) => {
  await fixture(page);
  const before = await data(page);
  await page.evaluate(() => splitFromContextMenu(0, 0, 0, 4000));
  await page.locator('#multi-subtitle-split-cancel').focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeHidden();
  expect(await data(page)).toEqual(before);
  await page.evaluate(() => splitFromContextMenu(0, 0, 0, 4000));
  await openMenubarMenu(page, '字幕');
  await page.locator('#cue-list-settings-open').click();
  await page.locator('#search').focus();
  await expect(page.locator('#search')).toBeFocused();
  await page.keyboard.type('one');
  await page.keyboard.press('Enter');
  expect(await data(page)).toEqual(before);
  await page.locator('#cue-list-settings-close').click();
  await page.locator('#multi-subtitle-split-main-text').focus();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
});

test('pending split refuses changed source data and closes on project switch', async ({ page }) => {
  for (const independent of [false, true]) {
    await fixture(page);
    await page.evaluate(() => { splitFromContextMenu(0, 0, 0, 4000); DATA.segments[0].text = 'changed text'; });
    if (independent) await panel(page).locator('summary').click();
    await page.locator(independent ? '#multi-subtitle-split-independent' : '#multi-subtitle-split-confirm').click();
    await expect(panel(page)).toBeHidden();
    expect((await data(page)).main).toHaveLength(1);
    expect((await data(page)).bindings).toHaveLength(1);
  }
  await page.evaluate(() => splitFromContextMenu(0, 0, 0, 4000));
  await fixture(page);
  await expect(panel(page)).toBeHidden();
});

test('manual rewriting of timed text requires confirmation', async ({ page }) => {
  await fixture(page, { mainTimed: true, unbound: true });
  await page.evaluate(() => { DATA.segments[0].text = 'one rewritten three four'; splitFromContextMenu(0, 0, 0, 4000); });
  await expect(panel(page)).toBeVisible();
  expect((await data(page)).main).toHaveLength(1);
});

test('incomplete item timing does not silently split text', async ({ page }) => {
  await fixture(page, { mainTimed: true, unbound: true });
  await page.evaluate(() => { delete DATA.segments[0].items[2].start; splitFromContextMenu(0, 0, 0, 4000); });
  await expect(panel(page)).toBeVisible();
  expect((await data(page)).main).toHaveLength(1);
});

test('English inline controls preserve project text while changing language', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    DATA.segments[0].text = '帮助 设置';
    DATA.multi_subtitle.tracks[0].segments[0].text = '主字幕副字幕';
    MSWE_I18N.applyLanguage('en');
    splitFromContextMenu(0, 0, 0, 4000);
  });
  await expect(page.locator('#multi-subtitle-split-title')).toHaveText('Split linked subtitles');
  await expect(page.locator('#multi-subtitle-split-meta')).toContainText('Split at');
  await expect(page.locator('#multi-subtitle-split-main-text')).toHaveText('帮助 设置');
  await expect(page.locator('#multi-subtitle-split-text')).toHaveText('主字幕副字幕');
  await page.locator('#multi-subtitle-split-confirm').click();
  expect((await data(page)).main.map(s => s.text)).toEqual(['帮助', '设置']);
});

for (const width of [1280, 740]) test(`inline split layout remains usable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page);
  await page.evaluate(() => splitFromContextMenu(0, 0, 0, 4000));
  const main = page.locator('#multi-subtitle-split-main-text');
  await main.locator('.multi-subtitle-split-gap').first().click();
  await page.locator('#multi-subtitle-split-text .multi-subtitle-split-gap').first().click();
  expect(await panel(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.locator('#multi-subtitle-split-confirm').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('inline-split.png') });
  await page.locator('#multi-subtitle-split-confirm').click();
  expect((await data(page)).bindings).toHaveLength(2);
});

test('razor cuts a secondary waveform block through the same linked flow', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-waveform-tool="razor"]').click();
  const block = page.locator('.waveform-cue-block[data-track="extension"]').first();
  await block.click();
  await expect(page.locator('#multi-subtitle-split-title')).toHaveText('联动切分');
  await page.locator('#multi-subtitle-split-confirm').click();
  expect((await data(page)).bindings).toHaveLength(2);
});
