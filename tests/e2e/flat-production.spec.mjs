import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server;
test.beforeAll(async()=>{const dir=makeTempDir('flat-production');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
const fixture=()=>({segments:[{id:'a',start:1000,end:3000,text:'Hello world',items:[]}],
  multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:1200,end:3200,text:'你好世界',items:[]}]}],
    bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:200,end_offset_ms:200}]},waveform:generateWaveformPayload(10000)});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
test.beforeEach(async({page})=>{await disableOnboarding(page);page.on('dialog',d=>d.accept());await page.goto(server.url);});
test('normal editor retains menus, paired cards and panels while saving native flat tracks',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#open-project-file').setInputFiles({name:'bilingual.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});
  await expect(page.locator('#json-name')).toHaveText('bilingual.mosp');
  await expect(page.locator('#menubar')).toBeVisible();await expect(page.locator('#flat-trial-bar')).toHaveCount(0);
  await expect(page.locator('.multi-dual-cue')).toHaveCount(1);
  await expect(page.locator('.multi-cue-column.main')).toContainText('Hello world');
  await expect(page.locator('.multi-cue-column.extension')).toContainText('你好世界');
  const p=await snap(page);expect(p.schema).toBe('msw.project.v4');expect(p.segments).toBeUndefined();
  expect(p.subtitles.tracks).toHaveLength(2);expect(p.subtitles.bindings).toHaveLength(1);
  expect(p.subtitles.cues[0].track_id).not.toBe(p.subtitles.cues[1].track_id);
  await page.screenshot({path:info.outputPath('normal-flat-bilingual.png')});
  expect(errors).toEqual([]);
});

test('paired cards retain linked split, merge and one-step undo',async({page})=>{
  await page.locator('#open-project-file').setInputFiles({name:'bilingual.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});
  await expect(page.locator('.multi-dual-cue')).toHaveCount(1);
  await page.locator('.multi-cue-column.main').click();
  await page.locator('#cue-panel-text').fill('Hello edited world');
  await page.locator('#cue-panel-text').blur();
  expect((await snap(page)).subtitles.cues.some(c=>c.content.text==='Hello edited world')).toBe(true);
  await page.mouse.move(1,1);
  await page.evaluate(()=>{player.currentTime=2;lastEditRegion='waveform';EDITOR_SETTINGS.keyboardOperationReference='playhead';setCuePanelTarget('main',0);});
  await page.keyboard.press('Control+b');
  await expect.poll(async()=>(await snap(page)).subtitles.cues.length).toBe(4);
  expect((await snap(page)).subtitles.bindings).toHaveLength(2);
  await page.evaluate(()=>{clearSelection({silent:true});DATA.segments.forEach((_,i)=>selectedIdxs.add(i));mergeSegments([...selectedIdxs]);});
  await expect.poll(async()=>(await snap(page)).subtitles.cues.length).toBe(2);
  expect((await snap(page)).subtitles.bindings).toHaveLength(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async()=>(await snap(page)).subtitles.cues.length).toBe(4);
  expect((await snap(page)).subtitles.bindings).toHaveLength(2);
});

test('arbitrary peer tracks bind into original bilingual cards and move independently',async({page})=>{
  await page.evaluate(()=>{
    const p=MSWFlatSubtitles.migrate({segments:[{id:'a',start:1000,end:3000,text:'Source'}],waveform:{duration_ms:10000,peaks:[]}});
    let n=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id:'second',name:'译文'});
    n=MSWFlatEditing.addCue(n,'second','b',1000,3000,'Translation');
    applyCanonicalProject(n,'peer.mosp');renderAll({waveform:'full'});clearSelection({silent:true});DATA.segments.forEach((_,i)=>selectedIdxs.add(i));
  });
  await page.keyboard.press('g');
  await expect(page.locator('.multi-dual-cue')).toHaveCount(1);
  expect((await snap(page)).subtitles.bindings).toHaveLength(1);
  await page.evaluate(()=>{fixedAddTrack('subtitle');fixedMove([fixedRef(DATA.segments[0])],DATA.subtitle_tracks.tracks.at(-1).id);});
  const p=await snap(page);expect(p.subtitles.bindings).toHaveLength(1);
  expect(p.subtitles.cues.find(c=>c.id==='b').track_id).toBe('second');
  expect(p.subtitles.cues.find(c=>c.content.text==='Source').track_id).toBe(p.subtitles.tracks.at(-1).id);
});

