import {expect,test} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cleanupTempDir,disableOnboarding,findFreePort,generateWav,makeTempDir,startServer} from './helpers.mjs';
let directory,server;
test.beforeEach(async()=>{
  directory=makeTempDir('asset-library');
  const project=JSON.parse(readFileSync(new URL('../fixtures/msw_beta1_legacy_project.json',import.meta.url),'utf8'));
  delete project.msw;
  project.segments[0].color={name:'purple',value:'#a855f7'};
  project.segments.push({id:'main-002',start:1500,end:2500,text:'第二条字幕'});
  const path=join(directory,'project.mosp');writeFileSync(path,JSON.stringify(project));
  server=await startServer(path,generateWav(join(directory,'synthetic.wav'),8),await findFreePort());
});
test.afterEach(async()=>{await server?.stop();cleanupTempDir(directory);});
test.beforeEach(async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect(page.locator('#editor-loading')).toBeHidden();
  await page.waitForFunction(()=>!appearanceBootPending);
});
async function copy(page,both=false){
  await page.evaluate(both=>{
    updateEditorSettings({selectBoundSubtitlePair:false});
    selectOnly(0);
    if(both)selectOnlyExtension(0,getActiveExtensionTrack(),true,true);
  },both);
  await page.locator('.waveform-cue-block[data-track="main"]').first().click({button:'right'});
  await page.locator('#ctxmenu .item').filter({hasText:/^复制到素材库$/}).click();
  await expect(page.locator('.msw-asset-row')).toHaveCount(both?2:1);
}
test('copy, independent edit, undo and project serialization',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await copy(page);
  await page.locator('.msw-asset-row [data-asset-action="edit"]').click();
  const editor=page.locator('#cue-panel-asset-text');await expect(editor).toBeVisible();
  await editor.fill('素材中的新文字');await page.locator('#cue-panel-asset-done').click();
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('你好');
  expect(await page.evaluate(()=>JSON.parse(buildJson()).msw.subtitle_assets[0].text)).toBe('素材中的新文字');
  await expect(page.locator('.msw-asset-row')).toContainText('素材中的新文字');
  await page.evaluate(()=>performUndo());await expect(page.locator('.msw-asset-row')).toContainText('你好');
  await page.evaluate(()=>performRedo());await expect(page.locator('.msw-asset-row')).toContainText('素材中的新文字');
  await page.screenshot({path:info.outputPath('subtitle-library.png')});expect(errors).toEqual([]);
});
test('multi-select inserts primary and secondary copies with bindings at the playhead',async({page})=>{
  await copy(page,true);
  const cards=page.locator('.msw-asset-row');await cards.nth(0).click();await cards.nth(1).click({modifiers:['Control']});
  await expect(page.locator('.msw-asset-row.selected')).toHaveCount(2);
  await page.evaluate(()=>seekFromWaveform(4));
  await page.locator('#asset-insert-selected').click();
  const state=await page.evaluate(()=>({cues:DATA.segments,ext:DATA.multi_subtitle.tracks[0].segments,bindings:DATA.multi_subtitle.bindings}));
  expect(state.cues.at(-1).start).toBe(4000);expect(state.ext.at(-1).start).toBe(4000);expect(state.bindings).toHaveLength(2);
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.segments.length)).toBe(2);
  await expect(cards).toHaveCount(2);
});
test('filters clear selection, player preference persists and timeline selection exits asset editor',async({page})=>{
  await copy(page);
  await page.locator('.msw-asset-row').click();await expect(page.locator('#cue-panel-asset-text')).toBeVisible();
  await page.locator('#asset-search').fill('不存在');await expect(page.locator('.msw-asset-row')).toHaveCount(0);
  await expect(page.locator('#cue-panel-asset-text')).toBeHidden();
  await page.locator('#asset-search').fill('');await page.locator('.msw-asset-row').click();
  await page.evaluate(()=>selectOnly(1));await expect(page.locator('#cue-panel-asset-text')).toBeHidden();
  await expect(page.locator('#cue-panel-text')).toHaveValue('第二条字幕');
  await page.selectOption('#asset-type','audio');await expect(page.locator('.msw-asset-row')).toHaveCount(0);
  await page.selectOption('#asset-type','subtitle');await expect(page.locator('.msw-asset-row')).toHaveCount(1);
  await page.evaluate(()=>{const toggle=document.getElementById('asset-show-player');toggle.checked=false;toggle.dispatchEvent(new Event('change'));});
  await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();
  await expect(page.locator('#asset-show-player')).not.toBeChecked();
});
test('subtitle drag inserts a copy at the drop position and conflicts never overwrite existing cues',async({page})=>{
  await copy(page);
  const wave=page.locator('.waveform-row').first(),box=await wave.boundingBox();
  await page.locator('.msw-asset-row').dragTo(wave,{sourcePosition:{x:30,y:15},targetPosition:{x:box.width*.7,y:box.height*.5}});
  await expect.poll(()=>page.evaluate(()=>DATA.segments.length)).toBe(3);
  expect(await page.evaluate(()=>DATA.segments.at(-1).start)).toBeGreaterThan(2500);
  expect(await page.evaluate(()=>DATA.msw.subtitle_assets.length)).toBe(1);
  await page.evaluate(()=>seekFromWaveform(0));
  await page.locator('.msw-asset-row [data-asset-action="insert"]').click();
  await expect(page.locator('#asset-import-message')).toContainText('与现有字幕重叠');
  expect(await page.evaluate(()=>DATA.segments.length)).toBe(3);
});
test('missing secondary track asks for destination and preserves the secondary role',async({page})=>{
  await copy(page,true);
  await page.evaluate(()=>{DATA.multi_subtitle.tracks[0].id='new-secondary';DATA.multi_subtitle.bindings=[];renderAll({waveform:'full'});seekFromWaveform(4);});
  const card=page.locator('.msw-asset-row').filter({hasText:'副字幕素材'});
  await card.locator('[data-asset-action="insert"]').click();
  const dialog=page.locator('.msw-asset-track-dialog');await expect(dialog).toBeVisible();
  await expect(dialog.locator('select')).toHaveValue('new-secondary');
  await dialog.getByRole('button',{name:'放入时间轴'}).click();
  await expect.poll(()=>page.evaluate(()=>DATA.multi_subtitle.tracks[0].segments.length)).toBe(2);
  expect(await page.evaluate(()=>DATA.segments.length)).toBe(2);
});
test('cross-page selection persists, filtering clears it, and narrow layout stays within the module',async({page},info)=>{
  await page.evaluate(()=>{
    const host=MSWE.resolve('processing-host'),base=structuredClone(DATA);
    base.segments=Array.from({length:92},(_,i)=>({id:'bulk-'+i,start:i*1000,end:i*1000+800,text:'素材 '+i}));
    MSWProject.ensure(base);const batch=MSWAssets.capture(base,{mainIds:base.segments.map(c=>c.id)});
    host.commitSubtitleAssets('导入测试字幕素材',ext=>Object.assign(ext,MSWAssets.add(ext,batch.assets,batch.batch)));
    host.showAssets({automatic:true});
  });
  await page.locator('.msw-asset-row').first().click();await page.locator('#asset-next').click();
  await page.locator('.msw-asset-row').last().click({modifiers:['Control']});
  await expect(page.locator('#asset-count')).toContainText('已选 2');
  await page.locator('#asset-prev').click();await expect(page.locator('.msw-asset-row.selected')).toHaveCount(1);
  await page.locator('#asset-search').fill('素材 1');await expect(page.locator('#asset-count')).not.toContainText('已选');
  await page.setViewportSize({width:900,height:760});
  expect(await page.locator('#asset-library').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('narrow-library.png')});
});
test('subtitle-only library survives server save and reload after clearing the timeline',async({page})=>{
  await copy(page);
  await page.locator('.msw-asset-row [data-asset-action="edit"]').click();
  await page.locator('#cue-panel-asset-text').fill('保存独立素材');
  await page.evaluate(async()=>{
    MSWE.resolve('asset-library').finishEdit();
    DATA.segments=[];DATA.multi_subtitle.tracks=[];DATA.multi_subtitle.bindings=[];
    renderAll({waveform:'full'});await saveCurrentProject({silent:true});
  });
  await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();
  expect(await page.evaluate(()=>DATA.segments.length)).toBe(0);
  expect(await page.evaluate(()=>DATA.msw.subtitle_assets[0].text)).toBe('保存独立素材');
  await page.evaluate(()=>MSWE.resolve('processing-host').showAssets({automatic:true}));
  await expect(page.locator('.msw-asset-row')).toContainText('保存独立素材');
});
