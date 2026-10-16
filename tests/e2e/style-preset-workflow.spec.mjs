import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer,toggleMediaSettings} from './helpers.mjs';
let server;
test.beforeAll(async()=>{const dir=makeTempDir('style-preset-workflow');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleStyle?.ready)).toBe(true);
  await page.evaluate(waveform=>{
    const style=MSWProjectStyle.defaults();style.annotation=MSWProjectStyle.defaults();style.annotation.main.fontSize=90;
    applyCanonicalProject({segments:[{id:'a',start:0,end:3000,text:'Source text',items:[]}],preview:{project_style:style},
      multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[{id:'b',text:'翻译字幕',start:0,end:3000,items:[]}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]},waveform},'preset.mosp');
    updateEditorSettings({autoSaveProject:false});
  },generateWaveformPayload(5000));
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleStyle?.ready)).toBe(true);await toggleMediaSettings(page);
});
const library=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('msw.subtitle-presets.v1')||'[]'));
const snapshot=page=>page.evaluate(()=>JSON.parse(buildJson()));
const editSize=async(page,size)=>{await page.locator('#style-field-fontSize').fill(String(size));await page.locator('#style-field-fontSize').dispatchEvent('change');};
async function saveNew(page){await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('我的大字');await page.locator('#style-save-preset').click();await expect(page.locator('#style-message')).toHaveText('预设已保存。');return (await library(page))[0].id;}

test('default preset replaces inheritance and reset restores the selected builtin or saved user preset',async({page})=>{
  await expect(page.locator('#style-project-preset option[value="inherit"]')).toHaveCount(0);
  await expect(page.locator('#style-project-preset')).toHaveValue('default');
  await page.locator('#style-project-preset').selectOption('large');await editSize(page,99);
  await page.locator('#style-reset').click();await expect(page.locator('#style-field-fontSize')).toHaveValue('72');
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('大字清晰');
  const id=await saveNew(page);await editSize(page,88);await page.locator('#style-overwrite').click();
  await expect(page.locator('#style-message')).toHaveText('预设已更新。');
  await editSize(page,100);await page.locator('#style-reset').click();
  await expect(page.locator('#style-field-fontSize')).toHaveValue('88');
  await expect(page.locator('#style-project-preset')).toHaveValue(id);
  await page.evaluate(()=>{fixedAddTrack('subtitle');MSWSubtitleStyle.editTrack(DATA.subtitle_tracks.tracks.at(-1).id,false);});
  await expect(page.locator('#style-project-preset')).toHaveValue('default');
  await expect(page.locator('#style-field-fontSize')).toHaveValue('48');
});

test('preset identity survives group adaptation, parameter edits and overwrite without changing other groups',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#style-project-preset').selectOption('large');
  const id=await saveNew(page);
  expect((await library(page))[0].annotation.main.fontSize).toBe(90);
  await expect(page.locator('#style-project-preset')).toHaveValue(id);
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('我的大字');
  await expect(page.locator('#style-project-preset option[value="current"]')).toHaveCount(0);
  await page.evaluate(id=>{fixedAddTrack('subtitle');MSWSubtitleStyle.editTrack(DATA.subtitle_tracks.tracks.at(-1).id,false);},id);
  await page.locator('#style-project-preset').selectOption(id);
  const other=(await snapshot(page)).subtitles.tracks.at(-1).style.value;
  await page.locator('#style-track-target').selectOption({label:'S1'});
  await page.locator('#style-preview-mode').selectOption('contrast');
  await editSize(page,88);
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('我的大字 · 已修改');
  expect((await library(page))[0].main.fontSize).toBe(72);
  await page.evaluate(()=>performUndo());await expect(page.locator('#style-project-preset option:checked')).toHaveText('我的大字');
  await page.evaluate(()=>performRedo());await expect(page.locator('#style-overwrite')).toBeEnabled();
  await page.locator('#style-overwrite').click();await expect(page.locator('#style-message')).toHaveText('预设已更新。');
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('我的大字');
  expect((await library(page))[0].main.fontSize).toBe(88);
  expect((await library(page))[0].annotation.main.fontSize).toBe(90);
  expect((await snapshot(page)).subtitles.tracks.at(-1).style.value).toEqual(other);
  await expect(page.locator('#style-preview-mode')).toHaveValue('contrast');
  const saved=await snapshot(page);await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),saved);
  await expect(page.locator('#style-project-preset')).toHaveValue(id);
  await expect(page.locator('#style-field-fontSize')).toHaveValue('88');
  const toolbar=await page.locator('.msw-style-toolbar').boundingBox(),selectors=await page.locator('.msw-style-selectors').boundingBox();
  expect(toolbar.y+toolbar.height).toBeLessThan(selectors.y);
  for(const theme of ['alice','default']){
    await page.evaluate(theme=>{updateEditorSettings({themePreset:theme,colors:null});applyThemeAndColors();},theme);
    await page.locator('#media-settings-modal').screenshot({path:info.outputPath(`style-${theme}.png`)});
  }
  expect(errors).toEqual([]);
});

test('builtins stay readonly and old unsaved styles remain intact without a custom option',async({page})=>{
  await page.locator('#style-project-preset').selectOption('large');await editSize(page,99);
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('大字清晰 · 已修改');
  await expect(page.locator('#style-overwrite')).toBeDisabled();
  const saved=await snapshot(page);
  for(const track of saved.subtitles.tracks)track.style.selection='current';
  await page.evaluate(p=>applyCanonicalProject(p,'legacy-custom.mosp'),saved);
  await expect(page.locator('#style-field-fontSize')).toHaveValue('99');
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('未保存为预设');
  await expect(page.locator('#style-project-preset option:checked')).toHaveAttribute('disabled','');
  await saveNew(page);await expect(page.locator('#style-project-preset option:checked')).toHaveText('我的大字');
  expect((await library(page))[0].main.fontSize).toBe(99);
});
