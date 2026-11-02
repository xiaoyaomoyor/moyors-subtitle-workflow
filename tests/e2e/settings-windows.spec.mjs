import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startBlankServer} from './helpers.mjs';
let server;
const fixture=()=>({segments:[{id:'a',start:37,end:3013,text:'Source',items:[]}],multi_subtitle:{enabled:true,tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:37,end:3013,text:'译文',items:[]}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]},waveform:generateWaveformPayload(5000)});
test.beforeEach(async({page})=>{
 server=await startBlankServer(await findFreePort(),makeTempDir('settings-windows'));
 await disableOnboarding(page);await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
 await page.evaluate(p=>{applyCanonicalProject(p,'windows.mosp');updateEditorSettings({autoSaveProject:false});},fixture());
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();});
const open=async(page,scope,category)=>page.evaluate(({scope,category})=>scope==='project'?setProjectSettingsPanelOpen(true,category):(setEditorSettingsPanelOpen(true),category&&activateEditorSettingsCategory(document.querySelector(`#editor-settings-content [data-settings-category="${category}"]`))),{scope,category});

test('two windows separate project controls and preferences, keeping one instance and undo',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await open(page,'editor','general');
 await expect(page.locator('#editor-settings-title')).toHaveText('编辑器设置');
 await expect(page.locator('#editor-settings-content #timeline-timebase')).toHaveCount(0);
 await expect(page.locator('#editor-settings-content #speaker-auto-follow')).toHaveCount(1);
 await expect(page.locator('#project-settings-content #speaker-palette-rows')).toHaveCount(1);
 await expect(page.locator('#editor-settings-content #editor-config-manager')).toHaveCount(1);
 const before=await page.evaluate(()=>JSON.parse(buildJson()));
 await page.locator('#speaker-auto-follow').check();
 expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(before.subtitles);
 await open(page,'project','time-tracks');
 await expect(page.locator('#project-settings-modal')).toBeVisible();await expect(page.locator('#editor-settings-modal')).toBeVisible();
 await expect(page.locator('#project-settings-tracks')).toContainText('S1主');
 const prefs=await page.evaluate(()=>MSWConfig.storage.getItem('moy.asr.editor.settings.v1'));
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#timeline-timebase').selectOption('frames');
 expect(await page.evaluate(()=>DATA.timebase.unit)).toBe('frames');
 const remapped=await page.evaluate(()=>JSON.parse(buildJson()));
 await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.timebase.unit)).not.toBe('frames');
 expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(before.subtitles);
 await page.evaluate(()=>performRedo());
 expect(await page.evaluate(()=>DATA.timebase.unit)).toBe('frames');
 expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(remapped.subtitles);
 await page.evaluate(()=>performUndo());
 expect(await page.evaluate(()=>MSWConfig.storage.getItem('moy.asr.editor.settings.v1'))).toBe(prefs);
 await page.locator('#project-settings-close').click();await expect(page.locator('#editor-settings-modal')).toBeVisible();
 expect(errors).toEqual([]);
});

test('navigation, search and positions are independent, preserved and accessible',async({page})=>{
 await open(page,'editor','appearance');await page.locator('#editor-settings-search').fill('主题');
 await open(page,'project','subtitle-speakers');
 await page.locator('#project-settings-search').fill('名称');await expect(page.locator('#speaker-name-language')).toBeVisible();
 await expect(page.locator('#editor-settings-search')).toHaveValue('主题');
 await page.locator('#project-settings-search').fill('not-a-setting');await expect(page.locator('#project-settings-content .settings-empty')).toBeVisible();
 await page.locator('#project-settings-nav button[data-settings-category="time-tracks"]').click();
 await expect(page.locator('#project-settings-search')).toHaveValue('');
 const drag=async(id,dx,dy)=>{const box=await page.locator(id).boundingBox();await page.mouse.move(box.x+20,box.y+16);await page.mouse.down();await page.mouse.move(box.x+20+dx,box.y+16+dy,{steps:4});await page.mouse.up();};
 await drag('#project-settings-drag-handle',70,35);
 const projectPos=await page.evaluate(()=>MSWConfig.storage.getItem('msw.project.settings.position.v1'));expect(projectPos).not.toBeNull();
 await page.locator('#project-settings-close').click();await drag('#editor-settings-drag-handle',20,-20);
 expect(await page.evaluate(()=>MSWConfig.storage.getItem('msw.project.settings.position.v1'))).toBe(projectPos);
 await page.evaluate(()=>MSWConfig.flush());await page.reload();await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
 await open(page,'project');await expect(page.locator('#project-settings-nav [data-settings-category="time-tracks"]')).toHaveAttribute('aria-current','page');
 expect(await page.locator('#project-settings-modal').evaluate(el=>({left:parseInt(el.style.left),top:parseInt(el.style.top)}))).toEqual(JSON.parse(projectPos));
});

test('module shortcuts reuse existing controls and track settings route to project scope',async({page})=>{
 await open(page,'editor','display-playback');await page.locator('#settings-open-cue').click();
 await expect(page.locator('#cue-editor-settings-modal')).toBeVisible();
 await page.locator('#project-track-settings-shortcut').click();await expect(page.locator('#track-split-track')).toBeVisible();
 await expect(page.locator('#track-split-track')).toHaveCount(1);
 await page.locator('#track-split-mode').selectOption('continuous');
 const saved=await page.evaluate(()=>JSON.parse(buildJson()));expect(saved.subtitles.tracks[0].split_mode).toBe('continuous');
 await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),saved);
 await open(page,'project','subtitle-layout');await page.locator('#project-style-settings-open').click();
 await expect(page.locator('#subtitle-properties')).toBeVisible();await expect(page.locator('#project-settings-modal')).toBeHidden();
 await open(page,'editor','configuration');await expect(page.locator('#editor-config-manager')).toBeVisible();
});

test('both settings windows fit dark/light and narrow layouts without clipped controls',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [width,theme,language] of [[1200,'default','zh'],[1200,'alice','en'],[390,'alice','zh']]){
  await page.setViewportSize({width,height:850});await page.evaluate(({theme,language})=>{updateEditorSettings({themePreset:theme});applyThemeAndColors();MSWE_I18N.applyLanguage(language);},{theme,language});
  for(const [scope,category] of [['editor','appearance'],['project','subtitle-speakers']]){
   await page.evaluate(()=>{setEditorSettingsPanelOpen(false);setProjectSettingsPanelOpen(false);});await open(page,scope,category);
   const root=page.locator(`#${scope}-settings-modal`);
   expect(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   expect(await page.locator(`#${scope}-settings-content`).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   await root.screenshot({path:info.outputPath(`${scope}-${width}-${theme}.png`)});
   if(scope==='project'&&language==='en'){
    await open(page,'project','time-tracks');await expect(page.locator('#project-settings-tracks')).toContainText('cues');
    await open(page,'project','media-resources');await expect(page.locator('#project-settings-media')).toContainText('Subtitle cues: 2');
   }
  }
 }
 expect(errors).toEqual([]);
});

test('portable editor supports project controls and configuration without a service',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(resolve('blank-editor.html')).href);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
 await page.evaluate(p=>applyCanonicalProject(p,'portable.mosp'),fixture());
 await open(page,'project','subtitle-speakers');await expect(page.locator('#speaker-palette-rows')).toBeVisible();
 await open(page,'editor','configuration');await expect(page.locator('#editor-config-manager')).toBeVisible();
 expect(errors).toEqual([]);
});
