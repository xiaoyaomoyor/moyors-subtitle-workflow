import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { disableOnboarding, findFreePort, generateProjectJson, generateWav, makeTempDir, startServer } from './helpers.mjs';

let dir, server;
test.beforeAll(async () => {
  dir = makeTempDir('beta6-editor');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env');
  process.env.MSW_APP_DATA_ROOT = join(dir, 'app-data');
  const project = join(dir, 'test.mosp'), media = generateWav(join(dir, 'synthetic.wav'), 60);
  generateProjectJson(project);
  server = await startServer(project, media, await findFreePort());
});
test.afterAll(async () => { await server?.stop(); });
test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
  await page.addInitScript(() => { if (!localStorage.getItem('moy.asr.editor.settings.v1')) localStorage.setItem('moy.asr.editor.settings.v1', JSON.stringify({ autoSaveProject: false, pauseOnMouseClick: true })); });
  await page.goto(server.url);
  await expect(page.locator('#editor-loading')).not.toBeVisible();
});

for (const kind of ['main', 'extension', 'overlay', 'linked']) {
  test(`duplicate split preserves audio, clears timing and undoes once: ${kind}`, async ({ page }) => {
    const before = await page.evaluate((kind) => {
      const cue = (id, text) => ({ id, text, start: 1000, end: 3000, items: [{ text, start: 1000, end: 3000 }] });
      DATA.segments = [cue('one', '字'), { id: 'one-a', text: 'Reserved', start: 4000, end: 5000 }];
      DATA.multi_subtitle = { schema: 'moy.asr.multi_subtitle.v1', enabled: true, display_mode: 'both',
        tracks: [{ id: 'ext', role: 'extension', name: 'Secondary', language: 'English', split_mode: 'word', segments: [cue('two', 'Word')] }],
        bindings: kind === 'linked' ? [{ id: 'binding', track_id: 'ext', main_segment_ids: ['one'], extension_segment_ids: ['two'], start_offset_ms: 0, end_offset_ms: 0 }] : [] };
      DATA.overlay_track = { enabled: true, segments: [cue('three', '叠')] };
      normalizeMultiSubtitleState();
      const track = kind === 'extension' ? 'ext' : null;
      DATA.msw.assets = [{ id: 'audio-' + '1'.repeat(32), kind:'audio', job_id:'job',
        path:'msw-'+'2'.repeat(24)+'.assets/audio/audio-'+'1'.repeat(32)+'.wav',sha256:'3'.repeat(64),
        sample_rate:24000,sample_count:48000,channels:1,byte_size:96044,
        generation:{provider:'test',model:'test',voice:'test',language_type:'Auto',display_text:'test',spoken_text:'test'},
        source_ref: { key:'source', id: kind === 'extension' ? 'two' : kind === 'overlay' ? 'three' : 'one', track_id: track,
        ...(kind === 'overlay' ? { track_kind: 'overlay' } : {}), text: kind === 'extension' ? 'Word' : kind === 'overlay' ? '叠' : '字', start: 1000, end: 3000 } }];
      DATA.msw.audio_tracks = [{id:'voice',name:'Voice',gain_db:0,muted:false}];
      DATA.msw.audio_clips = [MSWAudio.create(DATA.msw.assets[0], 'voice', 1200, 'clip')];
      renderAll();
      const before = { main: JSON.stringify(DATA.segments), multi: JSON.stringify(DATA.multi_subtitle), overlay: JSON.stringify(DATA.overlay_track), msw: JSON.stringify(DATA.msw) };
      if (kind === 'main') openMainWaveformSplitModal(0, 2000);
      else if (kind === 'extension') openExtensionSplitModal(0, 2000);
      else if (kind === 'overlay') openOverlaySplitModal(0, 2000);
      else requestSubtitleSplit('main', 0, { timeMs: 2000, requireConfirm: true });
      return before;
    }, kind);
    await expect(page.locator('#multi-subtitle-split-duplicate')).toBeEnabled();
    await page.locator('#multi-subtitle-split-modal summary').click();
    await page.locator('#multi-subtitle-split-duplicate').click();
    const after = await page.evaluate(kind => {
      const cues = kind === 'extension' ? DATA.multi_subtitle.tracks[0].segments : kind === 'overlay' ? DATA.overlay_track.segments : DATA.segments;
      return { cues, msw: JSON.stringify(DATA.msw), stale: MSWAsr.assetStatuses(DATA).has(DATA.msw.assets[0].id), bindings: DATA.multi_subtitle.bindings };
    }, kind);
    expect(after.cues.slice(0, 2).map(cue => cue.text)).toEqual(kind === 'extension' ? ['Word', 'Word'] : kind === 'overlay' ? ['叠', '叠'] : ['字', '字']);
    expect(after.cues.slice(0, 2).every(cue => !cue.items?.length)).toBe(true);
    expect(new Set(after.cues.map(cue => cue.id)).size).toBe(after.cues.length);
    expect(after.msw).toBe(before.msw);
    expect(after.stale).toBe(true);
    if (kind === 'linked') expect(after.bindings).toHaveLength(2);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => JSON.stringify(DATA.segments))).toBe(before.main);
    expect(await page.evaluate(() => JSON.stringify(DATA.multi_subtitle))).toBe(before.multi);
    expect(await page.evaluate(() => MSWAsr.assetStatuses(DATA).has(DATA.msw.assets[0].id))).toBe(false);
  });
}

