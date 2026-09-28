import {test, expect} from '@playwright/test';
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir,
  startTtsServer, openTtsEnvironment, closeTtsEnvironment} from './helpers.mjs';

let server, dir, bundle, indexPort, gptPort, audio, errors;
test.beforeEach(async ({page}) => {
  dir = makeTempDir('tts-services'); bundle = join(dir, 'bundle with spaces');
  mkdirSync(join(bundle, 'runtime'), {recursive:true}); writeFileSync(join(bundle, 'runtime', 'python.exe'), 'fixture');
  const bootstrap = `import sys,time,pathlib,json\nroot=pathlib.Path(__file__).parent\nsys.path.insert(0,${JSON.stringify(resolve('.'))})\nsys.path.insert(0,${JSON.stringify(resolve('tests'))})\nprint('Synthetic model loading',flush=True)\nwhile not (root/'ready.flag').exists(): time.sleep(.05)\n`;
  writeFileSync(join(bundle,'webui.py'), bootstrap + `from index_service_fixture import IndexFixture\np=int(sys.argv[sys.argv.index('--port')+1])\nservice=IndexFixture(port=p)\noriginal=service.result\ndef result(name,data):\n if name=='gen_single':\n  with (root/'calls.jsonl').open('a',encoding='utf-8') as f: f.write(json.dumps(data)+'\\n')\n return original(name,data)\nservice.result=result\nprint('Synthetic Index ready',flush=True)\nservice.thread.join()\n`);
  writeFileSync(join(bundle,'api_v2.py'), bootstrap + `from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer\nclass Handler(BaseHTTPRequestHandler):\n def do_GET(self):\n  body=json.dumps({'paths':{k:{} for k in ['/tts','/set_gpt_weights','/set_sovits_weights']},'components':{'schemas':{'TTS_Request':{'properties':{k:{} for k in ['text','text_lang','ref_audio_path','prompt_lang']}}}}}).encode()\n  self.send_response(200); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)\np=int(sys.argv[sys.argv.index('-p')+1])\nThreadingHTTPServer(('127.0.0.1',p),Handler).serve_forever()\n`);
  indexPort = await findFreePort(); gptPort = await findFreePort();
  process.env.MAW_ENV_FILE = join(dir,'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(dir,'app-data');
  process.env.MSW_TEST_LOCAL_TTS_INSTALL = bundle;
  audio = readFileSync(generateWav(join(dir,'reference.wav'),.3));
  const project = join(dir,'test.mosp');
  writeFileSync(project,JSON.stringify({media:'',msw:{schema:'msw.editor.v1',project_id:randomUUID()},
    segments:[{id:'main',start:0,end:1000,text:'Frozen source'}],waveform:generateWaveformPayload(5000)}));
  server = await startTtsServer(project,generateWav(join(dir,'media.wav'),5),await findFreePort(),'http://127.0.0.1:9');
  errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await disableOnboarding(page);await page.goto(server.url);await expect(page.locator('#editor-loading')).not.toBeVisible();
});
test.afterEach(async () => {await server?.stop(); server=null; delete process.env.MSW_TEST_LOCAL_TTS_INSTALL;expect(errors).toEqual([]);});
async function api(page, route, body) {
  return page.evaluate(async ({route,body}) => {
    const config=MSWE.resolve('processing-host').config;
    const response=await fetch(`${config.processingUrl}/${route}`,{method:body?'POST':'GET',headers:{'X-MSW-Token':config.requestToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,...await response.json()};
  },{route,body});
}
async function configure(page, kind='indextts') {
  await openTtsEnvironment(page,kind);
  await page.locator(`#tts-local-${kind}-directory`).fill(bundle);
  await page.locator(`#tts-local-${kind}-port`).fill(String(kind==='indextts'?indexPort:gptPort));
  await page.locator('#tts-environment-save').click();
  await expect(page.locator('#tts-environment-message')).toHaveText('环境配置已保存到本机');
  const result=await api(page,`tts-local-service?engine=${kind}`);expect(result.service.configured).toBe(true);
}
async function voice(page) {
  await configure(page);
  const uploaded=await api(page,'index-tts',{action:'upload',filename:'reference.wav',audio_base64:audio.toString('base64')});
  const current=await api(page,'tts-settings');
  await api(page,'tts-settings',{service_url:`http://127.0.0.1:${indexPort}`,timeout:600,
    recipe:{...current.index_tts.recipe,speaker_ref:uploaded.reference.id}});
  await page.reload();await expect(page.locator('#editor-loading')).not.toBeVisible();await page.evaluate(()=>selectOnly(0));
  await openTtsEnvironment(page,'indextts');await closeTtsEnvironment(page);
  await expect(page.locator('#tts-start')).toBeEnabled();
  await expect(page.locator('#tts-start')).toHaveText('启动并合成');
}
function release() {writeFileSync(join(bundle,'ready.flag'),'ready');}
function calls() {return existsSync(join(bundle,'calls.jsonl'))?readFileSync(join(bundle,'calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];}

test('GPT service management is separate from synthesis, compact and never starts on save',async ({page},info)=>{
  await configure(page,'gpt-sovits');
  expect((await api(page,'tts-local-service?engine=gpt-sovits')).service.owned).toBe(false);
  expect(await page.locator('#tts-engine option[value="gpt-sovits"]').count()).toBe(1);
  const port=await page.locator('#tts-local-gpt-sovits-port').boundingBox(), timeout=await page.locator('#tts-local-gpt-sovits-timeout').boundingBox();
  expect(Math.abs(port.y-timeout.y)).toBeLessThan(2);expect(timeout.x).toBeGreaterThan(port.x);
  await page.locator('#tts-local-gpt-sovits-start').click();
  await expect.poll(async()=>(await api(page,'tts-local-service?engine=gpt-sovits')).service.state).toBe('loading');
  release();await expect.poll(async()=>{
    const s=(await api(page,'tts-local-service?engine=gpt-sovits')).service;
    if(s.state==='failed') throw new Error(JSON.stringify(s.logs));
    return s.state;
  }).toBe('ready');
  await expect(page.locator('#tts-local-gpt-sovits-status')).toHaveText('服务已就绪');
  await page.screenshot({path:info.outputPath('gpt-service.png')});
  await page.locator('#tts-local-gpt-sovits-stop').click();
  await expect.poll(async()=>(await api(page,'tts-local-service?engine=gpt-sovits')).service.owned).toBe(false);
});

test('start and synthesize freezes input, coalesces starts and preserves owned server on panel close',async({page,context})=>{
  await voice(page);await page.locator('#tts-start').click();
  await expect(page.locator('#tts-jobs')).toContainText('正在等待本机服务');
  const other=await context.newPage();await other.goto(server.url);await expect(other.locator('#editor-loading')).not.toBeVisible();
  const started=await api(other,'tts-local-service',{engine:'indextts',action:'start'});
  await expect.poll(async()=>(await api(page,'tts-local-service?engine=indextts')).service.owned).toBe(true);
  const pid=(await api(page,'tts-local-service?engine=indextts')).service.pid;
  expect(['checking','loading']).toContain(started.service.state);
  await page.evaluate(()=>{DATA.segments[0].text='Changed after submission';});
  await page.locator('#tts-close').click();release();
  await expect.poll(()=>calls().length).toBe(1);expect(calls()[0][2]).toBe('Frozen source');
  await expect.poll(()=>page.evaluate(()=>DATA.msw.assets?.length||0)).toBe(1);
  const ready=(await api(page,'tts-local-service?engine=indextts')).service;
  expect(ready.pid).toBe(pid);expect(ready.owned).toBe(true);
  await other.close();
});

for(const operation of ['cancel','project'])test(`${operation} while models load prevents late synthesis`,async({page})=>{
  await voice(page);await page.locator('#tts-start').click();
  await expect(page.locator('#tts-jobs')).toContainText('正在等待本机服务');
  if(operation==='cancel')await page.locator('#tts-jobs').getByRole('button',{name:'取消任务'}).click();
  else await page.evaluate(()=>dispatchEvent(new Event('msw:project-changed')));
  const id=await page.evaluate(()=>DATA.msw.project_id);
  await expect.poll(async()=>{const data=await api(page,`jobs?project_id=${id}`);return data.jobs[0]?.status;}).toBe('cancelled');
  release();await expect.poll(async()=>(await api(page,'tts-local-service?engine=indextts')).service.state).toBe('ready');
  expect(calls()).toEqual([]);expect(await page.evaluate(()=>DATA.msw.assets?.length||0)).toBe(0);
});

test('unknown engine and unauthenticated lifecycle mutations are rejected',async({page})=>{
  expect((await api(page,'tts-settings',{recipe:{provider:'unknown'}})).status).toBe(400);
  const response=await page.request.post(server.url+'/api/msw/tts-local-service',{data:{engine:'indextts',action:'start'}});
  expect(response.status()).toBe(403);
  expect((await api(page,'tts-local-service',{engine:'gpt-sovits',action:'stop',confirm:true})).status).toBe(400);
});

test('English narrow settings keep directory controls contained',async({page},info)=>{
  await page.setViewportSize({width:920,height:720});
  await page.evaluate(()=>localStorage.setItem('mawe.language','en'));await page.reload();
  await openTtsEnvironment(page,'gpt-sovits');
  await expect(page.locator('#tts-local-gpt-sovits-start')).toHaveText('Start service');
  for(const id of ['directory','python','port','timeout']) {
    const input=page.locator(`#tts-local-gpt-sovits-${id}`);
    expect(await input.evaluate(node=>{const parent=node.closest('label').getBoundingClientRect(), box=node.getBoundingClientRect();return box.width>120&&box.left>=parent.left-1&&box.right<=parent.right+1;})).toBe(true);
  }
  await page.locator('#tts-local-gpt-sovits-start').scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('local-service-narrow-en.png')});
});


test('directory picker shows progress, accepts a folder and distinguishes cancellation',async({page})=>{
  await openTtsEnvironment(page,'gpt-sovits');let cancel=false;
  await page.route('**/api/msw/tts-local-service',async route=>{
    if(route.request().postDataJSON()?.action!=='pick')return route.continue();
    await new Promise(r=>setTimeout(r,600));
    await route.fulfill({json:{ok:true,directory:cancel?'':bundle}});
  });
  const button=page.locator('#tts-local-gpt-sovits').getByRole('button',{name:'选择文件夹',exact:true});
  await button.click();await expect(page.locator('#tts-local-gpt-sovits-status')).toContainText('正在打开');
  await expect(page.locator('#tts-local-gpt-sovits-directory')).toHaveValue(bundle);
  await expect(button).toBeEnabled();cancel=true;await button.click();
  await expect(page.locator('#tts-local-gpt-sovits-status')).toHaveText('已取消目录选择');
  await expect(page.locator('#tts-local-gpt-sovits-directory')).toHaveValue(bundle);await expect(button).toBeEnabled();
});


test('local connection failure clears progress even when subsequent status refresh fails',async({page})=>{
  await configure(page,'gpt-sovits');
  await page.route('**/api/msw/tts-local-service*',async route=>{
    await new Promise(r=>setTimeout(r,200));await route.fulfill({status:503,json:{error:'offline'}});
  });
  const button=page.locator('#tts-local-gpt-sovits-check'),status=page.locator('#tts-local-gpt-sovits-status');
  await button.click();await expect(status).toContainText('正在验证');await expect(button).toBeDisabled();
  await expect(status).toHaveText('offline');await expect(status).toHaveAttribute('aria-busy','false');
  await expect(button).toBeEnabled();
});
