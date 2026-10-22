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
    await page.locator('[data-menubar-item="window"] .menubar-tab').click();await page.locator('#config-manager-open').click();
    await expect(page.locator('.msw-config-manager')).toBeVisible();
    await upload(page,file({browser:{'moy.asr.editor.settings.v1':{mediaSeekStepMs:2750,autoSaveProject:false}}}));
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
    await page.locator('[data-config-mode="restore"]').click();
    await page.locator('#config-snapshots').selectOption({index:1});
    await page.locator('#config-all').click();
    // all were selected, so clear then select just interface.
    await page.locator('[data-config-category][value="interface"]').check();
    await page.locator('#config-policy').selectOption('replace');await page.locator('#config-preview').click();await expect(page.locator('#config-apply')).toBeEnabled();
    await page.locator('#config-apply').click();await expect(page.locator('#config-message')).toContainText('配置已保存');
    await page.locator('#config-close').click();await page.reload();await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
    expect(await page.evaluate(()=>EDITOR_SETTINGS.mediaSeekStepMs)).toBe(1000);
    await open(page);const downloadPromise=page.waitForEvent('download');await page.locator('#config-export').click();const downloaded=await downloadPromise;
    const exported=JSON.parse(readFileSync(await downloaded.path(),'utf8'));expect(exported.format).toBe('msw-config');expect(exported.revision).toBeUndefined();
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
  const ws=await page.evaluate(()=>waveformEditor.getLayoutData());
  await upload(page,ws,'Sample.workspace.json');await page.locator('#config-policy').selectOption('replace');await page.locator('#config-preview').click();await expect(page.locator('#config-apply')).toBeEnabled();await page.locator('#config-apply').click();
  expect(await page.evaluate(()=>MSWConfig.snapshot.sections.server.saved_workspaces.Sample.schema)).toBe('moy.asr.editor.workspace.v1');
  await upload(page,file({browser:{'moy.asr.editor.settings.v1':{mediaSeekStepMs:3250,theme:'light'}}}));await page.locator('#config-policy').selectOption('replace');await page.locator('#config-preview').click();await page.locator('#config-apply').click();
  await expect(page.locator('#config-message')).toContainText('配置已保存');await page.locator('#config-close').click();await page.reload();await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
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
    const categories=[{id:'interface',name:'界面与编辑操作',paths:[]}];
    MSWConfig.connect({registry:{},sections:{},transfer:categories},async p=>p.action==='catalog'?{categories}:{});
    MSWLauncher.openSettings();
  });
  await page.locator('#launcher-config-manager-open').click();await expect(page.locator('.msw-config-manager')).toBeVisible();await page.locator('#config-export').click();await expect(page.locator('#config-message')).toContainText('已导出');
  expect(await page.evaluate(()=>configCalls)).toContain('save_user_config_file');
  await page.screenshot({path:'output/config-manager-launcher.png'});
});