test('normal processing host uses native IDs and candidate revisions retain bindings and undo',async({page})=>{
  await page.locator('#open-project-file').setInputFiles({name:'source.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({segments:[{id:'a',start:0,end:2000,text:'Hello'}]}))});
  const result=await page.evaluate(()=>{
    selectOnly(0);const h=MSWE.resolve('processing-host'),snapshot=h.capture('secondary','new');
    const job={id:'translation-test',kind:'translation',project_id:DATA.msw.project_id,status:'succeeded',snapshot,result:{translations:[{id:snapshot.entries[0].source.id,text:'译文'}]}};
    MSWResults.register(DATA.msw,[job]);h.applyProcessing([job],'secondary');
    const first=JSON.parse(buildJson());job.result.translations[0].text='修改后的候选';h.applyProcessing([job],'secondary');
    const second=JSON.parse(buildJson());
    const tts=MSWTts.snapshot(DATA,{mainIds:[],extensionIds:[second.subtitles.bindings[0].target_id],trackId:MSWProductionProject.EXT,hasSelection:true},'secondary');
    return {schema:snapshot.project_schema,first,second,tts};
  });
  expect(result.schema).toBe('msw.project.v4');expect(result.first.subtitles.bindings).toHaveLength(1);
  expect(result.second.subtitles.cues).toHaveLength(2);expect(result.second.subtitles.cues.some(c=>c.content.text==='修改后的候选')).toBe(true);
  expect(result.tts.entries[0].track_id).toBe(result.second.subtitles.tracks[1].id);
  await page.keyboard.press('Control+z');
  expect((await snap(page)).subtitles.cues.some(c=>c.content.text==='译文')).toBe(true);
});

test('copy/paste and subtitle assets keep independent tracks and paired cards',async({page})=>{
  await page.locator('#open-project-file').setInputFiles({name:'pairs.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});
  const result=await page.evaluate(()=>{
    selectOnly(0);selectedExtensionIdxs.add(0);copySelectedCues();
    MSWE.resolve('processing-host').copySubtitleAssets();
    const ids=DATA.msw.subtitle_assets.map(a=>a.id),owner=fixedOwner(DATA.segments[0]);fixedActiveTrackId=owner;
    const placed=MSWProductionProject.place(DATA,productionClipboard.rows,productionClipboard.bindings,4000,owner);
    productionCommitProject(MSWProductionProject.toProject(placed.project),'测试粘贴',placed.ids);
    const pasted=JSON.parse(buildJson());
    const plan=MSWAssets.insert(DATA,ids,7000,{},c=>c,{subtitleTrackId:owner});productionCommitProject(MSWProductionProject.toProject(plan.project),'素材插入');
    return {pasted,final:JSON.parse(buildJson())};
  });
  expect(result.pasted.subtitles.cues).toHaveLength(4);expect(result.pasted.subtitles.bindings).toHaveLength(2);
  expect(result.final.subtitles.cues).toHaveLength(6);expect(result.final.subtitles.bindings).toHaveLength(3);
  await expect(page.locator('.multi-dual-cue')).toHaveCount(3);
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles.cues).toHaveLength(4);
});

for(const method of ['ctrl','menu'])test(`normal empty physical track creates through ${method}`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(p=>{applyCanonicalProject(p,'empty.mosp');waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;
    waveformEditor.settings.rowHeight=140;waveformEditor.render();updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false});},fixture());
  await page.locator('.fixed-track-head').first().click({button:'right'});
  await page.getByRole('button',{name:'新增字幕轨道',exact:true}).click();
  const before=await snap(page),target=before.subtitles.tracks.at(-1).id;
  const point=time=>page.evaluate(({target,time})=>{
    const row=document.querySelector('.waveform-row'),r=row.getBoundingClientRect(),lane=fixedLayout().positions.get(JSON.stringify([target,'main']));
    return {x:r.left+r.width*(time-Number(row.dataset.startMs))/(Number(row.dataset.endMs)-Number(row.dataset.startMs)),
      y:r.bottom-(parseFloat(row.style.getPropertyValue('--audio-lane-space'))||0)-7-lane*38-17};
  },{target,time});
  const a=await point(1500),b=await point(2500);await page.mouse.move(a.x,a.y);
  if(method==='ctrl') {
    await page.keyboard.down('Control');await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});
    await expect(page.locator('.waveform-create-preview')).toHaveAttribute('data-subtitle-track-id',target);
    await page.mouse.up();await page.keyboard.up('Control');
  } else {await page.mouse.click(a.x,a.y,{button:'right'});await page.locator('#ctxmenu .item').filter({hasText:'创建字幕'}).click();}
  const after=await snap(page),added=after.subtitles.cues.filter(c=>!before.subtitles.cues.some(a=>a.id===c.id));
  expect(added).toHaveLength(1);expect(added[0].track_id).toBe(target);expect(Math.abs(added[0].content.start-1500)).toBeLessThan(30);
  expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);expect(errors).toEqual([]);
});

