import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer,openMenubarMenu} from './helpers.mjs';
let server;
test.beforeAll(async()=>{const dir=makeTempDir('track-menus');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
  await disableOnboarding(page);page.on('dialog',d=>d.accept());await page.goto(server.url);
  await page.evaluate(waveform=>{
    applyCanonicalProject({segments:[{id:'a',text:'Hello world',start:1000,end:3000,items:[]}],
      multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[{id:'b',text:'你好世界',start:1000,end:3000,items:[]}]}],
        bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:0,end_offset_ms:0}]},waveform},'menus.mosp');
    updateEditorSettings({autoSaveProject:false});
  },generateWaveformPayload(10000));
});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
async function trackMenu(page,kind) {
  await openMenubarMenu(page,'字幕');
  await page.locator('#subtitle-track-settings-dropdown > .dropdown-submenu-toggle').hover();
  if(kind)await page.locator(`#subtitle-track-${kind}-dropdown > .dropdown-submenu-toggle`).hover();
}

test('track submenu edits expansion and enabled states without closing, and persists with undo',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const before=await snap(page),[main,sub]=before.subtitles.tracks;
  await trackMenu(page,'visibility');
  await expect(page.locator('[data-menubar-item="subtitle"]')).not.toContainText('叠加字幕支持编辑和导出');
  const check=id=>page.locator(`#subtitle-track-visibility-menu label[data-track-id="${id}"] input`);
  await expect(check(main.id)).toBeChecked();await check(main.id).uncheck();
  await expect(page.locator(`.fixed-track-head[data-subtitle-track-id="${main.id}"]`)).toHaveCount(0);
  await expect(check(sub.id)).toBeVisible();await check(sub.id).uncheck();
  await expect(page.locator('.fixed-track-head')).toHaveCount(0);
  await check(main.id).check();await check(sub.id).check();
  await page.screenshot({path:info.outputPath('track-expansion.png')});
  await trackMenu(page,'enabled');
  const enabled=id=>page.locator(`#subtitle-track-enabled-menu label[data-track-id="${id}"] input`);
  await enabled(main.id).uncheck();await enabled(sub.id).uncheck();
  const saved=await snap(page);expect(saved.subtitles.cues).toEqual(before.subtitles.cues);expect(saved.subtitles.bindings).toEqual(before.subtitles.bindings);
  expect(saved.subtitles.tracks.every(t=>!t.enabled&&!t.collapsed)).toBe(true);
  await page.evaluate(()=>performUndo());await expect(enabled(sub.id)).toBeChecked();await expect(enabled(main.id)).not.toBeChecked();
  const label=enabled(sub.id).locator('..');await label.focus();await page.keyboard.press('Space');await expect(enabled(sub.id)).not.toBeChecked();
  await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),saved);
  await trackMenu(page,'enabled');await expect(enabled(main.id)).not.toBeChecked();await expect(enabled(sub.id)).not.toBeChecked();
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>{updateEditorSettings({themePreset:theme==='light'?'alice':'default',colors:null});applyThemeAndColors();},theme);
    await page.screenshot({path:info.outputPath(`track-enabled-${theme}.png`)});
  }
  await trackMenu(page);await page.locator('#subtitle-track-add').click();
  expect((await snap(page)).subtitles.tracks.map(t=>t.name)).toEqual(['S1主','S1副','S2']);
  await trackMenu(page,'visibility');await expect(page.locator('#subtitle-track-visibility-menu input')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('language explanation uses shared hover and pinned help without the old block',async({page},info)=>{
  await openMenubarMenu(page,'字幕');await page.locator('#multi-subtitle-settings-toggle').hover();
  await expect(page.locator('.multi-subtitle-setting-hint')).toHaveCount(0);
  const help=page.locator('#multi-subtitle-language-caption .msw-help-button');
  await help.hover();await expect(page.locator('#msw-option-help')).toContainText('按空格拆分');
  await help.click();await page.locator('#multi-subtitle-main-language-mode').hover();
  await expect(page.locator('#msw-option-help')).toContainText('按字符拆分');
  await page.screenshot({path:info.outputPath('language-help.png')});
  await page.keyboard.press('Escape');await expect(page.locator('#msw-option-help')).toBeHidden();
  await expect(page.locator('#multi-subtitle-settings-menu')).toBeVisible();
  await page.setViewportSize({width:700,height:800});await trackMenu(page,'visibility');
  const menu=page.locator('#subtitle-track-visibility-menu');
  const box=await menu.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(700);
  await page.screenshot({path:info.outputPath('track-menu-narrow.png')});
});
