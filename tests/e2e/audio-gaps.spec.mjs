import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DURATION_MS, cleanupTempDir, findFreePort, generateProjectJson, generateWav, makeTempDir, startServer, startBlankServer, clickMenubarItem } from './helpers.mjs';

let tempDir, server;
test.beforeAll(async () => {
  tempDir = makeTempDir('audio-gaps');
  const media = join(tempDir, 'synthetic.wav'), project = join(tempDir, 'project.json');
  generateWav(media, DURATION_MS / 1000); generateProjectJson(project);
  server = await startServer(project, media, await findFreePort());
});
test.afterAll(async () => { await server?.stop(); cleanupTempDir(tempDir); });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('moy.asr.editor.settings.v1', JSON.stringify({autoSaveProject: false})));
  await page.goto(server.url);
  await expect(page.locator('.waveform-row').first()).toBeVisible();
});
const open = page => clickMenubarItem(page, '媒体', 'gap-remove-manage');
const shape = page => page.evaluate(() => getGapRemoveGaps().map(({start, end, removed}) => ({start, end, removed})));
async function deterministicWave(page) {
  await page.evaluate(() => {
    const peaks = new Int8Array(80); // 4 s, sounding before 1 s and after 3 s.
    for (let i = 0; i < 40; i++) if (i < 10 || i >= 30) { peaks[i * 2] = -100; peaks[i * 2 + 1] = 100; }
    waveformEditor.getGapRemoveDetectionData = () => ({peaks, peaks_per_second: 10, duration_ms: 4000});
    updateGapRemoveUi();
  });
}

