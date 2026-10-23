import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {makeTempDir,cleanupTempDir,findFreePort,startBlankServer} from './helpers.mjs';

test.beforeEach(()=>{delete process.env.MSW_APP_DATA_ROOT;delete process.env.MAW_APP_DATA_ROOT;});
const file=sections=>({format:'msw-config',version:1,kind:'preferences',categories:['interface'],sections});
async function open(page){await page.evaluate(()=>MSWConfigManager.open());await expect(page.locator('.msw-config-manager')).toBeVisible();await expect(page.locator('#config-categories input')).not.toHaveCount(0);}
async function upload(page,value,name='Test.mswconfig'){
  await page.locator('[data-config-mode="import"]').click();
  await page.locator('#config-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await expect(page.locator('#config-filename')).toHaveText(name);
}

test('editor import previews, isolates categories, preserves project and rolls back',async({page})=>{
  const root=makeTempDir('config-manager'),server=await startBlankServer(await findFreePort(),root),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
    await page.evaluate(async()=>{applyCanonicalProject({segments:[{id:'sample',start:0,end:3000,text:'Keep project style and content',items:[]}]},'fixture.mosp');updateEditorSettings({autoSaveProject:false,mediaSeekStepMs:1000});await MSWConfig.flush();});
    const before=await page.evaluate(()=>JSON.stringify(DATA));
    await expect(page.locator('#config-manager-open')).toHaveCount(0);
    await page.locator('[data-menubar-item="edit"] .menubar-tab').click();await page.locator('#editor-settings-toggle').click();
    await page.locator('#editor-settings-nav [data-settings-category="configuration"]').click();
    await expect(page.locator('#editor-settings-modal')).toBeVisible();
    await expect(page.locator('dialog.msw-config-manager')).toHaveCount(0);
    // Opening global settings also initializes environment defaults. Finish
    // those independent migrations before testing an import/restore snapshot.
    await page.waitForLoadState('networkidle');
    await page.locator('#editor-settings-search').fill('配置管理');
    await expect(page.locator('#config-export')).toBeVisible();
    await page.locator('#editor-settings-search').fill('');
    await expect(page.locator('.msw-config-manager')).toBeVisible();
    await expect(page.locator('[data-config-category]')).toHaveCount(8);
    await expect(page.locator('#config-categories')).not.toContainText('ASS');
    await expect(page.locator('#config-categories')).not.toContainText('首次使用');
    const all=page.getByRole('checkbox',{name:'配置分类',exact:true});
    await expect(all).toBeChecked();
    await page.locator('[data-config-category][value="tts"]').uncheck();
    expect(await all.evaluate(e=>e.indeterminate)).toBe(true);
    await all.click();await expect(page.locator('[data-config-category]:checked')).toHaveCount(8);
    await all.uncheck();await expect(page.locator('[data-config-category]:checked')).toHaveCount(0);
    await all.check();
    const fonts=await page.locator('.msw-config-manager').evaluate(e=>[...e.querySelectorAll('legend label,#config-categories label,nav button,footer button')].map(x=>getComputedStyle(x).fontSize));
    expect(new Set(fonts).size).toBe(1);
    await expect(page.locator('[data-config-mode]')).toHaveCount(2);
    await expect(page.locator('[data-config-mode="restore"]')).toHaveCount(0);
    await upload(page,file({browser:{'moy.asr.editor.settings.v1':{mediaSeekStepMs:2750,autoSaveProject:false}}}));
    await expect(page.locator('#config-file-row #config-policy')).toBeVisible();
    await expect(page.locator('#config-policy-row')).toContainText('导入机制');
    await expect(all).toBeChecked(); // Unavailable categories do not affect the header.
    await expect(page.locator('[data-config-category]:enabled')).toHaveCount(1);
    await page.locator('#editor-settings-close').click();await open(page);
    await expect(page.locator('#config-filename')).toHaveText('Test.mswconfig');
    await page.locator('#config-policy').selectOption('replace');await page.locator('#config-preview').click();
    await expect(page.locator('#config-preview-result')).toContainText('界面与编辑操作');await expect(page.locator('#config-apply')).toBeEnabled();
    expect(await page.evaluate(()=>EDITOR_SETTINGS.mediaSeekStepMs)).toBe(1000);
    await page.locator('#config-apply').click();await expect(page.locator('#config-message')).toContainText('配置已保存');
    expect(await page.evaluate(()=>JSON.stringify(DATA))).toBe(before);
    expect(await page.evaluate(()=>EDITOR_SETTINGS.mediaSeekStepMs)).toBe(1000);
    expect(await page.evaluate(()=>JSON.parse(MSWConfig.storage.getItem('moy.asr.editor.settings.v1')).mediaSeekStepMs)).toBe(2750);
    // A later edit in this still-open page must not undo imported defaults.
    await page.evaluate(async()=>{updateEditorSettings({cueListShowTime:false});await MSWConfig.flush();});
    expect(await page.evaluate(()=>JSON.parse(MSWConfig.storage.getItem('moy.asr.editor.settings.v1')).mediaSeekStepMs)).toBe(2750);
    // Automatic pre-import backup remains internal; the UI only offers import/export.
    await page.evaluate(async()=>{
      const {snapshots}=await MSWConfig.request({action:'snapshots'});
      const payload={id:snapshots[0].id,categories:['interface'],policy:'replace'};
      const preview=await MSWConfig.request({...payload,action:'restore-preview'});
      await MSWConfig.request({...payload,action:'restore',revision:preview.revision,token:preview.token});
    });
    await page.locator('#editor-settings-close').click();await page.reload();await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
    expect(await page.evaluate(()=>EDITOR_SETTINGS.mediaSeekStepMs)).toBe(1000);
    await open(page);const downloadPromise=page.waitForEvent('download');await page.locator('#config-export').click();const downloaded=await downloadPromise;
    const exported=JSON.parse(readFileSync(await downloaded.path(),'utf8'));expect(exported.format).toBe('msw-config');expect(exported.revision).toBeUndefined();
    expect(exported.categories).not.toContain('assStyles');expect(exported.categories).not.toContain('onboarding');
    await page.screenshot({path:'output/config-manager-dark.png'});
    expect(errors).toEqual([]);
  }finally{await server.stop();cleanupTempDir(root);}
});

