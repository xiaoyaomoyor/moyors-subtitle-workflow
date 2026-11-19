import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer,toggleWaveSettings} from './helpers.mjs';

let server;
const errors=new WeakMap();
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const state=page=>page.evaluate(()=>({
  top:waveformEditor.getNavigationSnapshot().waveformTopEdgeMs,
  height:waveformEditor.settings.rowHeight,seconds:waveformEditor.settings.secondsPerRow,
  scroll:waveformEditor.scroll.scrollTop,max:waveformEditor.scroll.scrollHeight-waveformEditor.scroll.clientHeight,
}));
const anchor=async(page,time=300000)=>{
  await page.evaluate(time=>waveformEditor.restoreNavigation({waveformTopEdgeMs:time}),time);
  await settle(page);
};

test.beforeAll(async()=>{
  const dir=makeTempDir('wave-navigation'),media=join(dir,'synthetic.wav'),project=join(dir,'synthetic.json');
  generateWav(media,600);
  writeFileSync(project,JSON.stringify({segments:[
    {id:'early',start:1000,end:2000,text:'Early subtitle',items:[]},
    {id:'middle',start:301000,end:302000,text:'Middle subtitle',items:[]},
  ],waveform:generateWaveformPayload(600000,10)}));
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});
test.beforeEach(async({page})=>{
  errors.set(page,[]);page.on('pageerror',error=>errors.get(page).push(error.message));
  await disableOnboarding(page);await page.goto(server.url);
  await page.waitForFunction(()=>typeof waveformEditor!=='undefined'&&waveformEditor&&player.readyState>=2);
  await page.evaluate(()=>{
    updateEditorSettings({autoSaveProject:false});player.pause();player.currentTime=1;
    waveformEditor.settings.rowHeight=120;waveformEditor.settings.secondsPerRow=10;
    waveformEditor.setMode('multi');waveformEditor.render();
    selectCueByClick(0);
    window.navigationBefore={subtitles:JSON.parse(buildJson()).subtitles,selection:[...selectedIdxs]};
  });
  await anchor(page);
});
test.afterEach(async({page})=>{
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(()=>({subtitles:JSON.parse(buildJson()).subtitles,selection:[...selectedIdxs]})))
    .toEqual(await page.evaluate(()=>window.navigationBefore));
});

test('settings controls preserve the visible time without seeking the media',async({page},info)=>{
  await toggleWaveSettings(page);
  await page.locator('#waveform-row-height').selectOption('240');await settle(page);
  expect(await state(page)).toMatchObject({top:300000,height:240});
  await page.locator('#waveform-seconds-per-row').selectOption('20');await settle(page);
  expect(await state(page)).toMatchObject({top:300000,seconds:20});
  await page.locator('#waveform-seconds-per-row').selectOption('5');await settle(page);
  expect(await state(page)).toMatchObject({top:300000,seconds:5});
  // A new row grid retains the row containing the old time, not an unrelated pixel offset.
  await anchor(page,315000);
  await page.locator('#waveform-seconds-per-row').selectOption('20');await settle(page);
  expect((await state(page)).top).toBe(300000);
  expect(await page.evaluate(()=>player.currentTime)).toBeCloseTo(1,2);
  await toggleWaveSettings(page);
  await page.screenshot({path:info.outputPath('preserved-time.png')});
});

test('wheel settings preserve the manual view while playing and after resize',async({page})=>{
  await page.evaluate(async()=>{player.muted=true;await player.play();});
  await anchor(page);
  const box=await page.locator('#waveform-scroll').boundingBox();
  await page.mouse.move(box.x+box.width*.7,box.y+Math.min(80,box.height/2));
  await page.keyboard.down('Control');await page.mouse.wheel(0,120);await page.keyboard.up('Control');
  await expect.poll(async()=>(await state(page)).seconds).toBe(20);
  expect((await state(page)).top).toBe(300000);
  await page.keyboard.down('Control');await page.keyboard.down('Shift');await page.mouse.wheel(0,-120);
  await page.keyboard.up('Shift');await page.keyboard.up('Control');
  await expect.poll(async()=>(await state(page)).height).toBe(144);
  expect((await state(page)).top).toBe(300000);
  await page.setViewportSize({width:1100,height:900});await settle(page);
  expect((await state(page)).top).toBe(300000);
  const playback=await page.evaluate(()=>({time:player.currentTime,paused:player.paused}));
  expect(playback.paused).toBe(false);expect(playback.time).toBeGreaterThan(1);expect(playback.time).toBeLessThan(15);
});

test('head and tail clamp safely; basic height changes keep the window and canvas',async({page})=>{
  await anchor(page,0);
  await page.evaluate(()=>waveformEditor.setRowHeight(64));await settle(page);
  expect((await state(page)).top).toBe(0);
  await anchor(page,599000);
  await page.evaluate(()=>waveformEditor.setSecondsPerRow(30));await settle(page);
  const tail=await state(page);
  expect(tail.scroll).toBeGreaterThanOrEqual(0);expect(tail.scroll).toBeLessThanOrEqual(tail.max);
  expect(tail.scroll).toBeCloseTo(tail.max,0);
  await page.evaluate(()=>{
    waveformEditor.settings.visibleSeconds=10;waveformEditor.setMode('basic');
    waveformEditor.restoreNavigation({waveformTopEdgeMs:300000});
    window.navigationCanvas=waveformEditor.renderedRows[0].querySelector('canvas');
    waveformEditor.options.getHoverSeekPreview=()=>true;
    waveformEditor.scheduleHoverSeekPreview({clientX:200,clientY:200,buttons:0},waveformEditor.renderedRows[0]);
    waveformEditor.setRowHeight(240);
  });
  await settle(page);
  expect(await page.evaluate(()=>({top:waveformEditor.basicWindowStartMs,
    sameCanvas:waveformEditor.renderedRows[0].querySelector('canvas')===window.navigationCanvas,
    hoverFrame:waveformEditor.hoverSeekPreviewFrame,hoverEvent:waveformEditor.hoverSeekPreviewLastEvent,
  }))).toEqual({top:300000,sameCanvas:true,hoverFrame:0,hoverEvent:null});
});
