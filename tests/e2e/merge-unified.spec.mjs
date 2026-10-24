import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
let server;
test.beforeAll(async()=>{
 const folder=makeTempDir('merge-unified'),media=join(folder,'synthetic.wav'),project=join(folder,'project.mosp');
 process.env.MSW_APP_DATA_ROOT=join(folder,'settings');process.env.MAW_ENV_FILE=join(folder,'isolated.env');
 generateWav(media,8);writeFileSync(project,JSON.stringify({media,segments:[],waveform:generateWaveformPayload(8000)}));
 server=await startServer(project,media,await findFreePort());
});
for(const area of ['list','waveform']) for(const motion of ['reduce','no-preference']) test(`optional tape effect at ${area} joins with ${motion} is independent, local and removed`,async({page},testInfo)=>{
 await setup(page,false,true);await selectPair(page,'main',area);
 expect(await page.evaluate(()=>EDITOR_SETTINGS.mergeTapeEffect)).toBe(false);
 await page.keyboard.press('c');await expect(page.locator('.merge-tape-flash')).toHaveCount(0);
 await page.keyboard.press('Control+z');
 await page.evaluate(()=>setEditorSettingsPanelOpen(true));
 await page.locator('.settings-nav-item[data-settings-category="ninja"]').click();
 await page.locator('#merge-tape-effect').check();await expect(page.locator('#ninja-mode')).not.toBeChecked();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('moy.asr.editor.settings.v1')).mergeTapeEffect)).toBe(true);
 await page.evaluate(()=>setEditorSettingsPanelOpen(false));
 await selectPair(page,'main',area);
 await page.emulateMedia({reducedMotion:motion});
 await page.keyboard.press('c');
 const tape=page.locator('.merge-tape-flash');await expect(tape).toHaveCount(2);
 if (area==='waveform') {
  const centers=await tape.evaluateAll(nodes=>nodes.map(n=>parseFloat(n.style.top)));
  expect(Math.abs(centers[0]-centers[1])).toBeGreaterThan(30);
 }
 expect(await tape.first().evaluate(el=>({pointer:getComputedStyle(el).pointerEvents,animation:getComputedStyle(el).animationName}))).toEqual({pointer:'none',animation:motion==='reduce'?'merge-tape-fade':'merge-tape-stick'});
 await page.screenshot({path:testInfo.outputPath(`tape-${area}.png`)});
 await expect(tape).toHaveCount(0);
 await page.evaluate(()=>mergeSegments([0]));await expect(tape).toHaveCount(0);
});

async function manyCueFixture(page,area,{hiddenPartner=false}={}){
 await page.setViewportSize({width:1500,height:1100});
 await setup(page,false,true);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(({waveform,area,hiddenPartner})=>{
  const cues=Array.from({length:4},(_,i)=>({id:`m${i}`,start:i*2000,end:(i+1)*2000,text:`Caption ${i+1}`,items:[]}));
  applyCanonicalProject({segments:cues,multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'sub',role:'extension',segments:cues.map((cue,i)=>({...cue,id:`s${i}`,text:`译文 ${i+1}`}))}],
   bindings:cues.map((cue,i)=>({id:`b${i}`,track_id:'sub',main_segment_ids:[cue.id],extension_segment_ids:[`s${i}`],start_offset_ms:0,end_offset_ms:0}))},waveform},'many-merge.mosp');
  EDITOR_SETTINGS.mergeTapeEffect=true;
  waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=4;waveformEditor.settings.rowHeight=120;
  if(hiddenPartner){const ext=getActiveExtensionTrack();fixedUpdateTrack(fixedOwner(ext.segments[0],'extension',ext.id),{collapsed:true});}
  renderAll({waveform:'full'});lastPointerPos={x:0,y:0};lastEditRegion=area==='waveform'?'waveform':'list';
 },{waveform:generateWaveformPayload(8000),area,hiddenPartner});
}

