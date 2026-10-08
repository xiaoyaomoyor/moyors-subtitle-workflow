import {expect, test} from '@playwright/test';
import {join} from 'node:path';
import {DURATION_MS, cleanupTempDir, findFreePort, generateProjectJson, generateWav, makeTempDir, startServer, clickMenubarItem} from './helpers.mjs';
let tempDir, server;
test.beforeAll(async () => {
  tempDir=makeTempDir('gap-retention');
  const media=join(tempDir,'synthetic.wav'), project=join(tempDir,'project.json');
  generateWav(media,DURATION_MS/1000); generateProjectJson(project);
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async () => {await server?.stop();cleanupTempDir(tempDir);});
test.beforeEach(async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url); await expect(page.locator('.waveform-row').first()).toBeVisible();
  await page.evaluate(()=>setGapRemoveData({gaps:[{start:1000,end:2000},{start:3000,end:4000}]}));
});
const shape=page=>page.evaluate(()=>getGapRemoveGaps());
const open=page=>clickMenubarItem(page,'媒体','gap-remove-manage');
async function menu(page,index=0) {
  await page.locator(`.waveform-gap-block[data-gap-index="${index}"]`).first().click({button:'right',position:{x:8,y:12}});
  return page.locator('#ctxmenu');
}

test('right-click retention locks a dimmed marker but still skips it and persists on save',async({page})=>{
  const context=await menu(page);
  await expect(context.locator('.item')).toHaveText(['固定空隙','转为时间选区','删除该空隙','删除所有未固定空隙']);
  await context.getByText('固定空隙',{exact:true}).click();
  const locked=page.locator('.waveform-gap-block.retained').first();
  await expect(locked).toHaveClass(/restored/); await expect(locked.locator('.waveform-gap-handle')).toHaveCount(0);
  const before=await shape(page), box=await locked.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+20); await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+80,box.y+20,{steps:5}); await page.mouse.up();
  expect(await shape(page)).toEqual(before);
  expect(await page.evaluate(()=>window.MSWE.resolve('processing-host').audioPlaybackSkip(1500))).toEqual({start:1000,end:2000});
  await page.evaluate(()=>{DATA.gap_remove=JSON.parse(buildJson()).gap_remove;updateGapRemoveUi();});
  expect(await shape(page)).toEqual(before);
  expect(await page.evaluate(()=>JSON.parse(buildJson()).gap_remove.gaps.every(g=>g.removed))).toBe(true);
  await menu(page); await expect(context.getByText('取消固定',{exact:true})).toBeVisible();
  await context.getByText('取消固定',{exact:true}).click();
  await expect(page.locator('.waveform-gap-block.retained')).toHaveCount(0);
});

test('regeneration removes every unretained source and manual edit while preserving exact locked bounds',async({page})=>{
  await page.evaluate(()=>{
    toggleGapRemoved(0); applyManualGapRange(5000,6000,true);
    const state=getGapRemoveData(true), core=window.AsrGapRemoveCore;
    const provenance=core.replaceGapRemoveProvenanceSource(state.provenance,'subtitle_outside',[{start:7000,end:8000}]);
    setGapRemoveData({...state,lead_in_ms:0,lead_out_ms:0},{provenance});
    const peaks=new Int8Array(80);
    for(let i=0;i<40;i++)if(i<15||i>=25){peaks[2*i]=-100;peaks[2*i+1]=100;}
    waveformEditor.getGapRemoveDetectionData=()=>({peaks,peaks_per_second:10,duration_ms:4000});
  });
  const before=await shape(page); await open(page);
  await page.locator('#gap-remove-scan').click();
  await expect.poll(()=>shape(page)).toEqual([
    {start:1000,end:2000,removed:true,retained:true},
    {start:2000,end:2500,removed:true,retained:false},
  ]);
  await page.evaluate(()=>performUndo()); expect(await shape(page)).toEqual(before);
  await page.evaluate(()=>performRedo());
  await page.locator('#gap-remove-source').selectOption('subtitle_outside');
  await page.evaluate(()=>{DATA.segments=[{id:'full',start:0,end:300000,text:'full',items:[]}];});
  await page.locator('#gap-remove-scan').click();
  await expect.poll(()=>shape(page)).toEqual([{start:1000,end:2000,removed:true,retained:true}]);
});

