import {test,expect} from '@playwright/test';
import {writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,generateWav,generateWaveformPayload,makeTempDir,startServer,findFreePort,clickMenubarItem,toggleWaveSettings} from './helpers.mjs';

let server;
test.beforeEach(async({page})=>{
  const dir=makeTempDir('editing-save');
  process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'local');
  const media=generateWav(join(dir,'source.wav'),10),info=statSync(media);
  const cues=[2000,4000,6000].map((start,i)=>({id:'main-'+i,start,end:start+1000,text:'Alpha Bravo',items:[{start,end:start+500,text:'Alpha'},{start:start+500,end:start+1000,text:' Bravo'}]}));
  cues[0].color={name:'purple',value:'#bb66ff',start:2000,end:5000};cues[1].color_ref={name:'purple',headIdx:0};
  const extension=cues.map((c,i)=>({...structuredClone(c),id:'ext-'+i,text:'Alpha Bravo'}));
  const waveform=generateWaveformPayload(10000);waveform.audio_track=0;waveform.source={name:'source.wav',size:info.size,modified_ms:Math.floor(info.mtimeMs)};
  const project={media,segments:cues,waveform,multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'ext',role:'extension',name:'Secondary',language:'en',split_mode:'word',segments:extension}],bindings:[]}};
  const path=join(dir,'project.mosp');writeFileSync(path,JSON.stringify(project));
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(path,media,await findFreePort());await page.goto(server.url);
  await expect(page.locator('#editor-loading')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#player').readyState)).toBeGreaterThan(0);
});
test.afterEach(async()=>{await server?.stop();server=null;});

test('merge fields match timing fields and new project has a distinct save title',async({page})=>{
  await clickMenubarItem(page,'字幕','auto-merge-manage');
  const color=await page.locator('#auto-merge-gap-ms').evaluate(e=>getComputedStyle(e.closest('.gap-remove-field')).backgroundColor);
  const timingColor=await page.locator('#subtitle-scale-percent').evaluate(e=>getComputedStyle(e.closest('.gap-remove-field')).backgroundColor);
  expect(color).toBe(timingColor);expect(color).not.toBe('rgba(0, 0, 0, 0)');
  if(process.env.MSW_UI_EVIDENCE_DIR)await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'merge-panel.png')});
  await page.locator('#auto-merge-close').click();
  await page.evaluate(()=>{void window.MSWE.resolve('project-persistence').saveAs({project:buildBlankProject(),name:'new.mosp',newProject:true});});
  await expect(page.locator('#project-save-title')).toHaveText('新工程保存位置');
  await page.locator('#project-save-cancel').click();
  await clickMenubarItem(page,'文件','save-project-as');
  await expect(page.locator('#project-save-title')).toHaveText('另存为工程');
});

test('source gain changes only painted amplitude and reuses peak envelopes',async({page})=>{
  await toggleWaveSettings(page);await page.locator('#waveform-follow-source-gain').check();await toggleWaveSettings(page);
  await page.evaluate(()=>{const w=waveformEditor;w.redrawWaveformCanvases();window.__row=w.renderedRows[0];window.__envelope=window.__row._waveformEnvelope;window.__peaks=w.activeWaveShape().peaks;window.__picture=window.__row.querySelector('canvas').toDataURL();});
  await page.evaluate(async()=>{await window.MSWE.resolve('audio-timeline').setSourceGainDb(-12);});
  await expect(page.locator('#waveform-source-gain-readout')).toHaveText('-12.0 dB');
  await expect.poll(()=>page.evaluate(()=>window.__row.querySelector('canvas').toDataURL()!==window.__picture)).toBe(true);
  expect(await page.evaluate(()=>window.__envelope===window.__row._waveformEnvelope && window.__peaks===waveformEditor.activeWaveShape().peaks)).toBe(true);
  await page.evaluate(()=>{waveformEditor.settings.followSourceGain=false;waveformEditor.refreshSourceGainDisplay();});
  await expect.poll(()=>page.evaluate(()=>window.__row.querySelector('canvas').toDataURL()===window.__picture)).toBe(true);
});

