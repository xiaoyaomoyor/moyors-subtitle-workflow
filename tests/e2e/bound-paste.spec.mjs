import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server;
test.use({viewport:{width:1500,height:1100}});
test.beforeAll(async()=>{const dir=makeTempDir('bound-paste');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{await disableOnboarding(page);await page.goto(server.url);});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()).subtitles);
async function setup(page,{reverse=false,swap=false,markers=false}={}) {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(({waveform,reverse,swap,markers})=>{
    let p=MSWFlatSubtitles.migrate({segments:[{id:'a',start:1000,end:3000,text:'Hello',items:[{text:'Hello',start:1033,end:2887}]}],
      multi_subtitle:{enabled:true,tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:1200,end:3400,text:'你好',items:[]}]}],
        bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:200,end_offset_ms:400}]},waveform});
    MSWFlatSubtitles.normalizeGroups(p,{infer:true});const [main,sub]=p.subtitles.tracks;
    p.subtitles.tracks.push({...structuredClone(main),id:'dest',display_number:2},
      {...structuredClone(sub),id:'dest-sub',secondary_for:'dest',display_number:2});p.subtitles.next_track_number=3;
    if(markers){const [a,b]=p.subtitles.cues;a.content.color={name:'red',value:'#ff0000',start:1000,end:3400};
      a.content.sticker={name:'star',start:1000,end:3400};b.content.color_ref={cue_id:a.id};b.content.sticker_ref={cue_id:a.id};}
    if(reverse){const b=p.subtitles.bindings[0];[b.source_id,b.target_id]=[b.target_id,b.source_id];b.start_offset_ms*=-1;b.end_offset_ms*=-1;}
    applyCanonicalProject(p,'bound-paste.mosp');
    if(swap)productionCommitProject(MSWProductionProject.swapColumns(DATA),'测试换侧',[],{displayOnly:true});
    waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.settings.rowHeight=235;
    updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false,selectBoundSubtitlePair:false,multiSubtitleAutoSyncDuration:false});
    waveformEditor.render();clearSelection();selectedIdxs.add(0);selectedExtensionIdxs.add(0);waveformEditor.updateSelection();
  },{waveform:generateWaveformPayload(30000),reverse,swap,markers});
  expect(errors).toEqual([]);return errors;
}
async function hover(page,id){const pt=await page.evaluate(id=>{
  const row=document.querySelector('.waveform-row'),r=row.getBoundingClientRect(),lane=fixedLayout().positions.get(JSON.stringify([id,'main']));
  return {x:r.left+r.width*.6,y:r.bottom-7-(parseFloat(row.style.getPropertyValue('--audio-lane-space'))||0)-lane*waveformEditor.subtitleGeometry().pitch-waveformEditor.subtitleGeometry().height/2};
},id);await page.mouse.move(pt.x,pt.y);}
const seek=(page,ms)=>page.evaluate(ms=>{if(!MSWE.resolve('audio-timeline').seek(ms))player.currentTime=ms/1000;},ms);
for(const target of ['dest','dest-sub'])for(const reverse of [false,true])test(`Ctrl+C/V pair to ${target}, reversed ${reverse}: selection, undo, redo and reopen`,async({page})=>{
  const errors=await setup(page,{reverse,swap:reverse});const before=await snap(page);
  const selection=await page.evaluate(()=>snapshotEditorSelection());
  await page.keyboard.press('Control+c');await hover(page,target);await seek(page,1000);
  await page.keyboard.press('Control+v');const after=await snap(page);
  const additions=after.cues.filter(c=>!before.cues.some(old=>old.id===c.id));expect(additions).toHaveLength(2);
  expect(additions.map(c=>c.track_id).sort()).toEqual(['dest','dest-sub']);expect(after.bindings).toHaveLength(2);
  for(const c of additions){const old=before.cues.find(a=>a.content.text===c.content.text);expect(c.content).toEqual(old.content);}
  expect(await page.evaluate(()=>[...processingSelection().mainIds,...processingSelection().extensionIds].sort())).toEqual(additions.map(c=>c.id).sort());
  await page.keyboard.press('Control+z');expect(await snap(page)).toEqual(before);
  expect(await page.evaluate(()=>snapshotEditorSelection())).toEqual(selection);
  await page.keyboard.press('Control+Shift+z');expect(await snap(page)).toEqual(after);
  await page.evaluate(()=>applyCanonicalProject(JSON.parse(buildJson()),'reopened.mosp'));expect(await snap(page)).toEqual(after);expect(errors).toEqual([]);
});
test('repeated paste has fresh references and IDs; original removal cannot break the clipboard',async({page})=>{
  const errors=await setup(page,{markers:true});const before=await snap(page);
  await page.keyboard.press('Control+c');await page.keyboard.press('Control+x');expect((await snap(page)).cues).toHaveLength(0);
  await hover(page,'dest-sub');await seek(page,6000);await page.keyboard.press('Control+v');const once=await snap(page);
  await seek(page,16000);await page.keyboard.press('Control+v');const twice=await snap(page);
  expect(twice.cues).toHaveLength(4);expect(new Set(twice.cues.map(c=>c.id)).size).toBe(4);expect(twice.bindings).toHaveLength(2);
  for(const b of twice.bindings){const a=twice.cues.find(c=>c.id===b.source_id),z=twice.cues.find(c=>c.id===b.target_id);
    expect(z.content.color_ref.cue_id).toBe(a.id);expect(z.content.sticker_ref.cue_id).toBe(a.id);expect(z.content.start-a.content.start).toBe(200);}
  await page.keyboard.press('Control+z');expect(await snap(page)).toEqual(once);
  await page.keyboard.press('Control+z');expect((await snap(page)).cues).toHaveLength(0);
  await page.keyboard.press('Control+z');expect(await snap(page)).toEqual(before);expect(errors).toEqual([]);
});
test('half-pair cut keeps the uncopied peer and undo restores the original binding',async({page})=>{
  const errors=await setup(page,{markers:true});const before=await snap(page);
  await page.evaluate(()=>{selectedIdxs.clear();waveformEditor.updateSelection();});
  await page.keyboard.press('Control+x');const cut=await snap(page);expect(cut.cues).toHaveLength(1);expect(cut.bindings).toHaveLength(0);
  await hover(page,'dest');await seek(page,6000);await page.keyboard.press('Control+v');const pasted=await snap(page);
  const added=pasted.cues.find(c=>c.id!==cut.cues[0].id);expect(added.track_id).toBe('dest');expect(added.content.text).toBe('你好');expect(added.content.color.name).toBe('red');expect(added.content.color_ref).toBeUndefined();
  expect(pasted.bindings).toHaveLength(0);await page.keyboard.press('Control+z');expect(await snap(page)).toEqual(cut);
  await page.keyboard.press('Control+z');expect(await snap(page)).toEqual(before);expect(errors).toEqual([]);
});
test('failed cut-paste retains the clipboard and does not insert history; locked copy remains readable',async({page})=>{
  const errors=await setup(page);const before=await snap(page);
  await page.evaluate(()=>fixedUpdateTrack('dest-sub',{locked:true}));const locked=await snap(page);
  await page.keyboard.press('Control+x');const cut=await snap(page);expect(cut.cues).toHaveLength(0);
  await hover(page,'dest');await seek(page,6000);await page.keyboard.press('Control+v');expect(await snap(page)).toEqual(cut);
  await page.keyboard.press('Control+z');expect(await snap(page)).toEqual(locked); // undo cut, not a failed paste
  await page.keyboard.press('Control+z');expect(await snap(page)).toEqual(before);
  await hover(page,'dest-sub');await page.keyboard.press('Control+v');expect((await snap(page)).cues).toHaveLength(4);
  await page.keyboard.press('Control+z');
  await page.evaluate(()=>{fixedUpdateTrack(DATA.subtitle_tracks.tracks[0].id,{locked:true});selectedIdxs.add(0);selectedExtensionIdxs.add(0);});
  await page.keyboard.press('Control+c');await hover(page,'dest');await seek(page,6000);await page.keyboard.press('Control+v');expect((await snap(page)).cues).toHaveLength(4);expect(errors).toEqual([]);
});
test('copy commits the current draft, ignores an empty selection and leaves text clipboard shortcuts native',async({page})=>{
  const errors=await setup(page);
  await page.evaluate(()=>{clearSelection();selectOnly(0);});
  const input=page.locator('#cue-panel-text');await input.fill('Edited before copy');
  await input.blur();await page.keyboard.press('Control+c');
  expect(await page.evaluate(()=>productionClipboard.rows[0].content.text)).toBe('Edited before copy');
  const copied=await page.evaluate(()=>JSON.stringify(productionClipboard));
  await page.evaluate(()=>{clearSelection();copySelectedCues();});expect(await page.evaluate(()=>JSON.stringify(productionClipboard))).toBe(copied);
  const result=await page.evaluate(()=>{
    const node=document.createElement('textarea');document.body.append(node);node.value='native text';node.focus();node.select();
    const events=['c','x','v'].map(key=>{const e=new KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true});node.dispatchEvent(e);return e.defaultPrevented;});node.remove();return events;
  });expect(result).toEqual([false,false,false]);expect(errors).toEqual([]);
});
test('stale pointer coordinates do not override the active destination; collisions are atomic',async({page})=>{
  const errors=await setup(page);const before=await snap(page);
  await page.keyboard.press('Control+c');await hover(page,'dest');
  await page.evaluate(()=>{fixedActiveTrackId=DATA.subtitle_tracks.tracks[0].id;waveformEditor.pointerLineEvent={clientX:1,clientY:1};});
  await seek(page,1000);await page.keyboard.press('Control+v');expect(await snap(page)).toEqual(before);
  await page.mouse.move(2,2);await page.evaluate(()=>{fixedActiveTrackId='dest-sub';});await page.keyboard.press('Control+v');expect((await snap(page)).cues).toHaveLength(4);expect(errors).toEqual([]);
});
test('paste before locked source marker groups preserves references and undo',async({page})=>{
  const errors=await setup(page,{markers:true});
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),head=p.subtitles.cues.find(c=>c.content.text==='Hello');
    p.subtitles.tracks.find(t=>t.id===head.track_id).locked=true;
    p.subtitles.cues.push({id:'tail',track_id:head.track_id,content:{start:4000,end:4500,text:'Tail',items:[],color_ref:{cue_id:head.id}}});
    applyCanonicalProject(p,'locked.mosp');clearSelection();selectedIdxs.add(0);selectedExtensionIdxs.add(0);waveformEditor.render();
  });
  const before=await snap(page);await page.keyboard.press('Control+c');await hover(page,'dest');await seek(page,0);await page.keyboard.press('Control+v');
  const after=await snap(page);expect(after.cues).toHaveLength(5);expect(after.cues.find(c=>c.id==='tail')).toEqual(before.cues.find(c=>c.id==='tail'));
  await page.keyboard.press('Control+z');expect(await snap(page)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');expect(await snap(page)).toEqual(after);expect(errors).toEqual([]);
});

