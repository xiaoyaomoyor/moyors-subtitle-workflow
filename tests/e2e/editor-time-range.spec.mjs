import {test, expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding, findFreePort, makeTempDir, startBlankServer, generateBlankEditor, startStaticServer} from './helpers.mjs';

let server, portable, root;
test.beforeAll(async () => {
  root = makeTempDir('time-range');
  process.env.MAW_ENV_FILE = join(root, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(root, 'app-data');
  server = await startBlankServer(await findFreePort(), join(root, 'settings'));
  portable = await startStaticServer(generateBlankEditor(join(root, 'portable.html')), await findFreePort());
});
test.afterAll(async () => { await server?.stop(); await portable?.stop(); });
test.beforeEach(async ({page}) => { await disableOnboarding(page); });
const range = page => page.evaluate(() => MSWE.resolve('time-range').range);
const selections = page => page.evaluate(() => MSWE.resolve('time-range').ranges);
async function openPrecise(page) {
  const [selected]=await selections(page),row=await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.click(row.x+row.width*(selected.start+selected.end)/20000,row.y+row.height*.3,{button:'right'});
  await page.locator('.msw-range-menu').getByRole('button',{name:'精确编辑时间选区',exact:true}).click();
}
async function toolDrag(page, from, to, modifier) {
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(from.x,from.y); await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:8}); await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}
async function setup(page, url, duration = 60000) {
  await page.goto(url); await expect(page.locator('.waveform-row').first()).toBeVisible();
  await page.evaluate(duration => {
    applyCanonicalProject({media:'',segments:[],media_metadata:{duration_ms:duration}}, 'range.mosp');
    waveformEditor.settings.secondsPerRow = 10; waveformEditor.settings.mode = 'multi'; waveformEditor.render();
  }, duration);
}
async function drag(page, from, to, modifier = 'Control') {
  await page.keyboard.down(modifier); await page.keyboard.down('Shift');
  await page.mouse.move(from.x,from.y); await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:8}); await page.mouse.up();
  await page.keyboard.up('Shift'); await page.keyboard.up(modifier);
}
async function pixel(page, fraction) {
  return page.locator('.waveform-row canvas').first().evaluate((canvas,x) => {
    return [...canvas.getContext('2d').getImageData(Math.round(canvas.width*x),Math.round(canvas.height*.3),1,1).data];
  }, fraction);
}

for (const mode of ['server','portable']) test(`${mode}: reverse drag selects source time and inverts only the canvas without creating subtitles`, async ({page}) => {
  await setup(page, mode === 'server' ? server.url : portable.url);
  const before = await pixel(page,.4), outside = await pixel(page,.8);
  const row = await page.locator('.waveform-row').first().boundingBox();
  await drag(page,{x:row.x+row.width*.6,y:row.y+row.height*.3},{x:row.x+row.width*.2,y:row.y+row.height*.3});
  const result = await range(page); expect(result.start).toBeCloseTo(2000,-1); expect(result.end).toBeCloseTo(6000,-1);
  const selected = await pixel(page,.4);
  expect(selected.slice(0,3)).toEqual(before.slice(0,3).map(x=>255-x)); expect(await pixel(page,.8)).toEqual(outside);
  expect(await page.evaluate(()=>DATA.segments)).toEqual([]);
  await page.keyboard.press('Delete'); expect(await range(page)).toEqual(result);
  await page.keyboard.press('Escape'); expect(await range(page)).toBeNull(); expect(await pixel(page,.4)).toEqual(before);
});

test('cross-row selection keeps its gesture after modifier release and survives zoom and resize',async ({page})=>{
  await setup(page,server.url);
  const first=await page.locator('.waveform-row[data-row-index="0"]').boundingBox();
  const third=await page.locator('.waveform-row[data-row-index="2"]').boundingBox();
  await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  await page.mouse.move(first.x+first.width*.6,first.y+first.height*.3); await page.mouse.down();
  const height=await page.evaluate(()=>waveformEditor.settings.rowHeight);
  await page.mouse.wheel(0,-100); expect(await page.evaluate(()=>waveformEditor.settings.rowHeight)).toBe(height);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await page.mouse.move(third.x+third.width*.2,third.y+third.height*.3,{steps:10}); await page.mouse.up();
  const result=await range(page); expect(result.start).toBeCloseTo(6000,-1); expect(result.end).toBeCloseTo(22000,-1);
  await page.evaluate(()=>{waveformEditor.settings.secondsPerRow=20;waveformEditor.render();});
  await page.setViewportSize({width:1100,height:900}); expect(await range(page)).toEqual(result);
  expect(await page.evaluate(()=>DATA.segments.length)).toBe(0);
});

