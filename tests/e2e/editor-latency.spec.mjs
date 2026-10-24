import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server;
test.setTimeout(120000);
test.beforeAll(async()=>{
  const dir=makeTempDir('editor-latency'),media=join(dir,'video.mp4'),project=join(dir,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(dir,'settings');process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  const segments=Array.from({length:400},(_,i)=>({id:'main-'+i,start:i*3000,end:i*3000+2000,text:'Subtitle '+i}));
  const secondary=segments.map((c,i)=>({...c,id:'secondary-'+i,text:'Translation '+i}));
  writeFileSync(project,JSON.stringify({media,segments,multi_subtitle:{enabled:true,tracks:[{id:'translation',segments:secondary}],
    bindings:segments.map((c,i)=>({id:'binding-'+i,track_id:'translation',main_segment_ids:[c.id],extension_segment_ids:[secondary[i].id]}))},waveform:generateWaveformPayload(1200000,10)}));
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});
test.beforeEach(async({page})=>{
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,selectBoundSubtitlePair:false})));
  await page.goto(server.url);
  await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2);
  await page.evaluate(()=>{player.pause();updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false});});
});
const paint=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));

test('typing batches structural validation and changing styles preserves cards and cue focus',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);window.originalText=DATA.segments[0].text;window.textValidations=0;window.savedReconcile=MSWSubtitleTracks.reconcile;
    MSWSubtitleTracks.reconcile=(...args)=>{textValidations++;return savedReconcile(...args);};
    for(const text of ['Typing first','Typing second','Typing final']){cuePanelText.value=text;cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));}
  });
  expect(await page.evaluate(()=>textValidations)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>textValidations)).toBe(1);
  await page.evaluate(()=>{MSWSubtitleTracks.reconcile=savedReconcile;performUndo();});
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe(await page.evaluate(()=>originalText));
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('track');window.keptStyleCard=container.querySelector('.cue');});
  await page.locator('#style-project-preset').selectOption('large');
  expect(await page.evaluate(()=>keptStyleCard.isConnected)).toBe(true);
  await page.locator('#style-edit-scope').selectOption('cue');
  await page.locator('#style-project-preset').selectOption('default');
  expect(await page.evaluate(()=>({same:keptStyleCard.isConnected,text:getCurrentCuePanelTarget()?.segment.text}))).toEqual({same:true,text:await page.evaluate(()=>originalText)});
  await page.evaluate(()=>performUndo());
  expect(await page.evaluate(()=>DATA.segments[0].subtitle_style)).toBeUndefined();
  await page.evaluate(()=>performRedo());
  expect(await page.evaluate(()=>DATA.segments[0].subtitle_style)).toBeTruthy();
  const saved=await page.evaluate(()=>{
    cuePanelText.value='Save immediately after typing';cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));
    return JSON.parse(buildJson()).subtitles.cues.find(c=>c.id===DATA.segments[0].id).content.text;
  });
  expect(saved).toBe('Save immediately after typing');
});

test('right-click and selection read live cues without converting or validating the entire project',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{waveformEditor.closeDockModule('properties');selectOnly(0);});
  await page.evaluate(paint);
  const result=await page.evaluate(async()=>{
    const convert=MSWProductionProject.toProject,index=MSWSubtitleTracks.createIndex;
    const counts={convert:0,index:0};
    MSWProductionProject.toProject=(...args)=>{counts.convert++;return convert(...args);};
    MSWSubtitleTracks.createIndex=(...args)=>{counts.index++;return index(...args);};
    try{
      showContextMenu(350,250,1,3500);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const menu=ctxmenu.textContent;
      showExtensionContextMenu(350,250,1,3500,getActiveExtensionTrack());
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return {counts,menu,selected:[...fixedPositionSelectedIds()],hidden:!MSWSubtitleStyle.propertiesVisible()};
    }finally{MSWProductionProject.toProject=convert;MSWSubtitleTracks.createIndex=index;}
  });
  expect(result.counts).toEqual({convert:0,index:0});
  expect(result.menu).toContain('绑定操作');expect(result.menu).toContain('反转绑定方向');
  expect(result.selected).toEqual(await page.evaluate(()=>[getActiveExtensionTrack().segments[1].id]));expect(result.hidden).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>MSWSubtitleStyle.open('cue'));
  await expect(page.locator('#style-selection-label')).toContainText('S1副_2');
  await page.locator('#style-field-fontSize').fill('72');await page.locator('#style-field-fontSize').blur();
  expect(await page.evaluate(()=>getActiveExtensionTrack().segments[1].subtitle_style.fontSize)).toBe(72);
  await page.evaluate(()=>performUndo());
  expect(await page.evaluate(()=>getActiveExtensionTrack().segments[1].subtitle_style)).toBeUndefined();
  expect(await page.evaluate(()=>DATA.multi_subtitle.bindings.length)).toBe(400);
  expect(errors).toEqual([]);
});