test('reused list cards keep correct click, edit and context targets after indices shift',async({page})=>{
  const errors=await setup(page);
  const original=await page.evaluate(()=>{
    const a=DATA.segments[0],b=getActiveExtensionTrack().segments[0];
    window.originalPasteRow=document.querySelector(`.cue[data-main-id="${a.id}"]`);return {a:a.id,b:b.id};
  });
  await page.keyboard.press('Control+c');await hover(page,'dest');await seek(page,0);await page.keyboard.press('Control+v');
  expect(await page.evaluate(id=>document.querySelector(`.cue[data-main-id="${id}"]`)===window.originalPasteRow,original.a)).toBe(true);
  expect(await page.evaluate(()=>({kind:editorHistory.peekUndo().kind,bytes:JSON.stringify(editorHistory.peekUndo()).length})))
    .toEqual({kind:'subtitle-insertion',bytes:expect.any(Number)});
  const row=page.locator(`.cue[data-main-id="${original.a}"]`);
  await row.locator('.multi-cue-column.main .text').click();
  expect(await page.evaluate(()=>getCurrentCuePanelTarget().segment.id)).toBe(original.a);
  await row.locator('.multi-cue-column.extension .text').click();
  expect(await page.evaluate(()=>getCurrentCuePanelTarget().segment.id)).toBe(original.b);
  await row.locator('.multi-cue-column.extension .text').click({button:'right'});
  expect(await page.evaluate(()=>[...processingSelection().extensionIds])).toEqual([original.b]);
  await page.keyboard.press('Escape');
  await row.locator('.multi-cue-column.main .text').dblclick();
  expect(await page.evaluate(()=>DATA.segments[editingState.idx].id)).toBe(original.a);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');await page.keyboard.press('Control+Shift+z');
  await row.locator('.multi-cue-column.extension .text').click();
  expect(await page.evaluate(()=>getCurrentCuePanelTarget().segment.id)).toBe(original.b);
  expect(errors).toEqual([]);
});