test('range drag over a subtitle does not move it; cancel restores the previous range and precise edit works',async ({page})=>{
  await setup(page,server.url);
  await page.evaluate(()=>{DATA.segments.push({id:'cue',start:1000,end:4000,text:'Do not move'});renderAll();MSWE.resolve('time-range').setRange({start:5000,end:7000});});
  const cue=await page.locator('.waveform-cue-block').first().boundingBox();
  await page.keyboard.down('Control');await page.keyboard.down('Shift');
  await page.mouse.move(cue.x+cue.width*.5,cue.y+cue.height*.5);await page.mouse.down();
  await page.mouse.move(cue.x+cue.width*1.5,cue.y+cue.height*.5,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
  await page.keyboard.up('Shift');await page.keyboard.up('Control');
  expect(await range(page)).toEqual({start:5000,end:7000});
  expect(await page.evaluate(()=>DATA.segments[0])).toMatchObject({start:1000,end:4000,text:'Do not move'});
  await openPrecise(page);
  await page.locator('#msw-range-start').fill('1.234'); await page.locator('#msw-range-end').fill('5.678');
  await page.locator('#msw-range-save').click();expect(await range(page)).toEqual({start:1234,end:5678});
  await page.evaluate(()=>applyCanonicalProject({segments:[],media:''},'other.mosp'));expect(await range(page)).toBeNull();
});

test('autoscroll extends the range across virtualized rows without retaining stale DOM geometry',async ({page})=>{
  await setup(page,server.url,300000);
  const first=await page.locator('.waveform-row').first().boundingBox(), scroll=await page.locator('#waveform-scroll').boundingBox();
  await page.keyboard.down('Control');await page.keyboard.down('Shift');
  await page.mouse.move(first.x+first.width*.3,first.y+first.height*.3);await page.mouse.down();
  await page.mouse.move(first.x+first.width*.5,scroll.y+scroll.height-2,{steps:10});
  await expect.poll(()=>page.evaluate(()=>waveformEditor.scroll.scrollTop)).toBeGreaterThan(120);
  await page.mouse.up();await page.keyboard.up('Shift');await page.keyboard.up('Control');
  const selected=await range(page);expect(selected.start).toBeCloseTo(3000,-1);expect(selected.end).toBeGreaterThan(40000);
  expect(await page.evaluate(()=>DATA.segments.length)).toBe(0);
  await page.screenshot({path:join(root,'range-autoscroll.png')});
});

test('precise range dialog aligns times, validates input and applies with Enter while cancel preserves selection',async({page})=>{
  await setup(page,server.url);
  await page.evaluate(()=>MSWE.resolve('time-range').setRange([{start:1000,end:3000},{start:5000,end:7000}]));
  await openPrecise(page);
  const start=await page.locator('#msw-range-start').boundingBox(),end=await page.locator('#msw-range-end').boundingBox();
  expect(start.y).toBe(end.y);expect(start.width).toBe(end.width);
  await page.locator('#msw-range-start').fill('');await page.locator('#msw-range-end').press('Enter');
  await expect(page.locator('#msw-range-error')).toContainText('有效');
  expect((await selections(page))[0]).toEqual({start:1000,end:3000});
  await page.locator('#msw-range-start').fill('1.234');await page.locator('#msw-range-end').fill('3.456');
  await expect(page.locator('#msw-range-duration')).toContainText('2.222');
  await page.screenshot({path:join(root,'precise-range-dialog.png')});
  await page.locator('#msw-range-end').press('Enter');
  expect((await selections(page))[0]).toEqual({start:1234,end:3456});
  await openPrecise(page);await page.locator('#msw-range-start').fill('2');await page.keyboard.press('Escape');
  expect((await selections(page))[0]).toEqual({start:1234,end:3456});
  await openPrecise(page);await page.locator('#msw-range-part').selectOption('1');
  await expect(page.locator('#msw-range-start')).toHaveValue('5.000');
  await page.locator('#msw-range-end').fill('70');await page.locator('#msw-range-save').click();
  await expect(page.locator('#msw-range-error')).toContainText('有效');
  await page.locator('#msw-range-cancel').click();expect((await selections(page))[1]).toEqual({start:5000,end:7000});
  await openPrecise(page);await page.evaluate(()=>applyCanonicalProject({media:'',segments:[]},'new.mosp'));
  await expect(page.locator('#msw-range-dialog')).not.toBeVisible();
});

test('range boundaries resize across rows, reverse direction and preserve the opposite endpoint',async({page})=>{
  await setup(page,server.url);
  await page.evaluate(()=>{waveformEditor.setTool('range');MSWE.resolve('time-range').setRange({start:2000,end:8000});});
  const first=await page.locator('.waveform-row[data-row-index="0"]').boundingBox();
  const second=await page.locator('.waveform-row[data-row-index="1"]').boundingBox();
  const at=(row,fraction)=>({x:row.x+row.width*fraction,y:row.y+row.height*.4});
  await toolDrag(page,at(first,.8),at(second,.4));
  expect(await range(page)).toMatchObject({start:2000});expect((await range(page)).end).toBeCloseTo(14000,-1);
  await toolDrag(page,at(second,.4),at(first,.6));
  expect(await range(page)).toMatchObject({start:2000});expect((await range(page)).end).toBeCloseTo(6000,-1);
  await page.evaluate(()=>MSWE.resolve('time-range').setRange({start:14000,end:18000}));
  await toolDrag(page,at(second,.4),at(first,.6));
  expect(await range(page)).toMatchObject({end:18000});expect((await range(page)).start).toBeCloseTo(6000,-1);
  await page.screenshot({path:join(root,'range-boundary-cross-row.png')});
});

test('range boundary can extend past a row edge horizontally and cancel restores its original span',async({page})=>{
  await setup(page,server.url);
  // Keep a visible margin beyond the row, as in a resized waveform module.
  await page.evaluate(()=>{waveformEditor.content.style.minWidth='0';waveformEditor.content.style.width='600px';waveformEditor.render();waveformEditor.setTool('range');MSWE.resolve('time-range').setRange({start:2000,end:9800});});
  const row=await page.locator('.waveform-row[data-row-index="0"]').boundingBox();
  await page.mouse.move(row.x+row.width*.98,row.y+row.height*.4);await page.mouse.down();
  await page.mouse.move(row.x+row.width+35,row.y+row.height*.4,{steps:6});
  expect((await range(page)).start).toBe(2000);expect((await range(page)).end).toBeGreaterThan(10000);
  await page.keyboard.press('Escape');await page.mouse.up();expect(await range(page)).toEqual({start:2000,end:9800});
});

test('row-end selection handles remain visible with track heads and a partial final row',async({page})=>{
  await setup(page,server.url,25000);
  await page.evaluate(()=>{waveformEditor.setTool('range');MSWE.resolve('time-range').setRange({start:2000,end:10000});});
  const first=await page.locator('.waveform-row[data-row-index="0"]').boundingBox();
  const second=await page.locator('.waveform-row[data-row-index="1"]').boundingBox();
  const last=await page.locator('.waveform-row[data-row-index="2"]').boundingBox();
  const scroll=await page.locator('#waveform-scroll').boundingBox();
  expect(first.x+first.width).toBeLessThanOrEqual(scroll.x+scroll.width);
  expect(last.width/first.width).toBeCloseTo(.5,2);
  await toolDrag(page,{x:first.x+first.width-2,y:first.y+first.height*.4},{x:second.x+second.width*.3,y:second.y+second.height*.4});
  expect((await range(page)).start).toBe(2000);expect((await range(page)).end).toBeCloseTo(13000,-1);
  await page.screenshot({path:join(root,'range-visible-row-end.png')});
});

test('Cmd+Shift and pointer cancellation share the same range rules',async ({page})=>{
  await setup(page,server.url);
  const row=await page.locator('.waveform-row').first().boundingBox();
  await drag(page,{x:row.x+row.width*.2,y:row.y+row.height*.2},{x:row.x+row.width*.7,y:row.y+row.height*.2},'Meta');
  const previous=await range(page);expect(previous.end).toBeCloseTo(7000,-1);
  await page.keyboard.down('Control');await page.keyboard.down('Shift');
  await page.mouse.move(row.x+row.width*.3,row.y+row.height*.2);await page.mouse.down();
  await page.mouse.move(row.x+row.width*.4,row.y+row.height*.2);
  await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})));
  await page.mouse.up();await page.keyboard.up('Shift');await page.keyboard.up('Control');expect(await range(page)).toEqual(previous);
});

