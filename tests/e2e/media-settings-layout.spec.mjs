import {expect,test} from '@playwright/test';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startBlankServer,toggleMediaSettings} from './helpers.mjs';
let server;
test.beforeEach(async({page})=>{
  server=await startBlankServer(await findFreePort(),makeTempDir('media-settings-layout'));
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await page.evaluate(waveform=>{
    applyCanonicalProject({segments:[{id:'a',start:0,end:3000,text:'Source text',items:[]}],multi_subtitle:{enabled:true,tracks:[{id:'zh',role:'extension',segments:[{id:'b',text:'翻译字幕',start:0,end:3000,items:[]}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]},waveform},'settings.mosp');
    updateEditorSettings({autoSaveProject:false});
  },generateWaveformPayload(5000));
  await toggleMediaSettings(page);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();});
async function edit(page,id,value){await page.locator(id).fill(value);await page.locator(id).dispatchEvent('change');}
const project=page=>page.evaluate(()=>fixedStyleValue());
async function properties(page){await page.evaluate(()=>{setSubtitlePreviewSettingsPanelOpen(false);MSWSubtitleStyle.open('track');});}

test('playback and preview controls fit narrow panels in both languages',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('#subtitle-layer-presentation-settings legend')).toHaveText('重叠字幕');
  await expect(page.locator('#sticker-overlay-toggle').locator('..').locator('.msw-help-button')).toHaveCount(0);
  await page.locator('#subtitle-layer-gap').locator('..').locator('.msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('组内主副字幕');await page.keyboard.press('Escape');
  await page.locator('#jkl-playback-mode').locator('..').locator('.msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('K');await page.keyboard.press('Escape');
  for(const [width,theme,language] of [[560,'default','zh'],[360,'alice','zh'],[360,'default','en']]){
    await page.locator('#media-settings-modal').evaluate((el,w)=>el.style.width=w+'px',width);
    await page.evaluate(({theme,language})=>{updateEditorSettings({themePreset:theme});applyThemeAndColors();MSWE_I18N.applyLanguage(language);},{theme,language});
    expect(await page.locator('.media-settings-body').evaluate(body=>body.scrollWidth<=body.clientWidth+1)).toBe(true);
    await expect(page.locator('#subtitle-properties-open')).toBeVisible();
    await page.locator('#media-settings-modal').screenshot({path:info.outputPath(`settings-${width}-${language}.png`)});
  }
  expect(errors).toEqual([]);
});
test('independent preview stays selected while project preset edits reset to that preset',async({page})=>{
  await expect(page.locator('#style-preview-mode option[value="custom"]')).toHaveCount(0);
  await page.locator('#style-preview-mode').selectOption('contrast');await properties(page);
  await page.locator('#style-project-preset').selectOption('large');await edit(page,'#style-field-fontSize','64');
  expect((await project(page)).main.fontSize).toBe(64);
  await expect(page.locator('#style-project-preset option:checked')).toContainText('已修改');
  // Property editing intentionally previews project style; leaving the module
  // restores the independent proofreading preset.
  expect(await page.evaluate(()=>{waveformEditor.activateModuleTab('panel');return MSWSubtitleStyle.currentPreview().style.main.borderStyle;})).toBe(3);
  await properties(page);
  await page.locator('#style-reset').click();await expect(page.locator('#style-field-fontSize')).toHaveValue('72');
  await page.evaluate(()=>performUndo());await expect(page.locator('#style-field-fontSize')).toHaveValue('64');
  await page.evaluate(()=>performRedo());await expect(page.locator('#style-field-fontSize')).toHaveValue('72');
  await expect(page.locator('#style-preview-mode')).toHaveValue('contrast');
});
test('explicit preview preference survives reload without creating a project preset',async({page})=>{
  const before=await project(page);
  await page.locator('#style-preview-mode').selectOption('large');await page.evaluate(()=>MSWConfig.flush());
  expect(await project(page)).toEqual(before);
  await page.reload();await expect.poll(()=>page.evaluate(()=>MSWSubtitleStyle?.ready)).toBe(true);
  await toggleMediaSettings(page);await expect(page.locator('#style-preview-mode')).toHaveValue('large');
  expect(await page.evaluate(()=>MSWSubtitleStyle.currentPreview().style.main.fontSize)).toBe(72);
  await expect(page.locator('#style-preview-mode option').filter({hasText:'旧工程预览样式'})).toHaveCount(0);
});
test('paired arrangement and appearance-only swap survive undo and serialization',async({page})=>{
  await properties(page);await page.locator('#style-project-preset').selectOption('default');
  await page.locator('#style-more').evaluate(el=>el.open=true);
  await page.locator('#style-pair-order').selectOption('secondary-above');await edit(page,'#style-pair-gap','-12');
  const before=await project(page);expect(before.pairLayout).toEqual({order:'secondary-above',gap:-12});
  await page.locator('#style-swap').click();const swapped=await project(page);
  expect(swapped.main.fontSize).toBe(before.secondary.fontSize);expect(swapped.secondary.primaryColor).toBe(before.main.primaryColor);
  for(const role of ['main','secondary'])for(const key of ['alignment','marginL','marginR','marginV'])expect(swapped[role][key]).toBe(before[role][key]);
  expect(swapped.pairLayout).toEqual(before.pairLayout);
  await page.evaluate(()=>performUndo());expect(await project(page)).toEqual(before);
  await page.evaluate(()=>performRedo());expect(await project(page)).toEqual(swapped);
  await page.evaluate(()=>{applyCanonicalProject(JSON.parse(buildJson()),'arranged.mosp');MSWSubtitleStyle.open('track');});
  await expect(page.locator('#style-pair-order')).toHaveValue('secondary-above');await expect(page.locator('#style-pair-gap')).toHaveValue('-12');
});
test('current animation presets keep values across disabling and section folding',async({page})=>{
  await properties(page);await page.locator('#style-animation').evaluate(el=>el.open=true);
  await page.locator('#motion-preset-fade').click();await page.locator('#motion-timing').selectOption('ms');
  const before=await project(page);
  await page.locator('#motion-preset-fade').click();await expect(page.locator('#motion-fade-graph')).toBeHidden();
  await page.locator('#motion-preset-fade').click();expect(await project(page)).toEqual(before);
  await page.locator('#style-animation').evaluate(el=>el.open=false);await page.locator('#style-animation').evaluate(el=>el.open=true);
  await expect(page.locator('#motion-fade-graph')).toBeVisible();expect(await project(page)).toEqual(before);
});
test('failed shared-config preset save preserves appearance and allows retry',async({page})=>{
  await properties(page);let before=await project(page);
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('可重试预设');
  const url=await page.evaluate(()=>new URL(MSW_CONFIG_BOOTSTRAP.url,location.href).href);
  await page.route(url,route=>route.fulfill({status:500,json:{ok:false,error:'测试保存失败'}}));
  await page.locator('#style-save-preset').click();await expect(page.locator('#style-message')).not.toBeEmpty();
  await expect(page.locator('#style-save-form')).toBeVisible();expect(await project(page)).toEqual(before);
  await edit(page,'#style-field-fontSize','53');before=await project(page);
  await page.unroute(url);await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-message')).toHaveText('预设已保存。');
  expect((await project(page)).main).toEqual(before.main);
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('可重试预设');
  const presets=await page.evaluate(()=>JSON.parse(MSWConfig.storage.getItem('msw.subtitle-presets.v1')));
  expect(presets.filter(s=>s.name==='可重试预设')).toHaveLength(1);expect(presets[0].main.fontSize).toBe(53);
});
test('wrapping settings remain independent for paired tracks and survive save/reopen',async({page})=>{
  await page.locator('#style-preview-mode').selectOption('contrast');await properties(page);
  await page.locator('#style-field-wrapMode').selectOption('characters');await edit(page,'#style-field-charsPerLine','7');
  await page.locator('#style-secondary').click();await expect(page.locator('#style-field-wrapMode')).toHaveValue('auto');
  await page.locator('#style-field-wrapMode').selectOption('characters');await edit(page,'#style-field-charsPerLine','11');
  await page.evaluate(()=>performUndo());await expect(page.locator('#style-field-charsPerLine')).toHaveValue('20');
  await page.evaluate(()=>performRedo());await expect(page.locator('#style-field-charsPerLine')).toHaveValue('11');
  await page.evaluate(()=>{applyCanonicalProject(JSON.parse(buildJson()),'wrapped.mosp');MSWSubtitleStyle.open('track');});
  await page.locator('#style-main').click();await expect(page.locator('#style-field-charsPerLine')).toHaveValue('7');
  await edit(page,'#style-field-charsPerLine','0');expect((await project(page)).main.charsPerLine).toBe(7);
  await expect(page.locator('#style-preview-mode')).toHaveValue('contrast');
});