for(const kind of ['main','extension'])test(`${kind} clipboard keeps inherited color and original group references`,async({page})=>{
  const result=await page.evaluate(kind=>{
    clearSelection({silent:true,commitCuePanel:false});
    (kind==='main'?selectedIdxs:selectedExtensionIdxs).add(1);
    copySelectedCues();player.currentTime=1;pasteCuesFromClipboard();
    const cues=kind==='main'?DATA.segments:getActiveExtensionTrack().segments;
    const original=cues.find(c=>c.id===(kind==='main'?'main-1':'ext-1'));
    const pasted=cues.find(c=>c.id.includes('pasted'));
    return {color:pasted.color,ref:pasted.color_ref,head:cues[original.color_ref.headIdx].id,start:pasted.start,items:pasted.items};
  },kind);
  expect(result.color.name).toBe('purple');expect(result.color.value).toBe('#bb66ff');expect(result.ref).toBeUndefined();
  expect(result.head).toBe(kind==='main'?'main-0':'ext-0');expect(result.start).toBe(1000);
  expect(result.items.map(i=>[i.start,i.end])).toEqual([[1000,1500],[1500,2000]]);
});

test('timing wheel coalesces undo, retimes words and keeps feedback in panel',async({page})=>{
  await page.evaluate(()=>{selectedIdxs.add(0);});
  await clickMenubarItem(page,'字幕','subtitle-scale-offset-open');
  const before=await page.evaluate(()=>({undo:editorHistory.undoLength(),hints:document.querySelectorAll('.hint-card').length}));
  await page.locator('#subtitle-shift-ms').evaluate(input=>{for(let i=0;i<3;i++)input.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));});
  const result=await page.evaluate(()=>({start:DATA.segments[0].start,word:DATA.segments[0].items[0].start,undo:editorHistory.undoLength(),hints:document.querySelectorAll('.hint-card').length,repairs:[repairCurrentProjectTimings(),repairCurrentProjectTimings()]}));
  expect(result.start).toBe(2030);expect(result.word).toBe(2030);expect(result.undo).toBe(before.undo+1);expect(result.hints).toBe(before.hints);expect(result.repairs).toEqual([0,0]);
  await expect(page.locator('#subtitle-time-status')).toContainText('已调整');
  if(process.env.MSW_UI_EVIDENCE_DIR)await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'timing-panel.png')});
  await page.keyboard.press('Escape');await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>DATA.segments[0].start)).toBe(2000);
});

test('secondary timing scope never falls back to editing all main subtitles',async({page})=>{
  await page.evaluate(()=>{selectedExtensionIdxs.add(0);});
  await clickMenubarItem(page,'字幕','subtitle-scale-offset-open');
  await expect(page.locator('#subtitle-time-track')).toHaveValue('extension');
  await page.locator('#subtitle-shift-ms').fill('100');await page.locator('#subtitle-shift-ms').press('Tab');
  expect(await page.evaluate(()=>[DATA.segments[0].start,getActiveExtensionTrack().segments[0].start])).toEqual([2000,2100]);
  await page.evaluate(()=>selectedExtensionIdxs.clear());
  await page.locator('#subtitle-shift-ms').fill('100');await page.locator('#subtitle-shift-ms').press('Tab');
  await expect(page.locator('#subtitle-time-status')).toContainText('当前范围没有字幕');
});

test('whole-track move preserves gaps and durations',async({page})=>{
  await clickMenubarItem(page,'字幕','subtitle-scale-offset-open');
  await expect(page.locator('#subtitle-time-scope')).toHaveValue('all');
  await page.locator('#subtitle-shift-ms').fill('1500');await page.locator('#subtitle-shift-ms').press('Tab');
  expect(await page.evaluate(()=>DATA.segments.map(c=>[c.start,c.end]))).toEqual([[3500,4500],[5500,6500],[7500,8500]]);
});

for(const kind of ['main','extension'])test(`linked ${kind} batch movement preserves every follower`,async({page})=>{
  await page.evaluate(()=>{
    getMultiSubtitleState().bindings=DATA.segments.map((cue,i)=>({id:'binding-'+i,track_id:'ext',main_segment_ids:[cue.id],extension_segment_ids:['ext-'+i],start_offset_ms:0,end_offset_ms:0}));
  });
  await clickMenubarItem(page,'字幕','subtitle-scale-offset-open');
  await page.locator('#subtitle-time-track').selectOption(kind);
  await page.locator('#subtitle-shift-ms').fill('2500');await page.locator('#subtitle-shift-ms').press('Tab');
  expect(await page.evaluate(()=>[DATA.segments,getActiveExtensionTrack().segments].map(cues=>cues.map(c=>[c.start,c.end,c.items[0].start])))).toEqual([
    [[4500,5500,4500],[6500,7500,6500],[8500,9500,8500]],
    [[4500,5500,4500],[6500,7500,6500],[8500,9500,8500]],
  ]);
});

