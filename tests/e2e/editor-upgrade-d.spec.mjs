import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanupTempDir, clickMenubarItem, disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, startServer } from './helpers.mjs';

let directory, server;
test.beforeAll(async () => {
  directory = makeTempDir('editor-upgrade-d');
  const project = JSON.parse(readFileSync(new URL('../fixtures/msw_beta1_legacy_project.json', import.meta.url), 'utf8'));
  const asset = project.msw.assets[0];
  const audio = join(directory, asset.path);
  mkdirSync(dirname(audio), { recursive: true });
  generateWav(audio, 1);
  const bytes = readFileSync(audio);
  Object.assign(asset, { sample_rate: 8000, sample_count: 8000, byte_size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  Object.assign(project.msw.audio_clips[0], { start_ms: 2200, source_in_sample: 0, source_out_sample: 4800 });
  project.waveform = generateWaveformPayload(10000);
  project.sticker_root = join(directory, 'stickers');
  mkdirSync(project.sticker_root);
  writeFileSync(join(project.sticker_root, '中文 图片.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvKkAAAAASUVORK5CYII=', 'base64'));
  project.gap_remove = { detector: 'audio_gate', gaps: [{ start: 1000, end: 1500, removed: true }, { start: 1800, end: 1900, removed: false }, { start: 3500, end: 4000, removed: true }] };
  const source = join(directory, 'project.mosp');
  writeFileSync(source, JSON.stringify(project));
  const media = generateWav(join(directory, 'synthetic.wav'), 10);
  server = await startServer(source, media, await findFreePort());
});
test.afterAll(async () => { await server?.stop(); cleanupTempDir(directory); });
test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await page.goto(server.url);
  await expect(page.locator('#editor-loading')).toBeHidden();
});

for (const policy of ['protect', 'follow']) {
  test(`fill interval preserves tracks and uses ${policy} voice gap policy through undo and export`, async ({ page }) => {
    const before = await page.evaluate((value) => {
      DATA.msw.audio_settings.gap_policy = value;
      const saved = JSON.parse(buildJson());
      return { gaps: structuredClone(getGapRemoveGaps()), msw: saved.msw, multi: saved.multi_subtitle, segments: saved.segments };
    }, policy);
    await page.evaluate(() => showWaveformBlankMenu(2500, 300, 300));
    await expect(page.locator('#ctxmenu .item').filter({ hasText: '创建字幕' }).locator('kbd')).toHaveText('N');
    await page.locator('#ctxmenu .item').filter({ hasText: '填充区间空隙' }).click();
    expect(await page.evaluate(() => getGapRemoveGaps())).toMatchObject([{ start: 1000, end: 4000, removed: true, origins: expect.arrayContaining(['manual']) }]);
    expect(await page.evaluate(() => getRemovedGapRanges())).toEqual(policy === 'protect'
      ? [{ start: 1000, end: 2200 }, { start: 2800, end: 4000 }]
      : [{ start: 1000, end: 4000 }]);
    expect(await page.evaluate(() => fillGapRangeAtWaveformTime(1200))).toBe(false);
    await clickMenubarItem(page, '编辑', 'undo-btn');
    expect(await page.evaluate(() => getGapRemoveGaps())).toEqual(before.gaps);
    await clickMenubarItem(page, '编辑', 'redo-btn');
    expect(await page.evaluate(() => getGapRemoveGaps())).toMatchObject([{ start: 1000, end: 4000, removed: true, origins: expect.arrayContaining(['manual']) }]);
    const saved = await page.evaluate(() => JSON.parse(buildJson()));
    expect(saved.msw).toEqual(before.msw);
    expect(saved.multi_subtitle).toEqual(before.multi);
    expect(saved.segments).toEqual(before.segments);
    expect(saved.gap_remove.manual_corrections).toBe(true);
    expect(saved.gap_remove.provenance).toBeTruthy();
  });
}

