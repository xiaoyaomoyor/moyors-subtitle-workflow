import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWav,makeTempDir,startStaticServer,startBlankServer} from './helpers.mjs';
const old={media:'synthetic.wav',segments:[{id:'a',start:0,end:2000,text:'Hello world',items:[{start:0,end:1000,text:'Hello '},{start:1000,end:2000,text:'world'}]},{id:'b',start:2000,end:4000,text:'Second line'}]};
let server;
test.beforeAll(async()=>{const dir=makeTempDir('flat-subtitle-ui');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{await disableOnboarding(page);page.on('dialog',d=>d.accept());await page.goto(server.url+'?flat-subtitles=1');await expect(page.locator('#flat-trial-bar')).toBeVisible();});
const snap=page=>page.evaluate(()=>MSWFlatEditor.snapshot());
const open=async(page,p=old)=>{await page.locator('#flat-open-file').setInputFiles({name:'synthetic.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await expect(page.locator('#flat-project-name')).toHaveText('synthetic.mosp');};

test('trial edits native tracks, text, timing, undo and downloads v4 without legacy arrays',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  await expect(page.locator('.flat-cue')).toHaveCount(2);
  await page.locator('.flat-cue').first().click();await page.locator('#flat-text').fill('Edited caption');await page.locator('#flat-end').click();
  expect((await snap(page)).subtitles.cues[0].content.text).toBe('Edited caption');
  await page.locator('#flat-undo').click();expect((await snap(page)).subtitles.cues[0].content.text).toBe('Hello world');
  await page.getByRole('button',{name:'新轨道',exact:true}).click();
  expect((await snap(page)).subtitles.tracks).toHaveLength(2);
  await page.locator('.flat-cue').first().click();const target=(await snap(page)).subtitles.tracks[1].id;
  await page.locator('#flat-cue-track').selectOption(target);expect((await snap(page)).subtitles.cues[0].track_id).toBe(target);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();const saved=JSON.parse(readFileSync(await(await download).path(),'utf8'));
  expect(saved.schema).toBe('msw.project.v4');expect(saved.segments).toBeUndefined();expect(saved.subtitles.tracks).toHaveLength(2);
  expect(saved).toEqual(await snap(page));expect(errors).toEqual([]);
});
test('ordinary and quick split work symmetrically with bindings; merge and undo restore both tracks',async({page})=>{
  await open(page);const p=await page.evaluate(()=>{let p=MSWFlatEditor.snapshot();const t={...p.subtitles.tracks[0],id:'zh',name:'译文'};p=MSWFlatSubtitles.addTrack(p,t);p=MSWFlatEditing.addCue(p,'zh','translated',0,2000,'你好世界');return MSWFlatSubtitles.bind(p,p.subtitles.cues[0].id,'translated','pair');});await open(page,p);
  const row=page.locator('.flat-cue').filter({hasText:'你好世界'});await row.click();
  await page.locator('#flat-text').focus();await page.locator('#flat-text').evaluate(t=>t.setSelectionRange(2,2));await page.getByRole('button',{name:'切分',exact:true}).click();
  await expect(page.locator('.flat-split-row')).toHaveCount(2);await page.getByRole('button',{name:'确认切分',exact:true}).click();
  expect((await snap(page)).subtitles.bindings).toHaveLength(2);
  await page.locator('#flat-undo').click();expect((await snap(page)).subtitles.bindings).toHaveLength(1);expect((await snap(page)).subtitles.cues).toHaveLength(3);
  await row.click();await row.locator('.flat-cue-text').hover({position:{x:25,y:10}});await page.keyboard.press('Control+b');
  expect((await snap(page)).subtitles.bindings).toHaveLength(2);await expect(page.locator('.flat-split-row')).toHaveCount(0);
  const translated=(await snap(page)).subtitles.cues.filter(c=>c.track_id==='zh');
  for(let i=0;i<translated.length;i++)await page.locator(`[data-flat-cue="${translated[i].id}"]`).click({modifiers:i?['Control']:[]});
  await page.mouse.move(10,10);await page.keyboard.press('c');expect((await snap(page)).subtitles.bindings).toHaveLength(1);expect((await snap(page)).subtitles.cues).toHaveLength(3);
});
test('waveform displays separate physical tracks and drag updates v4 only once',async({page})=>{
  await open(page);await expect(page.locator('.waveform-cue-block').first()).toBeVisible();
  const before=await snap(page),block=page.locator('.waveform-cue-block').filter({hasText:'Second line'}).first(),box=await block.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2,{steps:10});await page.mouse.up();
  expect((await snap(page)).subtitles.cues[1].content.start).toBeGreaterThan(2000);await page.locator('#flat-undo').click();expect(await snap(page)).toEqual(before);
});

test('track context menu renames and locks captions; Alt disables without removing them',async({page})=>{
  await open(page);const head=page.locator('.fixed-track-head').first();await head.click({button:'right'});
  await page.getByText('轨道设置…',{exact:true}).click();await page.getByRole('textbox',{name:'轨道名称',exact:true}).fill('源字幕');await page.getByRole('button',{name:'完成',exact:true}).click();
  expect((await snap(page)).subtitles.tracks[0].name).toBe('源字幕');
  const block=page.locator('.waveform-cue-block').first(),bounds=await block.boundingBox();await page.keyboard.down('Alt');await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.keyboard.up('Alt');expect((await snap(page)).subtitles.cues[0].content.disabled).toBe(true);await expect(block).toBeVisible();
  await head.click({button:'right'});await page.getByText('锁定轨道',{exact:true}).click();await page.locator('.flat-cue').first().click();await expect(page.locator('#flat-text')).toBeDisabled();
  const before=await snap(page);await page.mouse.move(10,10);await page.keyboard.press('Delete');expect(await snap(page)).toEqual(before);await expect(page.locator('#flat-message')).toContainText('锁定');
});
test('split line drags and Escape cancels only the drag; active lane controls independent split',async({page})=>{
  await open(page);const p=await page.evaluate(()=>{let p=MSWFlatEditor.snapshot();p=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id:'zh',name:'译文'});p=MSWFlatEditing.addCue(p,'zh','translated',0,2000,'你好世界');return MSWFlatSubtitles.bind(p,p.subtitles.cues[0].id,'translated','pair');});await open(page,p);
  await page.locator('.flat-cue').first().click();await page.locator('#flat-text').evaluate(t=>t.setSelectionRange(6,6));await page.getByRole('button',{name:'切分',exact:true}).click();
  const marker=page.locator('.waveform-split-preview:visible').first(),box=await marker.boundingBox();const time=await page.locator('#flat-split-time').inputValue();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+30,box.y+box.height/2,{steps:4});
  expect(await page.locator('#flat-split-time').inputValue()).not.toBe(time);await page.keyboard.press('Escape');await page.mouse.up();expect(await page.locator('#flat-split-time').inputValue()).toBe(time);
  await page.locator('.flat-split-row').first().focus();await page.keyboard.press('ArrowDown');await expect(page.locator('.flat-split-row.active')).toContainText('译文');await page.keyboard.press('Shift+b');
  const out=await snap(page);expect(out.subtitles.bindings).toHaveLength(0);expect(out.subtitles.cues.filter(c=>c.track_id==='zh')).toHaveLength(2);expect(out.subtitles.cues.find(c=>c.id===p.subtitles.cues[0].id).content).toEqual(p.subtitles.cues[0].content);
});
test('draft recovery and malformed input never replace valid edits; narrow panel uses theme styling',async({page},info)=>{
  await open(page);await page.locator('.flat-cue').first().click();await page.locator('#flat-text').fill('Recovered text');await page.locator('#flat-end').click();
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('msw.flat-draft.v1:')&&localStorage[k].includes('Recovered text')))).toBe(true);
  await page.reload();await page.getByRole('button',{name:'恢复上次试用草稿'}).click();expect((await snap(page)).subtitles.cues[0].content.text).toBe('Recovered text');
  const before=await snap(page);await page.locator('#flat-open-file').setInputFiles({name:'broken.mosp',mimeType:'application/json',buffer:Buffer.from('{"schema":"future"}')});expect(await snap(page)).toEqual(before);await expect(page.locator('#flat-message')).toHaveClass(/error/);
  await page.locator('.flat-cue').first().click();await page.screenshot({path:info.outputPath('flat-ui.png')});
  await page.setViewportSize({width:760,height:760});await expect(page.locator('#flat-cue-editor')).toBeVisible();
  const overflow=await page.locator('#flat-cue-editor').evaluate(el=>el.scrollWidth-el.clientWidth);expect(overflow).toBeLessThanOrEqual(2);
});
test('normal entry transfers current unsaved text into an isolated trial tab',async({page})=>{
  await page.goto(server.url);await page.locator('#open-project-file').setInputFiles({name:'original.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...old,media:''}))});
  await page.locator('.cue[data-idx="0"]').first().click();await page.locator('#cue-panel-text').fill('Unsaved normal text');
  await page.getByRole('button',{name:'文件',exact:true}).click();const popup=page.waitForEvent('popup');await page.locator('#flat-trial-entry').click();const trial=await popup;
  await expect(trial.locator('#flat-trial-bar')).toBeVisible();expect((await snap(trial)).subtitles.cues[0].content.text).toBe('Unsaved normal text');
  expect(await page.evaluate(()=>MSWE.resolve('persistence-host').snapshot().schema)).toBe('msw.project.v3');await trial.close();
});
test('local editor server serves trial without posting processing or saving legacy projects',async({page})=>{
  const local=await startBlankServer(await findFreePort(),makeTempDir('flat-ui-server-settings'));
  try{const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});await page.goto(local.url+'?flat-subtitles=1');await open(page);
    await page.locator('.flat-cue').first().click();await page.locator('#flat-text').fill('Local edit');await page.locator('#flat-end').click();
    await expect(page.locator('#menubar')).toBeHidden();expect((await snap(page)).schema).toBe('msw.project.v4');
    await page.evaluate(()=>{scheduleAutoSave();scheduleAutoSaveFlush();refreshSubtitlePreview();});expect(writes).toEqual([]);
    expect(await page.evaluate(()=>({renderer:!!document.querySelector('.JASSUB'),processing:MSWE.resolve('processing-host').config.processingUrl}))).toEqual({renderer:false,processing:null});
  }finally{await local.stop();}
});
test('copy and paste preserve selected correspondence; Ctrl+Shift+C uses common state',async({page})=>{
  await open(page);const p=await page.evaluate(()=>{let p=MSWFlatEditor.snapshot();p=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id:'zh',name:'译文'});p=MSWFlatEditing.addCue(p,'zh','translated',0,2000,'你好世界');return MSWFlatSubtitles.bind(p,p.subtitles.cues[0].id,'translated','pair');});await open(page,p);
  await page.locator('.flat-cue').first().click();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
  const secondRow=page.locator('.waveform-row').nth(1),bounds=await secondRow.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+10);await page.keyboard.press('Control+v');
  expect((await snap(page)).subtitles.cues).toHaveLength(6);expect((await snap(page)).subtitles.bindings).toHaveLength(2);
  await page.locator('#flat-undo').click();expect((await snap(page)).subtitles.cues).toHaveLength(3);
  await page.locator('.flat-cue').first().click();await page.mouse.move(10,10);await page.keyboard.press('1');
  await page.locator('.flat-cue').filter({hasText:'Second line'}).click({modifiers:['Control']});await page.mouse.move(10,10);await page.keyboard.press('Control+Shift+c');
  const result=await snap(page);expect(result.subtitles.cues).toHaveLength(2);expect(result.subtitles.cues.find(c=>c.track_id!=='zh').content.color).toBeUndefined();
});
test('split confirmation preserves dock resizing and both light and dark styles',async({page},info)=>{
  await open(page);await page.locator('.flat-cue').first().click();
  await page.locator('#flat-text').fill('Changed, then select');await page.locator('.flat-cue').filter({hasText:'Second line'}).click();await expect(page.locator('#flat-text')).toHaveValue('Second line');
  const paired=await page.evaluate(()=>{let p=MSWFlatEditor.snapshot();p=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id:'zh',name:'译文'});p=MSWFlatEditing.addCue(p,'zh','translated',0,2000,'你好世界');return MSWFlatSubtitles.bind(p,p.subtitles.cues[0].id,'translated','pair');});await open(page,paired);
  await page.locator('.flat-cue').first().click();await page.locator('#flat-text').evaluate(t=>t.setSelectionRange(8,8));await page.getByRole('button',{name:'切分',exact:true}).click();await expect(page.locator('.flat-split-row')).toHaveCount(2);
  const oldHeight=await page.locator('#current-cue-panel').evaluate(el=>el.clientHeight);
  const divider=page.locator('.layout-resizer-h2'),bounds=await divider.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+80,{steps:8});await page.mouse.up();
  expect(await page.locator('#current-cue-panel').evaluate(el=>el.clientHeight)).toBeGreaterThan(oldHeight+30);
  await page.evaluate(()=>{updateEditorSettings({themePreset:'alice'});applyThemeAndColors();});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.screenshot({path:info.outputPath('flat-ui-light.png')});
  const controls=await page.locator('#flat-cue-editor').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
  expect(controls.overflow).toBe('auto');expect(controls.height).toBeGreaterThan(0);
});
test('local media audition does not replace project media or historical audio assets',async({page})=>{
  await open(page);const before=await snap(page),dir=makeTempDir('flat-ui-media'),wav=join(dir,'audition.wav');generateWav(wav,6);
  await page.locator('#flat-media-file').setInputFiles(wav);await expect(page.locator('#flat-message')).toContainText('试听媒体：audition.wav');
  const out=await snap(page);expect(out.media).toBe(before.media);expect(out.msw).toEqual(before.msw);expect(out.subtitles).toEqual(before.subtitles);
  expect(await page.locator('#player').evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(1);
});