test('dense frame word timing remains stable across repeated save snapshots',async({page})=>{
  await page.evaluate(()=>{
    DATA.timebase={unit:'frames',fps:30};
    const cue=DATA.segments[0];cue.end=2200;cue.items=Array.from({length:10},(_,i)=>({text:String(i),start:2000+i*20,end:2020+i*20}));
    selectedIdxs.add(0);
  });
  await clickMenubarItem(page,'字幕','subtitle-scale-offset-open');
  await page.locator('#subtitle-shift-ms').fill('100');await page.locator('#subtitle-shift-ms').press('Tab');
  const result=await page.evaluate(()=>({first:buildJson(),second:buildJson(),cue:DATA.segments[0],repairs:repairCurrentProjectTimings()}));
  expect(result.first).toEqual(result.second);expect(result.repairs).toBe(0);
  expect(result.cue.items.every(i=>i.start>=result.cue.start && i.end<=result.cue.end)).toBe(true);
});

for(const outcome of ['success','edit','failure'])test(`save toast starts before response and handles ${outcome}`,async({page})=>{
  let release,arrival;const arrived=new Promise(resolve=>arrival=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/msw/project',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    arrival();await gate;
    if(outcome==='failure')await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic write failure'})});
    else await route.continue();
  });
  await page.keyboard.press('Control+s');await arrived;
  const pending=page.locator('.hint-card[data-save-progress="true"]');await expect(pending).toContainText('正在保存');
  await expect(pending.locator('.hint-save-spinner')).toBeVisible();
  if(outcome==='success' && process.env.MSW_UI_EVIDENCE_DIR)await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'saving.png')});
  await pending.evaluate(node=>node.dataset.testSave='current');
  if(outcome==='edit')await page.evaluate(()=>{DATA.segments[0].text='edited during save';DATA.segments[0]._dirty=true;});
  release();
  if(outcome==='success'){
    const same=page.locator('[data-test-save="current"]');await expect(same).toHaveClass(/hint-success/);await expect(same).toHaveText('保存成功');await expect(same).toBeHidden({timeout:10000});
  }else if(outcome==='edit'){
    await expect(page.locator('[data-test-save="current"]')).toContainText('新修改仍未保存');
    expect(await page.evaluate(()=>hasUnsavedProjectChanges())).toBe(true);
  }else await expect(page.locator('.hint-warning').last()).toContainText('synthetic write failure');
  await expect(page.locator('.hint-save-spinner')).toHaveCount(0);
});

test('save-as uses the same immediate progress toast above its modal',async({page})=>{
  let release,arrival;const arrived=new Promise(resolve=>arrival=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/msw/save-target',route=>route.fulfill({json:{ok:true,target:'test-target',directory:'projects',filename:'copy.mosp'}}));
  await page.route('**/api/msw/save-as',async route=>{
    arrival();await gate;
    const project=route.request().postDataJSON().project;
    await route.fulfill({json:{ok:true,project,projectId:project.msw.project_id,filename:'copy.mosp',binding:'test-binding',saveRevision:1,assets:{available:0,total:0}}});
  });
  await clickMenubarItem(page,'文件','save-project-as');await page.locator('#project-save-choose').click();
  await page.locator('#project-save-confirm').click();await arrived;
  const toast=page.locator('[data-save-progress="true"]');await expect(toast).toContainText('正在保存');
  await toast.evaluate(node=>node.dataset.testSave='save-as');
  expect(await page.evaluate(()=>Number(getComputedStyle(document.querySelector('#hint-stack')).zIndex)>Number(getComputedStyle(document.querySelector('#project-save-as-modal')).zIndex))).toBe(true);
  release();await expect(page.locator('[data-test-save="save-as"]')).toHaveText('保存成功');
  await expect(page.locator('#project-save-as-modal')).toBeHidden();
});