test('single-row range selection pans at the edge and remains stable when real peaks arrive',async ({page})=>{
  await setup(page,server.url);
  await page.evaluate(()=>{waveformEditor.settings.mode='basic';waveformEditor.settings.visibleSeconds=10;waveformEditor.render();});
  const row=await page.locator('.waveform-row').first().boundingBox();
  await page.keyboard.down('Control');await page.keyboard.down('Shift');
  await page.mouse.move(row.x+row.width*.3,row.y+row.height*.3);await page.mouse.down();
  await page.mouse.move(row.x+row.width-2,row.y+row.height*.3,{steps:8});
  await expect.poll(()=>page.evaluate(()=>waveformEditor.basicWindowStartMs)).toBeGreaterThan(300);
  await page.mouse.up();await page.keyboard.up('Shift');await page.keyboard.up('Control');
  const previous=await range(page);expect(previous.start).toBeCloseTo(3000,-1);expect(previous.end).toBeGreaterThan(10000);
  await page.evaluate(()=>MSWE.resolve('processing-host').applyWaveform({schema:'moy.asr.waveform.v1',encoding:'i8-minmax-base64',
    peaks_per_second:1,peak_count:60,duration_ms:60000,audio_track:0,data:btoa(String.fromCharCode(...Array.from({length:120},(_,i)=>i%2?60:196)))}));
  expect(await range(page)).toEqual(previous);expect(await page.evaluate(()=>DATA.segments.length)).toBe(0);
});

