import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {disableOnboarding,makeTempDir,cleanupTempDir,findFreePort,startBlankServer} from './helpers.mjs';

test.beforeEach(()=>{delete process.env.MSW_APP_DATA_ROOT;delete process.env.MAW_APP_DATA_ROOT;});
const openDefaults=page=>page.evaluate(()=>{
  setEditorSettingsPanelOpen(true);
  activateEditorSettingsCategory(document.querySelector('#editor-settings-content [data-settings-category="stickers"]'));
});

for(const portable of [false,true])test(`imported presets refresh all choices without changing applied project styles (${portable?'portable':'server'})`,async({page},info)=>{
  const root=portable?null:makeTempDir('settings-final');
  const server=portable?null:await startBlankServer(await findFreePort(),root);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await disableOnboarding(page);
    await page.goto(portable?pathToFileURL(resolve('blank-editor.html')).href:server.url);
    await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
    await page.evaluate(()=>{
      applyCanonicalProject({segments:[{id:'a',start:0,end:3000,text:'Keep original',items:[]}]},'settings.mosp');
      updateEditorSettings({autoSaveProject:false});
      MSWSubtitleStyle.editTrack(DATA.subtitle_tracks.tracks[0].id);
    });
    const before=await page.evaluate(()=>JSON.parse(buildJson()));
    const bundle=await page.evaluate(()=>({format:'msw-config',version:1,kind:'preferences',categories:['subtitlePresets'],
      sections:{subtitlePresets:{version:1,presets:[{...MSWProjectStyle.defaults(),id:'imported',name:'导入样式',main:{...MSWProjectStyle.defaults().main,fontSize:67}}]}}}));
    await page.evaluate(()=>MSWConfigManager.open());
    await page.waitForLoadState('networkidle');
    await page.evaluate(()=>MSWConfig.flush());
    await page.locator('[data-config-mode="import"]').click();
    await page.locator('#config-file').setInputFiles({name:'Presets.mswconfig',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
    await page.locator('#config-preview').click();
    // Another setting changes after review: retry the preview, not the page.
    await page.evaluate(async()=>{updateEditorSettings({mediaSeekStepMs:1700});await MSWConfig.flush();});
    await page.locator('#config-apply').click();
    await expect(page.locator('#config-message')).toContainText('配置预览已过期');
    await expect(page.locator('#config-apply')).toBeDisabled();
    await expect(page.locator('#config-filename')).toHaveText('Presets.mswconfig');
    await page.locator('#config-preview').click();
    await page.locator('#config-apply').click();
    await expect(page.locator('#config-message')).toContainText('预设与方案已更新');
    await expect(page.locator('#style-project-preset option[value="imported"]')).toHaveText('导入样式');
    await expect(page.locator('#style-preview-mode option[value="imported"]')).toHaveCount(1);
    await expect(page.locator('#video-export-style-source option[value="preset:imported"]')).toHaveCount(1);
    expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(before.subtitles);
    expect(await page.evaluate(()=>editorHistory.canUndo())).toBe(false);
    await page.locator('#editor-settings-close').click();
    await page.locator('#style-project-preset').selectOption('imported');
    await expect(page.locator('#style-field-fontSize')).toHaveValue('67');
    const applied=await page.evaluate(()=>JSON.parse(buildJson()));
    // Keep a pending destructive library action open while the same library is
    // replaced by a config import. Its old target must not survive the import.
    await page.locator('#style-delete-preset').click();
    await expect(page.locator('#style-delete-confirm')).toBeVisible();
    await page.evaluate(async()=>{
      const payload={package:{format:'msw-config',version:1,kind:'preferences',categories:['subtitlePresets'],sections:{subtitlePresets:{version:1,presets:[]}}},categories:['subtitlePresets'],policy:'replace'};
      const preview=await MSWConfig.request({...payload,action:'preview'});
      await MSWConfig.request({...payload,action:'import',revision:preview.revision,token:preview.token});
    });
    await expect(page.locator('#style-delete-confirm')).toBeHidden();
    await expect(page.locator('#style-project-preset option[value="imported"]')).toHaveCount(0);
    await expect(page.locator('#style-field-fontSize')).toHaveValue('67');
    expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(applied.subtitles);
    await page.evaluate(()=>performUndo());
    expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(before.subtitles);
    await page.evaluate(p=>{applyCanonicalProject(p,'reopened.mosp');MSWSubtitleStyle.editTrack(DATA.subtitle_tracks.tracks[0].id);},applied);
    await expect(page.locator('#style-field-fontSize')).toHaveValue('67');
    await openDefaults(page);
    await page.locator('#editor-settings-modal').screenshot({path:info.outputPath('defaults.png')});
    expect(errors).toEqual([]);
  }finally{await page.close({runBeforeUnload:false});if(server)await server.stop();if(root)cleanupTempDir(root);}
});

test('defaults routes reuse the tools and workspace shortcut opens the actual choices',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await disableOnboarding(page);await page.goto(pathToFileURL(resolve('blank-editor.html')).href);
  await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
  for(const scope of ['editor','project']){
    await page.locator('[data-menubar-item="edit"] .menubar-tab').click();
    await page.locator(`#${scope}-settings-toggle`).click();
    await expect(page.locator(`#${scope}-settings-modal`)).toBeVisible();
    await page.locator(`#${scope}-settings-close`).click();
    await expect(page.locator(`#${scope}-settings-toggle`)).toHaveAttribute('aria-expanded','false');
  }
  await openDefaults(page);await page.locator('#settings-open-workspaces').click();
  await expect(page.locator('#workspace-preset-toggle')).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#workspace-preset-menu')).toBeVisible();
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await openDefaults(page);await page.locator('#settings-open-speaker-schemes').click();
  await expect(page.locator('#speaker-scheme-select')).toBeVisible();
  await page.locator('#project-settings-close').click();
  await page.locator('#settings-open-style-presets').click();
  await expect(page.locator('#style-project-preset')).toBeVisible();
  await page.evaluate(()=>{updateEditorSettings({themePreset:'alice'});applyThemeAndColors();MSWConfigManager.open();});
  await page.getByText('详情说明',{exact:true}).click();
  await expect(page.locator('.config-scope-details')).toContainText('重新打开编辑器页面');
  await page.locator('#editor-settings-modal').screenshot({path:info.outputPath('configuration-light.png')});
  await page.setViewportSize({width:760,height:780});
  await page.locator('#editor-settings-modal').screenshot({path:info.outputPath('configuration-narrow.png')});
  expect(errors).toEqual([]);
});
