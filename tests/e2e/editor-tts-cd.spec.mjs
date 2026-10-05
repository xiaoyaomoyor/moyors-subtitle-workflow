import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startTtsServer,openTtsEnvironment,closeTtsEnvironment,openMenubarMenu} from './helpers.mjs';
let server,mock,dir,bundle,calls,errors,audio;
test.beforeEach(async({page})=>{
  server=null;mock=null;
  dir=makeTempDir('tts-cd');bundle=join(dir,'bundle');calls=[];errors=[];
  for(const p of ['runtime','GPT_weights','SoVITS_weights_v2Pro'])mkdirSync(join(bundle,p),{recursive:true});
  writeFileSync(join(bundle,'runtime','python.exe'),'fixture');writeFileSync(join(bundle,'api_v2.py'),'# synthetic API');
  writeFileSync(join(bundle,'GPT_weights','test.ckpt'),'PKgpt');writeFileSync(join(bundle,'SoVITS_weights_v2Pro','test.pth'),'05sovits');
  audio=readFileSync(generateWav(join(dir,'result.wav'),.5));generateWav(join(dir,'reference.wav'),4);
  const mp3=join(dir,'result.mp3');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',join(dir,'result.wav'),mp3]);
  mock=createServer(async(req,res)=>{
    if(req.url==='/openapi.json'){const body={paths:Object.fromEntries(['/tts','/set_gpt_weights','/set_sovits_weights'].map(k=>[k,{}])),components:{schemas:{TTS_Request:{properties:Object.fromEntries(['text','text_lang','ref_audio_path','prompt_lang'].map(k=>[k,{}]))}}}};res.end(JSON.stringify(body));return;}
    if(req.method==='GET'){calls.push(req.url.split('?')[0]);res.end('{"message":"success"}');return;}
    const chunks=[];for await(const c of req)chunks.push(c);calls.push(JSON.parse(Buffer.concat(chunks)));res.writeHead(200,{'Content-Type':'audio/wav'});res.end(audio);
  });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'appdata');process.env.MSW_TEST_LOCAL_TTS_INSTALL=bundle;process.env.MSW_TEST_EDGE_AUDIO=mp3;
  const project=join(dir,'test.mosp');writeFileSync(project,JSON.stringify({media:'',msw:{schema:'msw.editor.v1',project_id:randomUUID()},segments:[{id:'main',start:0,end:2000,text:'你好，测试配音。'}],waveform:generateWaveformPayload(6000)}));
  server=await startTtsServer(project,generateWav(join(dir,'media.wav'),6),await findFreePort(),`http://127.0.0.1:${mock.address().port}`);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await disableOnboarding(page);await page.goto(server.url);await expect(page.locator('#editor-loading')).not.toBeVisible();await page.evaluate(()=>selectOnly(0));
});
test.afterEach(async()=>{await server?.stop();if(mock)await new Promise(r=>mock.close(r));delete process.env.MSW_TEST_EDGE_AUDIO;delete process.env.MSW_TEST_LOCAL_TTS_INSTALL;expect(errors).toEqual([]);});
async function api(page,route,body){return page.evaluate(async({route,body})=>MSWE.resolve('audio-timeline').request(route,body),{route,body});}
async function gpt(page){
  await openTtsEnvironment(page,'gpt-sovits');await page.locator('#tts-local-gpt-sovits-directory').fill(bundle);await page.locator('#tts-gpt-url').fill(`http://127.0.0.1:${mock.address().port}`);
  await page.locator('#tts-environment-save').click();await expect(page.locator('#tts-environment-message')).toContainText('已保存');
  await page.locator('#tts-gpt-scan').click();await expect(page.locator('#tts-gpt-status')).toContainText('2');
  await page.locator('#tts-gpt-upload-file').setInputFiles(join(dir,'reference.wav'));await expect(page.locator('#tts-gpt-status')).toContainText('参考已保存');
  await page.locator('#tts-gpt-check').click();await expect(page.locator('#tts-gpt-status')).toContainText('已连接');
  await closeTtsEnvironment(page);await page.locator('#tts-engine').selectOption('gpt-sovits');
  for(const key of ['gpt_model','sovits_model'])await page.locator('#tts-gpt-'+key).selectOption({index:1});
  await page.locator('#tts-gpt-prompt_lang').selectOption('ja');await page.locator('#tts-gpt-language_type').selectOption('zh');await page.locator('#tts-gpt-prompt_text').fill('こんにちは。');
  await page.locator('#tts-save-settings').click();await expect(page.locator('#tts-message')).toContainText('已保存');
}
async function edge(page){await openTtsEnvironment(page,'edge');await page.locator('#tts-edge-refresh').click();await expect(page.locator('#tts-edge-status')).toContainText('已更新');await closeTtsEnvironment(page);await page.locator('#tts-engine').selectOption('edge');}
async function count(page){return page.evaluate(()=>DATA.msw.assets?.length||0);}
for(const engine of ['gpt','edge'])test(`${engine} creates assets, preserves recipe for regeneration, inserts and replaces clips`,async({page},info)=>{
  if(engine==='gpt')await gpt(page);else await edge(page);
  await expect(page.locator('#tts-qwen-fields')).not.toBeVisible();await expect(page.locator('#tts-start')).toBeEnabled();
  await page.screenshot({path:info.outputPath(engine+'-panel.png')});await page.locator('#tts-start').click();await expect.poll(()=>count(page)).toBe(1);
  const original=await page.evaluate(()=>DATA.msw.assets[0]);expect(original.generation.provider).toBe(engine==='gpt'?'gpt-sovits':'edge');
  if(engine==='gpt'){expect(calls[2].prompt_lang).toBe('ja');expect(calls[2].text_lang).toBe('zh');}
  await page.locator('#tts-close').click();await page.locator(`[data-asset-id="${original.id}"] [data-asset-action="regenerate"]`).click();
  await expect(page.locator('#asset-import-message')).toContainText('新增音频素材 1');expect(await count(page)).toBe(2);
  const regenerated=await page.evaluate(id=>DATA.msw.assets.find(a=>a.id!==id),original.id);expect(regenerated.generation).toEqual(original.generation);
  const download=page.waitForEvent('download');await page.locator(`[data-asset-id="${original.id}"]`).getByRole('button',{name:'下载 WAV',exact:true}).click();
  expect(readFileSync(await(await download).path()).subarray(0,4).toString()).toBe('RIFF');
  await page.locator(`[data-asset-id="${original.id}"]`).getByRole('button',{name:'放入时间轴',exact:true}).click();
  await page.locator('.msw-audio-clip').first().click();await openMenubarMenu(page,'媒体');await page.locator('#audio-actions-open').click();
  await page.locator('#audio-actions-regenerate').click();await expect(page.locator('#audio-actions-message')).toContainText('已替换 1');
  expect(await page.evaluate(()=>DATA.msw.audio_clips[0].asset_id)).not.toBe(original.id);
});
test('Edge filters voices, survives catalog failure and cancels an editor draft',async({page})=>{
  await edge(page);await page.locator('#tts-edge-language').selectOption('ja-JP');await page.locator('#tts-edge-voice').selectOption('ja-JP-NanamiNeural');
  await page.locator('#tts-save-settings').click();await expect(page.locator('#tts-message')).toContainText('已保存');
  await page.route('**/api/msw/edge-tts',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'}));
  await page.locator('#tts-edge-refresh-panel').click();await expect(page.locator('#tts-edge-call-status')).toContainText('offline');await expect(page.locator('#tts-edge-voice')).toHaveValue('ja-JP-NanamiNeural');
  await page.locator('#tts-target').selectOption('editor_text');await page.locator('#cue-panel-tts-text').fill('WAIT_CANCEL');await page.locator('#tts-start').click();
  await page.locator('#tts-jobs').getByRole('button',{name:'取消任务'}).click();await expect(page.locator('#tts-jobs')).toContainText('已取消');expect(await count(page)).toBe(0);
});

test('Edge first entry loads languages automatically and shows immediate verification feedback',async({page})=>{
  let calls=0;
  await page.route('**/api/msw/edge-tts',async route=>{calls++;await new Promise(r=>setTimeout(r,600));await route.continue();});
  await openTtsEnvironment(page,'edge');
  await expect(page.locator('#tts-edge-status')).toContainText('正在验证');
  await expect(page.locator('#tts-edge-refresh')).toBeDisabled();
  await expect(page.locator('#tts-edge-status')).toContainText('已更新');
  await closeTtsEnvironment(page);await page.locator('#tts-engine').selectOption('edge');
  expect(await page.locator('#tts-edge-language option').count()).toBe(4);
  await page.locator('#tts-edge-language').selectOption('en-US');await page.locator('#tts-edge-voice').selectOption('en-US-JennyNeural');
  expect(calls).toBe(1);
});
test('GPT presets retain independent languages; environment and compact controls fit',async({page},info)=>{
  await gpt(page);await openTtsEnvironment(page,'gpt-sovits');await page.locator('#tts-gpt-preset_name').locator('..').locator('..').evaluate(e=>e.open=true);
  await page.locator('#tts-gpt-preset_name').fill('日跨中');await page.locator('#tts-gpt-preset-save').click();await expect(page.locator('#tts-gpt-status')).toContainText('预设已保存');
  await closeTtsEnvironment(page);await page.locator('#tts-gpt-language_type').selectOption('en');await page.locator('#tts-gpt-preset').selectOption('日跨中');
  await expect(page.locator('#tts-gpt-language_type')).toHaveValue('zh');await expect(page.locator('#tts-gpt-prompt_lang')).toHaveValue('ja');
  const a=await page.locator('#tts-gpt-gpt_model').boundingBox(),b=await page.locator('#tts-gpt-sovits_model').boundingBox();expect(Math.abs(a.y-b.y)).toBeLessThan(2);expect(b.x).toBeGreaterThan(a.x);
  await page.screenshot({path:info.outputPath('gpt-preset.png')});
});