test('mouse seek pauses, modifier selection and internal seek keep playing; paused auto-play still starts', async ({ page }) => {
  await page.waitForFunction(() => player.readyState >= 2);
  await page.evaluate(async () => { updateEditorSettings({ clickBehavior: 'select-and-play' }); await player.play(); });
  await page.locator('#cues-container > .cue').nth(1).click({ modifiers: ['Control'] });
  expect(await page.evaluate(() => isPlaybackActive())).toBe(true);
  await page.evaluate(() => seekFromWaveform(5));
  expect(await page.evaluate(() => isPlaybackActive())).toBe(true);
  await page.locator('#cues-container > .cue').nth(2).click();
  await expect.poll(() => page.evaluate(() => isPlaybackActive())).toBe(false);
  await page.locator('#cues-container > .cue').nth(3).click();
  await expect.poll(() => page.evaluate(() => isPlaybackActive())).toBe(true);
});

test('speaker migration preserves old previews and explicit opt-out; new mapping links once and undo restores', async ({ page }) => {
  expect(await page.evaluate(() => speakerSettings().enabled)).toBe(false);
  const states = await page.evaluate(() => {
    const change = (id, value) => { const el = document.getElementById(id); el.checked = value; el.dispatchEvent(new Event('change', {bubbles:true})); };
    applyCanonicalProject(buildBlankProject(), 'new.mosp'); syncSpeakerControls();
    const initial = speakerSettings();
    change('speaker-mapping-enabled', true);
    const linked = speakerExportOptions();
    return {initial, linked};
  });
  expect(states.initial.enabled).toBe(true);
  expect(states.linked.speakerLabelsEnabled).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => speakerSettings().mapping_enabled)).toBe(false);
  expect(await page.evaluate(() => EDITOR_SETTINGS.exportSpeakerLabels)).toBe(false);
  await page.evaluate(() => {
    const change = (id, value) => { const el = document.getElementById(id); el.checked = value; el.dispatchEvent(new Event('change', {bubbles:true})); };
    change('speaker-mapping-enabled', true); change('export-speaker-labels', false);
    change('speaker-mapping-enabled', false); change('speaker-mapping-enabled', true);
  });
  expect(await page.evaluate(() => EDITOR_SETTINGS.exportSpeakerLabels)).toBe(false);
  await page.reload();
  expect(await page.evaluate(() => EDITOR_SETTINGS.exportSpeakerLabelsExplicit)).toBe(true);
  expect(await page.evaluate(() => EDITOR_SETTINGS.exportSpeakerLabels)).toBe(false);
});

