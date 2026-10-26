import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server;
test.use({viewport:{width:1500,height:1100}});
test.beforeAll(async()=>{const dir=makeTempDir('bound-move');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{await disableOnboarding(page);await page.goto(server.url);});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()).subtitles);
async function setup(page,{reverse=false,swap=false,frames=false,second=false,unbound=false}={}) {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(({waveform,reverse,swap,frames,second,unbound})=>{
    let p=MSWFlatSubtitles.migrate({segments:[{id:'a',start:1000,end:3000,text:'Hello',items:[{text:'Hello',start:1033,end:2887}]}],
      multi_subtitle:{enabled:true,tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:1200,end:3400,text:'你好',items:[]}]}],
        bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:200,end_offset_ms:400}]},waveform});
    MSWFlatSubtitles.normalizeGroups(p,{infer:true});
    const [main,sub]=p.subtitles.tracks;
    p.subtitles.tracks.push({...structuredClone(main),id:'destination',display_number:2},
      {...structuredClone(sub),id:'destination-sub',secondary_for:'destination',display_number:2});
    p.subtitles.next_track_number=3;
    if(second)for(const c of [...p.subtitles.cues])p.subtitles.cues.push({...structuredClone(c),id:c.id+'-2',content:{...structuredClone(c.content),start:c.content.start+4000,end:c.content.end+4000,items:[]}});
    if(second)for(const b of [...p.subtitles.bindings])p.subtitles.bindings.push({...b,id:b.id+'-2',source_id:b.source_id+'-2',target_id:b.target_id+'-2'});
    if(reverse)for(const b of p.subtitles.bindings){[b.source_id,b.target_id]=[b.target_id,b.source_id];b.start_offset_ms*=-1;b.end_offset_ms*=-1;}
    if(unbound)p.subtitles.bindings=[];
    if(frames)p.timebase={unit:'frames',fps:25};
    applyCanonicalProject(p,'bound-move.mosp');
    if(swap)productionCommitProject(MSWProductionProject.swapColumns(DATA),'测试换侧',[],{displayOnly:true});
    waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.settings.rowHeight=235;
    updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false,selectBoundSubtitlePair:false,multiSubtitleAutoSyncDuration:false});
    waveformEditor.render();
  },{waveform:generateWaveformPayload(30000),reverse,swap,frames,second,unbound});
  expect(errors).toEqual([]);return errors;
}
async function point(page,id,time){return page.evaluate(({id,time})=>{
  const row=[...document.querySelectorAll('.waveform-row')].find(r=>Number(r.dataset.startMs)<=time&&Number(r.dataset.endMs)>time);
  const rect=row.getBoundingClientRect(),lane=fixedLayout().positions.get(JSON.stringify([id,'main']));
  return {x:rect.left+rect.width*(time-Number(row.dataset.startMs))/(Number(row.dataset.endMs)-Number(row.dataset.startMs)),
    y:rect.bottom-7-(parseFloat(row.style.getPropertyValue('--audio-lane-space'))||0)-lane*waveformEditor.subtitleGeometry().pitch-waveformEditor.subtitleGeometry().height/2};
},{id,time});}
async function begin(page,source,target,at=2000,to=12000){const a=await point(page,source,at),b=await point(page,target,to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});}
for(const side of [0,1])for(const reverse of [false,true])test(`pair drag from side ${side}, reversed ${reverse}: both roles, ghosts, offsets and one undo`,async({page},info)=>{
  const errors=await setup(page,{reverse,swap:reverse});const before=await snap(page);
  const source=before.tracks[side].id,target=side===0?'destination-sub':'destination';
  await begin(page,source,target);
  expect(await page.evaluate(()=>waveformEditor.drag.destinationPreview.blocked)).toBe(false);
  const ghosts=page.locator('.waveform-row[data-start-ms="10000"] .waveform-drag-preview');await expect(ghosts).toHaveCount(2);
  expect(await ghosts.evaluateAll(nodes=>nodes.map(n=>n.dataset.subtitleTrackId).sort())).toEqual(['destination','destination-sub']);
  await page.screenshot({path:info.outputPath('paired-destination.png')});
  await page.mouse.up();const after=await snap(page);
  for(const c of before.cues){const moved=after.cues.find(n=>n.id===c.id);
    expect(moved.track_id).toBe(c.track_id===before.tracks[0].id?'destination':'destination-sub');
    expect(moved.content.start).toBe(c.content.start+10000);expect(moved.content.end).toBe(c.content.end+10000);
    expect(moved.content.items).toEqual(c.content.items.map(i=>({...i,start:i.start+10000,end:i.end+10000,start_frame:i.start_frame+300,end_frame:i.end_frame+300})));
  }
  expect(after.bindings).toEqual(before.bindings);
  await page.evaluate(()=>performUndo());expect(await snap(page)).toEqual(before);
  await page.evaluate(()=>performRedo());expect(await snap(page)).toEqual(after);
  await page.evaluate(()=>{const p=JSON.parse(buildJson());applyCanonicalProject(p,'reopen.mosp');});expect(await snap(page)).toEqual(after);
  expect(errors).toEqual([]);
});
test('cross-column multiselection moves both pairs once and Escape restores all',async({page})=>{
  const errors=await setup(page,{second:true});const before=await snap(page);
  await page.evaluate(()=>{selectedIdxs.add(0);selectedExtensionIdxs.add(1);waveformEditor.updateSelection();});
  await begin(page,before.tracks[0].id,'destination');
  expect(await page.evaluate(()=>waveformEditor.drag.fixedMove.entries.length)).toBe(4);
  for(const c of (await snap(page)).cues)expect(c.content.start).toBe(before.cues.find(n=>n.id===c.id).content.start+10000);
  await page.keyboard.press('Escape');await page.mouse.up();expect(await snap(page)).toEqual(before);expect(errors).toEqual([]);
});
test('locked, missing and occupied partner destinations reject the whole pair; folded destination retains its role',async({page})=>{
  const errors=await setup(page);const before=await snap(page),source=before.tracks[0].id;
  await page.evaluate(()=>fixedUpdateTrack('destination-sub',{locked:true}));const locked=await snap(page);
  await begin(page,source,'destination');await page.mouse.up();expect(await snap(page)).toEqual(locked);
  await page.evaluate(()=>fixedUpdateTrack('destination-sub',{locked:false}));
  await begin(page,source,'destination');await page.keyboard.press('Escape');await page.mouse.up();expect(await snap(page)).toEqual(before);
  await page.evaluate(()=>{layerCreateCue(10500,14500,'main','destination-sub');clearSelection();});const occupied=await snap(page);
  await begin(page,source,'destination');expect(await page.evaluate(()=>waveformEditor.drag.destinationPreview.blocked)).toBe(true);
  await page.mouse.up();expect(await snap(page)).toEqual(occupied);
  await setup(page);await page.evaluate(()=>fixedUpdateTrack('destination-sub',{collapsed:true}));
  await begin(page,(await snap(page)).tracks[0].id,'destination');await page.mouse.up();
  const moved=await snap(page);expect(moved.cues.map(c=>c.track_id).sort()).toEqual(['destination','destination-sub']);
  expect(moved.cues.every(c=>c.content.start>=11000)).toBe(true);expect(errors).toEqual([]);
});
test('manual binding uses group main as reference in either selection order and does not replace another pair',async({page})=>{
  const errors=await setup(page,{unbound:true,second:true});
  await page.evaluate(()=>{selectedExtensionIdxs.add(0);productionRememberSelection();selectedIdxs.add(0);productionBindSelected();});
  const bound=await snap(page),link=bound.bindings[0];expect(bound.cues.find(c=>c.id===link.source_id).track_id).toBe(bound.tracks[0].id);
  await begin(page,bound.tracks[1].id,bound.tracks[1].id,2000,2600);await page.mouse.up();
  const moved=await snap(page);for(const id of [link.source_id,link.target_id])expect(moved.cues.find(c=>c.id===id).content.start-bound.cues.find(c=>c.id===id).content.start).toBe(600);
  await page.evaluate(()=>{clearSelection();selectedIdxs.add(0);selectedExtensionIdxs.add(1);productionBindSelected();});expect(await snap(page)).toEqual(moved);expect(errors).toEqual([]);
});