test('multi-cue waveform tape marks every visible join on the result including the next line boundary',async({page},info)=>{
 await manyCueFixture(page,'waveform');
 const result=await page.evaluate(async()=>{
  const ok=mergeSegments([0,1,2,3]);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  return {ok,production:productionFlatMode(),tapes:[...document.querySelectorAll('.merge-tape-flash')].map(tape=>{
   const time=Number(tape.dataset.timeMs),blocks=[...document.querySelectorAll(`.waveform-cue-block[data-cue-id="${tape.dataset.cueId}"]`)];
   const block=blocks.find(node=>{const row=node.closest('.waveform-row');return time>=Number(row.dataset.startMs)&&time<Number(row.dataset.endMs);});
   const rect=block?.getBoundingClientRect(), row=block?.closest('.waveform-row');
   return {time,rowStart:Number(row?.dataset.startMs),y:parseFloat(tape.style.top),expectedY:rect?.top+rect?.height/2,width:parseFloat(getComputedStyle(tape).width)};
  })};
 });
 expect(result.ok).toBe(true);expect(result.production).toBe(true);expect(result.tapes).toHaveLength(6);
 expect(result.tapes.map(t=>t.time).sort((a,b)=>a-b)).toEqual([2000,2000,4000,4000,6000,6000]);
 for(const tape of result.tapes){expect(tape.width).toBe(108);expect(Math.abs(tape.y-tape.expectedY)).toBeLessThan(1);if(tape.time===4000)expect(tape.rowStart).toBe(4000);}
 await page.screenshot({path:info.outputPath('many-tapes-waveform.png')});
 await expect(page.locator('.merge-tape-flash')).toHaveCount(0);
});

test('multi-cue list tape follows the final paired cards instead of removed card coordinates',async({page},info)=>{
 await manyCueFixture(page,'list');
 const result=await page.evaluate(async()=>{
  mergeSegments([0,1,2,3]);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  return [...document.querySelectorAll('.merge-tape-flash')].map(tape=>{
   const row=document.querySelector(`.cue[data-main-id="${tape.dataset.cueId}"],.cue[data-ext-id="${tape.dataset.cueId}"]`);
   const column=row.querySelector(row.dataset.mainId===tape.dataset.cueId?'.multi-cue-column.main':'.multi-cue-column.extension')||row;
   const rect=column.getBoundingClientRect();return {x:parseFloat(tape.style.left),y:parseFloat(tape.style.top),left:rect.left,right:rect.right,bottom:rect.bottom};
  });
 });
 expect(result).toHaveLength(2);
 for(const tape of result){expect(tape.x).toBeGreaterThan(tape.left);expect(tape.x).toBeLessThan(tape.right);expect(Math.abs(tape.y-(tape.bottom-7))).toBeLessThan(1);}
 await page.screenshot({path:info.outputPath('many-tapes-list.png')});
});

test('a tall merged card keeps tape on its visible edge instead of below the viewport',async({page})=>{
 await manyCueFixture(page,'list');
 const result=await page.evaluate(async()=>{
  DATA.segments.forEach(cue=>{cue.text='Long caption text. '.repeat(90);});
  // A user can dock the list in a pane shorter than the resulting card.
  container.style.minHeight='0';container.style.maxHeight='90px';
  renderAll();mergeSegments([0,1,2,3]);
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  const bounds=cueListVisibleBounds(),card=container.querySelector('.multi-cue-column.main').getBoundingClientRect();
  return {cardBottom:card.bottom,top:bounds.top,bottom:bounds.bottom,tapes:[...document.querySelectorAll('.merge-tape-flash')].map(node=>({y:parseFloat(node.style.top),id:node.dataset.cueId})),id:DATA.segments[0].id};
 });
 expect(result.cardBottom).toBeGreaterThan(result.bottom);
 expect(result.tapes.some(tape=>tape.id===result.id)).toBe(true);
 for(const tape of result.tapes){expect(tape.y).toBeGreaterThan(result.top);expect(tape.y).toBeLessThan(result.bottom);}
});