test('mouse pause stops JKL reverse and survives deferred media seek', async ({page}) => {
  await page.waitForFunction(() => player.readyState >= 2);
  await page.evaluate(() => { player.currentTime=10; startJklReversePlayback(); });
  expect(await page.evaluate(() => jklReversePlaying)).toBe(true);
  await page.locator('#cues-container > .cue').nth(1).click();
  expect(await page.evaluate(() => jklReversePlaying)).toBe(false);
  expect(await page.evaluate(() => isPlaybackActive())).toBe(false);
  const pending=await page.evaluate(async () => {
    await player.play();
    Object.defineProperty(player,'readyState',{configurable:true,get:()=>0});
    Object.defineProperty(player,'seekable',{configurable:true,get:()=>({length:0})});
    seekWarned=false; seekFromWaveform(3,{mouseClick:true});
    return pendingMediaSeek;
  });
  expect(pending.pauseAfterSeek).toBe(true);
  await page.evaluate(() => { delete player.readyState; delete player.seekable; flushPendingMediaSeek(player); });
  await expect.poll(()=>page.evaluate(()=>player.paused)).toBe(true);
  expect(await page.evaluate(()=>player.currentTime)).toBeCloseTo(3,1);
});

test('secondary duplicate split keeps same-track color references at nonzero indexes', async ({page}) => {
  await page.evaluate(() => {
    const cues=Array.from({length:4},(_,i)=>({id:'s'+i,start:i*2000,end:i*2000+1800,text:'Word'}));
    cues[1].color={name:'red',start:2000,end:3800};
    cues[2].color={name:'blue',start:4000,end:7800};
    cues[3].color_ref={name:'blue',headIdx:2};
    DATA.multi_subtitle={schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',
      tracks:[{id:'sub',role:'extension',name:'Sub',split_mode:'word',segments:cues}],bindings:[]};
    normalizeMultiSubtitleState();renderAll();openExtensionSplitModal(1,2900);
  });
  await page.locator('#multi-subtitle-split-modal summary').click();
  await page.locator('#multi-subtitle-split-duplicate').click();
  const cues=await page.evaluate(()=>DATA.multi_subtitle.tracks[0].segments);
  expect(cues[2].color_ref.headIdx).toBe(1);
  expect(cues[4].color_ref.headIdx).toBe(3);
});

test('speaker-only ASS uses frozen export options and does not alter cue text', async ({ page }) => {
  const result = await page.evaluate(() => {
    updateEditorSettings({assMode:true,exportSpeakerLabels:true});
    DATA.segments = [{id:'test',start:0,end:2000,text:'Body: text',color:{name:'red',start:0,end:2000}}];
    setSubtitleAppearance({ass_color_style:'speaker',speaker_labels:{mapping_enabled:true,enabled:true,names:{red:'Name'},separator:': '}});
    setAssLibraryExports(true);
    renderAll();
    const frozen = MSWE.resolve('processing-host').exportProject();
    setSpeakerLabelSettings({mapping_enabled:true,enabled:true,names:{red:'Changed'}});
    const ass = AsrEditorUtils.buildAssPayload(frozen.segments,{assMode:true,appearance:frozen.preview.subtitle,
      speakerLabelsEnabled:frozen.preview.burn_speaker_labels.enabled,speakerLabels:frozen.preview.burn_speaker_labels.names,
      speakerLabelSeparator:frozen.preview.burn_speaker_labels.separator});
    return {frozen,ass,saved:JSON.parse(buildJson()),text:DATA.segments[0].text,selected:document.getElementById('ass-color-style').value};
  });
  expect(result.selected).toBe('speaker');
  expect(result.frozen.preview.burn_speaker_labels.names.red).toBe('Name');
  expect(result.saved.preview.burn_speaker_labels).toBeUndefined();
  expect(result.text).toBe('Body: text');
  expect(JSON.stringify(result.ass)).toContain('Name: ');
});