test('unchanged recovery polling preserves layout; text changes, including edits during upload, are captured',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);fixedPreviewLayout();});
  await page.evaluate(()=>MSWE.resolve('project-persistence').captureDraft());
  const unchanged=await page.evaluate(async()=>{
    const layout=fixedPreviewLayout(),build=buildJson;let snapshots=0;
    buildJson=(...args)=>{snapshots++;return build(...args);};
    try{
      selectOnly(1);seekFromWaveform(4);
      await MSWE.resolve('project-persistence').captureDraft();
      await MSWE.resolve('project-persistence').captureDraft();
      return {snapshots,sameLayout:layout===fixedPreviewLayout(),selected:[...fixedPositionSelectedIds()]};
    }finally{buildJson=build;}
  });
  expect(unchanged).toEqual({snapshots:0,sameLayout:true,selected:await page.evaluate(()=>[DATA.segments[1].id])});
  const editedId=await page.evaluate(()=>DATA.segments[0].id);
  const uploads=[];let release,arrived;
  const waiting=new Promise(r=>arrived=r),held=new Promise(r=>release=r);
  await page.route('**/recovery-draft',async route=>{
    uploads.push(route.request().postDataJSON());
    if(uploads.length===1){arrived();await held;}
    await route.fulfill({json:{ok:true}});
  });
  await page.evaluate(()=>{DATA.segments[0].text='First edit';window.draftTest=MSWE.resolve('project-persistence').captureDraft();});
  await waiting;
  await page.evaluate(()=>{DATA.segments[0].text='Second edit';});release();
  await page.evaluate(()=>window.draftTest);
  await page.evaluate(()=>MSWE.resolve('project-persistence').captureDraft());
  expect(uploads.map(p=>p.project.subtitles.cues.find(c=>c.id===editedId).content.text)).toEqual(['First edit','Second edit']);
  await page.evaluate(()=>MSWE.resolve('project-persistence').captureDraft());expect(uploads).toHaveLength(2);
  await page.evaluate(()=>{
    const card=container.querySelector('.multi-cue[data-main-idx="0"] .multi-cue-column.main');
    startEdit(card,0);editingState.textEl.innerText='Uncommitted draft';
  });
  await page.evaluate(()=>MSWE.resolve('project-persistence').captureDraft());
  expect(uploads.at(-1).project.subtitles.cues.find(c=>c.id===editedId).content.text).toBe('Uncommitted draft');
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Second edit');
  await page.evaluate(()=>finishEdit(false));
  const gesture=await page.evaluate(async()=>{
    waveformEditor.drag={type:'move'};
    try{return await MSWE.resolve('project-persistence').captureDraft();}
    finally{waveformEditor.drag=null;}
  });
  expect(gesture).toBe(false);expect(uploads).toHaveLength(3);
});

test('selection highlights clear old partners and retain multi-selection while seeking',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);addExtensionToSelection(0);});
  await expect(page.locator('.multi-cue-column.selected')).toHaveCount(2);
  await page.evaluate(()=>selectOnly(1));
  await expect(page.locator('.multi-cue-column.selected')).toHaveCount(1);
  await expect(page.locator('.multi-cue[data-main-idx="0"] .related-selected')).toHaveCount(0);
  await page.evaluate(()=>{addExtensionToSelection(1);seekFromWaveform(4);});
  expect(await page.evaluate(()=>[...fixedPositionSelectedIds()].sort())).toEqual(await page.evaluate(()=>[DATA.segments[1].id,getActiveExtensionTrack().segments[1].id].sort()));
  await expect(page.locator('.multi-cue-column.selected')).toHaveCount(2);
});

