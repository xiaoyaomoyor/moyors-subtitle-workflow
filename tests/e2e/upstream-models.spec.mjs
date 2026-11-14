import {test, expect} from '@playwright/test';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {disableOnboarding, findFreePort, makeTempDir, startBlankServer} from './helpers.mjs';
import {setLauncherLanguage} from './launcher-language.mjs';

const model='qwen-audio-3.1-asr-flash-filetrans', oldModel='qwen-audio-3.0-asr-flash-filetrans';
test('launcher gates dialect, restores preference and shows regional token pricing', async({page},info)=>{
  let saved=false;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('dialectPrefs',value=>{if(typeof value==='boolean')saved=value;return saved;});
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
    MSWLauncher.bridgeOverride=async(method,payload,next)=>{
      if(method==='get_config')return {...await next(method,payload),qwenKeepDialect:await window.dialectPrefs()};
      if(method==='save_prefs'&&typeof payload.qwenKeepDialect==='boolean'){await window.dialectPrefs(payload.qwenKeepDialect);return {ok:true};}
      return next(method,payload);
    };
  },{once:true}));
  async function open(){
    await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
    await page.waitForFunction(()=>MSWLauncher.config?.providers?.length&&document.querySelector('#prefabRail input'));
    await page.evaluate(()=>{MSWNavigation.show('prefab');MSWModules.setEnabled('asr',true);MSWWorkflow.setCollapsed('asr',false);});
    await page.locator('#advancedToggle').click();
  }
  await open();
  await expect(page.locator('#model')).toHaveValue(oldModel);
  await expect(page.locator('#qwenAudioKeepDialect')).toBeHidden();
  await expect(page.locator('#modelBillingNote')).toBeHidden();
  await page.locator('#model').selectOption(model);
  await expect(page.locator('#qwenAudioKeepDialect')).toBeVisible();
  await expect(page.locator('#modelBillingNote')).toContainText('¥0.8');
  await page.locator('#qwenAudioKeepDialect').check();
  await expect.poll(()=>saved).toBe(true);
  expect((await page.evaluate(()=>MSWLauncher.getTranscriptionPayload())).qwenKeepDialect).toBe(true);
  await page.evaluate(()=>MSWLauncher.openSettings('asrSettingsSection'));
  await page.locator('#region').selectOption('singapore');
  expect((await page.evaluate(()=>MSWLauncher.getTranscriptionPayload())).region).toBe('beijing');
  await expect(page.locator('#modelBillingNote')).toContainText('¥0.8');
  await page.locator('#workspaceId').fill('test-workspace');
  await page.locator('#saveAsrConnection').click();
  await expect.poll(()=>page.evaluate(()=>MSWLauncher.getTranscriptionPayload().region)).toBe('singapore');
  await page.evaluate(()=>MSWNavigation.show('prefab'));
  await expect(page.locator('#modelBillingNote')).toContainText('¥1.094');
  await page.locator('#qwenAudioKeepDialectField').screenshot({path:info.outputPath('launcher-dialect.png')});
  await setLauncherLanguage(page,'en');
  await expect(page.locator('#qwenAudioKeepDialectField')).toContainText('Preserve dialect expressions');
  await expect(page.locator('#qwenAudioKeepDialect')).toBeChecked();
  await page.locator('#model').selectOption(oldModel);
  await expect(page.locator('#qwenAudioKeepDialect')).toBeHidden();
  await expect(page.locator('#modelBillingNote')).toBeHidden();
  await open();await page.locator('#model').selectOption(model);
  await expect(page.locator('#qwenAudioKeepDialect')).toBeChecked();
  expect(errors).toEqual([]);
});

test('editor uses production catalog and persists dialect with independent saved connection',async({page},info)=>{
  const root=makeTempDir('upstream-models');
  process.env.MAW_ENV_FILE=join(root,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(root,'app-data');
  writeFileSync(process.env.MAW_ENV_FILE,'DASHSCOPE_API_KEY=synthetic-only\nDASHSCOPE_REGION=singapore\nDASHSCOPE_WORKSPACE_ID=test-workspace\n');
  const server=await startBlankServer(await findFreePort(),join(root,'settings'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await disableOnboarding(page);
    await page.goto(server.url);
    async function open(){
      await page.waitForFunction(()=>window.MSWE?.resolve('asr'));
      await page.evaluate(()=>MSWE.resolve('asr').open('whole'));
      await expect(page.locator('#msw-asr-modelId option')).not.toHaveCount(0);
    }
    await open();
    await expect(page.locator('#msw-asr-modelId')).toHaveValue(oldModel);
    await expect(page.locator('#msw-asr-qwenKeepDialect')).toBeHidden();
    await page.locator('#msw-asr-modelId').selectOption(model);
    await expect(page.locator('#msw-asr-billing')).toContainText('¥1.094');
    await page.locator('#msw-asr-qwenKeepDialect').check();
    await page.locator('#msw-asr-panel').screenshot({path:info.outputPath('editor-asr.png')});
    const response=page.waitForResponse(r=>r.url().endsWith('/asr-settings')&&r.request().method()==='POST');
    await page.locator('#msw-asr-save-settings').click();expect((await response).ok()).toBe(true);
    await page.reload();await open();
    await expect(page.locator('#msw-asr-modelId')).toHaveValue(model);
    await expect(page.locator('#msw-asr-qwenKeepDialect')).toBeChecked();
    await page.locator('#msw-asr-modelId').selectOption('fun-asr');
    await expect(page.locator('#msw-asr-qwenKeepDialect')).toBeHidden();
    await expect(page.locator('#msw-asr-billing')).toBeHidden();
    expect(errors).toEqual([]);
  } finally {await page.close({runBeforeUnload:false});await server.stop();}
});
