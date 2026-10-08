import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
let server;
test.beforeAll(async()=>{
 const folder=makeTempDir('merge-unified'),media=join(folder,'synthetic.wav'),project=join(folder,'project.mosp');
 generateWav(media,8);writeFileSync(project,JSON.stringify({media,segments:[],waveform:generateWaveformPayload(8000)}));
 server=await startServer(project,media,await findFreePort());
});
for(const area of ['list','waveform']) test(`optional tape effect at ${area} joins is independent, local and removed`,async({page},testInfo)=>{
 await setup(page);await selectPair(page,'main',area);
 expect(await page.evaluate(()=>EDITOR_SETTINGS.mergeTapeEffect)).toBe(false);
 await page.keyboard.press('c');await expect(page.locator('.merge-tape-flash')).toHaveCount(0);
 await page.keyboard.press('Control+z');
 await page.evaluate(()=>setEditorSettingsPanelOpen(true));
 await page.locator('.settings-nav-item[data-settings-category="ninja"]').click();
 await page.locator('#merge-tape-effect').check();await expect(page.locator('#ninja-mode')).not.toBeChecked();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('moy.asr.editor.settings.v1')).mergeTapeEffect)).toBe(true);
 await page.evaluate(()=>setEditorSettingsPanelOpen(false));
 await selectPair(page,'main',area);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.keyboard.press('c');
 const tape=page.locator('.merge-tape-flash');await expect(tape).toHaveCount(2);
 if (area==='waveform') {
  const centers=await tape.evaluateAll(nodes=>nodes.map(n=>parseFloat(n.style.top)));
  expect(Math.abs(centers[0]-centers[1])).toBeGreaterThan(30);
 }
 expect(await tape.first().evaluate(el=>({pointer:getComputedStyle(el).pointerEvents,animation:getComputedStyle(el).animationName}))).toEqual({pointer:'none',animation:'merge-tape-fade'});
 await page.screenshot({path:testInfo.outputPath(`tape-${area}.png`)});
 await expect(tape).toHaveCount(0);
 await page.evaluate(()=>mergeSegments([0]));await expect(tape).toHaveCount(0);
});
test('both context menus offer direct state modes',async({page})=>{
 await setup(page);
 for(const role of ['main','extension']) {
  await selectPair(page,role,'list');
  await page.locator(`#cues-container .multi-cue-column.${role}[data-${role==='main'?'main':'ext'}-idx="1"]`).click({button:'right'});
  await expect(page.locator('#ctxmenu .item').filter({hasText:'累加状态合并'})).toContainText('C');
  const common=page.locator('#ctxmenu .item').filter({hasText:'共有状态合并'});await expect(common).toContainText('Ctrl+Shift+C');
  await common.click();expect((await snapshot(page)).segments).toHaveLength(2);
  expect((await snapshot(page)).multi_subtitle.bindings).toHaveLength(1);
  await page.keyboard.press('Control+z');
 }
});
test.afterAll(async()=>{await server?.stop();});
async function setup(page,legacy=false){
 await disableOnboarding(page);
 await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
 const url=new URL(server.url);url.searchParams.set('subtitle-layers',legacy?'0':'1');
 await page.goto(url.href);
 await page.evaluate(()=>{
  applyCanonicalProject({media:DATA.media,segments:[
   {id:'m1',start:0,end:2000,text:'one',items:[{start:0,end:2000,text:'one'}],color:{name:'red',value:'#ff0000'}},
   {id:'m2',start:2000,end:4000,text:'two',items:[],disabled:true},
   {id:'m3',start:5000,end:6000,text:'outside',items:[]}
  ],multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'sub',role:'extension',split_mode:'continuous',segments:[
   {id:'s1',start:100,end:1900,text:'甲',items:[],color:{name:'purple',value:'#0000ff'}},
   {id:'s2',start:2100,end:3900,text:'乙',items:[],color:{name:'purple',value:'#0000ff'}}]}],bindings:[1,2].map(n=>({id:'b'+n,track_id:'sub',main_segment_ids:['m'+n],extension_segment_ids:['s'+n],start_offset_ms:100,end_offset_ms:-100}))},waveform:DATA.waveform},'merge-test.mosp');
  DATA.preview={...DATA.preview,project_style:MSWProjectStyle.defaults()};
  DATA.msw.removed_asset_ids=[];renderAll();
 });
}
const snapshot=page=>page.evaluate(()=>JSON.parse(buildJson()));
test('merge preserves audio, provenance and project style even with hidden partner track',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{
  DATA.multi_subtitle.enabled=false;
  DATA.msw.assets=[{id:'audio-'+'1'.repeat(32),kind:'audio',job_id:'job',path:'msw-'+'2'.repeat(24)+'.assets/audio/audio-'+'1'.repeat(32)+'.wav',sha256:'3'.repeat(64),sample_rate:24000,sample_count:48000,channels:1,byte_size:96044,
   generation:{provider:'test',model:'test',voice:'test',language_type:'Auto',display_text:'one',spoken_text:'one'},
   source_ref:{key:'source',id:'m1',track_id:null,text:'one',start:0,end:2000}}];
  DATA.msw.audio_tracks=[{id:'voice',name:'Voice',gain_db:0,muted:false}];
  DATA.msw.audio_clips=[MSWAudio.create(DATA.msw.assets[0],'voice',1200,'clip')];renderAll();
 });
 const before=await snapshot(page);
 expect(await page.evaluate(()=>mergeSegments([0,1]))).toBe(true);
 const after=await snapshot(page);
 expect(after.msw).toEqual(before.msw);expect(after.preview.project_style).toEqual(before.preview.project_style);
 expect(after.multi_subtitle.tracks[0].segments).toHaveLength(1);expect(after.multi_subtitle.bindings).toHaveLength(1);
 expect(await page.evaluate(()=>MSWAsr.assetStatuses(DATA).has(DATA.msw.assets[0].id))).toBe(true);
 await page.evaluate(()=>performUndo());expect(await snapshot(page)).toEqual(before);
});
test('partner collision rejects atomically and disabled result remains visible until another selection',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{DATA.subtitle_layers.allow_overlap=false;getActiveExtensionTrack().segments.push({id:'gap',start:1950,end:2050,text:'unrelated',items:[]});renderAll();});
 const before=await snapshot(page);const history=await page.evaluate(()=>editorHistory.undoLength());
 expect(await page.evaluate(()=>mergeSegments([0,1]))).toBe(false);expect(await snapshot(page)).toEqual(before);
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history);
 await page.evaluate(()=>{getActiveExtensionTrack().segments=getActiveExtensionTrack().segments.filter(s=>s.id!=='gap');renderAll();mergeSegments([0,1]);});
 const card=page.locator('#cues-container .multi-cue-column.main').filter({hasText:'one two'});
 await expect(card).toBeVisible();await expect(page.locator('.waveform-cue-block[data-track="main"]').filter({hasText:'one two'})).toBeVisible();
 await page.locator('#cues-container .text').filter({hasText:'outside'}).click();
 await expect(card).toBeHidden();await expect(page.locator('.waveform-cue-block[data-track="main"]').filter({hasText:'one two'})).toHaveCount(0);
});
async function selectPair(page,role,area){
 await page.evaluate(()=>{clearSelection();updateEditorSettings({cueListHideDisabled:false});renderAll();});
 const cue=index=>area==='waveform'?page.locator(`.waveform-cue-block[data-track="${role}"][data-cue-id="${role==='main'?'m':'s'}${index+1}"]`).first()
  :page.locator(`#cues-container .multi-cue-column.${role}[data-${role==='main'?'main':'ext'}-idx="${index}"] .time`);
 await cue(0).click();await cue(1).click({modifiers:['Control']});
}
for(const legacy of [false,true]) for(const role of ['main','extension']) for(const mode of ['union','common']){
 test(`direct linked merge ${role} ${mode} legacy=${legacy} preserves data and undo`,async({page})=>{
  await setup(page,legacy);expect(await page.evaluate(()=>layerMode())).toBe(!legacy);const before=await snapshot(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  expect(await page.evaluate(({role,mode})=>role==='main'?mergeSegments([0,1],mode):mergeExtensionSegments([0,1],getActiveExtensionTrack(),mode),{role,mode})).toBe(true);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#sel-count')).toHaveText('1');
  const after=await snapshot(page);
  expect(after.segments).toHaveLength(2);expect(after.multi_subtitle.tracks[0].segments).toHaveLength(1);
  expect(Boolean(after.segments[0].disabled)).toBe(mode==='union');
  expect(after.segments[0].color?.name).toBe(mode==='union'?'red':undefined);
  expect(after.segments[0].items).toEqual(before.segments[0].items);
  const sub=after.multi_subtitle.tracks[0].segments[0];expect(sub.color.name).toBe('purple');
  expect([sub.start,sub.end]).toEqual([100,3900]);
  expect(after.multi_subtitle.bindings).toHaveLength(1);
  expect(after.multi_subtitle.bindings[0].main_segment_ids).toEqual([after.segments[0].id]);
  expect(after.multi_subtitle.bindings[0].extension_segment_ids).toEqual([sub.id]);
  expect(after.preview.project_style).toEqual(before.preview.project_style);
  await expect(page.locator('#cues-container .cue').filter({hasText:'one two'})).toBeVisible();
  await page.evaluate(()=>performUndo());expect(await snapshot(page)).toEqual(before);
  await page.evaluate(()=>performRedo());expect(await snapshot(page)).toEqual(after);
  await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),after);
  expect((await snapshot(page)).multi_subtitle.bindings).toEqual(after.multi_subtitle.bindings);
  expect(errors).toEqual([]);
 });
}
for(const area of ['list','waveform']) for(const role of ['main','extension']){
 test(`${area} ${role} shortcuts merge both tracks and preserve copy`,async({page})=>{
  await setup(page);await selectPair(page,role,area);const before=await snapshot(page);
  const pagesBefore=page.context().pages().length;
  await page.keyboard.press('Control+c');expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(()=>window.MSW_CLIPBOARD_KIND)).toBe('cues');
  await page.keyboard.press('Control+Shift+C');
  expect((await snapshot(page)).segments).toHaveLength(2);
  expect((await snapshot(page)).segments[0].disabled).toBe(false);
  expect(page.context().pages()).toHaveLength(pagesBefore);
  await page.keyboard.press('Control+z');expect(await snapshot(page)).toEqual(before);
  await selectPair(page,role,area);await page.keyboard.press('c');
  expect((await snapshot(page)).segments).toHaveLength(2);
  expect((await snapshot(page)).segments[0].disabled).toBe(true);
  expect((await snapshot(page)).multi_subtitle.tracks[0].segments).toHaveLength(1);
 });
}
test('merge keyboard respects text editing, selection, dialogs and pending split',async({page})=>{
 await setup(page);await selectPair(page,'main','list');
 await page.locator('#cue-panel-text').focus();await page.keyboard.press('Control+Shift+C');
 expect((await snapshot(page)).segments).toHaveLength(3);
 await page.evaluate(()=>{document.activeElement.blur();const p=document.createElement('p');p.textContent='Selected help text';p.style.userSelect='text';document.body.append(p);const range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);});
 expect(await page.evaluate(()=>getSelection().toString())).toBe('Selected help text');
 await page.keyboard.press('Control+Shift+C');expect((await snapshot(page)).segments).toHaveLength(3);
 await page.evaluate(()=>{getSelection().removeAllRanges();const d=document.createElement('dialog');d.id='guard-dialog';document.body.append(d);d.showModal();});
 await page.keyboard.press('c');expect((await snapshot(page)).segments).toHaveLength(3);
 await page.evaluate(()=>document.getElementById('guard-dialog').remove());
 await page.evaluate(()=>openMainWaveformSplitModal(0,1000));
 const before=await snapshot(page);expect(await page.evaluate(()=>mergeSegments([0,1]))).toBe(false);
 expect(await snapshot(page)).toEqual(before);
});