test('range tool adds and subtracts disjoint intervals, inverts only selected parts and precisely edits one part',async ({page})=>{
  await setup(page,server.url);
  await page.locator('[data-waveform-tool="range"]').click();
  const row=await page.locator('.waveform-row').first().boundingBox();
  const point=t=>({x:row.x+row.width*t/10000,y:row.y+row.height*.3});
  const before=await pixel(page,.4);
  await toolDrag(page,point(1000),point(8000));
  await toolDrag(page,point(3000),point(5000),'Control');
  let items=await selections(page);expect(items).toHaveLength(2);
  expect(items[0].end).toBeCloseTo(3000,-1);expect(items[1].start).toBeCloseTo(5000,-1);
  expect(await pixel(page,.4)).toEqual(before);
  await toolDrag(page,point(2500),point(5500),'Shift');
  items=await selections(page);expect(items).toHaveLength(1);expect(items[0].start).toBeCloseTo(1000,-1);expect(items[0].end).toBeCloseTo(8000,-1);
  await toolDrag(page,point(4000),point(6000),'Control');
  await openPrecise(page);await page.locator('#msw-range-part').selectOption('1');
  await page.locator('#msw-range-start').fill('6.123');await page.locator('#msw-range-end').fill('8.456');await page.locator('#msw-range-save').click();
  items=await selections(page);expect(items).toHaveLength(2);expect(items[1]).toEqual({start:6123,end:8456});
  expect(await page.evaluate(()=>DATA.segments)).toEqual([]);
  await page.screenshot({path:join(root,'range-tool-multiple.png')});
});

test('range tool resizes either boundary, restores all parts on cancel and leaves existing cue drag available in select tool',async ({page})=>{
  await setup(page,server.url);
  await page.evaluate(()=>{DATA.segments.push({id:'cue',start:1000,end:2000,text:'Keep'});renderAll();MSWE.resolve('time-range').setRange([{start:1000,end:3000},{start:6000,end:8000}]);});
  await page.locator('[data-waveform-tool="range"]').click();
  const row=await page.locator('.waveform-row').first().boundingBox();
  const point=t=>({x:row.x+row.width*t/10000,y:row.y+row.height*.3});
  await toolDrag(page,point(3000),point(4000));
  await toolDrag(page,point(6000),point(5000));
  let items=await selections(page);expect(items).toHaveLength(2);expect(items[0].end).toBeCloseTo(4000,-1);expect(items[1].start).toBeCloseTo(5000,-1);
  await page.mouse.move(point(5000).x,point(5000).y);await page.mouse.down();await page.mouse.move(point(4500).x,point(4500).y);
  await page.keyboard.press('Escape');await page.mouse.up();expect(await selections(page)).toEqual(items);
  await page.locator('[data-waveform-tool="select"]').click();
  expect(await page.evaluate(()=>waveformEditor.getTool())).toBe('select');
  const cue=await page.locator('.waveform-cue-block').first().boundingBox();
  await toolDrag(page,{x:cue.x+cue.width*.5,y:cue.y+cue.height*.5},{x:cue.x+cue.width*.5+row.width*.1,y:cue.y+cue.height*.5});
  expect(await page.evaluate(()=>DATA.segments[0].start)).toBeGreaterThan(1500);expect(await selections(page)).toEqual(items);
});