test('collapsed partner has no floating tape and a new merge clears all previous strips',async({page})=>{
 await manyCueFixture(page,'waveform',{hiddenPartner:true});
 const result=await page.evaluate(async()=>{
  mergeSegments([0,1]);await new Promise(requestAnimationFrame);
  const previous=[...document.querySelectorAll('.merge-tape-flash')];
  mergeSegments([0,1,2]);await new Promise(requestAnimationFrame);
  return {oldCount:previous.length,detached:previous.every(node=>!node.isConnected),
   tapes:[...document.querySelectorAll('.merge-tape-flash')].map(node=>({id:node.dataset.cueId,time:Number(node.dataset.timeMs)})),id:DATA.segments[0].id};
 });
 expect(result.oldCount).toBe(1);expect(result.detached).toBe(true);expect(result.tapes).toHaveLength(2);
 expect(result.tapes.map(t=>t.time)).toEqual([4000,6000]);expect(result.tapes.every(t=>t.id===result.id)).toBe(true);
});

test('dense joins are deduplicated and capped while disabling the Easter egg clears pending feedback',async({page})=>{
 await manyCueFixture(page,'waveform',{hiddenPartner:true});
 const result=await page.evaluate(async()=>{
  mergeSegments([0,1,2,3]);
  triggerMergeFeedback([{cueId:DATA.segments[0].id,region:'waveform',times:Array.from({length:160},(_,i)=>i*50)}]);
  await new Promise(requestAnimationFrame);
  const positions=[...document.querySelectorAll('.merge-tape-flash')].map(tape=>({x:parseFloat(tape.style.left),y:parseFloat(tape.style.top)}));
  const toggle=document.getElementById('merge-tape-effect');toggle.checked=false;toggle.dispatchEvent(new Event('change'));
  return {positions,remaining:document.querySelectorAll('.merge-tape-flash').length};
 });
 expect(result.positions.length).toBeGreaterThan(2);expect(result.positions.length).toBeLessThanOrEqual(12);
 for(let i=0;i<result.positions.length;i++)for(let j=i+1;j<result.positions.length;j++){
  const a=result.positions[i],b=result.positions[j];expect(Math.abs(a.x-b.x)>=44||Math.abs(a.y-b.y)>=16).toBe(true);
 }
 expect(result.remaining).toBe(0);
});

test('physical-track cross-column merge resolves the real resulting cue for tape feedback',async({page})=>{
 await setup(page,false,true);await page.emulateMedia({reducedMotion:'reduce'});
 const result=await page.evaluate(async waveform=>{
  let project=MSWFlatSubtitles.migrate({segments:[0,1,2].map(i=>({id:`cross${i}`,start:i*2000,end:(i+1)*2000,text:`Part ${i+1}`,items:[]})),waveform});
  project.subtitle_view={secondary_cue_ids:[project.subtitles.cues[1].id]};
  applyCanonicalProject(project,'cross-tape.mosp');EDITOR_SETTINGS.mergeTapeEffect=true;
  clearSelection({silent:true});DATA.segments.forEach((_,i)=>selectedIdxs.add(i));getActiveExtensionTrack().segments.forEach((_,i)=>selectedExtensionIdxs.add(i));
  lastPointerPos={x:0,y:0};lastEditRegion='list';const ok=mergeSegments([...selectedIdxs]);
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  return {ok,resultIds:MSWProductionProject.toProject(DATA).subtitles.cues.map(c=>c.id),tapeIds:[...document.querySelectorAll('.merge-tape-flash')].map(t=>t.dataset.cueId)};
 },generateWaveformPayload(8000));
 expect(result.ok).toBe(true);expect(result.resultIds).toHaveLength(1);expect(result.tapeIds).toEqual(result.resultIds);
});

for(const area of ['list','waveform']) test(`normal-motion ${area} tape survives redraw and another pane restoring its scroll`,async({page},info)=>{
 await manyCueFixture(page,area);
 await page.emulateMedia({reducedMotion:'no-preference'});
 const result=await page.evaluate(async area=>{
  DATA.segments.push(...Array.from({length:24},(_,i)=>({id:`tail${i}`,start:8000+i*1000,end:9000+i*1000,text:`Following caption ${i}`,items:[]})));
  waveformEditor.settings.secondsPerRow=1;waveformEditor.settings.rowHeight=160;
  renderAll({waveform:'full'});
  mergeSegments([0,1,2,3]);await new Promise(requestAnimationFrame);
  const tapes=[...document.querySelectorAll('.merge-tape-flash')];
  // Layout restoration and preview updates can run after the merge's first frame.
  renderAll({waveform:'full'});
  const other=area==='list'?document.getElementById('waveform-scroll'):container;
  other.scrollTop=80;
  const scroll=other.scrollTop;
  await new Promise(resolve=>setTimeout(resolve,180));
  return {scroll,count:tapes.length,visible:tapes.filter(node=>node.isConnected&&Number(getComputedStyle(node).opacity)>.5).length};
 },area);
 expect(result.scroll).toBeGreaterThan(0);expect(result.count).toBeGreaterThan(0);
 expect(result.visible).toBe(result.count);
 await page.screenshot({path:info.outputPath(`normal-motion-${area}.png`)});
 await expect(page.locator('.merge-tape-flash')).toHaveCount(0);
});