test('settings remember the category across reload while search keeps LLM and TTS navigation', async ({ page }) => {
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await page.locator('.settings-nav-item[data-settings-category="environment"]').first().click();
  await expect(page.locator('.settings-nav-subitem').filter({ hasText: /^LLM$/ })).toBeVisible();
  await expect(page.locator('.settings-nav-subitem').filter({ hasText: /^TTS$/ })).toBeVisible();
  await page.locator('.settings-nav-item[data-settings-category="appearance"]').click();
  await page.locator('#editor-settings-search').fill('TTS');
  await expect(page.locator('[data-settings-category="environment"].settings-category')).toBeVisible();
  await page.locator('#editor-settings-close').click();
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await expect(page.locator('#editor-settings-search')).toHaveValue('');
  await expect(page.locator('.settings-nav-item[data-settings-category="appearance"]')).toHaveClass(/active/);
  await page.reload();
  await expect(page.locator('#editor-loading')).toBeHidden();
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await expect(page.locator('.settings-nav-item[data-settings-category="appearance"]')).toHaveAttribute('aria-current', 'true');
  const appearance = page.locator('.settings-nav-item[data-settings-category="appearance"]');
  await appearance.press('Home');
  await expect(page.locator('.settings-nav-item[data-settings-category="all"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#editor-settings-nav .settings-nav-item[aria-current="true"]')).toBeFocused();
});

test('unavailable settings categories fall back and reappear when available', async ({ page }) => {
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await page.locator('.settings-nav-item[data-settings-category="appearance"]').click();
  await page.locator('#editor-settings-close').click();
  await page.evaluate(() => document.querySelectorAll('[data-settings-category="appearance"] .editor-settings-sub-group').forEach(group => { group.hidden = true; }));
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await expect(page.locator('.settings-nav-item[data-settings-category="all"]')).toHaveClass(/active/);
  await expect(page.locator('.settings-nav-item[data-settings-category="appearance"]')).toHaveCount(0);
  await page.locator('#editor-settings-close').click();
  await page.evaluate(() => document.querySelectorAll('[data-settings-category="appearance"] .editor-settings-sub-group').forEach(group => { group.hidden = false; }));
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await expect(page.locator('.settings-nav-item[data-settings-category="appearance"]')).toBeVisible();
});

test('source export options cover every combination without changing voice or extension tracks', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const before = JSON.parse(buildJson());
    DATA.segments[0].sticker = { rel: '中文 图片.png', name: '中文 图片' };
    DATA.media_time_reference = { sample_rate: 48000, time_reference_samples: 480000 };
    const results = [];
    for (const gapRemoved of [false, true]) for (const stickers of [false, true]) for (const markers of [false, true]) for (const srt of [false, true]) {
      updateEditorSettings({ otioExportIncludeStickers: stickers, otioExportIncludeMarkers: markers, otioExportIncludeSrt: srt });
      const downloads = [];
      window.showSaveFilePicker = async ({ suggestedName }) => ({ createWritable: async () => ({
        write: async blob => downloads.push({ name: suggestedName, text: await blob.text() }), close: async () => {},
      }) });
      await exportSourceTimeline({ gapRemoved });
      const timeline = JSON.parse(downloads[0].text);
      const clips = timeline.tracks.children.flatMap(t => t.children).filter(c => c.OTIO_SCHEMA === 'Clip.2');
      results.push({ gapRemoved, stickers, markers, srt, files: downloads.length,
        stickerCount: clips.filter(c => c.metadata?.moy?.sticker_rel).length,
        markerCount: clips.reduce((n,c) => n + c.markers.length, 0),
        sourceStart: clips[0].source_range.start_time.value,
        srtText: downloads[1]?.text, expectedSrt: gapRemoved ? buildGapRemovedSrt() : buildSrt() });
    }
    const after = JSON.parse(buildJson());
    return { results, preserved: JSON.stringify(before.msw) === JSON.stringify(after.msw) && JSON.stringify(before.multi_subtitle) === JSON.stringify(after.multi_subtitle) };
  });
  expect(results.preserved).toBe(true);
  for (const row of results.results) {
    expect(row.files).toBe(row.srt ? 2 : 1);
    expect(row.stickerCount).toBe(row.stickers ? 1 : 0);
    expect(row.markerCount > 0).toBe(row.markers);
    expect(row.sourceStart).toBe(600);
    if (row.srt) expect(row.srtText.replace(/^\uFEFF/, '')).toBe(row.expectedSrt);
  }
});