test('reused marker references jump to the reindexed head and review updates the live cue',async({page})=>{
  const errors=await setup(page,{markers:true});
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),head=p.subtitles.cues.find(c=>c.content.text==='Hello');
    p.subtitles.cues.push({id:'tail',track_id:head.track_id,content:{start:4000,end:4500,text:'Review tail',items:[],review_required:true,color_ref:{cue_id:head.id},sticker_ref:{cue_id:head.id,name:'star'}}});
    applyCanonicalProject(p,'review.mosp');clearSelection();selectedIdxs.add(0);selectedExtensionIdxs.add(0);waveformEditor.render();
    window.originalTail=document.querySelector('.cue[data-main-id="tail"]');
  });
  await page.keyboard.press('Control+c');await hover(page,'dest');await seek(page,0);await page.keyboard.press('Control+v');
  expect(await page.evaluate(()=>document.querySelector('.cue[data-main-id="tail"]')===window.originalTail)).toBe(true);
  const tail=page.locator('.cue[data-main-id="tail"]');await tail.locator('.color-bar.is-ref').click();
  expect(await page.evaluate(()=>getCurrentCuePanelTarget().segment.text)).toBe('Hello');
  await tail.locator('.sticker-slot .sref').click();expect(await page.evaluate(()=>getCurrentCuePanelTarget().segment.text)).toBe('Hello');
  await tail.locator('.msw-review-badge').click();expect(await page.evaluate(()=>DATA.segments.find(c=>c.id==='tail').review_required)).toBeUndefined();
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>DATA.segments.find(c=>c.id==='tail').review_required)).toBe(true);
  expect(errors).toEqual([]);
});
