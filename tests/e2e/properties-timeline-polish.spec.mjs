import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server,errors;
test.beforeAll(async()=>{const dir=makeTempDir('properties-timeline');server=await startStaticServer(generateBlankEditor(join(dir,'blank.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
  errors=[];page.on('pageerror',e=>errors.push(e.stack));page.on('dialog',d=>d.dismiss());await disableOnboarding(page);await page.goto(server.url);
  await page.evaluate(waveform=>{
    applyCanonicalProject({segments:[{id:'a',start:1000,end:2000,text:'First'},{id:'b',start:4000,end:5000,text:'Second'}],
      multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[{id:'sub',start:1000,end:2000,text:'Translation'}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['sub']}]},waveform},'test.mosp');
    updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false,clickBehavior:'select-only'});
    waveformEditor.settings.mode='multi';waveformEditor.settings.rowHeight=150;waveformEditor.settings.secondsPerRow=10;waveformEditor.render();
  },generateWaveformPayload(120000));
});
test.afterEach(()=>expect(errors).toEqual([]));
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()).subtitles);
const ranges=p=>Object.fromEntries(p.cues.map(c=>[c.content.text,[c.content.start,c.content.end]]));
async function edgeDrag(page,delta,cancel=false){
  const block=page.locator('.waveform-cue-block').filter({hasText:'First'}).first(),r=await block.boundingBox();
  const row=await block.locator('..').boundingBox();
  await page.mouse.move(r.x+r.width-1,r.y+r.height/2);await page.mouse.down();
  await page.mouse.move(r.x+r.width-1+row.width*delta/10000,r.y+r.height/2,{steps:5});
  if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
}
test('multiselection resizes both columns together, keeps bound offsets, cancels and undoes once',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);addToSelection(1);addExtensionToSelection(0);});
  const before=await snap(page);await edgeDrag(page,500,true);expect(ranges(await snap(page))).toEqual(ranges(before));
  await edgeDrag(page,500);const after=await snap(page),r=ranges(after),delta=r.First[1]-2000;
  expect(delta).toBeGreaterThan(400);expect(delta).toBeLessThan(600);
  expect(r).toEqual({First:[1000,2000+delta],Second:[4000,5000+delta],Translation:[1000,2000+delta]});
  expect(after.bindings).toEqual(before.bindings);
  await page.evaluate(()=>performUndo());expect(ranges(await snap(page))).toEqual(ranges(before));
  await page.evaluate(()=>performRedo());expect(ranges(await snap(page))).toEqual(r);
});

test('multiselection endpoint resize stops at neighbours and locked bound tracks block the whole gesture',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);addToSelection(1);});
  await edgeDrag(page,5000);
  expect(ranges(await snap(page))).toEqual({First:[1000,4000],Second:[4000,7000],Translation:[1000,4000]});
  await page.evaluate(()=>performUndo());
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson());p.subtitles.tracks[1].locked=true;
    productionCommitProject(p,'lock fixture',p.subtitles.cues.filter(c=>c.track_id===p.subtitles.tracks[0].id).map(c=>c.id));
  });
  const before=await snap(page);await edgeDrag(page,500);expect(await snap(page)).toEqual(before);
});
test('selecting a cue and switching to properties preserves virtual waveform viewport',async({page})=>{
  await page.evaluate(()=>{
    fixedAddTrack('subtitle');const p=JSON.parse(buildJson()),track=p.subtitles.tracks.at(-1);
    p.subtitles.cues.push({id:'s2',track_id:track.id,content:{start:62000,end:65000,text:'Annotation',items:[]}});
    productionCommitProject(p,'fixture',['s2']);
    const w=waveformEditor;w.ensureCustomLayoutForDrag();
    w.settings.layoutTree={type:'split',direction:'row',ratio:45,children:[{type:'split',direction:'column',ratio:50,children:[{type:'module',id:'player'},{type:'tabs',activeIndex:0,children:[{type:'module',id:'cues'},{type:'module',id:'properties'}]}]},{type:'module',id:'wave'}]};
    w.applyLayout();w.render();w.scroll.scrollTop=5*(w.effectiveRowHeight+10);w.renderMultiVisible(true);
  });
  const old=await page.evaluate(()=>waveformEditor.scroll.scrollTop);
  await page.locator('[data-dock-module="cues"] [data-tab-for="properties"]').click();
  await expect(page.locator('#subtitle-properties')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>waveformEditor.scroll.scrollTop)).toBe(old);
  const covers=await page.evaluate(()=>{const w=waveformEditor,top=w.scroll.scrollTop;return w.renderedRows.some(r=>r.offsetTop<=top+70&&r.offsetTop+r.offsetHeight>top);});
  expect(covers).toBe(true);
});
test('right dock divider respects minimum space of nested left modules',async({page})=>{
  await page.evaluate(()=>{
    const w=waveformEditor;w.ensureCustomLayoutForDrag();w.settings.layoutTree={type:'split',direction:'row',ratio:75,children:[
      {type:'split',direction:'row',ratio:40,children:[{type:'module',id:'player'},{type:'module',id:'wave'}]},{type:'module',id:'properties'}]};w.applyLayout();w.render();
  });
  const divider=page.locator('.free-layout-root > .layout-split > .layout-split-divider'),r=await divider.boundingBox();
  await page.mouse.move(r.x+3,r.y+40);await page.mouse.down();await page.mouse.move(150,r.y+40,{steps:8});await page.mouse.up();
  expect((await page.locator('[data-dock-module="player"]').boundingBox()).width).toBeGreaterThanOrEqual(219);
  expect((await page.locator('[data-dock-module="wave"]').boundingBox()).width).toBeGreaterThanOrEqual(259);
});
test('paste chooses hovered physical track instead of selected cue track',async({page})=>{
  await page.evaluate(()=>{fixedAddTrack('subtitle');selectOnly(0);productionCaptureClipboard();});
  const before=await snap(page);
  const target=await page.evaluate(()=>DATA.subtitle_tracks.tracks.at(-1).id);
  const point=await page.evaluate(id=>{
    const row=document.querySelector('.waveform-row'),r=row.getBoundingClientRect(),band=fixedLayout().bands.find(b=>b.track.id===id);
    return {x:r.left+r.width*.7,y:r.bottom-7-(band.bottom+.5)*fixedWaveGeometry().pitch};
  },target);
  await page.mouse.move(point.x,point.y);
  await page.evaluate(()=>{productionPasteClipboard();});
  const p=await snap(page),copy=p.cues.find(c=>!before.cues.some(old=>old.id===c.id));
  expect(copy?.track_id).toBe(target);expect(copy.content.text).toBe('First');
});

test('font fields remain editable without a local service and have no duplicate search input',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});
  await expect(page.locator('#style-scan-fonts')).toHaveCount(0);
  await page.locator('#style-field-latinFontName').fill('Georgia');
  await expect(page.locator('#style-local-fonts input')).toHaveCount(0);
  await page.locator('#style-field-latinFontName').blur();
  expect((await snap(page)).cues.find(c=>c.content.text==='First').content.subtitle_style.latinFontName).toBe('Georgia');
});