test('single and bulk conversion merge time selections and undo restores both in one step',async({page})=>{
  await page.evaluate(()=>{toggleGapRemoved(0);window.MSWE.resolve('time-range').setRange([{start:500,end:1500}]);});
  const before=await shape(page);
  const context=await menu(page); await context.getByText('转为时间选区',{exact:true}).click();
  expect(await page.evaluate(()=>window.MSWE.resolve('time-range').ranges)).toEqual([{start:500,end:2000}]);
  expect((await shape(page)).map(g=>g.start)).toEqual([3000]);
  await page.evaluate(()=>performUndo()); expect(await shape(page)).toEqual(before);
  expect(await page.evaluate(()=>window.MSWE.resolve('time-range').ranges)).toEqual([{start:500,end:1500}]);
  await page.evaluate(()=>performRedo());
  await open(page); await page.locator('#gap-convert-all').click();
  expect(await shape(page)).toEqual([]);
  expect(await page.evaluate(()=>window.MSWE.resolve('time-range').ranges)).toEqual([{start:500,end:2000},{start:3000,end:4000}]);
  await page.evaluate(()=>performUndo()); expect((await shape(page)).map(g=>g.start)).toEqual([3000]);
  expect(await page.evaluate(()=>window.MSWE.resolve('time-range').ranges)).toEqual([{start:500,end:2000}]);
});

test('bulk retain/unretain and deletion are reversible and keep locked markers',async({page},info)=>{
  await open(page); await page.locator('#gap-retain-all').click();
  expect((await shape(page)).every(g=>g.retained)).toBe(true);
  await expect(page.locator('#gap-delete-unretained')).toBeDisabled();
  await page.locator('#gap-unretain-all').click(); expect((await shape(page)).every(g=>!g.retained)).toBe(true);
  await page.evaluate(()=>toggleGapRemoved(0));
  await page.locator('#gap-delete-unretained').click();
  expect(await shape(page)).toEqual([{start:1000,end:2000,removed:true,retained:true}]);
  await page.evaluate(()=>performUndo()); expect(await shape(page)).toHaveLength(2);
  await page.screenshot({path:info.outputPath('gap-retention-panel.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:640});
  await expect(page.locator('#gap-remove-clear-all')).toBeInViewport();
  expect(await page.locator('#gap-remove-panel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.locator('#gap-remove-close').click();
  const context=await menu(page); await context.getByText('删除所有未固定空隙',{exact:true}).click();
  expect(await shape(page)).toHaveLength(1);
  await menu(page); await context.getByText('删除该空隙',{exact:true}).click();
  expect(await shape(page)).toEqual([]); await page.evaluate(()=>performUndo());
  expect((await shape(page))[0].retained).toBe(true);
});

test('both generation methods and manual marks share plain gap appearance',async({page})=>{
  await page.evaluate(()=>{
    const core=window.AsrGapRemoveCore;
    let provenance=core.replaceGapRemoveProvenanceSource(null,'audio_gate',[{start:1000,end:2000}]);
    provenance=core.replaceGapRemoveProvenanceSource(provenance,'subtitle_outside',[{start:3000,end:4000}]);
    setGapRemoveData({provenance}); applyManualGapRange(5000,6000,true);
  });
  await expect(page.locator('.waveform-gap-block.protected')).toHaveCount(0);
  const styles=await page.locator('.waveform-gap-block').evaluateAll(nodes=>nodes.map(el=>{
    const style=getComputedStyle(el);return [style.boxShadow,style.borderLeftColor,style.backgroundImage];
  }));
  expect(styles.length).toBe(3); for(const style of styles)expect(style).toEqual(styles[0]);
});

test('auditioning a retained portion pauses skipping only inside that marker',async({page})=>{
  await page.evaluate(()=>{
    setGapRemoveData({retention_mode:'locked',retained_ranges:[{start:2000,end:3000}],gaps:[{start:1000,end:4000}]});
    previewGapAt(1,2500);
  });
  expect(await page.evaluate(()=>window.MSWE.resolve('processing-host').audioPlaybackSkip(2500))).toBeNull();
  expect(await page.evaluate(()=>window.MSWE.resolve('processing-host').audioPlaybackSkip(3500))).toEqual({start:1000,end:4000});
  await page.evaluate(()=>{resizeManualGapBoundary(1,'end',5000);translateManualGap(1,1000);});
  expect((await shape(page)).filter(g=>g.retained)).toEqual([{start:2000,end:3000,removed:true,retained:true}]);
});
