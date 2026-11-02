import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer,startServer} from './helpers.mjs';
let server,environment;
test.beforeAll(async()=>{
  environment={MAW_ENV_FILE:process.env.MAW_ENV_FILE,MSW_APP_DATA_ROOT:process.env.MSW_APP_DATA_ROOT};
  const dir=makeTempDir('speaker-follow');process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app');
  server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());
});
test.afterAll(async()=>{await server?.stop();for(const [key,value] of Object.entries(environment||{})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
test.beforeEach(async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await page.evaluate(waveform=>{
    const rows=prefix=>Array.from({length:6},(_,i)=>({id:prefix+i,start:i*1500,end:i*1500+1200,text:prefix==='a'?'Line '+i:'第 '+i+' 行',items:[]}));
    applyCanonicalProject({segments:rows('a'),multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'ext',role:'extension',segments:rows('b')}],bindings:[0,1,2,3,4,5].map(i=>({id:'pair'+i,track_id:'ext',main_segment_ids:['a'+i],extension_segment_ids:['b'+i],start_offset_ms:0,end_offset_ms:0}))},waveform},'follow.mosp');
    updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false,clickBehavior:'select-only'});
  },generateWaveformPayload(10000));
});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
const byText=(p,text)=>p.subtitles.cues.find(c=>c.content.text===text);
async function settings(page){await page.evaluate(()=>setEditorSettingsPanelOpen(true));await page.locator('#editor-settings-nav [data-settings-category=general]').click();}
async function menu(page,index,extension=false){
  await page.evaluate(({index,extension})=>showContextMenu(500,200,index,null,extension?getActiveExtensionTrack():null),{index,extension});
  await page.locator('#ctxmenu').getByText('标记字幕',{exact:true}).hover();
}

test('default off; actual settings, palette, hollow menu, clear and undo share one transaction',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await settings(page);await expect(page.locator('#speaker-auto-follow')).not.toBeChecked();
  await page.locator('#speaker-auto-follow').check();
  expect(await page.evaluate(()=>EDITOR_SETTINGS.speakerAutoFollow)).toBe(true);
  await page.reload();await settings(page);await expect(page.locator('#speaker-auto-follow')).toBeChecked();
  // Reload resets this temporary project; restore fixture without changing the preference.
  await page.evaluate(waveform=>{
    const rows=prefix=>Array.from({length:6},(_,i)=>({id:prefix+i,start:i*1500,end:i*1500+1200,text:prefix==='a'?'Line '+i:'第 '+i+' 行',items:[]}));
    applyCanonicalProject({segments:rows('a'),multi_subtitle:{enabled:true,tracks:[{id:'ext',role:'extension',segments:rows('b')}],bindings:rows('a').map((_,i)=>({id:'p'+i,track_id:'ext',main_segment_ids:['a'+i],extension_segment_ids:['b'+i],start_offset_ms:0,end_offset_ms:0}))},waveform},'follow.mosp');
    updateEditorSettings({speakerAutoFollow:false,autoSaveProject:false});assignColor([4],'blue');
  },generateWaveformPayload(10000));
  await settings(page);await page.locator('#speaker-auto-follow').check();
  await page.screenshot({path:'output/speaker-follow-settings.png'});
  await page.evaluate(()=>setEditorSettingsPanelOpen(false));
  const before=await snap(page),history=await page.evaluate(()=>editorHistory.undoLength());
  await menu(page,1,true);await page.locator('#ctxmenu button[data-speaker="red"]').click();
  const marked=await snap(page);
  for(const [root,child] of [['Line 1','Line 2'],['第 1 行','第 2 行']])expect(byText(marked,child).content.color_ref.cue_id).toBe(byText(marked,root).id);
  expect(byText(marked,'Line 4').content.color.name).toBe('blue');expect(byText(marked,'Line 5').content.color).toBeUndefined();
  expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
  await expect(page.locator('.multi-cue-column[data-main-idx="2"] .color-bar')).toHaveClass(/is-ref/);
  await expect(page.locator('.multi-cue-column[data-ext-idx="2"] .color-bar')).toHaveClass(/is-ref/);
  await menu(page,2,true);await expect(page.locator('#ctxmenu').getByText('从颜色组中脱离',{exact:true})).toHaveCount(0);
  await page.screenshot({path:'output/speaker-follow-menu.png'});
  await page.locator('#ctxmenu').getByText('独立标记',{exact:true}).click();
  const independent=await snap(page);
  for(const text of ['Line 2','第 2 行']){expect(byText(independent,text).content.color.name).toBe('red');expect(byText(independent,text).content.color_ref).toBeUndefined();}
  await expect(page.locator('.multi-cue-column[data-ext-idx="2"] .color-bar')).not.toHaveClass(/is-ref/);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(marked.subtitles);
  await menu(page,2);await page.locator('#ctxmenu').getByText('清除标记',{exact:true}).click();
  for(const text of ['Line 2','第 2 行']){const c=byText(await snap(page),text).content;expect(c.color).toBeUndefined();expect(c.color_ref).toBeUndefined();}
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(marked.subtitles);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
  expect(errors).toEqual([]);
});

