import {test,expect} from '@playwright/test';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startTtsServer,openTtsEnvironment,closeTtsEnvironment,openMenubarMenu} from './helpers.mjs';
let server,mock,dir,calls,errors,audio,mp3;
test.beforeEach(async({page})=>{
  dir=makeTempDir('tts-cloud');calls=[];errors=[];
  audio=readFileSync(generateWav(join(dir,'result.wav'),.5));generateWav(join(dir,'reference.wav'),4);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',join(dir,'result.wav'),join(dir,'result.mp3')]);mp3=readFileSync(join(dir,'result.mp3'));
  mock=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);
    const body=req.headers['content-type']?.includes('json')?JSON.parse(raw):null;
    calls.push({path:req.url,body});res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/get_voice')return res.end(JSON.stringify({base_resp:{status_code:0},system_voice:[{voice_id:'zh-test',voice_name:'中文测试'}],voice_cloning:[{voice_id:'account-test',voice_name:'账号测试'}]}));
    if(req.url.startsWith('/v1/audio/voices')&&req.method==='GET')return res.end(JSON.stringify({data:[{id:'moss-test',name:'测试音色'}],has_more:false}));
    if(req.url==='/v1/audio/voices')return res.end(JSON.stringify({id:'created-test',name:'参考测试'}));
    if(body?.text==='WAIT_CANCEL'||body?.input==='WAIT_CANCEL')await new Promise(r=>setTimeout(r,1500));
    if(req.url==='/v1/t2a_v2')return res.end(JSON.stringify({base_resp:{status_code:0},data:{status:2,audio:mp3.toString('hex')}}));
    if(req.url==='/v1/audio/speech'){res.setHeader('Content-Type','audio/wav');return res.end(audio);}
    res.writeHead(404);res.end('{}');
  });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'appdata');process.env.MSW_TEST_CLOUD_TTS='1';
  const project=join(dir,'test.mosp');writeFileSync(project,JSON.stringify({media:'',msw:{schema:'msw.editor.v1',project_id:randomUUID()},segments:[{id:'main',start:0,end:2000,text:'你好，测试配音。'}],waveform:generateWaveformPayload(6000)}));
  server=await startTtsServer(project,generateWav(join(dir,'media.wav'),6),await findFreePort(),`http://127.0.0.1:${mock.address().port}`);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await disableOnboarding(page);await page.goto(server.url);await expect(page.locator('#editor-loading')).not.toBeVisible();await page.evaluate(()=>selectOnly(0));
});
test.afterEach(async()=>{await server?.stop();await new Promise(r=>mock?.close(r));delete process.env.MSW_TEST_CLOUD_TTS;expect(errors).toEqual([]);});
async function setup(page,engine){
  await openTtsEnvironment(page,engine);await page.locator(`#tts-${engine}-key`).fill('synthetic-secret');
  await page.locator('#tts-environment-save').click();await expect(page.locator('#tts-environment-message')).toContainText('已保存');
  await expect(page.locator(`#tts-${engine}-key`)).toHaveValue('');
  await expect(page.locator(`#tts-${engine}-key`)).toHaveAttribute('placeholder','已持有本地密钥');
  await closeTtsEnvironment(page);await page.locator('#tts-engine').selectOption(engine);
  await page.locator(`#tts-${engine}-refresh`).click();await expect(page.locator(`#tts-${engine}-status`)).toContainText('已更新');
  await page.locator(`#tts-${engine}-catalog`).selectOption(engine==='minimax'?'zh-test':'moss-test');
  await page.locator('#tts-save-settings').click();await expect(page.locator('#tts-message')).toContainText('已保存');
}
async function count(page){return page.evaluate(()=>DATA.msw.assets?.length||0);}
for(const engine of ['minimax','mossland'])test(`${engine} complete audio, library regeneration and clip replacement`,async({page},info)=>{
  await setup(page,engine);await expect(page.locator('#tts-start')).toBeEnabled();
  await page.screenshot({path:info.outputPath(engine+'-panel.png')});
  await page.locator('#tts-start').click();await expect.poll(()=>count(page)).toBe(1);
  const original=await page.evaluate(()=>DATA.msw.assets[0]);expect(original.generation.provider).toBe(engine);
  expect(JSON.stringify(original)).not.toContain('synthetic-secret');
  await page.locator('#tts-close').click();await page.locator(`[data-asset-id="${original.id}"] [data-asset-action="regenerate"]`).click();
  await expect(page.locator('#asset-import-message')).toContainText('新增音频素材 1');expect(await count(page)).toBe(2);
  const regenerated=await page.evaluate(id=>DATA.msw.assets.find(a=>a.id!==id),original.id);expect(regenerated.generation).toEqual(original.generation);
  await page.locator(`[data-asset-id="${original.id}"]`).getByRole('button',{name:'放入时间轴',exact:true}).click();
  await page.locator('.msw-audio-clip').first().click();await openMenubarMenu(page,'媒体');await page.locator('#audio-actions-open').click();
  await page.locator('#audio-actions-regenerate').click();await expect(page.locator('#audio-actions-message')).toContainText('已替换 1');
  expect(await page.evaluate(()=>DATA.msw.audio_clips[0].asset_id)).not.toBe(original.id);
});
test('MiniMax model controls, manual voice, cache failure and account isolation',async({page})=>{
  await setup(page,'minimax');await page.locator('#tts-minimax-model').selectOption('speech-2.6-hd');await page.locator('#tts-minimax-emotion').selectOption('whisper');
  await page.locator('#tts-minimax-model').selectOption('speech-2.8-hd');await expect(page.locator('#tts-minimax-emotion')).toHaveValue('');
  await page.locator('#tts-minimax-voice').fill('manual-voice');
  await page.route('**/api/msw/minimax-tts',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'}));
  await page.locator('#tts-minimax-refresh').click();await expect(page.locator('#tts-minimax-status')).toContainText('offline');await expect(page.locator('#tts-minimax-voice')).toHaveValue('manual-voice');
  await openTtsEnvironment(page,'minimax');await page.locator('#tts-minimax-region').selectOption('global');await expect(page.locator('#tts-minimax-key')).toHaveValue('');await expect(page.locator('#tts-minimax-key')).toHaveAttribute('placeholder','请输入 API Key');
  await closeTtsEnvironment(page);await expect(page.locator('#tts-start')).toBeDisabled();await expect(page.locator('#tts-minimax-voice')).toHaveValue('');
});
test('Mossland creates reference voice, respects model language support and cancels draft',async({page})=>{
  await setup(page,'mossland');await page.getByText('从参考创建音色',{exact:true}).click();await page.locator('#tts-mossland-name').fill('参考测试');
  await page.locator('#tts-mossland-reference').setInputFiles(join(dir,'reference.wav'));await page.locator('#tts-mossland-create').click();
  await expect(page.locator('#tts-mossland-status')).toContainText('已创建');await expect(page.locator('#tts-mossland-voice')).toHaveValue('created-test');
  await page.locator('#tts-mossland-model').selectOption('moss-tts-1.0-pro');await expect(page.locator('#tts-mossland-language')).toBeDisabled();
  await page.locator('#tts-target').selectOption('editor_text');await page.locator('#cue-panel-tts-text').fill('WAIT_CANCEL');await page.locator('#tts-start').click();
  await page.locator('#tts-jobs').getByRole('button',{name:'取消任务'}).click();await expect(page.locator('#tts-jobs')).toContainText('已取消');
  await page.waitForTimeout(1700);expect(await count(page)).toBe(0);await expect(page.locator('#cue-panel-tts-text')).toHaveValue('WAIT_CANCEL');
});
test('cloud panels keep two columns and collapse to one on narrow screens',async({page},info)=>{
  await setup(page,'minimax');const model=page.locator('#tts-minimax-model'),language=page.locator('#tts-minimax-language');
  const a=await model.boundingBox(),b=await language.boundingBox();expect(Math.abs(a.y-b.y)).toBeLessThan(2);expect(b.x).toBeGreaterThan(a.x);
  await page.setViewportSize({width:480,height:850});await page.screenshot({path:info.outputPath('cloud-narrow.png')});
  const c=await model.boundingBox(),d=await language.boundingBox();expect(d.y).toBeGreaterThan(c.y);expect(d.x).toBeCloseTo(c.x,0);
});

test('cloud settings reopen with English labels, retain user voice IDs and reject unauthenticated calls',async({page},info)=>{
  await setup(page,'mossland');
  const response=await page.request.post(new URL('/api/msw/mossland-tts',server.url).href,{data:{action:'refresh'}});
  expect(response.status()).toBe(403);
  await page.evaluate(()=>localStorage.setItem('mawe.language','en'));await page.reload();await expect(page.locator('#editor-loading')).not.toBeVisible();
  await openTtsEnvironment(page,'mossland');await closeTtsEnvironment(page);await page.locator('#tts-engine').selectOption('mossland');
  await expect(page.locator('#tts-mossland-voice')).toHaveValue('moss-test');
  await expect(page.locator('#tts-mossland-refresh')).toHaveText('Refresh voices');
  await expect(page.getByText('Create a voice from a reference',{exact:true})).toBeVisible();
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await page.screenshot({path:info.outputPath('cloud-english.png')});
});


test('cloud connection refresh provides immediate progress and restores buttons after failure',async({page})=>{
  await openTtsEnvironment(page,'minimax');await page.locator('#tts-minimax-key').fill('synthetic-secret');
  await page.route('**/api/msw/minimax-tts',async route=>{await new Promise(r=>setTimeout(r,600));await route.fulfill({status:503,json:{error:'offline'}});});
  const button=page.locator('#tts-minimax-refresh-environment');await button.click();
  await expect(button).toHaveText('正在验证…');await expect(button).toBeDisabled();
  await expect(page.locator('#tts-minimax-management [role="status"]')).toContainText('正在验证');
  await expect(button).toBeEnabled();await expect(button).toHaveText('检测连接／刷新音色');
  await expect(page.locator('#tts-minimax-management [role="status"]')).toHaveText('offline');
});


test('no selected subtitles blocks TTS without a request; draft synthesis remains independent',async({page})=>{
  await setup(page,'mossland');await page.evaluate(()=>{clearSelection();document.dispatchEvent(new Event('pointerup'));});
  await expect(page.locator('#tts-start')).toBeDisabled();await expect(page.locator('#tts-scope')).toContainText('未选择字幕');
  const before=calls.length;await page.locator('#tts-start').evaluate(b=>b.click());expect(calls.length).toBe(before);
  await page.locator('#tts-target').selectOption('editor_text');await page.locator('#cue-panel-tts-text').fill('但说实话');
  await page.locator('#tts-mossland-language').selectOption('Chinese');await page.locator('#tts-mossland-expected_duration_sec').fill('2');
  await page.locator('#tts-start').click();await expect.poll(()=>count(page)).toBe(1);
  const body=calls.find(c=>c.path==='/v1/audio/speech').body;expect(body.input).toBe('但说实话');expect(body.expected_duration_sec).toBe(2);
  expect(await page.evaluate(()=>DATA.msw.assets[0].generation.expected_duration_sec)).toBe(2);
  await page.locator('#tts-close').click();await page.locator('[data-asset-action="regenerate"]').first().click();await expect.poll(()=>count(page)).toBe(2);
  expect(calls.filter(c=>c.path==='/v1/audio/speech').map(c=>c.body.expected_duration_sec)).toEqual([2,2]);
});