test('frame-mode drag from the secondary preserves frame offsets and one local undo',async({page})=>{
  const errors=await setup(page,{frames:true});const before=await snap(page);
  await begin(page,before.tracks[1].id,'destination-sub');await page.mouse.up();const after=await snap(page);
  for(const c of before.cues){const moved=after.cues.find(n=>n.id===c.id).content;
    expect(moved.start).toBe(c.content.start+10000);expect(moved.end).toBe(c.content.end+10000);
    expect(moved.start_frame).toBe(c.content.start_frame+250);expect(moved.end_frame).toBe(c.content.end_frame+250);
  }
  expect(after.bindings).toEqual(before.bindings);await page.evaluate(()=>performUndo());expect(await snap(page)).toEqual(before);expect(errors).toEqual([]);
});
test('missing target peer and locked source peer cannot split a pair; Alt drag remains linked',async({page})=>{
  const errors=await setup(page);const before=await snap(page),source=before.tracks[0].id;
  await page.evaluate(()=>{fixedAddTrack('subtitle');});let saved=await snap(page);const target=saved.tracks.at(-1).id;
  await begin(page,source,target);expect(await page.evaluate(()=>waveformEditor.drag.destinationPreview.reason)).toContain('副轨道');
  await page.mouse.up();expect(await snap(page)).toEqual(saved);
  await page.evaluate(id=>fixedUpdateTrack(id,{locked:true}),before.tracks[1].id);saved=await snap(page);
  await begin(page,source,'destination');await page.mouse.up();expect(await snap(page)).toEqual(saved);
  await setup(page);const ready=await snap(page);
  await page.keyboard.down('Alt');await begin(page,ready.tracks[1].id,'destination-sub');await page.mouse.up();await page.keyboard.up('Alt');
  const after=await snap(page);expect(after.cues.every(c=>c.content.start>=11000)).toBe(true);expect(after.bindings).toEqual(ready.bindings);expect(errors).toEqual([]);
});
test('one-side binding cannot cross an obstacle on its partner and Shift snaps the whole pair once',async({page})=>{
  const errors=await setup(page);const before=await snap(page),[main,sub]=before.tracks;
  await page.evaluate(id=>{layerCreateCue(4000,5000,'main',id);clearSelection();},sub.id);const saved=await snap(page);
  await begin(page,main.id,main.id,2000,4000);await page.mouse.up();const after=await snap(page);
  const pair=before.cues.map(c=>after.cues.find(n=>n.id===c.id));
  expect(pair.find(c=>c.track_id===sub.id).content.end).toBe(4000);
  for(const c of pair)expect(c.content.start-before.cues.find(n=>n.id===c.id).content.start).toBe(600);
  await page.evaluate(()=>performUndo());expect(await snap(page)).toEqual(saved);
  await page.keyboard.down('Shift');await begin(page,main.id,main.id,2000,2580);await page.mouse.up();await page.keyboard.up('Shift');
  expect((await snap(page)).cues.find(c=>c.id===before.cues.find(n=>n.track_id===sub.id).id).content.end).toBe(4000);
  expect(errors).toEqual([]);
});
