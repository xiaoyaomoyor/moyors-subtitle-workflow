import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,generateWav,makeTempDir,startStaticServer,startServer} from './helpers.mjs';
let server,environment;
test.beforeAll(async()=>{environment={MAW_ENV_FILE:process.env.MAW_ENV_FILE,MSW_APP_DATA_ROOT:process.env.MSW_APP_DATA_ROOT};const dir=makeTempDir('marker-delete');process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>{await server?.stop();for(const [key,value] of Object.entries(environment||{})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
test.beforeEach(async({page})=>{await disableOnboarding(page);await page.goto(server.url);await page.evaluate(waveform=>{
 const rows=(prefix)=>[{id:prefix+'0',start:1000,end:5000,text:'Hello world',items:[],color:{name:'red',value:'#e03040',start:1000,end:9000},sticker:{name:'smile',start:1000,end:9000}},
 {id:prefix+'1',start:6000,end:7000,text:'Second',items:[],color_ref:{name:'red',headIdx:0},sticker_ref:{name:'smile',headIdx:0}},
 {id:prefix+'2',start:8000,end:9000,text:'Third',items:[],color_ref:{name:'red',headIdx:0},sticker_ref:{name:'smile',headIdx:0}}];
 applyCanonicalProject({segments:rows('a'),multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'ext',role:'extension',segments:rows('b')}],bindings:[0,1,2].map(i=>({id:'link'+i,track_id:'ext',main_segment_ids:['a'+i],extension_segment_ids:['b'+i],start_offset_ms:0,end_offset_ms:0}))},waveform},'markers.mosp');
 updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false,clickBehavior:'select-only'});
 },generateWaveformPayload(10000));});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
function checkMarkers(p){
 for(const c of p.subtitles.cues)for(const field of ['color','sticker']){
  const value=c.content[field]||p.subtitles.cues.find(h=>h.id===c.content[field+'_ref']?.cue_id)?.content[field];
  expect(value?.name).toBe(field==='color'?'red':'smile');
 }
}
for(const origin of ['main','extension'])test(`linked split then delete the front via ${origin} preserves both marker groups`,async({page})=>{
 const before=await snap(page);
 await page.evaluate(()=>requestSubtitleSplit('main',0,{timeMs:3000,quick:true,textOffset:6}));
 await expect.poll(()=>page.evaluate(()=>DATA.segments.length)).toBe(4);
 const split=await snap(page),history=await page.evaluate(()=>editorHistory.undoLength());
 await page.evaluate(origin=>{if(origin==='main')selectOnly(0);else selectOnlyExtension(0,getActiveExtensionTrack());},origin);
 await page.locator('body').click({position:{x:2,y:2}});await page.keyboard.press('Delete');
 const after=await snap(page);expect(after.subtitles.cues).toHaveLength(6);expect(after.subtitles.bindings).toHaveLength(3);
 checkMarkers(after);
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(split.subtitles);
 await page.evaluate(()=>performRedo());expect((await snap(page)).subtitles).toEqual(after.subtitles);
 await page.evaluate(p=>applyCanonicalProject(p,'reopened.mosp'),after);expect((await snap(page)).subtitles).toEqual(after.subtitles);
 expect(before.subtitles.cues).toHaveLength(6);
});

test('independent secondary deletion promotes a surviving head and shifts later groups',async({page})=>{
 await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.bindings=[];applyCanonicalProject(p,'independent.mosp');
  const rows=getActiveExtensionTrack().segments;
  // A separate later group: deleting index 0 must also shift its member's head.
  rows[1].color={name:'red',value:'#e03040',start:6000,end:9000};delete rows[1].color_ref;
  delete rows[2].color;rows[2].color_ref={name:'red',headIdx:1};
  for(const row of rows.slice(1)){delete row.sticker;row.sticker_ref={name:'smile',headIdx:0};}
  fixedBeginEdit();renderAll();
 });
 const before=await snap(page),main=before.subtitles.cues.filter(c=>c.track_id===before.subtitles.tracks[0].id);
 await page.evaluate(()=>deleteExtensionSegments([0]));const after=await snap(page);checkMarkers(after);
 expect(after.subtitles.cues).toHaveLength(5);expect(after.subtitles.cues.filter(c=>c.track_id===before.subtitles.tracks[0].id)).toEqual(main);
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await page.evaluate(()=>performRedo());expect((await snap(page)).subtitles).toEqual(after.subtitles);
});

test('mixed bound and independent multi-delete preserves remaining marker groups',async({page})=>{
 await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.bindings=p.subtitles.bindings.slice(0,1);applyCanonicalProject(p,'mixed.mosp');});
 const before=await snap(page),history=await page.evaluate(()=>editorHistory.undoLength());
 await page.evaluate(()=>{clearSelection({silent:true});selectedIdxs.add(0);selectedExtensionIdxs.add(1);deleteSelectedCues();});
 const after=await snap(page);checkMarkers(after);expect(after.subtitles.cues).toHaveLength(3);expect(after.subtitles.bindings).toHaveLength(0);
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('a locked bound partner prevents deletion without changing either marker group',async({page})=>{
 await page.evaluate(()=>fixedUpdateTrack(DATA.subtitle_tracks.tracks[1].id,{locked:true}));const before=await snap(page);
 await page.evaluate(()=>deleteSegments([0]));expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('split/delete results save to disk and reopen with all remaining colors and stickers',async({page})=>{
 test.setTimeout(90000);
 const dir=makeTempDir('marker-delete-save'),path=join(dir,'markers.mosp'),audio=generateWav(join(dir,'audio.wav'),10);
 const p=await snap(page);p.media=audio;writeFileSync(path,JSON.stringify(p));
 process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');
 const live=await startServer(path,audio,await findFreePort()),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(live.url);await expect(page.locator('#editor-loading')).toBeHidden();
  await page.evaluate(()=>{updateEditorSettings({autoSaveProject:false});requestSubtitleSplit('main',0,{timeMs:3000,quick:true,textOffset:6});deleteSegments([0]);});
  const after=await snap(page);checkMarkers(after);
  await page.waitForFunction(()=>!projectSaveInFlight&&!projectCheckpointInFlight);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
  expect(JSON.parse(readFileSync(path,'utf8')).subtitles).toEqual(after.subtitles);
  await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();expect((await snap(page)).subtitles).toEqual(after.subtitles);
  expect(errors).toEqual([]);
 }finally{await page.close({runBeforeUnload:false});await live.stop();}
});