test('stale previews and invalid files cannot change settings',async({page})=>{
  const root=makeTempDir('config-conflict'),server=await startBlankServer(await findFreePort(),root);
  try{
    await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);await open(page);
    await upload(page,file({browser:{'mawe.language':'en'}}));await page.locator('#config-policy').selectOption('replace');await page.locator('#config-preview').click();
    await expect(page.locator('#config-apply')).toBeEnabled();
    await page.evaluate(async()=>{MSWConfig.storage.setItem('msw.assets.columns','2');await MSWConfig.flush();});
    await page.locator('#config-apply').click();await expect(page.locator('#config-message')).toContainText('其他窗口');
    await expect(page.locator('#config-apply')).toBeDisabled();
    await page.locator('#config-file').setInputFiles({name:'Bad.mswconfig',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file({browser:{'moy.asr.editor.settings.v1':{password:'test-only'}}})))});
    await expect(page.locator('#config-message')).toContainText('凭据');await expect(page.locator('#config-apply')).toBeDisabled();
  }finally{await server.stop();cleanupTempDir(root);}
});

test('portable editor transfers browser preferences and named legacy workspace',async({page})=>{
  await page.goto(pathToFileURL(resolve('blank-editor.html')).href);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);await open(page);
  await expect(page.locator('#config-message')).toContainText('便携 HTML');
  await expect(page.locator('[data-config-category]')).toHaveCount(4);
  await page.locator('[data-config-mode="import"]').click();await expect(page.locator('#config-all')).toBeDisabled();
  // An old file may contain retired categories; only selected current settings
  // are imported, and the onboarding flag remains local.
  const onboarding=await page.evaluate(()=>MSWConfig.storage.getItem('moy.asr.editor.onboarding.v1'));
  await upload(page,{format:'msw-config',version:1,kind:'preferences',categories:['interface','onboarding'],sections:{browser:{'mawe.language':'zh','moy.asr.editor.onboarding.v1':'skipped'}}});
  await expect(page.locator('#config-message')).toContainText('已略过');
  await page.locator('#config-policy').selectOption('replace');await page.locator('#config-preview').click();await page.locator('#config-apply').click();
  expect(await page.evaluate(()=>MSWConfig.storage.getItem('moy.asr.editor.onboarding.v1'))).toBe(onboarding);
  const ws=await page.evaluate(()=>waveformEditor.getLayoutData());
  await upload(page,ws,'Sample.workspace.json');await page.locator('#config-policy').selectOption('replace');await page.locator('#config-preview').click();await expect(page.locator('#config-apply')).toBeEnabled();await page.locator('#config-apply').click();
  expect(await page.evaluate(()=>MSWConfig.snapshot.sections.server.saved_workspaces.Sample.schema)).toBe('moy.asr.editor.workspace.v1');
  await upload(page,file({browser:{'moy.asr.editor.settings.v1':{mediaSeekStepMs:3250,theme:'light'}}}));await page.locator('#config-policy').selectOption('replace');await page.locator('#config-preview').click();await page.locator('#config-apply').click();
  await expect(page.locator('#config-message')).toContainText('配置已保存');await page.locator('#editor-settings-close').click();await page.reload();await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
  expect(await page.evaluate(()=>EDITOR_SETTINGS.mediaSeekStepMs)).toBe(3250);await open(page);await page.setViewportSize({width:560,height:760});
  const size=await page.locator('.msw-config-manager').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));expect(size.scroll).toBeLessThanOrEqual(size.width);
  await page.screenshot({path:'output/config-manager-light-small.png'});
});