test('blank waveform menu has five ordered actions and adds an editable interval without losing existing ranges',async({page})=>{
  await setup(page,server.url);
  await page.evaluate(()=>MSWE.resolve('time-range').setRange({start:1000,end:2000}));
  const row=await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.click(row.x+row.width*.4,row.y+row.height*.3,{button:'right'});
  const menu=page.locator('#ctxmenu');
  expect(await menu.locator(':scope > .item').evaluateAll(nodes=>nodes.map(n=>n.querySelector('span')?.textContent||n.textContent)))
    .toEqual(['创建字幕','添加空隙','添加时间选区','加选播放头到鼠标位置','波形显示器设置']);
  await expect(menu.locator('.ctx-window-item svg')).toHaveCount(1);
  await expect(menu).toHaveCSS('opacity','1');
  await page.screenshot({path:join(root,'blank-context-menu.png')});
  await menu.getByRole('button',{name:'添加时间选区',exact:true}).click();
  await expect(page.locator('#msw-range-dialog')).toBeVisible();
  const items=await selections(page);expect(items).toHaveLength(2);expect(items[0]).toEqual({start:1000,end:2000});
  expect(Math.abs(items[1].start-4000)).toBeLessThanOrEqual(Math.ceil(10000/row.width));
  await page.locator('#msw-range-end').fill('5.500');await page.locator('#msw-range-save').click();
  expect((await selections(page))[1].end).toBe(5500);
});

test('range menu shares blank menu typography, has a red clear action and window icon',async({page})=>{
  await setup(page,server.url);
  await page.evaluate(()=>MSWE.resolve('time-range').setRange({start:1000,end:3000}));
  const row=await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.click(row.x+row.width*.6,row.y+row.height*.3,{button:'right'});
  const style=await page.locator('#ctxmenu .item').nth(1).evaluate(n=>({font:getComputedStyle(n).fontSize,color:getComputedStyle(n).color,padding:getComputedStyle(n).padding}));
  await page.mouse.click(row.x+row.width*.2,row.y+row.height*.3,{button:'right'});
  const menu=page.locator('.msw-range-menu');await expect(menu).toBeVisible();
  expect(await menu.getByRole('button',{name:'精确编辑时间选区',exact:true}).evaluate(n=>({font:getComputedStyle(n).fontSize,color:getComputedStyle(n).color,padding:getComputedStyle(n).padding}))).toEqual(style);
  await expect(menu.getByRole('button',{name:'识别所选片段（ASR）',exact:true})).toBeVisible();
  const clear=menu.locator('.danger');await expect(clear).toContainText('清除时间选区');await expect(clear.locator('kbd')).toHaveText('Esc');
  expect(await clear.evaluate(n=>getComputedStyle(n).color)).not.toBe(style.color);
  await expect(menu.locator('.ctx-window-item svg')).toHaveCount(1);
  await page.screenshot({path:join(root,'range-context-menu.png')});
  await clear.click();expect(await selections(page)).toEqual([]);
});

for (const tool of ['select','razor','range']) test(`${tool}: context menu adds a frozen playhead-to-pointer interval and retains existing ranges`,async ({page})=>{
  await setup(page,server.url);
  await page.evaluate(()=>{waveformEditor.currentTimeMs=()=>6000;MSWE.resolve('time-range').setRange({start:1000,end:2000});});
  await page.locator(`[data-waveform-tool="${tool}"]`).click();
  const row=await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.click(row.x+row.width*.4,row.y+row.height*.3,{button:'right'});
  await expect(page.locator('#ctxmenu')).toBeVisible();
  if (tool==='select') {
    await expect(page.locator('#ctxmenu')).toHaveCSS('opacity','1');
    await page.screenshot({path:join(root,'waveform-range-context.png')});
  }
  await page.evaluate(()=>{waveformEditor.currentTimeMs=()=>8000;});
  await page.locator('#ctxmenu').getByRole('button',{name:'加选播放头到鼠标位置',exact:true}).click();
  let items=await selections(page);expect(items).toHaveLength(2);expect(items[0]).toEqual({start:1000,end:2000});
  expect(Math.abs(items[1].start-4000)).toBeLessThanOrEqual(Math.ceil(10000/row.width));expect(items[1].end).toBe(6000);
  const originalStart=items[1].start;
  await page.mouse.click(row.x+row.width*.5,row.y+row.height*.3,{button:'right'});
  await page.locator('.msw-range-menu').getByRole('button',{name:'加选播放头到鼠标位置',exact:true}).click();
  items=await selections(page);expect(items[1].start).toBe(originalStart);expect(items[1].end).toBe(8000);
  expect(await page.evaluate(()=>DATA.segments)).toEqual([]);
});