test('preview snapshots do not commit edits, save history, or include waveform and word caches',async({page})=>{
  await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const host=MSWE.resolve('processing-host'),before=JSON.stringify(DATA),layout=fixedPreviewLayout();
    const build=buildJson,commit=commitProcessingEdits;let saves=0,commits=0;
    buildJson=()=>{saves++;throw Error('Preview must not save');};
    commitProcessingEdits=()=>{commits++;throw Error('Preview must not commit');};
    try {
      const project=host.subtitlePreviewProject();MSWFlatSubtitles.validate(project);
      return {saves,commits,unchanged:before===JSON.stringify(DATA),sameLayout:layout===fixedPreviewLayout(),
        schema:project.schema,count:project.subtitles.cues.length,largeFields:['waveform','waveform_reapeaks','spectral','workspace','msw'].filter(k=>k in project),
        words:project.subtitles.cues.some(c=>'items' in c.content)};
    }finally{buildJson=build;commitProcessingEdits=commit;}
  });
  expect(result).toEqual({saves:0,commits:0,unchanged:true,sameLayout:true,schema:'msw.project.v4',count:800,largeFields:[],words:false});
});

test('rapid text edits coalesce, discard obsolete preview geometry and preserve unchanged cards',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{selectOnly(0);seekFromWaveform(.5);});
  await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:30000});
  let arrived,release;const waiting=new Promise(r=>arrived=r),held=new Promise(r=>release=r),requests=[];
  await page.route('**/subtitle-preview',async route=>{
    requests.push(route.request().postDataJSON());
    const response=await route.fetch();
    if(requests.length===1){arrived();await held;}
    await route.fulfill({response});
  });
  await page.evaluate(()=>{
    window.receivedPreviewTexts=[];const receive=fixedReceiveGeometry;
    fixedReceiveGeometry=rows=>{window.receivedPreviewTexts.push(rows.map(r=>r.text));return receive(rows);};
    window.unchangedCard=container.querySelector('.multi-cue[data-main-idx="1"]');
    cuePanelText.value='Obsolete version';cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await waiting;
  await page.evaluate(()=>{
    for(const text of ['Intermediate version','Latest text']) {
      cuePanelText.value=text;cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));
    }
  });
  release();
  await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.geometry.some(r=>r.text==='Latest text'));
  expect(requests).toHaveLength(2);
  expect(await page.evaluate(()=>window.receivedPreviewTexts.some(rows=>rows.includes('Obsolete version')))).toBe(false);
  expect(await page.evaluate(()=>window.unchangedCard===container.querySelector('.multi-cue[data-main-idx="1"]'))).toBe(true);
  const revision=await page.evaluate(()=>MSWSubtitleRenderer.revision);
  await page.evaluate(()=>{MSWSubtitleRenderer.invalidate();MSWSubtitleRenderer.invalidate();});
  await page.waitForFunction(()=>!MSWSubtitleRenderer.pending);
  expect(await page.evaluate(()=>MSWSubtitleRenderer.revision)).toBe(revision);
  expect(requests).toHaveLength(2);expect(errors).toEqual([]);
  await page.evaluate(()=>performUndo());
  await page.waitForFunction(()=>!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.geometry.some(r=>r.text==='Subtitle 0'));
});

test('text-only commit updates labels without rebuilding the list; unchanged saving retains geometry',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);});
  const result=await page.evaluate(()=>{
    const card=container.querySelector('.multi-cue[data-main-idx="1"]');
    cuePanelText.value='Committed text';commitCuePanelEdit();
    const layout=fixedPreviewLayout();fixedAcceptEdit();
    return {sameCard:card===container.querySelector('.multi-cue[data-main-idx="1"]'),
      sameLayout:layout===fixedPreviewLayout(),label:getCuePanelTextElement(getCurrentCuePanelTarget()).textContent,text:DATA.segments[0].text};
  });
  expect(result).toEqual({sameCard:true,sameLayout:true,label:'Committed text',text:'Committed text'});
});