test('OTIO menus synchronize persistent options and retain separate voiced export', async ({ page }) => {
  await clickMenubarItem(page, '文件', 'extra-export-btn');
  await page.locator('[aria-controls="extra-otio-menu"]').hover();
  const srt = page.locator('#extra-otio-menu [data-otio-export-option="srt"]');
  await expect(srt).toBeVisible();
  await srt.uncheck();
  await expect(srt).toBeVisible();
  await expect(page.locator('#gap-removed-otio-menu [data-otio-export-option="srt"]')).not.toBeChecked();
  await srt.focus();
  await page.keyboard.press('Space');
  await expect(srt).toBeChecked();
  await expect(srt).toBeFocused();
  await srt.uncheck();
  await expect(page.locator('#timeline-export-btn')).toContainText('含配音');
  await expect(page.locator('#download-otio')).toContainText('源媒体');
  await page.reload();
  await expect(page.locator('#editor-loading')).toBeHidden();
  expect(await page.locator('[data-otio-export-option="srt"]').evaluateAll(inputs => inputs.map(i => i.checked))).toEqual([false, false]);
});

for (const archive of [false, true]) {
  test(`source ${archive ? 'OTIOZ' : 'OTIO'} saves a consistent snapshot while the picker waits`, async ({ page }) => {
    const expected = await page.evaluate(() => {
      window.savedFiles = [];
      window.showSaveFilePicker = ({ suggestedName }) => new Promise(resolve => {
        const handle = { createWritable: async () => ({ write: async blob => window.savedFiles.push({ name: suggestedName, text: suggestedName.endsWith('.srt') ? await blob.text() : '', size: blob.size }), close: async () => {} }) };
        if (suggestedName.endsWith('.srt')) resolve(handle);
        else window.releasePicker = () => resolve(handle);
      });
      return { srt: buildGapRemovedSrt(), base: FILENAME_BASE };
    });
    const running = page.evaluate(value => exportSourceTimeline({ archive: value, gapRemoved: true }), archive);
    await page.waitForFunction(() => typeof window.releasePicker === 'function');
    await page.evaluate(() => {
      DATA.segments[0].text = 'edited while saving';
      DATA.segments[0].items = [{ start: 0, end: 1000, text: 'edited while saving' }];
      FILENAME_BASE = 'different-project';
      updateEditorSettings({ otioExportIncludeSrt: false });
      window.MSWE_I18N.applyLanguage('en');
      window.releasePicker();
    });
    expect(await running).toBe(true);
    const files = await page.evaluate(() => window.savedFiles);
    expect(files.map(f => f.name)).toEqual([`${expected.base}_去空隙.${archive ? 'otioz' : 'otio'}`, `${expected.base}_去空隙.srt`]);
    expect(files[0].size).toBeGreaterThan(0);
    expect(files[1].text.replace(/^\uFEFF/, '')).toBe(expected.srt);
  });
}

test('cancelled and failed main saves never trigger companion SRT; partial failures are reported', async ({ page }) => {
  for (const failure of ['AbortError', 'NotAllowedError']) {
    const result = await page.evaluate(async name => {
      let calls = 0;
      window.showSaveFilePicker = async () => { calls++; throw new DOMException('test', name); };
      return { saved: await exportSourceTimeline(), calls };
    }, failure);
    expect(result).toEqual({ saved: false, calls: 1 });
  }
  const result = await page.evaluate(async () => {
    let calls = 0;
    window.showSaveFilePicker = async () => {
      if (++calls === 2) throw new DOMException('cancel subtitle', 'AbortError');
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    };
    return { saved: await exportSourceTimeline(), calls };
  });
  expect(result).toEqual({ saved: true, calls: 2 });
  await expect(page.locator('#hint-stack')).toContainText('已取消附带 SRT');
});

test('source OTIOZ endpoint packs stickers and rejects missing images before starting a download', async ({ page }) => {
  const packed = await page.evaluate(async () => {
    DATA.segments[0].sticker = { rel: '中文 图片.png' };
    const timeline = JSON.parse(buildSourceOtio());
    const response = await fetch(SERVER_CONFIG.otiozTimelineExportUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestToken: SERVER_CONFIG.requestToken, kind: 'source', timeline }) });
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  });
  expect(packed.status).toBe(200);
  expect(Buffer.from(packed.bytes).includes(Buffer.from('media/中文 图片.png'))).toBe(true);
  const result = await page.evaluate(async () => {
    DATA.segments[0].sticker.rel = 'missing.png';
    let downloads = 0;
    window.showSaveFilePicker = async () => { downloads++; throw new DOMException('cancel', 'AbortError'); };
    return { saved: await exportSourceTimeline({ archive: true }), downloads };
  });
  expect(result).toEqual({ saved: false, downloads: 0 });
  await expect(page.locator('#hint-stack')).toContainText('表情包源文件不存在');
});