test('scrolling the timeline keeps visible tape attached to the resulting block',async({page})=>{
 await manyCueFixture(page,'waveform');
 const before=await page.evaluate(async()=>{
  waveformEditor.settings.secondsPerRow=1;waveformEditor.settings.rowHeight=160;waveformEditor.render();
  mergeSegments([0,1,2,3]);await new Promise(requestAnimationFrame);
  return document.querySelectorAll('.merge-tape-flash').length;
 });
 expect(before).toBeGreaterThan(0);
 const scroll=await page.locator('#waveform-scroll').evaluate(async node=>{
  node.scrollTop=40;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  return {top:node.scrollTop,tapes:[...document.querySelectorAll('.merge-tape-flash')].map(tape=>{
   const time=Number(tape.dataset.timeMs);
   const block=[...node.querySelectorAll(`.waveform-cue-block[data-cue-id="${tape.dataset.cueId}"]`)].find(block=>{
    const row=block.closest('.waveform-row');return time>=Number(row.dataset.startMs)&&time<Number(row.dataset.endMs);
   });
   const rect=block.getBoundingClientRect();return {y:parseFloat(tape.style.top),expected:rect.top+rect.height/2};
  })};
 });
 expect(scroll.top).toBeGreaterThan(0);expect(scroll.tapes.length).toBeGreaterThan(0);
 for(const tape of scroll.tapes)expect(Math.abs(tape.y-tape.expected)).toBeLessThan(1);
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
async function setup(page,legacy=false,production=false){
 await disableOnboarding(page);
 await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
 const url=new URL(server.url);url.searchParams.set('subtitle-layers',legacy?'0':'1');
 if(!production)url.searchParams.set('flat-production','0');
 if(legacy)url.searchParams.set('subtitle-tracks','0');
 await page.goto(url.href);
 await page.evaluate(waveform=>{
  updateEditorSettings({autoSaveProject:false,mergeTapeEffect:false,ninjaMode:false});
  applyNinjaSettings();
  applyCanonicalProject({segments:[
   {id:'m1',start:0,end:2000,text:'one',items:[{start:0,end:2000,text:'one'}],color:{name:'red',value:'#ff0000'}},
   {id:'m2',start:2000,end:4000,text:'two',items:[],disabled:true},
   {id:'m3',start:5000,end:6000,text:'outside',items:[]}
  ],multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'sub',role:'extension',split_mode:'continuous',segments:[
   {id:'s1',start:100,end:1900,text:'甲',items:[],color:{name:'purple',value:'#0000ff'}},
   {id:'s2',start:2100,end:3900,text:'乙',items:[],color:{name:'purple',value:'#0000ff'}}]}],bindings:[1,2].map(n=>({id:'b'+n,track_id:'sub',main_segment_ids:['m'+n],extension_segment_ids:['s'+n],start_offset_ms:100,end_offset_ms:-100}))},waveform},'merge-test.mosp');
  DATA.preview={...DATA.preview,project_style:MSWProjectStyle.defaults()};
  DATA.msw.removed_asset_ids=[];renderAll({waveform:'full'});
 },generateWaveformPayload(8000));
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
 await page.evaluate(()=>{updateEditorSettings({cueListHideDisabled:true});waveformEditor.settings.disabledDisplay='hidden';waveformEditor.render();});
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
 const cue=index=>area==='waveform'?page.locator(`.waveform-cue-block[data-track="${role}"][data-${role==='main'?'idx':'ext-idx'}="${index}"]`).first()
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
