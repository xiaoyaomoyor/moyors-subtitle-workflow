import {test,expect} from '@playwright/test';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,makeTempDir,startServer,generateWav,toggleEditorSettings} from './helpers.mjs';
let root,server,projectPath,mediaPath;
test.beforeEach(async({page})=>{
  root=makeTempDir('beta3-cd');mediaPath=join(root,'source.wav');generateWav(mediaPath,3);
  projectPath=join(root,'sample.mosp');
  writeFileSync(projectPath,JSON.stringify({media:mediaPath,segments:[{id:'cue-a',start:0,end:1000,text:'Hello',color:{name:'red',start:0,end:1000}}],msw:{schema:'msw.editor.v1',project_id:'beta3-cd'}}));
  process.env.MAW_ENV_FILE=join(root,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(root,'app-data');
  writeFileSync(process.env.MAW_ENV_FILE,'VOLC_API_KEY=synthetic\nMAW_OPENAI_ASR_API_KEY=synthetic\n');
  server=await startServer(projectPath,mediaPath,await findFreePort());await disableOnboarding(page);
  await page.goto(server.url);await expect(page.locator('.cue')).toHaveCount(1);
  await page.evaluate(()=>updateEditorSettings({autoSaveProject:false}));
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();});

test('speaker settings preview and SRT are undoable and leave source text untouched',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await toggleEditorSettings(page);await page.locator('.settings-nav-item[data-settings-category="subtitle-speakers"]').click();
  await page.locator('#speaker-mapping-enabled').check();await page.locator('#speaker-preview-enabled').check();
  await page.locator('[data-speaker-name="red"]').fill('Alice');await page.locator('[data-speaker-name="red"]').press('Tab');
  await page.locator('#export-speaker-labels').check();await page.locator('#subtitle-color-style').selectOption('text');
  await page.evaluate(()=>{player.currentTime=.2;update();});
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Hello');
  expect(await page.evaluate(()=>buildSrt())).toContain('Alice：Hello');
  await expect(page.locator('#overlay-main-text')).toContainText('Alice');
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.preview.subtitle.color_style)).not.toBe('text');
  await page.screenshot({path:join(root,'speakers.png'),fullPage:true});expect(errors).toEqual([]);
});

test('disk version preserves dirty edits without saving and restores an unsaved copy',async({page})=>{
  const before=readFileSync(projectPath,'utf8');
  await page.evaluate(()=>{DATA.segments[0].text='Unsaved version';DATA.segments[0]._dirty=true;renderAll();});
  await toggleEditorSettings(page);await page.locator('.settings-nav-item[data-settings-category="save"]').click();
  await page.locator('#project-version-create').click();await expect(page.locator('#project-version-status')).toContainText('磁盘版本已创建');
  expect(readFileSync(projectPath,'utf8')).toBe(before);expect(await page.evaluate(()=>hasUnsavedProjectChanges())).toBe(true);
  await page.locator('#project-version-list').click();await expect(page.locator('#project-recovery-list button')).toHaveCount(1);
  await page.locator('#project-recovery-list button').click();await expect(page.locator('#project-recovery-modal')).not.toHaveClass(/show/);
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Unsaved version');
  expect(await page.evaluate(()=>SERVER_CONFIG.canSave)).toBe(false);expect(readFileSync(projectPath,'utf8')).toBe(before);
});