test('overlapping or unresolved stickers explain how to export source media alone', async ({ page }) => {
  const result = await page.evaluate(() => {
    DATA.segments[0].sticker = { rel: '中文 图片.png' };
    DATA.segments.push({ start: 500, end: 2000, text: 'overlap', sticker: { rel: '中文 图片.png' } });
    const overlap = buildSourceOtio();
    updateEditorSettings({ otioExportIncludeStickers: false });
    const alone = JSON.parse(buildSourceOtio());
    updateEditorSettings({ otioExportIncludeStickers: true });
    STICKER_ROOT = '';
    DATA.segments[0].sticker = { name: 'unresolved' };
    return { overlap, alone: alone.tracks.children.length, unresolved: buildSourceOtio() };
  });
  expect(result).toEqual({ overlap: null, alone: 1, unresolved: null });
  await expect(page.locator('#hint-stack')).toContainText('可关闭「时间线包含表情包」');
});

test('help inherits custom colors after settings close and page reload', async ({ page }) => {
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await page.locator('.settings-nav-item[data-settings-category="appearance"]').click();
  await page.waitForFunction(() => !appearanceBootPending);
  const persisted = page.waitForResponse(response => response.url().endsWith('/api/settings/appearance') && response.request().method() === 'POST' && response.ok());
  for (const [key, color] of [['raised', '#203040'], ['popup', '#304050']]) {
    await page.locator('#interface-color-' + key).evaluate((input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, color);
  }
  await persisted;
  await page.locator('#editor-settings-close').click();
  await page.reload();
  await expect(page.locator('#editor-loading')).toBeHidden();
  await clickMenubarItem(page, '帮助', 'help-basic');
  await expect(page.locator('#help-panel .help-tabs')).toHaveCSS('background-color', 'rgb(32, 48, 64)');
  expect(await page.locator('#help-panel').evaluate(el => getComputedStyle(el).getPropertyValue('--tab-overlay-bg').trim())).toBe('#304050');
});

for (const [preset, width, height] of [['default', 1024, 760], ['alice', 480, 520]]) {
  test(`vertical help fits ${preset} theme at ${width}x${height} and keeps guide replay`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
    await page.locator('.settings-nav-item[data-settings-category="appearance"]').click();
    await page.locator(`[data-theme-preset="${preset}"]`).click();
    await page.locator('#editor-settings-close').click();
    await clickMenubarItem(page, '帮助', 'help-basic');
    await expect(page.locator('#help-panel [role="tab"]')).toHaveCount(8);
    await expect(page.locator('#help-panel [role="tablist"]')).toHaveAttribute('aria-orientation', 'vertical');
    await page.locator('#help-tab-basic').press('End');
    await expect(page.locator('#help-tab-about')).toBeFocused();
    await expect(page.locator('#help-tab-panel-about')).toBeVisible();
    await page.locator('#help-tab-gap').click();
    await expect(page.locator('#help-tab-panel-gap')).toContainText('保留配音保护');
    const panel = await page.locator('#help-panel').boundingBox();
    const nav = await page.locator('#help-panel .help-tabs').boundingBox();
    const content = await page.locator('#help-panel .help-panel-body').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width + 1);
    expect(panel.y + panel.height).toBeLessThanOrEqual(height + 1);
    expect(content.x).toBeGreaterThanOrEqual(nav.x + nav.width - 1);
    await expect(page.locator('#help-panel .help-tabs')).toHaveCSS('overflow-y', 'auto');
    await expect(page.locator('#help-panel .help-panel-body')).toHaveCSS('overflow-y', 'auto');
    await page.screenshot({ path: testInfo.outputPath('help-layout.png') });
    await page.locator('#help-onboarding').click();
    await expect(page.locator('#onboarding-layer')).toBeVisible();
  });
}