test('launcher entry uses common manager and native export bridge',async({page})=>{
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);await page.waitForFunction(()=>window.MSWLauncher?.config?.providers?.length);
  // The real bridge contract is covered in Python; emulate the native dialogs here.
  await page.evaluate(()=>{
    window.configCalls=[];
    MSWLauncher.backend='real';
    const original=MSWLauncher.callBackend;
    MSWLauncher.callBackend=async(method,payload)=>{configCalls.push(method);if(method==='save_user_config_file')return {ok:true};return original(method,payload);};
    const categories=Object.entries({interface:'界面与编辑操作',waveform:'波形与工作区',launcher:'启动器',subtitlePresets:'字幕样式预设',preview:'预览偏好',processing:'翻译与文本处理',tts:'配音设置',recovery:'工程备份设置',assStyles:'ASS 样式库',onboarding:'首次使用提示'}).map(([id,name])=>({id,name,paths:[],retired:['assStyles','onboarding'].includes(id)}));
    MSWConfig.connect({registry:{},sections:{},transfer:categories},async p=>p.action==='catalog'?{categories}:{});
    MSWLauncher.openSettings();
  });
  await page.locator('#launcher-config-manager-open').click();await expect(page.locator('.msw-config-manager')).toBeVisible();await page.locator('#config-export').click();await expect(page.locator('#config-message')).toContainText('已导出');
  await expect(page.locator('dialog.msw-config-manager')).toHaveCount(0);
  await expect(page.locator('[data-config-category]')).toHaveCount(8);
  await expect(page.locator('#launcher-config-manager-open')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#settingsAppearancePanel')).toBeHidden();
  expect(await page.evaluate(()=>configCalls)).toContain('save_user_config_file');
  await page.locator('[data-config-mode="import"]').click();
  await page.locator('#settingsRailAppearance').click();await expect(page.locator('.msw-config-manager')).toBeHidden();
  await page.locator('#launcher-config-manager-open').click();await expect(page.locator('#config-choose')).toBeVisible();
  await page.locator('[data-config-mode="export"]').click();
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:'output/config-manager-launcher.png'});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.setViewportSize({width:960,height:740});
  await expect.poll(()=>page.locator('#settingsRail').evaluate(e=>e.getBoundingClientRect().left)).toBeGreaterThanOrEqual(960);
  await expect(page.locator('#config-export')).toBeInViewport();
  const size=await page.locator('.msw-config-manager').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));expect(size.scroll).toBeLessThanOrEqual(size.width);
  await page.screenshot({path:'output/config-manager-launcher-light.png'});
});
