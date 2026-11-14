import {test, expect} from '@playwright/test';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server;
test.beforeAll(async()=>{
  const root=makeTempDir('boundary-feedback');
  process.env.MAW_ENV_FILE=join(root,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(root,'app-data');
  writeFileSync(process.env.MAW_ENV_FILE,'');
  const project=join(root,'test.mosp'),media=generateWav(join(root,'synthetic.wav'),30);
  writeFileSync(project,JSON.stringify({media,segments:[{id:'first',start:1000,end:3000,text:'First cue'},
    {id:'second',start:11000,end:13000,text:'Second cue'}],waveform:generateWaveformPayload(30000)}));
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});
test.beforeEach(async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect(page.locator('.waveform-cue-block[data-idx="0"]').first()).toBeVisible();
  await page.evaluate(()=>{updateEditorSettings({autoSaveProject:false,hoverSeekPreview:true,waveformClickBehavior:'select-only'});player.pause();});
});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
for(const mode of ['basic','multi'])test(`waveform content geometry aligns canvas pointers and split feedback in ${mode} mode`,async({page})=>{
  await page.evaluate(mode=>waveformEditor.setMode(mode),mode);await frames(page);
  const results=await page.evaluate(()=>[...document.querySelectorAll('.waveform-row')].filter(row=>row.clientWidth>0).map(row=>{
    const rect=row.getBoundingClientRect(),start=Number(row.dataset.startMs),end=Number(row.dataset.endMs);
    const geometry=waveformEditor.captureRowGeometry(row);
    const points=[0,.17,.83,1].map(r=>({x:rect.left+row.clientLeft+row.clientWidth*r,time:start+(end-start)*r}));
    return {canvasError:Math.abs(row.querySelector('canvas').getBoundingClientRect().width-row.clientWidth),
      errors:points.flatMap(p=>[
        Math.abs(waveformEditor.timeFromPointer({clientX:p.x},row)-p.time),
        Math.abs(waveformEditor.timeFromPointer({clientX:p.x},row,geometry)-p.time)]),
      reverseError:Math.abs(waveformEditor.getSplitPointAtTime(points[2].time).clientX-points[2].x)};
  }));
  expect(results.length).toBeGreaterThan(0);
  for(const result of results){expect(result.canvasError).toBeLessThan(1);expect(Math.max(...result.errors)).toBeLessThan(.001);expect(result.reverseError).toBeLessThan(.01);}
});
async function pressEdge(page,side='left'){
  const cue=page.locator('.waveform-cue-block[data-idx="0"]').first(),box=await cue.boundingBox();
  await page.mouse.move(side==='left'?box.x+1:box.x+box.width-1,box.y+box.height/2);
  await frames(page);await page.mouse.down();
  expect(await page.evaluate(()=>waveformEditor.drag?.kind)).toBe(side==='left'?'resize-left':'resize-right');
  return box;
}
async function markerState(page){return page.evaluate(()=>{
  const row=[...document.querySelectorAll('.waveform-row')].find(row=>row.querySelector('.waveform-pointer-line.boundary-snapped:not([hidden])'));
  if(!row)return null;
  const marker=row.querySelector('.waveform-pointer-line'),rect=row.getBoundingClientRect(),m=marker.getBoundingClientRect();
  return {time:Number(row.dataset.startMs)+(m.left+.5-rect.left-row.clientLeft)/row.clientWidth*(Number(row.dataset.endMs)-Number(row.dataset.startMs)),row:Number(row.dataset.rowIndex)};
});}

test('boundary indicator follows constrained timing and suppresses pending hover preview',async({page})=>{
  const before=await page.evaluate(()=>DATA.segments[0].start),box=await pressEdge(page);
  const position=await page.evaluate(()=>player.currentTime),row=await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.move(row.x+row.width*.7,box.y+box.height/2,{steps:8});await frames(page);
  const actual=await page.evaluate(()=>DATA.segments[0].start),marker=await markerState(page);
  expect(marker).not.toBeNull();expect(Math.abs(marker.time-actual)).toBeLessThan(25);
  expect(actual).toBeLessThan(3000);expect(await page.evaluate(()=>player.currentTime)).toBeCloseTo(position,2);
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('.waveform-pointer-line.boundary-snapped')).toHaveCount(0);
  expect(await page.evaluate(()=>DATA.segments[0].start)).toBe(before);
});

test('boundary indicator follows the existing cross-row mapping and clears on commit',async({page})=>{
  await pressEdge(page,'right');
  const row=page.locator('.waveform-row[data-row-index="1"]'),box=await row.boundingBox();
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5,{steps:8});await frames(page);
  const marker=await markerState(page),actual=await page.evaluate(()=>DATA.segments[0].end);
  expect(marker).not.toBeNull();expect(marker.row).toBe(1);expect(actual).toBeGreaterThan(10000);
  expect(Math.abs(marker.time-actual)).toBeLessThan(25);
  await page.mouse.up();await expect(page.locator('.waveform-pointer-line.boundary-snapped')).toHaveCount(0);
  expect(await page.evaluate(()=>DATA.segments[0].end)).toBe(actual);
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.segments[0].end)).toBe(3000);
});