test('compact panel, shared help, conditional settings and narrow layout', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page);
  await expect(page.locator('#gap-remove-panel-title')).toContainText('音频空隙');
  await expect(page.locator('#gap-remove-list')).toHaveText('尚未生成标记');
  await expect(page.locator('#gap-remove-advanced-body')).toBeHidden();
  await expect(page.locator('#gap-remove-disable-body')).toBeHidden();
  await expect(page.locator('#gap-remove-shrink')).toHaveCount(0);
  await page.locator('#gap-remove-panel-title .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('不改写原媒体');
  await page.keyboard.press('Escape');
  await expect(page.locator('#gap-remove-panel')).toBeVisible();
  await page.locator('#gap-remove-source').selectOption('subtitle_outside');
  await expect(page.locator('#gap-remove-audio-fields')).toBeHidden();
  await expect(page.locator('#gap-remove-advanced-section')).toBeHidden();
  await expect(page.locator('#gap-remove-lead-in')).toBeVisible();
  await page.locator('#gap-remove-source').selectOption('audio_gate');
  await page.locator('#gap-remove-advanced-toggle').click();
  await page.locator('#gap-remove-disable-toggle').click();
  await expect(page.locator('#gap-remove-clear-all')).toBeInViewport();
  await page.screenshot({path: info.outputPath('audio-gaps-dark.png'), animations: 'disabled'});
  await page.evaluate(() => { updateEditorSettings({themePreset:'alice', colors:null}); applyThemeAndColors(); });
  await expect(page.locator('#gap-remove-scan')).toHaveCSS('background-color', 'rgb(209, 183, 10)');
  const lightBase = await page.evaluate(() => {
    const sample = document.createElement('span');
    sample.style.backgroundColor = 'var(--bg-base)'; document.body.appendChild(sample);
    const color = getComputedStyle(sample).backgroundColor; sample.remove(); return color;
  });
  await expect(page.locator('#gap-remove-advanced-toggle')).toHaveCSS('background-color', lightBase);
  await page.screenshot({path: info.outputPath('audio-gaps-light.png'), animations: 'disabled'});
  await page.setViewportSize({width: 390, height: 620});
  await expect(page.locator('#gap-remove-clear-all')).toBeInViewport();
  expect(await page.locator('#gap-remove-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  await page.locator('#gap-remove-panel .gap-remove-panel-body').evaluate(el => el.scrollTop = el.scrollHeight);
  await expect(page.locator('#gap-remove-disable-button')).toBeVisible();
  await page.screenshot({path: info.outputPath('audio-gaps-narrow.png'), animations: 'disabled'});
  expect(errors).toEqual([]);
});

test('summary and subtitle filtering use the same dubbing-protected ranges as playback and export', async ({ page }) => {
  await page.evaluate(() => {
    DATA.msw = {schema:'msw.editor.v1',project_id:'gap-protection',
      assets:[{id:'audio-'+ 'a'.repeat(32),kind:'audio',sample_rate:8000,sample_count:8000,channels:1,byte_size:16044,
        path:'msw-'+ 'b'.repeat(24)+'.assets/audio/audio-'+ 'a'.repeat(32)+'.wav',sha256:'c'.repeat(64),job_id:'test',
        source_ref:{key:'kept',id:'kept',text:'protected',start:2000,end:3000,track_id:null},
        generation:{provider:'test',model:'test',voice:'test',language_type:'Auto',display_text:'protected',spoken_text:'protected'}}],
      audio_tracks:[{id:'voice',name:'配音',gain_db:0,muted:false}],
      audio_clips:[{id:'voice-1',asset_id:'audio-'+ 'a'.repeat(32),label:'test',track_id:'voice',start_ms:2000,source_in_sample:0,source_out_sample:8000,playback_rate:1,gain_db:0,muted:false}],
      audio_settings:{gap_policy:'protect'}};
    DATA.segments = [{id:'kept',start:2000,end:3000,text:'protected',items:[]}, {id:'cut',start:1000,end:2000,text:'remove',items:[]}];
    setGapRemoveData({gaps:[{start:1000,end:4000,removed:true}]});
    renderAll({waveform:'full'});
  });
  await open(page); await page.locator('#gap-remove-disable-toggle').click();
  expect(await page.evaluate(() => gapRemoveStats())).toEqual({count:1,total:2000,protectedMs:1000});
  await expect(page.locator('#gap-remove-list')).toHaveText('已标记 1 段 · 实际可缩短 2 s');
  await expect(page.locator('#gap-remove-protection')).toBeVisible();
  await page.locator('#gap-remove-protection .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('配音保护'); await page.keyboard.press('Escape');
  expect(await page.evaluate(() => getRemovedGapRanges())).toEqual([{start:1000,end:2000},{start:3000,end:4000}]);
  expect(await page.evaluate(() => window.MSWE.resolve('processing-host').audioPlaybackSkip(2200))).toBeNull();
  await expect(page.locator('.waveform-gap-block').first()).toHaveAttribute('title', /配音保护：保留 1.000 秒/);
  await expect(page.locator('#gap-remove-disable-button')).toHaveText('禁用符合条件的字幕（1）');
  await page.locator('#gap-remove-disable-button').click();
  expect(await page.evaluate(() => DATA.segments.filter(s => s.disabled).map(s => s.id))).toEqual(['cut']);
  await page.evaluate(() => performUndo());
  expect(await page.evaluate(() => DATA.segments.filter(s => s.disabled).map(s => s.id))).toEqual([]);
});

test('English panel keeps help and subsecond statistics concise', async ({ page }) => {
  await page.evaluate(() => { setGapRemoveData({gaps:[{start:1000,end:1250,removed:true}]}); window.MSWE_I18N.applyLanguage('en'); });
  await page.evaluate(() => openGapRemovePanel());
  await expect(page.locator('#gap-remove-panel-title')).toContainText('Audio gaps');
  await expect(page.locator('#gap-remove-list')).toHaveText('1 marked ranges · Removable 0.25 s');
  await page.locator('#gap-remove-panel-title .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('do not change the original media');
  await page.keyboard.press('Escape');
  await expect(page.locator('#gap-remove-clear-all')).toBeInViewport();
});

test('blank server and portable editor explain missing media without reporting a failed scan', async ({ page }) => {
  const blank = await startBlankServer(await findFreePort(), join(tempDir, 'blank-settings'));
  try {
    for (const url of [blank.url, pathToFileURL(join(process.cwd(), 'blank-editor.html')).href]) {
      await page.goto(url);
      await page.evaluate(() => openGapRemovePanel());
      await expect(page.locator('#gap-remove-list')).toHaveText('请先加载媒体');
      await expect(page.locator('#gap-remove-scan')).toBeDisabled();
      await page.locator('#gap-remove-source').selectOption('subtitle_outside');
      await expect(page.locator('#gap-remove-scan')).toBeDisabled();
      await expect(page.locator('#gap-remove-clear-all')).toBeInViewport();
    }
  } finally { await blank.stop(); }
});

test('zero padding and repeated generation are deterministic and preserve retained markers', async ({ page }) => {
  await deterministicWave(page); await open(page);
  for (const id of ['gap-remove-lead-in', 'gap-remove-lead-out']) { await page.locator(`#${id}`).fill('0'); await page.locator(`#${id}`).press('Tab'); }
  await page.locator('#gap-remove-scan').click();
  await expect.poll(() => shape(page)).toEqual([{start: 1000, end: 3000, removed: true}]);
  await page.evaluate(() => {
    const state = getGapRemoveData(true), core = window.AsrGapRemoveCore;
    const provenance = core.replaceGapRemoveProvenanceSource(state.provenance, 'subtitle_outside', [{start: 5000, end: 6000}]);
    setGapRemoveData(state, {provenance}); applyManualGapRange(1400, 1700, false);
  });
  await page.locator('#gap-remove-lead-in').fill('100'); await page.locator('#gap-remove-lead-in').press('Tab');
  await page.locator('#gap-remove-lead-out').fill('200'); await page.locator('#gap-remove-lead-out').press('Tab');
  await page.locator('#gap-remove-scan').click();
  const expected = [{start:1100,end:1400,removed:true},{start:1400,end:1700,removed:true},{start:1700,end:2800,removed:true}];
  await expect.poll(() => shape(page)).toEqual(expected);
  await page.locator('#gap-remove-scan').click(); await expect.poll(() => shape(page)).toEqual(expected);
  await page.evaluate(() => { DATA.gap_remove = JSON.parse(JSON.stringify(DATA.gap_remove)); updateGapRemoveUi(); });
  expect(await shape(page)).toEqual(expected);
  await expect(page.locator('.waveform-gap-block > .waveform-gap-label')).toHaveCount(0);
  await expect(page.locator('.waveform-gap-block').first()).toHaveAttribute('aria-label', /非保留空隙/s);
});

test('both clear entries perform the same undoable action without a dialog', async ({ page }) => {
  await deterministicWave(page); await open(page);
  await page.locator('#gap-remove-scan').click(); await expect(page.locator('#gap-remove-scan')).toHaveText('重新生成');
  const before = await shape(page); let dialogs = 0;
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
  await page.locator('#gap-remove-clear-all').click();
  await expect(page.locator('#gap-remove-list')).toHaveText('已清空标记，可撤销恢复');
  expect(await shape(page)).toEqual([]);
  await page.evaluate(() => performUndo()); expect(await shape(page)).toEqual(before);
  await page.evaluate(() => performRedo()); expect(await shape(page)).toEqual([]);
  await page.evaluate(() => performUndo());
  await clickMenubarItem(page, '媒体', 'gap-clear-all-menu'); expect(await shape(page)).toEqual([]);
  await page.evaluate(() => performUndo()); expect(await shape(page)).toEqual(before);
  expect(dialogs).toBe(0);
});

test('independent operation checkboxes and menu playback toggle stay in sync through undo', async ({ page }) => {
  await open(page);
  await page.locator('#gap-remove-middle').check();
  expect(await page.evaluate(() => getGapRemoveOperationMode())).toBe('boundary_and_middle');
  await page.locator('#gap-remove-boundary').uncheck();
  expect(await page.evaluate(() => getGapRemoveOperationMode())).toBe('middle_drag');
  await page.evaluate(() => performUndo()); await expect(page.locator('#gap-remove-boundary')).toBeChecked();
  await page.locator('#gap-remove-panel-skip').uncheck(); await expect(page.locator('#gap-skip-playback')).not.toBeChecked();
  await page.evaluate(() => performUndo()); await expect(page.locator('#gap-remove-panel-skip')).toBeChecked();
});

test('subtitle-outside regeneration replaces all unretained sources including a valid empty result', async ({ page }) => {
  await deterministicWave(page); await open(page);
  await page.locator('#gap-remove-scan').click(); await expect(page.locator('#gap-remove-scan')).toHaveText('重新生成');
  expect(await page.evaluate(() => DATA.gap_remove.provenance.sources.audio_gate.length)).toBeGreaterThan(0);
  await page.locator('#gap-remove-source').selectOption('subtitle_outside');
  await page.locator('#gap-remove-scan').click(); await expect(page.locator('#gap-remove-scan')).toHaveText('重新生成');
  expect(await page.evaluate(() => DATA.gap_remove.provenance.sources.subtitle_outside.length)).toBeGreaterThan(0);
  await page.evaluate(() => { DATA.segments = [{id:'full',start:0,end:gapRemoveMediaDurationMs(),text:'full',items:[]}]; });
  await page.locator('#gap-remove-scan').click();
  await expect.poll(() => page.evaluate(() => DATA.gap_remove.provenance.sources.subtitle_outside.length)).toBe(0);
  expect(await page.evaluate(() => DATA.gap_remove.provenance.sources.audio_gate)).toEqual([]);
  await page.evaluate(() => { setGapRemoveData({...getGapRemoveData(true), provenance:window.AsrGapRemoveCore.normalizeGapRemoveProvenance(null,[])}); });
  await expect(page.locator('#gap-remove-list')).toHaveText('没有符合当前条件的区段');
});