for (const [mode, seconds] of [['multi', 5], ['multi', 10], ['multi', 20], ['basic', 10]]) {
  test(`shared boundary preserves three audio layers and linked subtitles: ${mode} ${seconds}`, async ({page}) => {
    const before = await page.evaluate(({mode, seconds}) => {
      DATA.segments = [{id:'m1',start:1000,end:2000,text:'One'}, {id:'m2',start:2000,end:3000,text:'Two'}];
      DATA.multi_subtitle = {schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',
        tracks:[{id:'ext',role:'extension',name:'Secondary',language:'English',split_mode:'word',
          segments:DATA.segments.map((cue,i)=>({...cue,id:'s'+(i+1)}))}],
        bindings:[1,2].map(i=>({id:'b'+i,track_id:'ext',main_segment_ids:['m'+i],extension_segment_ids:['s'+i]}))};
      normalizeMultiSubtitleState();
      DATA.msw.assets = [{id:'audio-'+'1'.repeat(32),kind:'audio',job_id:'job',
        path:'msw-'+'2'.repeat(24)+'.assets/audio/audio-'+'1'.repeat(32)+'.wav',sha256:'3'.repeat(64),
        sample_rate:24000,sample_count:48000,channels:1,byte_size:96044,
        generation:{provider:'test',model:'test',voice:'test',language_type:'Auto',display_text:'test',spoken_text:'test'}}];
      DATA.msw.audio_tracks = [1,2,3].map(i=>({id:'voice'+i,name:'Voice '+i,gain_db:0,muted:false}));
      DATA.msw.audio_clips = [1,2,3].map(i=>MSWAudio.create(DATA.msw.assets[0],'voice'+i,1100+i*100,'clip'+i));
      updateEditorSettings({autoSnapAdjacentCues:true});
      waveformEditor.settings.mode=mode;waveformEditor.settings.secondsPerRow=seconds;
      renderAll();
      return JSON.stringify(DATA.msw.audio_clips);
    }, {mode,seconds});
    const handle=page.locator('.waveform-cue-block[data-track="main"][data-idx="0"] .waveform-cue-handle.right').first();
    await handle.scrollIntoViewIfNeeded();
    const box=await handle.boundingBox();
    const row=handle.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " waveform-row ")][1]');
    const rowBox=await row.boundingBox();
    const duration=Number(await row.getAttribute('data-end-ms'))-Number(await row.getAttribute('data-start-ms'));
    expect(box).not.toBeNull();expect(rowBox).not.toBeNull();expect(duration).toBeGreaterThan(0);
    const x=box.x+box.width-1,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x-rowBox.width*400/duration,y,{steps:5});await page.mouse.up();
    // Basic mode includes a sidebar; its drawable width differs from the row.
    // The contract here is shared boundaries, linked followers and intact clips.
    await expect.poll(()=>page.evaluate(()=>DATA.segments[0].end)).toBeLessThan(1900);
    const boundary=await page.evaluate(()=>DATA.segments[0].end);
    expect(boundary).toBeGreaterThan(1400);
    if(mode==='multi')expect(boundary).toBe(1600);
    expect(await page.evaluate(()=>DATA.segments[1].start)).toBe(boundary);
    expect(await page.evaluate(()=>DATA.multi_subtitle.tracks[0].segments.map(c=>[c.start,c.end]))).toEqual([[1000,boundary],[boundary,3000]]);
    expect(await page.evaluate(()=>JSON.stringify(DATA.msw.audio_clips))).toBe(before);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(()=>DATA.segments.map(c=>[c.start,c.end]))).toEqual([[1000,2000],[2000,3000]]);
    expect(await page.evaluate(()=>JSON.stringify(DATA.msw.audio_clips))).toBe(before);
  });
}
