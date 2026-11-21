import {test,expect} from '@playwright/test';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {disableOnboarding,findFreePort,makeTempDir,startBlankServer} from './helpers.mjs';

const qwen='qwen3-asr-local',whisper='whisper-large-v3-local';
let server;
test.afterEach(async()=>{await server?.stop();server=null;});
async function editor(page){
  const root=makeTempDir('local-model-settings');
  process.env.MAW_ENV_FILE=join(root,'synthetic.env');process.env.MSW_APP_DATA_ROOT=join(root,'app-data');
  server=await startBlankServer(await findFreePort(),join(root,'settings'));
  await disableOnboarding(page);
  const fonts=page.waitForResponse(r=>r.url().endsWith('/api/msw/subtitle-fonts'),{timeout:30000});
  await page.goto(server.url);await fonts;
  await expect(page.locator('.waveform-row').first()).toBeVisible();
  await page.evaluate(()=>MSWE.resolve('asr').open());
  await expect(page.locator('#msw-asr-providerId')).toBeEnabled();
}
async function save(page,id,path){
  await page.locator('#msw-asr-localModelPath').fill(path);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/msw/asr-settings')&&r.request().method()==='POST',{timeout:20000});
  await page.locator('#msw-asr-save-settings').click();
  const saved=await (await response).json();expect(saved.ok,JSON.stringify(saved)).toBe(true);
  await expect.poll(()=>page.evaluate(async id=>(await MSWE.resolve('media').request('asr-settings')).localModelPaths[id],id)).toBe(path);
}

test('editor remembers separate directories, restores after reopening, and keeps a cleared override empty',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await editor(page);
  await page.locator('#msw-asr-providerId').selectOption('local');
  await page.locator('#msw-asr-modelId').selectOption(qwen);
  await save(page,qwen,'C:/Models/Qwen');
  await expect(page.locator('#msw-asr-localModelPath')).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#msw-asr-local-status')).toContainText('目录不存在');
  await page.locator('#msw-asr-modelId').selectOption(whisper);
  await expect(page.locator('#msw-asr-localModelPath')).toHaveValue('');
  await save(page,whisper,'C:/Models/Whisper');
  await page.locator('#msw-asr-modelId').selectOption(qwen);
  await expect(page.locator('#msw-asr-localModelPath')).toHaveValue('C:/Models/Qwen');
  await page.reload();await page.evaluate(()=>MSWE.resolve('asr').open());
  await expect(page.locator('#msw-asr-localModelPath')).toHaveValue('C:/Models/Whisper');
  await page.locator('#msw-asr-modelId').selectOption(qwen);
  await save(page,qwen,'');
  await page.reload();await page.evaluate(()=>MSWE.resolve('asr').open());
  await expect(page.locator('#msw-asr-localModelPath')).toHaveValue('');
  await expect(page.locator('#msw-asr-device option[value="mps"]')).toHaveJSProperty('disabled',true);
  const exported=await page.evaluate(()=>MSWConfig.request({action:'export',categories:['launcher','asr']}));
  expect(JSON.stringify(exported)).not.toContain('C:/Models');
  expect(errors).toEqual([]);
});

test('editor shows MPS only for Qwen when the host advertises macOS support',async({page})=>{
  await page.route('**/api/msw/asr-settings',async route=>{
    const response=await route.fetch(),body=await response.json();
    for(const provider of body.providers||[])for(const model of provider.models||[]){
      if(provider.kind==='local')model.devices=['auto','cpu','cuda',...(model.engine==='qwen-asr'?['mps']:[])];
    }
    await route.fulfill({response,json:body});
  });
  await editor(page);await page.locator('#msw-asr-providerId').selectOption('local');
  await page.locator('#msw-asr-modelId').selectOption(qwen);
  await expect(page.locator('#msw-asr-device option[value="mps"]')).toHaveJSProperty('disabled',false);
  await page.locator('#msw-asr-device').selectOption('mps');
  await page.locator('#msw-asr-modelId').selectOption(whisper);
  await expect(page.locator('#msw-asr-device')).toHaveValue('auto');
  await expect(page.locator('#msw-asr-device option[value="mps"]')).toHaveJSProperty('disabled',true);
});

