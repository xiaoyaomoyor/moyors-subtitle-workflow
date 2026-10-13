import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server;
test.beforeAll(async()=>{const dir=makeTempDir('track-actions');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
const fixture=()=>({segments:[{id:'a',start:1000,end:3000,text:'Hello',items:[]},{id:'c',start:4000,end:5000,text:'World',items:[]}],
  multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:1000,end:3000,text:'你好',items:[]},{id:'d',start:4000,end:5000,text:'世界',items:[]}]}],
    bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:0,end_offset_ms:0}]},waveform:generateWaveformPayload(30000)});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
test.beforeEach(async({page})=>{await disableOnboarding(page);page.on('dialog',d=>d.dismiss());await page.goto(server.url);await page.evaluate(p=>{applyCanonicalProject(p,'actions.mosp');updateEditorSettings({clickBehavior:'select-only',selectBoundSubtitlePair:false,autoSaveProject:false});},fixture());});
const item=(page,label)=>page.locator('#ctxmenu > .item').filter({has:page.locator('span').filter({hasText:new RegExp('^'+label+'$')})});

test('main and secondary menus share layout and a closed extended-actions flyout',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const labels=[];
  for(const role of ['main','extension']) {
    await page.locator(`.waveform-cue-block[data-track="${role}"]`).first().click({button:'right'});
    labels.push(await page.locator('#ctxmenu > .item > span, #ctxmenu > .ctx-submenu > .item > span').allTextContents());
    await expect(page.getByRole('menuitem',{name:'配音所选字幕（TTS）',exact:true})).toBeHidden();
    await page.getByRole('menuitem',{name:'扩展操作',exact:true}).hover();
    await expect(page.locator('#ctxmenu .ctx-submenu.open .ctx-submenu-menu > .item > span')).toHaveText(['翻译所选字幕','配音所选字幕（TTS）','复制到素材库']);
    await page.screenshot({path:info.outputPath(role+'-menu.png')});
    await page.keyboard.press('Escape');
  }
  expect(labels[1].filter(x=>x!=='对齐对应字幕时间范围')).toEqual(labels[0]);
  expect(errors).toEqual([]);
});

test('secondary color, replacement and sticker commands keep main text untouched and undo',async({page})=>{
  await page.locator('.waveform-cue-block[data-track="extension"]').first().click({button:'right'});
  await page.locator('#ctxmenu span[title]').first().click();
  let p=await snap(page);expect(p.subtitles.cues.find(c=>c.content.text==='你好').content.color).toBeTruthy();
  expect(p.subtitles.cues.find(c=>c.content.text==='Hello').content.color).toBeFalsy();
  await page.evaluate(()=>performUndo());
  await page.evaluate(()=>{clearSelection({silent:true});selectedExtensionIdxs.add(0);selectedExtensionIdxs.add(1);showExtensionContextMenu(400,250,0,2000);});
  await item(page,'批量替换选中字幕…').click();
  await page.locator('#find-input').fill('好');await page.locator('#replace-input').fill('们');await page.locator('#replace-confirm').click();
  p=await snap(page);expect(p.subtitles.cues.some(c=>c.content.text==='你们')).toBe(true);expect(p.subtitles.cues.some(c=>c.content.text==='Hello')).toBe(true);
  await page.evaluate(()=>performUndo());
  await page.evaluate(()=>{STICKERS.push({name:'test-sticker',filename:'test.png'});openStickerPicker([0],false,{extension:getActiveExtensionTrack()});assignSticker(STICKERS.at(-1));});
  p=await snap(page);expect(p.subtitles.cues.find(c=>c.content.text==='你好').content.sticker.name).toBe('test-sticker');expect(p.subtitles.cues.find(c=>c.content.text==='Hello').content.sticker).toBeFalsy();
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles.cues.every(c=>!c.content.sticker)).toBe(true);
});

test('TTS offers two targets and captures only actual selections with physical track identities',async({page})=>{
  await expect(page.locator('#tts-target option')).toHaveText(['选定的字幕块','字幕编辑器内容']);
  await expect(page.locator('#tts-target')).toHaveValue('selection');
  const result=await page.evaluate(()=>{
    const capture=()=>MSWTts.snapshot(DATA,processingSelection(),'selection');
    selectOnlyExtension(0);const secondary=capture();selectOnly(0);const main=capture();
    selectedExtensionIdxs.add(0);const both=capture();
    clearSelection({silent:true});let error;try{capture();}catch(e){error=e.message;}
    return {secondary,main,both,error};
  });
  expect(result.secondary.entries.map(e=>e.text)).toEqual(['你好']);expect(result.main.entries.map(e=>e.text)).toEqual(['Hello']);
  expect(result.both.entries.map(e=>e.text).sort()).toEqual(['Hello','你好']);expect(new Set(result.both.entries.map(e=>e.track_id)).size).toBe(2);
  expect(result.error).toContain('请先选择字幕');
  await page.locator('.multi-cue-column.extension').first().click({button:'right'});await page.getByRole('menuitem',{name:'扩展操作',exact:true}).hover();
  await page.getByRole('menuitem',{name:'配音所选字幕（TTS）',exact:true}).click();await expect(page.locator('#tts-target')).toHaveValue('selection');
});