test('normal subtitle import, column swap and track replacement preserve other physical tracks',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(p=>applyCanonicalProject(p,'import.mosp'),{segments:fixture().segments,waveform:fixture().waveform});
  const before=await snap(page);
  await page.evaluate(()=>showMultiSubtitleImportChoice({name:'translation.srt'},[{start:1000,end:3000,text:'新译文'}]));
  await page.locator('#multi-subtitle-import-result-confirm').click();
  await expect(page.locator('.multi-cue-column.extension')).toContainText('新译文');
  const imported=await snap(page);expect(imported.subtitles.tracks).toHaveLength(2);expect(imported.subtitles.bindings).toHaveLength(1);
  await page.evaluate(()=>swapMainAndExtensionSubtitles());
  await expect(page.locator('.multi-cue-column.main')).toContainText('新译文');
  const swapped=await snap(page);expect([...swapped.subtitles.cues].sort((a,b)=>a.id.localeCompare(b.id))).toEqual([...imported.subtitles.cues].sort((a,b)=>a.id.localeCompare(b.id)));
  expect(swapped.subtitles.bindings[0].source_id).toBe(imported.subtitles.bindings[0].target_id);
  await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),swapped);
  await expect(page.locator('.multi-cue-column.main')).toContainText('新译文');
  await page.evaluate(()=>{fixedActiveTrackId=DATA.subtitle_tracks.tracks[0].id;replaceMainTrack([{start:4000,end:5000,text:'新原文'}],'replace.srt');});
  const replaced=await snap(page);expect(replaced.subtitles.cues.map(c=>c.content.text).sort()).toEqual(['新原文','新译文']);
  expect(replaced.subtitles.tracks).toEqual(imported.subtitles.tracks);expect(replaced.subtitles.bindings).toEqual([]);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(swapped.subtitles);
  expect(before.subtitles.cues).toHaveLength(1);expect(errors).toEqual([]);
});

test('native paired blocks drag with offsets, disable independently, and restore without changing identity',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(p=>{applyCanonicalProject(p,'drag.mosp');waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;
    waveformEditor.settings.rowHeight=140;waveformEditor.render();updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false});},fixture());
  const before=await snap(page),first=before.subtitles.cues[0],id=first.id;
  const block=await page.locator(`.waveform-cue-block[data-cue-id="${id}"]`).first().boundingBox(),row=await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.move(block.x+block.width/2,block.y+block.height/2);await page.mouse.down();
  await page.mouse.move(row.x+row.width*.6,block.y+block.height/2,{steps:6});await page.mouse.up();
  const moved=await snap(page),a=moved.subtitles.cues.find(c=>c.id===id),b=moved.subtitles.cues.find(c=>c.id!==id);
  expect(a.content.start).toBeGreaterThan(first.content.start);expect(b.content.start-a.content.start).toBe(200);
  expect(moved.subtitles.bindings).toEqual(before.subtitles.bindings);expect(a.track_id).toBe(first.track_id);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
  const head=page.locator(`.fixed-track-head[data-subtitle-track-id="${first.track_id}"]`).first();await head.locator('.fixed-track-toggle').click();
  const disabled=await snap(page);expect(disabled.subtitles.tracks.find(t=>t.id===first.track_id).enabled).toBe(false);
  expect(disabled.subtitles.tracks.find(t=>t.id!==first.track_id).enabled).toBe(true);
  await page.evaluate(p=>MSWE.resolve('persistence-host').restore({project:p,filename:'restored.mosp'}),disabled);
  expect((await snap(page)).subtitles).toEqual(disabled.subtitles);await expect(page.locator('.multi-dual-cue')).toHaveCount(1);
  expect(errors).toEqual([]);
});