test('launcher persists changes through its bridge and never replaces a cleared directory with a detected cache',async({page})=>{
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
    MSWLauncher.bridgeOverride=async(method,payload,next)=>{
      if(method==='choose_folder'&&payload.kind==='model'){
        return new Promise(resolve=>{window.completeModelPicker=resolve;});
      }
      if(method==='save_prefs'&&payload.localModelPaths){
        const paths=JSON.parse(localStorage.getItem('test-model-paths')||'{}');
        localStorage.setItem('test-model-paths',JSON.stringify({...paths,...payload.localModelPaths}));
      }
      const result=await next(method,payload);
      if(method==='get_config'){
        result.localModelPaths=JSON.parse(localStorage.getItem('test-model-paths')||'{}');
        for(const provider of result.providers)for(const model of provider.models){
          model.devices=['auto','cpu','cuda',...(model.id==='qwen3-asr-local'?['mps']:[])];
        }
      }
      if(method==='get_local_models')for(const model of result.models){
        model.localStatus={...model.localStatus,path:'C:/Automatic/Cache',status:'installed',installed:true};
      }
      return result;
    };
  },{once:true}));
  async function open(){
    await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
    await page.waitForFunction(()=>MSWLauncher.config?.providers?.length&&document.querySelector('#prefabRail input'));
    await page.evaluate(()=>MSWNavigation.show('prefab'));
    await page.locator('#prefabRail input[data-module-id="asr"]').check();
    if(await page.locator('#recognitionCard').evaluate(el=>el.classList.contains('collapsed')))await page.locator('#recognitionCard .module-collapse').click();
    await page.locator('#provider').selectOption('local');
  }
  await open();await page.locator('#model').selectOption(qwen);
  await page.locator('#localModelPath').fill('C:/Custom/Qwen');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('test-model-paths')||'{}')['qwen3-asr-local'])).toBe('C:/Custom/Qwen');
  if(await page.locator('#advancedCard').evaluate(el=>el.classList.contains('collapsed')))await page.locator('#advancedToggle').click();
  await page.locator('#localDevice').selectOption('mps');
  await page.locator('#model').selectOption('funasr-local');
  await expect(page.locator('#localDevice')).toHaveValue('auto');
  await expect(page.locator('#localModelPath')).toHaveValue('');
  await page.locator('#model').selectOption(qwen);
  await expect(page.locator('#localModelPath')).toHaveValue('C:/Custom/Qwen');
  await open();await page.locator('#model').selectOption(qwen);
  await expect(page.locator('#localModelPath')).toHaveValue('C:/Custom/Qwen');
  const pick=page.locator('#pickLocalModelPath');
  async function completePicker(result){
    await page.evaluate(result=>{
      window.completeModelPicker(result);
      window.completeModelPicker=null;
    },result);
  }
  await pick.click();
  await page.waitForFunction(()=>!!window.completeModelPicker);
  await completePicker({ok:false,code:'cancelled'});
  await expect(page.locator('#localModelPath')).toHaveValue('C:/Custom/Qwen');
  await pick.click();
  await page.waitForFunction(()=>!!window.completeModelPicker);
  await page.locator('#model').selectOption('funasr-local');
  await completePicker({ok:true,path:'C:/Custom/Delayed'});
  await expect(page.locator('#localModelPath')).toHaveValue('');
  await page.locator('#model').selectOption(qwen);
  await expect(page.locator('#localModelPath')).toHaveValue('C:/Custom/Qwen');
  await pick.click();
  await page.waitForFunction(()=>!!window.completeModelPicker);
  await completePicker({ok:true,path:'C:/Custom/Accepted'});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('test-model-paths')||'{}')['qwen3-asr-local'])).toBe('C:/Custom/Accepted');
  await page.locator('#clearLocalModelPath').click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('test-model-paths')||'{}')['qwen3-asr-local'])).toBe('');
  await expect(page.locator('#localModelPath')).toHaveValue('');
  await expect(page.locator('#localModelPath')).toHaveAttribute('placeholder','C:/Automatic/Cache');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-model-paths')||'{}')['funasr-local'])).toBeUndefined();
});
