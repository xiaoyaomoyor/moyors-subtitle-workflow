import {test, expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, startServer, clickMenubarItem} from './helpers.mjs';

let server;
test.beforeAll(async () => {
  const dir = makeTempDir('gap-reference-tracks'), media = generateWav(join(dir, 'media.wav'), 10), project = join(dir, 'test.mosp');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(dir, 'app-data');
  writeFileSync(process.env.MAW_ENV_FILE, '');
  writeFileSync(project, JSON.stringify({media, segments:[{start:0,end:1000,text:'Source'}], waveform:generateWaveformPayload(10000)}));
  server = await startServer(project, media, await findFreePort());
});
test.afterAll(async () => server?.stop());
test.beforeEach(async ({page}) => {
  await disableOnboarding(page);
  await page.addInitScript(() => localStorage.setItem('moy.asr.editor.settings.v1', JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url); await expect(page.locator('#editor-loading')).not.toBeVisible();
  await page.evaluate(waveform => {
    const p = JSON.parse(buildJson()), base = p.subtitles.tracks[0];
    p.waveform = waveform;
    p.subtitles.tracks = [{...base,id:'one',display_number:1}, {...base,id:'two',display_number:1,secondary_for:'one'},
      {...base,id:'three',display_number:2,enabled:false,collapsed:true}, {...base,id:'empty',display_number:3}];
    p.subtitles.next_track_number = 4;
    p.subtitles.cues = [{id:'a',track_id:'one',content:{start:500,end:2000,text:'First track',items:[]}},
      {id:'b',track_id:'two',content:{start:700,end:2200,text:'Bound translation',items:[]}},
      {id:'c',track_id:'three',content:{start:4000,end:5000,text:'Another track',items:[],disabled:true}}];
    p.subtitles.bindings = [{id:'pair',source_id:'a',target_id:'b',start_offset_ms:200,end_offset_ms:200}];
    p.subtitle_view.secondary_cue_ids = ['b','c'];
    p.gap_remove = {generation_mode:'subtitle_outside',lead_in_ms:0,lead_out_ms:0,retention_mode:'locked',
      retained_ranges:[{start:1200,end:1500}],gaps:[{start:1200,end:1500},{start:8000,end:9000}]};
    applyCanonicalProject(p, 'gap-tracks.mosp');
  }, generateWaveformPayload(10000));
});
const open = page => clickMenubarItem(page, '媒体', 'gap-remove-manage');
const shape = page => page.evaluate(() => getGapRemoveGaps().map(({start,end,retained}) => [start,end,retained]));

test('physical reference tracks ignore columns, disabled state and folding; settings alone preserve markers', async ({page}, info) => {
  const original = await shape(page); await open(page);
  await expect(page.locator('#gap-reference-caption')).toHaveText('参考轨道 · S1主');
  await page.locator('#gap-reference-picker summary').click();
  await page.locator('#gap-reference-choices input[value="two"]').check();
  await page.locator('#gap-reference-choices input[value="three"]').check();
  await page.locator('#gap-reference-choices input[value="one"]').uncheck();
  expect(await shape(page)).toEqual(original);
  expect(await page.evaluate(() => ({problem:gapReferenceProblem(),duration:gapRemoveMediaDurationMs(),
    tracks:gapSubtitleTracks().map(t => [t.id,t.cues.length]),ids:gapReferenceScope().ids}))).toEqual({
    problem:'',duration:10000,tracks:[['one',1],['two',1],['three',1],['empty',0]],ids:['two','three']});
  expect(await page.evaluate(() => ({disabled:gapRemoveScanButton.disabled, generating:gapRemoveGenerating,
    source:gapRemoveSource.value, state:getGapRemoveData().generation_mode}))).toEqual({disabled:false,generating:false,source:'subtitle_outside',state:'subtitle_outside'});
  await page.locator('#gap-remove-scan').click();
  const expected = [[0,700,false],[1200,1500,true],[2200,4000,false],[5000,10000,false]];
  await expect.poll(() => shape(page)).toEqual(expected);
  const saved = await page.evaluate(() => JSON.parse(buildJson()));
  expect(saved.gap_remove.reference_track_ids).toEqual(['two','three']);
  await page.evaluate(() => productionCommitProject(MSWProductionProject.swapColumns(DATA),'Swap list',[],{displayOnly:true}));
  await page.locator('#gap-remove-scan').click(); expect(await shape(page)).toEqual(expected);
  await page.evaluate(({p,waveform}) => applyCanonicalProject({...p,waveform}, 'roundtrip.mosp'), {p:saved,waveform:generateWaveformPayload(10000)});
  await expect(page.locator('#gap-reference-choices input[value="two"]')).toBeChecked();
  expect(await shape(page)).toEqual(expected);
  await expect(page.locator('#gap-remove-panel')).toHaveCSS('opacity','1');
  await page.screenshot({path:info.outputPath('references-dark.png'),animations:'disabled'});
});

test('quick action uses saved references and zero padding, preserves fixed marks and undoes once', async ({page}) => {
  await page.evaluate(() => setGapRemoveData({...getGapRemoveData(), reference_track_ids:['two'],generation_mode:'audio_gate',lead_in_ms:120,lead_out_ms:80}));
  const before = await shape(page);
  await clickMenubarItem(page, '媒体', 'non-subtitle-gap-apply');
  await expect(page.locator('#gap-remove-panel')).toBeHidden();
  expect(await shape(page)).toEqual([[0,700,false],[1200,1500,true],[2200,10000,false]]);
  expect(await page.evaluate(() => [getGapRemoveData().generation_mode,getGapRemoveData().lead_in_ms,getGapRemoveData().lead_out_ms])).toEqual(['audio_gate',120,80]);
  await page.evaluate(() => performUndo()); expect(await shape(page)).toEqual(before);
  await page.evaluate(() => performRedo()); expect(await shape(page)).toHaveLength(3);
});

test('empty and deleted references block generation and quick actions without replacing markers', async ({page}) => {
  await open(page); const before = await shape(page);
  for (const [ids, message] of [[[], '请选择至少一条参考轨道'], [['empty'], '参考轨道在媒体范围内没有字幕'], [['deleted'], '参考轨道已删除，请重新选择']]) {
    await page.evaluate(ids => setGapRemoveData({...getGapRemoveData(),reference_track_ids:ids}), ids);
    await expect(page.locator('#gap-reference-status')).toHaveText(message);
    await expect(page.locator('#gap-remove-scan')).toBeDisabled();
    await page.locator('#non-subtitle-gap-apply').evaluate(node => node.click());
    expect(await shape(page)).toEqual(before);
  }
  await page.evaluate(() => {
    setGapRemoveData({...getGapRemoveData(),reference_track_ids:['three']});
    const p = MSWProductionProject.toProject(DATA);
    p.subtitles.cues = p.subtitles.cues.filter(c => c.track_id !== 'three');
    p.subtitles.tracks = p.subtitles.tracks.filter(t => t.id !== 'three');
    p.subtitle_view.secondary_cue_ids = ['b'];
    productionCommitProject(p,'Delete reference track');
  });
  await expect(page.locator('#gap-reference-status')).toHaveText('参考轨道已删除，请重新选择');
  await expect(page.locator('#gap-remove-scan')).toBeDisabled(); expect(await shape(page)).toEqual(before);
});

test('subtitle processing targets real tracks, follows bindings symmetrically and undoes atomically', async ({page}) => {
  await page.evaluate(() => setGapRemoveData({gaps:[{start:600,end:2300}],disable_track_id:'two',disable_linked:true,disable_coverage_percent:80,disable_remaining_ms:300}));
  await open(page); await page.locator('#gap-remove-disable-toggle').click();
  await expect(page.locator('#gap-remove-disable-button')).toHaveText('禁用符合条件的字幕（2）');
  const disabled = () => page.evaluate(() => MSWProductionProject.toProject(DATA).subtitles.cues.filter(c => c.content.disabled).map(c => c.id).sort());
  await page.locator('#gap-remove-disable-button').click(); expect(await disabled()).toEqual(['a','b','c']);
  await page.evaluate(() => performUndo()); expect(await disabled()).toEqual(['c']);
  await page.locator('#gap-disable-linked').uncheck();
  await expect(page.locator('#gap-remove-disable-button')).toHaveText('禁用符合条件的字幕（1）');
  await page.locator('#gap-remove-disable-button').click(); expect(await disabled()).toEqual(['b','c']);
  await page.evaluate(() => performUndo());
  await page.locator('#gap-disable-linked').check();
  await page.evaluate(() => fixedUpdateTrack('one', {locked:true}));
  await expect(page.locator('#gap-remove-disable-button')).toBeDisabled();
  await page.locator('#gap-disable-linked').uncheck();
  await expect(page.locator('#gap-remove-disable-button')).toBeEnabled();
  await page.evaluate(() => productionCommitProject(MSWProductionProject.swapColumns(DATA),'Swap list',[],{displayOnly:true}));
  await page.locator('#gap-remove-disable-button').click(); expect(await disabled()).toEqual(['b','c']);
  const saved = await page.evaluate(() => JSON.parse(buildJson()).gap_remove);
  expect(saved.disable_track_id).toBe('two'); expect(saved.disable_linked).toBe(false);
});

test('narrow light panel and English help use the shared UI without clipping', async ({page}, info) => {
  await page.setViewportSize({width:720,height:720});
  await page.evaluate(() => {updateEditorSettings({themePreset:'alice',colors:null});applyThemeAndColors();});
  await open(page); await page.locator('#gap-reference-picker summary').click();
  await page.locator('#gap-reference-picker .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('禁用或折叠');
  await page.keyboard.press('Escape');
  await page.evaluate(() => MSWE_I18N.applyLanguage('en'));
  await expect(page.locator('#gap-reference-caption')).toHaveText('Reference tracks · S1主');
  await page.locator('#gap-reference-picker .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('disabled');
  await page.keyboard.press('Escape');
  await expect(page.locator('#gap-remove-clear-all')).toBeInViewport();
  expect(await page.locator('#gap-remove-panel').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({path:info.outputPath('references-light-english.png'),animations:'disabled'});
});