test('Doubao resource hotwords and OpenAI diarize settings reach server recipes',async({page})=>{
  await page.evaluate(()=>MSWE.resolve('asr').open());
  await expect(page.locator('#msw-asr-providerId option[value="doubao"]')).toHaveCount(1);
  await page.locator('#msw-asr-providerId').selectOption('doubao');await page.locator('#msw-asr-modelId').selectOption('volc.bigasr.auc_idle');
  await page.locator('#msw-asr-settings details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;}));
  await page.locator('#msw-asr-doubaoHotwords').fill('MSW\nSubtitle');await page.locator('#msw-asr-save-settings').click();
  await expect(page.locator('#msw-asr-message')).toContainText('识别设置已保存');
  await page.locator('#msw-asr-providerId').selectOption('openai');await page.locator('#msw-asr-modelId').selectOption('gpt-4o-transcribe');
  await expect(page.locator('#msw-asr-openaiHint')).toContainText('没有可靠');await expect(page.locator('#msw-asr-start')).toBeDisabled();
  await page.locator('#msw-asr-modelId').selectOption('gpt-4o-transcribe-diarize');await expect(page.locator('#msw-asr-openaiDiarize')).toBeChecked();
  await expect(page.locator('#msw-asr-openaiPrompt')).toBeHidden();await page.locator('#msw-asr-save-settings').click();
  await expect(page.locator('#msw-asr-message')).toContainText('识别设置已保存');
  await page.locator('#msw-asr-modelId').selectOption('whisper-1');
  await page.locator('#msw-asr-openaiKeywords').evaluate(node=>{node.value='stale hidden keywords';});
  await page.locator('#msw-asr-save-settings').click();
  await expect(page.locator('#msw-asr-message')).toContainText('识别设置已保存');
});

test('clicking an open processing panel brings it above settings with modal tier preserved',async({page})=>{
  await page.evaluate(()=>MSWE.resolve('asr').open());await toggleEditorSettings(page);
  await page.locator('#msw-asr-panel').dispatchEvent('pointerdown',{button:0});
  const levels=await page.evaluate(()=>['msw-asr-panel','editor-settings-modal','sticker-root-modal'].map(id=>Number(getComputedStyle(document.getElementById(id)).zIndex)));
  expect(levels[0]).toBeGreaterThan(levels[1]);expect(levels[2]).toBeGreaterThan(levels[0]);
});

test('track swap preserves groups and bindings with a single undo and hides disabled extension controls',async({page})=>{
  const before=await page.evaluate(()=>{
    DATA.multi_subtitle={enabled:true,tracks:[{id:'ext',language:'en',segments:[{id:'x',start:0,end:500,text:'One'},{id:'y',start:500,end:1000,text:'Two'}]}],
      bindings:[{id:'bind',track_id:'ext',main_segment_ids:['cue-a'],extension_segment_ids:['x','y']}]};
    renderAll();return JSON.stringify({segments:DATA.segments,multi:DATA.multi_subtitle});
  });
  expect(await page.evaluate(()=>swapMainAndExtensionSubtitles())).toBe(true);
  expect(await page.evaluate(()=>DATA.segments.map(s=>MULTI_SUBTITLE_UTILS.effectiveColorName(s,DATA.segments)))).toEqual(['red','red']);
  expect(await page.evaluate(()=>DATA.multi_subtitle.bindings[0].main_segment_ids)).toEqual(['x','y']);
  await page.evaluate(()=>performUndo());
  const restored=await page.evaluate(()=>({ids:DATA.segments.map(s=>s.id),bound:DATA.multi_subtitle.bindings[0].main_segment_ids}));
  expect(restored).toEqual({ids:['cue-a'],bound:['cue-a']});expect(before).toContain('cue-a');
  await page.evaluate(()=>{DATA.multi_subtitle.enabled=false;renderAll();});
  await expect(page.locator('#multi-subtitle-extension-language-mode')).toBeHidden();
  expect(await page.evaluate(()=>DATA.multi_subtitle.tracks[0].segments.length)).toBe(2);
});

test('onboarding completion survives a different server port and can be replayed',async({page,browser})=>{
  await expect.poll(()=>page.evaluate(async()=>{const c=SERVER_CONFIG;return (await(await fetch(c.processingUrl+'/onboarding-status',{headers:{'X-MSW-Token':c.requestToken}})).json()).status;})).toBe('completed');
  const another=await startServer(projectPath,mediaPath,await findFreePort());
  const context=await browser.newContext(),other=await context.newPage();
  try{
    await other.goto(another.url);await expect(other.locator('.cue')).toHaveCount(1);
    await expect(other.locator('#onboarding-layer')).toBeHidden();
    await other.locator('#help-onboarding').dispatchEvent('click');
    await expect(other.locator('#onboarding-layer')).toBeVisible();
    await other.keyboard.press('Escape');await expect(other.locator('#onboarding-layer')).toBeHidden();
  }finally{await context.close();await another.stop();}
});

test('gap movement and boundary adjustment ignore two-pixel motion and support undo',async({page})=>{
  await page.evaluate(()=>{
    DATA.segments=[];waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=3;
    DATA.gap_remove={schema:'moy.asr.gap_remove.v1',detector:'audio_gate',minimum_ms:400,threshold_db:-28,hysteresis_db:2,lead_in_ms:0,lead_out_ms:0,
      skip_playback:true,operation_mode:'boundary_and_middle',gaps:[{start:500,end:1200,removed:true,source:'manual'}]};
    updateGapRemoveUi();renderAll({waveform:'full'});
  });
  const read=()=>page.evaluate(()=>DATA.gap_remove.gaps.map(({start,end,removed})=>({start,end,removed})));
  const before=await read();
  const block=page.locator('.waveform-gap-block').first();await expect(block).toBeVisible();
  for(const target of [block,block.locator('.waveform-gap-handle.left')]){
    const box=await target.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+2,y);await page.mouse.up();
    expect(await read()).toEqual(before);
  }
  const handle=await block.locator('.waveform-gap-handle.left').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+30,handle.y+handle.height/2);await page.mouse.up();
  expect(await read()).not.toEqual(before);await page.evaluate(()=>performUndo());expect(await read()).toEqual(before);
});

test('color SRT export freezes speaker names and text before the file picker',async({page})=>{
  const downloads=[];page.on('download',item=>downloads.push(item));
  await page.evaluate(()=>{
    DATA.segments.push({id:'blue',start:1500,end:2000,text:'Blue text',color:{name:'blue',start:1500,end:2000}});
    const settings={mapping_enabled:true,enabled:false,names:{red:'Alice',blue:'Bob'},separator:': '};
    setSubtitleAppearance({speaker_labels:settings});
    updateEditorSettings({exportSpeakerLabels:true,exportSpeakerNamesAsSuffix:true,exportColorUnified:true,exportStartAtZero:false});
    window.showSaveFilePicker=async()=>{
      DATA.segments[0].text='Late change';DATA.preview.subtitle.speaker_labels.names.red='Changed';
      updateEditorSettings({exportColorUnified:false,exportStartAtZero:true});
      return {name:'chosen.srt'};
    };
  });
  await page.evaluate(()=>downloadColorSrts());await expect.poll(()=>downloads.length).toBe(2);
  const files={};for(const download of downloads){const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);files[download.suggestedFilename()]=Buffer.concat(chunks).toString('utf8');}
  expect(files['chosen_Alice.srt']).toContain('Alice: Hello');expect(files['chosen_Bob.srt']).toContain('00:00:01,500');
  expect(files['chosen_Alice.srt']).not.toContain('Late change');
});