test('track select-all includes disabled contents across rows without paired-track selection',async({page})=>{
  await page.evaluate(()=>{
    updateEditorSettings({selectBoundSubtitlePair:true});
    DATA.segments[1].disabled=true;DATA.segments[1].start=14000;DATA.segments[1].end=16000;
    renderAll({waveform:'full'});fixedAddTrack('subtitle');
  });
  const p=await snap(page);
  for(const track of p.subtitles.tracks) {
    await page.locator(`.fixed-track-head[data-subtitle-track-id="${track.id}"]`).first().click({button:'right'});
    const action=page.getByRole('menuitem',{name:'全选轨道内容',exact:true});
    const expected=p.subtitles.cues.filter(c=>c.track_id===track.id).map(c=>c.id).sort();
    if(!expected.length){await expect(action).toHaveAttribute('aria-disabled','true');continue;}
    await action.click();
    expect(await page.evaluate(()=>{const s=processingSelection();return [...s.mainIds,...s.extensionIds].sort();})).toEqual(expected);
  }
});

test('three visible subtitle tracks compact blocks and headers; collapsing restores two-track height',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const block=page.locator('.waveform-cue-block[data-track="main"]').first();
  expect((await block.boundingBox()).height).toBe(32);
  const id=await page.evaluate(()=>{fixedAddTrack('subtitle');return DATA.subtitle_tracks.tracks.at(-1).id;});
  expect((await block.boundingBox()).height).toBe(20);
  expect(await block.evaluate(el=>getComputedStyle(el).lineHeight)).toBe('20px');
  const geometry=await page.evaluate(()=>[document.querySelector('.waveform-track-heads')].flatMap(group=>[...group.querySelectorAll('.fixed-track-head')].map(head=>{
    const cue=document.querySelector(`.waveform-cue-block[data-subtitle-track-id="${head.dataset.subtitleTrackId}"]`);
    return cue?{cue:cue.getBoundingClientRect().y,head:head.getBoundingClientRect().y,height:head.getBoundingClientRect().height}:null;
  })).filter(Boolean));
  for(const g of geometry){expect(g.height).toBe(20);expect(Math.abs(g.cue-g.head)).toBeLessThan(2);}
  await page.evaluate(()=>{waveformEditor.settings.mode='basic';waveformEditor.render();});
  expect((await block.boundingBox()).height).toBe(20);
  const pane=await page.locator('.waveform-pane').boundingBox(),lastHead=await page.locator(`.fixed-track-head[data-subtitle-track-id="${id}"]`).boundingBox();
  expect(lastHead.y+lastHead.height).toBeLessThan(pane.y+pane.height);
  await page.screenshot({path:info.outputPath('compact-three-tracks.png')});
  await page.evaluate(id=>fixedUpdateTrack(id,{collapsed:true}),id);
  expect((await block.boundingBox()).height).toBe(32);
  await page.evaluate(id=>{fixedUpdateTrack(id,{collapsed:false});fixedUpdateTrack(id,{enabled:false});},id);
  expect((await block.boundingBox()).height).toBe(20);
  expect(errors).toEqual([]);
});

test('compact track Ctrl-drag creation stays on the pointed empty track and can undo',async({page})=>{
  const id=await page.evaluate(()=>{fixedAddTrack('subtitle');waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.render();return DATA.subtitle_tracks.tracks.at(-1).id;});
  const target=await page.evaluate(id=>{
    const row=document.querySelector('.waveform-row'),r=row.getBoundingClientRect();
    const head=document.querySelector(`.fixed-track-head[data-subtitle-track-id="${id}"]`).getBoundingClientRect();
    return {x:r.left+r.width*.6,x2:r.left+r.width*.8,y:head.y+head.height/2};
  },id);
  await page.keyboard.down('Control');await page.mouse.move(target.x,target.y);await page.mouse.down();await page.mouse.move(target.x2,target.y,{steps:10});
  const ghost=page.locator('.waveform-create-preview');await expect(ghost).toBeVisible();expect((await ghost.boundingBox()).height).toBe(20);
  await page.mouse.up();await page.keyboard.up('Control');
  expect((await snap(page)).subtitles.cues.filter(c=>c.track_id===id)).toHaveLength(1);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles.cues.filter(c=>c.track_id===id)).toHaveLength(0);
});