test('cross-display references remain hollow and can be made independent',async({page})=>{
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),head=p.subtitles.cues.find(c=>c.content.text==='Line 1'),target=p.subtitles.cues.find(c=>c.content.text==='第 2 行');
    head.content.color={name:'red'};target.content.color_ref={cue_id:head.id,name:'red'};
    applyCanonicalProject(p,'cross.mosp');
  });
  await expect(page.locator('.multi-cue-column[data-ext-idx="2"] .color-bar')).toHaveClass(/is-ref/);
  const before=await snap(page);await menu(page,2,true);await page.locator('#ctxmenu').getByText('独立标记',{exact:true}).click();
  expect(byText(await snap(page),'第 2 行').content.color.name).toBe('red');
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('follow references save to disk, reopen, and resolve names in SRT and ASS',async({page})=>{
  test.setTimeout(90000);
  const dir=makeTempDir('speaker-follow-save'),path=join(dir,'follow.mosp'),audio=join(dir,'video.mp4');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=10','-c:v','libx264','-pix_fmt','yuv420p',audio],{windowsHide:true});
  const p=await snap(page);p.media=audio;writeFileSync(path,JSON.stringify(p));
  process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app');
  const live=await startServer(path,audio,await findFreePort());
  try{
    await page.goto(live.url);await expect(page.locator('#editor-loading')).toBeHidden();
    await page.evaluate(()=>MSWConfig.ready);
    await page.evaluate(()=>{
      updateEditorSettings({autoSaveProject:false,speakerAutoFollow:true,exportSpeakerLabels:true});
      const speaker=MSWSpeaker.ensure(DATA).rows.find(r=>r.id==='red');Object.assign(speaker,{name:'Alice',mode:'text',color:'#cc1122'});speakerPaletteChanged();
      DATA.preview.speaker_labels_visible=true;assignColor([1],'red');
    });
    const saved=await snap(page);
    await page.evaluate(()=>MSWConfig.flush());
    await page.waitForFunction(()=>!projectSaveInFlight&&!projectCheckpointInFlight);
    expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
    expect(JSON.parse(readFileSync(path,'utf8')).subtitles).toEqual(saved.subtitles);
    await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();
    await page.evaluate(()=>MSWConfig.ready);
    expect(await page.evaluate(()=>EDITOR_SETTINGS.exportSpeakerLabels)).toBe(true);
    expect((await snap(page)).subtitles).toEqual(saved.subtitles);
    await expect(page.locator('.multi-cue-column[data-ext-idx="2"] .color-bar')).toHaveClass(/is-ref/);
    await page.waitForFunction(()=>player.readyState>=2);
    await page.evaluate(()=>{player.pause();player.currentTime=3.5;});
    await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.geometry.map(r=>r.text)),{timeout:20000}).toContain('Alice：Line 2');
    const outputs=await page.evaluate(async()=>({srt:buildSrt(),ass:await fixedAssDocument()}));
    expect(outputs.srt).toContain('Alice：Line 2');expect(outputs.ass).toContain('Alice：');expect(outputs.ass).toContain('2211CC');
    await page.evaluate(()=>{updateEditorSettings({speakerAutoFollow:false});assignColor([1],'blue');});
    expect(byText(await snap(page),'Line 2').content.color_ref.name).toBe('blue');
  }finally{await page.close({runBeforeUnload:false});await live.stop();}
});
