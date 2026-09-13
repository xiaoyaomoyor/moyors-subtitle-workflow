import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,makeTempDir,startTtsServer,generateWav,clickMenubarItem} from './helpers.mjs';

let root,mediaPath,server,mock,calls,reply,pending;
test.beforeEach(async({page})=>{
  test.skip(!process.env.FFMPEG_PATH,'Explicit FFmpeg required');
  root=makeTempDir('editor-asr');mediaPath=join(root,'source.wav');generateWav(mediaPath,4);
  const project=join(root,'initial.mosp');writeFileSync(project,JSON.stringify({media:'',segments:[],msw:{schema:'msw.editor.v1',project_id:'asr-project'}}));
  process.env.MAW_ENV_FILE=join(root,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(root,'app-data');process.env.MSW_TEST_MEDIA_SOURCE=mediaPath;
  writeFileSync(process.env.MAW_ENV_FILE,'DASHSCOPE_API_KEY=synthetic-asr-key\n');
  calls=[];pending=[];reply={segments:[{start:100,end:600,text:'Recognized speech',items:[{start:100,end:600,text:'Recognized speech'}]}]};
  mock=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));calls.push(body);
    const send=()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));};
    if (reply===null)pending.push(send);else send();
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  server=await startTtsServer(project,null,await findFreePort(),`http://127.0.0.1:${mock.address().port}`);
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('msw.waveform.auto','false'));
  await page.goto(server.url);await expect(page.locator('.waveform-row').first()).toBeVisible();
  await clickMenubarItem(page,'文件','load-media');
  await expect.poll(()=>page.evaluate(()=>Boolean(MSWE.resolve('media').current))).toBe(true);
});
test.afterEach(async({page})=>{
  // Stop browser polling before its localhost server; avoid racing a pending
  // beforeunload dialog against Chromium session teardown.
  await page.close({runBeforeUnload:false});
  reply={segments:[]};for(const send of pending || [])send();await server?.stop();
  if(mock)await new Promise(resolve=>mock.close(resolve));
});
async function open(page,mode='whole') {await page.evaluate(mode=>MSWE.resolve('asr').open(mode),mode);await expect(page.locator('#msw-asr-providerId option')).not.toHaveCount(0);}
async function completed(page) {
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('asr').jobs.find(job=>job.status==='succeeded')?.id)).toBeTruthy();
  return page.evaluate(()=>MSWE.resolve('asr').jobs.find(job=>job.status==='succeeded').id);
}

test('Qwen full-media task previews and exports source-time candidates without passing credentials to the fixture',async({page})=>{
  await page.evaluate(()=>{DATA.segments.push({id:'old',start:100,end:800,text:'Existing'});renderAll();});
  await open(page);await page.locator('#msw-asr-start').click();const id=await completed(page);
  await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);
  await expect(page.locator('#msw-asr-candidates')).toContainText('Recognized speech');
  expect(calls).toHaveLength(1);expect(calls[0].asr.duration_ms).toBe(4000);expect(JSON.stringify(calls)).not.toContain('synthetic-asr-key');
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Existing');
  const download=page.waitForEvent('download');await page.locator('#msw-asr-export-json').click();const file=await download;
  const exported=JSON.parse(readFileSync(await file.path(),'utf-8'));expect(exported.segments[0].start).toBe(100);expect(exported.media).toContain('source.wav');
  await page.locator('#msw-asr-apply').click();await expect.poll(()=>page.evaluate(()=>DATA.segments[0].text)).toBe('Recognized speech');
  await page.locator('#msw-asr-close').click();await page.locator('body').click({position:{x:4,y:4}});await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>DATA.segments.map(c=>c.text))).toEqual(['Existing']);
  await page.keyboard.press('Control+y');expect(await page.evaluate(()=>DATA.segments.map(c=>c.text))).toEqual(['Recognized speech']);
});

test('range boundaries require explicit expansion and then use a precisely extracted source range',async({page})=>{
  await page.evaluate(()=>{
    DATA.segments.push({id:'old',start:1000,end:2000,text:'Crossed'});renderAll();MSWE.resolve('time-range').setRange({start:1500,end:2300});
  });
  await open(page,'range');await expect(page.locator('#msw-asr-start')).toBeDisabled();
  await expect(page.locator('#msw-asr-scope')).toContainText('切穿');await page.locator('#msw-asr-expand').click();
  expect(await page.evaluate(()=>MSWE.resolve('time-range').range)).toEqual({start:1000,end:2300});
  await page.locator('#msw-asr-start').click();const id=await completed(page);await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);
  expect(calls[0].asr.duration_ms).toBe(1300);await expect(page.locator('#msw-asr-candidates')).toContainText('1.100–1.600');
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Crossed');
});

test('empty main track auto-applies once, preserves media and supports undo',async({page})=>{
  await open(page);await page.locator('#msw-asr-start').click();const id=await completed(page);
  await expect.poll(()=>page.evaluate(()=>DATA.segments[0]?.text)).toBe('Recognized speech');
  expect(await page.evaluate(()=>DATA.msw.applied_results.length)).toBe(1);
  await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);await expect(page.locator('#msw-asr-apply')).toBeDisabled();
  await page.screenshot({path:join(root,'asr-applied.png'),fullPage:true});
  await page.locator('#msw-asr-close').click();await page.locator('body').click({position:{x:4,y:4}});await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>DATA.segments.length)).toBe(0);expect(await page.evaluate(()=>MSWE.resolve('media').current.name)).toBe('source.wav');
});

test('disjoint selections submit separate source intervals and preserve subtitles in the unselected gap',async({page})=>{
  await page.evaluate(()=>{
    DATA.segments.push({id:'gap',start:1500,end:1800,text:'Unselected gap'});renderAll();
    MSWE.resolve('time-range').setRange([{start:0,end:1000},{start:2000,end:3000}]);
  });
  await open(page,'range');await page.locator('#msw-asr-start').click();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('asr').jobs.filter(job=>job.status==='succeeded').length)).toBe(2);
  expect(calls.map(call=>call.asr.duration_ms)).toEqual([1000,1000]);
  const ids=await page.evaluate(()=>MSWE.resolve('asr').jobs.map(job=>job.id));
  for (const id of ids) {
    await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);await page.locator('#msw-asr-apply').click();
    await expect.poll(()=>page.evaluate(id=>DATA.msw.applied_results?.includes(id),id)).toBe(true);
  }
  expect(await page.evaluate(()=>DATA.segments.map(cue=>[cue.start,cue.text])))
    .toEqual([[100,'Recognized speech'],[1500,'Unselected gap'],[2100,'Recognized speech']]);
});

test('ASR controls and replacement preview follow the English editor language',async({page})=>{
  await page.evaluate(()=>{MSWE_I18N.applyLanguage('en');DATA.segments.push({id:'old',start:0,end:1000,text:'Existing'});renderAll();});
  await open(page);await expect(page.locator('#msw-asr-title')).toHaveText('ASR · Source audio transcription');
  await expect(page.locator('#msw-asr-start')).toHaveText('Start transcription');
  await page.locator('#msw-asr-start').click();const id=await completed(page);await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);
  await expect(page.locator('#msw-asr-apply')).toHaveText('Apply to main subtitles');
  await expect(page.locator('#msw-asr-result-status')).toContainText('Replace main subtitles');
  await expect(page.locator('#msw-asr-result-status')).not.toContainText(/[\u3400-\u9fff]/);
  await expect(page.locator('#msw-asr-jobs')).not.toContainText(/[\u3400-\u9fff]/);
  await page.screenshot({path:join(root,'asr-english.png'),fullPage:true});
});

test('range replacement keeps hidden secondary text, detaches old binding, marks review and restores it with one undo',async({page})=>{
  await page.evaluate(()=>{
    DATA.segments.push({id:'outside',start:0,end:500,text:'Keep'},{id:'old',start:1000,end:2000,text:'Replace'});
    DATA.multi_subtitle={schema:'moy.asr.multi_subtitle.v1',enabled:false,display_mode:'both',tracks:[{id:'ext',role:'extension',name:'English',language:'English',
      segments:[{id:'translated',start:1000,end:2000,text:'Old translation'}]}],bindings:[{id:'binding',track_id:'ext',main_segment_ids:['old'],extension_segment_ids:['translated']}]};
    renderAll();MSWE.resolve('time-range').setRange({start:1000,end:2000});
  });
  await open(page,'range');await page.locator('#msw-asr-start').click();const id=await completed(page);
  await page.evaluate(()=>{DATA.segments[0].text='Outside edit';renderAll();});
  await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);await page.locator('#msw-asr-apply').click();
  await expect.poll(()=>page.evaluate(()=>DATA.segments[1]?.text)).toBe('Recognized speech');
  expect(await page.evaluate(()=>[DATA.segments[0].text,DATA.multi_subtitle.tracks[0].segments[0].text,DATA.multi_subtitle.bindings.length,
    Boolean(DATA.msw.asr_stale_subtitles.ext.translated)])).toEqual(['Outside edit','Old translation',0,true]);
  await page.evaluate(()=>{DATA.multi_subtitle.enabled=true;renderAll();});await expect(page.locator('.msw-source-stale').first()).toBeVisible();
  await page.locator('#msw-asr-close').click();await page.locator('body').click({position:{x:4,y:4}});await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>[DATA.segments[1].id,DATA.multi_subtitle.bindings.length,DATA.msw.asr_stale_subtitles||{}])).toEqual(['old',1,{}]);
});

test('editing the target while ASR runs blocks application and retains export',async({page})=>{
  await page.evaluate(()=>{DATA.segments.push({id:'old',start:0,end:1000,text:'Old'});renderAll();});
  reply=null;await open(page);await page.locator('#msw-asr-start').click();await expect.poll(()=>pending.length).toBe(1);
  await page.evaluate(()=>{DATA.segments[0].text='User edit';renderAll();});
  reply={segments:[{start:100,end:600,text:'Late candidate'}]};pending.shift()();const id=await completed(page);
  await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);await expect(page.locator('#msw-asr-apply')).toBeDisabled();
  await expect(page.locator('#msw-asr-result-status')).toContainText('编辑');expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('User edit');
});

test('empty recognition never clears existing subtitles and can be set aside',async({page})=>{
  await page.evaluate(()=>{DATA.segments.push({id:'old',start:0,end:1000,text:'Keep'});renderAll();});reply={segments:[]};
  await open(page);await page.locator('#msw-asr-start').click();const id=await completed(page);await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);
  await expect(page.locator('#msw-asr-apply')).toBeDisabled();await expect(page.locator('#msw-asr-result-status')).toContainText('没有识别到语音');
  await page.locator('#msw-asr-discard').click();await expect(page.locator('#msw-asr-discard')).toBeDisabled();
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Keep');
});

test('a missing submit response is retried with the same request identity',async({page})=>{
  let dropped=false;
  await page.route('**/jobs',async route=>{
    if(route.request().method()!=='POST'||dropped)return route.continue();
    dropped=true;await route.fetch();await route.abort('failed');
  });
  await open(page);await page.locator('#msw-asr-start').click();await expect(page.locator('#msw-asr-start')).toHaveText('确认上次提交');
  await page.locator('#msw-asr-start').click();await completed(page);
  expect(calls.length).toBe(1);expect(await page.evaluate(()=>MSWE.resolve('asr').jobs.length)).toBe(1);
});

test('refresh resumes job inspection but requires manual application for an earlier page',async({page})=>{
  reply=null;await open(page);await page.locator('#msw-asr-start').click();await expect.poll(()=>pending.length).toBe(1);
  await page.reload();await expect.poll(()=>page.evaluate(()=>Boolean(MSWE.resolve('media').current))).toBe(true);
  reply={segments:[{start:100,end:600,text:'After refresh'}]};pending.shift()();const id=await completed(page);
  await open(page);await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);
  expect(await page.evaluate(()=>DATA.segments)).toEqual([]);await expect(page.locator('#msw-asr-apply')).toBeEnabled();
  await page.locator('#msw-asr-apply').click();await expect.poll(()=>page.evaluate(()=>DATA.segments[0]?.text)).toBe('After refresh');
});

test('a partly submitted range batch resumes only its remaining requests',async({page})=>{
  await page.evaluate(()=>MSWE.resolve('time-range').setRange([{start:0,end:1000},{start:2000,end:3000}]));
  let submitted=0;
  await page.route('**/jobs',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    submitted++;
    if(submitted!==2)return route.continue();
    await route.fetch();await route.abort('failed');
  });
  await open(page,'range');await page.locator('#msw-asr-start').click();
  await expect(page.locator('#msw-asr-start')).toHaveText('确认上次提交');
  await page.locator('#msw-asr-start').click();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('asr').jobs.filter(job=>job.status==='succeeded').length)).toBe(2);
  expect(calls).toHaveLength(2);expect(submitted).toBe(3);
  await expect(page.locator('#msw-asr-jobs')).toContainText('0.000–1.000 s');
  await expect(page.locator('#msw-asr-jobs')).toContainText('2.000–3.000 s');
});

test('changing the underlying source after recognition rejects apply without losing candidates',async({page})=>{
  await page.evaluate(()=>{DATA.segments.push({id:'old',start:0,end:1000,text:'Keep'});renderAll();});
  await open(page);await page.locator('#msw-asr-start').click();const id=await completed(page);
  writeFileSync(mediaPath,Buffer.concat([readFileSync(mediaPath),Buffer.from([0,0])]));
  await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);await page.locator('#msw-asr-apply').click();
  await expect(page.locator('#msw-asr-message')).toContainText(/改变|变化/);
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Keep');await expect(page.locator('#msw-asr-candidates')).toContainText('Recognized speech');
});

test('replacing a group head promotes the outside survivor and keeps its original timing',async({page})=>{
  await page.evaluate(()=>{
    DATA.segments.push({id:'old',start:1000,end:2000,text:'Head',color:{start:1000,end:3500,color:'#ff0000'}},
      {id:'keep',start:3000,end:3500,text:'Keep',color_ref:{headIdx:0}});renderAll();MSWE.resolve('time-range').setRange({start:1000,end:2000});
  });
  await open(page,'range');await page.locator('#msw-asr-start').click();const id=await completed(page);
  await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);await page.locator('#msw-asr-apply').click();
  await expect.poll(()=>page.evaluate(()=>DATA.segments[0].text)).toBe('Recognized speech');
  expect(await page.evaluate(()=>({id:DATA.segments[1].id,start:DATA.segments[1].start,end:DATA.segments[1].end,color:DATA.segments[1].color})))
    .toEqual({id:'keep',start:3000,end:3500,color:{start:3000,end:3500,color:'#ff0000'}});
  expect(await page.evaluate(()=>DATA.segments[0].color)).toEqual({start:1100,end:1600,color:'#ff0000'});
});

test('cancelling ASR leaves subtitles unchanged even when the provider returns late',async({page})=>{
  reply=null;await open(page);await page.locator('#msw-asr-start').click();await expect.poll(()=>pending.length).toBe(1);
  await page.locator('#msw-asr-history > summary').click();
  await page.locator('#msw-asr-jobs button').filter({hasText:/^取消$/}).click();
  reply={segments:[{start:100,end:600,text:'Late result'}]};pending.shift()();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('asr').jobs[0]?.status)).toBe('cancelled');
  expect(await page.evaluate(()=>DATA.segments)).toEqual([]);
});

test('range ASR keeps the original waveform cue color and undo restores its group reference',async({page})=>{
  await page.evaluate(()=>{
    const color=ASR_EDITOR_PALETTE[0];
    DATA.segments.push({id:'head',start:0,end:500,text:'Head',color:{...color,start:0,end:2000}},
      {id:'target',start:1000,end:2000,text:'Target',color_ref:{name:color.name,headIdx:0}});
    renderAll();MSWE.resolve('time-range').setRange({start:1000,end:2000});
  });
  const before=await page.locator('.waveform-cue-block').filter({hasText:'Target'}).first().evaluate(node=>node.style.getPropertyValue('--cue-color'));
  await open(page,'range');await page.locator('#msw-asr-start').click();const id=await completed(page);
  await page.evaluate(id=>MSWE.resolve('asr').showResult(id),id);await page.locator('#msw-asr-apply').click();
  await expect.poll(()=>page.evaluate(()=>DATA.segments[1]?.text)).toBe('Recognized speech');
  expect(await page.locator('.waveform-cue-block').filter({hasText:'Recognized speech'}).first().evaluate(node=>node.style.getPropertyValue('--cue-color'))).toBe(before);
  await page.locator('#msw-asr-close').click();await page.locator('body').click({position:{x:4,y:4}});await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>DATA.segments[1].color_ref.headIdx)).toBe(0);
});

for (const [provider,model] of [['qwen','fun-asr'],['soniox','stt-async-v5'],['openai','whisper-1']])
test(`${provider}/${model}: editor settings route to the existing cloud transcription adapter`,async({page})=>{
  await open(page);await page.locator('#msw-asr-close').click();await page.evaluate(()=>MSWE.resolve('processing-host').openAsrEnvironment());
  await page.locator('#msw-asr-environment-provider').selectOption(provider);
  await page.locator('#msw-asr-apiKey').fill('synthetic-asr-key');
  if (provider==='openai')await page.locator('#msw-asr-openaiBaseUrl').fill('http://127.0.0.1:1/v1');
  await page.locator('#msw-asr-save-environment').click();await expect(page.locator('#msw-asr-environment-message')).toContainText('已保存');
  await page.locator('#msw-asr-environment-return').click();
  await page.locator('#msw-asr-providerId').selectOption(provider);await page.locator('#msw-asr-modelId').selectOption(model);
  await page.locator('#msw-asr-start').click();await completed(page);
  expect(calls[0].asr).toMatchObject({provider,model,duration_ms:4000});
  await expect.poll(()=>page.evaluate(()=>DATA.segments[0]?.text)).toBe('Recognized speech');
});

test('ASR uses TTS panel geometry with two call columns and separate environment configuration',async({page})=>{
  await open(page);
  const box=await page.locator('#msw-asr-panel').boundingBox();
  expect(box.width).toBe(440);
  await expect(page.locator('#msw-asr-panel #msw-asr-language')).toBeVisible();
  await expect(page.locator('#msw-asr-panel #msw-asr-apiKey')).toHaveCount(0);
  await expect(page.locator('#msw-asr-environment-open')).toHaveCount(0);
  const service=await page.locator('#msw-asr-providerId').boundingBox(),model=await page.locator('#msw-asr-modelId').boundingBox();
  expect(service.y).toBe(model.y);expect(service.width).toBeCloseTo(model.width,0);
  await expect(page.locator('#msw-asr-close svg')).toHaveCount(1);
  const close=await page.locator('#msw-asr-close').boundingBox();
  expect(close.width).toBe(await page.locator('#tts-close').evaluate(node=>parseFloat(getComputedStyle(node).width)));
  expect(await page.locator('#msw-asr-panel').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.screenshot({path:join(root,'asr-panel-refined.png'),fullPage:true});
  await page.locator('#msw-asr-close').click();await page.evaluate(()=>MSWE.resolve('processing-host').openAsrEnvironment());
  await expect(page.locator('#msw-asr-panel')).not.toHaveClass(/show/);
  await expect(page.locator('#editor-settings-nav .settings-nav-subitem').filter({hasText:/^ASR$/})).toBeVisible();
  await expect(page.locator('#asr-environment-section #msw-asr-apiKey')).toBeVisible();
  await page.locator('#msw-asr-apiKey').fill('synthetic-new-key');
  await page.locator('#msw-asr-save-environment').click();await expect(page.locator('#msw-asr-environment-message')).toContainText('已保存');
  await expect(page.locator('#msw-asr-apiKey')).toHaveValue('');
  await page.screenshot({path:join(root,'asr-environment-refined.png'),fullPage:true});
  await page.locator('#msw-asr-environment-return').click();await expect(page.locator('#msw-asr-panel')).toHaveClass(/show/);
  await page.setViewportSize({width:520,height:740});
  expect(await page.locator('#msw-asr-panel').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await expect(page.locator('#msw-asr-close')).toBeInViewport();
});

test('each history record owns its preview and folded history retains the selected export target',async({page})=>{
  await page.evaluate(()=>{
    DATA.segments.push({id:'keep',start:1500,end:1800,text:'Keep'});renderAll();
    MSWE.resolve('time-range').setRange([{start:0,end:1000},{start:2000,end:3000}]);
  });
  await open(page,'range');await page.locator('#msw-asr-start').click();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('asr').jobs.filter(job=>job.status==='succeeded').length)).toBe(2);
  await page.locator('#msw-asr-history > summary').click();
  const cards=page.locator('[data-asr-job]');await expect(cards).toHaveCount(2);
  await expect(page.locator('[data-asr-job] details')).toHaveCount(2);
  const id=await cards.first().getAttribute('data-asr-job');
  await cards.first().getByRole('radio').check();
  await expect(page.locator('#msw-asr-preview')).toHaveAttribute('open','');
  await page.locator('#msw-asr-preview > summary').click();
  // A real server event forces a list refresh; folding must survive it.
  await page.evaluate(async id=>{const media=MSWE.resolve('media');await media.request(`jobs/${id}/ack`,{project_id:DATA.msw.project_id,application:'discarded'});},id);
  await expect.poll(()=>page.evaluate(id=>MSWE.resolve('asr').jobs.find(job=>job.id===id).application,id)).toBe('discarded');
  await expect(page.locator('#msw-asr-preview')).not.toHaveAttribute('open','');
  await page.screenshot({path:join(root,'asr-records.png'),fullPage:true});
  await page.locator('#msw-asr-history > summary').click();
  for(const action of ['apply','discard','export-json','export-srt'])await expect(page.locator('#msw-asr-'+action)).toBeVisible();
  const download=page.waitForEvent('download');await page.locator('#msw-asr-export-json').click();
  const result=JSON.parse(readFileSync(await (await download).path(),'utf8'));
  const start=await page.evaluate(id=>MSWE.resolve('asr').jobs.find(job=>job.id===id).source_range.start,id);
  expect(result.segments[0].start).toBe(start+100);
});

test('call controls adapt to custom OpenAI models and Soniox context without exposing credentials',async({page})=>{
  await open(page);await page.locator('#msw-asr-providerId').selectOption('openai');
  await page.locator('#msw-asr-modelId').selectOption('whisper-1');await expect(page.locator('#msw-asr-openaiModel')).toBeHidden();
  await page.locator('#msw-asr-modelId').selectOption('custom-asr');await expect(page.locator('#msw-asr-openaiModel')).toBeVisible();
  await page.locator('#msw-asr-openaiModel').fill('compatible-model');
  await page.locator('#msw-asr-providerId').selectOption('soniox');await expect(page.locator('#msw-asr-openaiModel')).toBeHidden();
  await page.locator('#msw-asr-settings > details > summary').click();
  await expect(page.locator('#msw-asr-sonioxContextText')).toBeVisible();await expect(page.locator('#msw-asr-qwenAudioContext')).toBeHidden();
  await expect(page.locator('#msw-asr-panel input[type="password"]')).toHaveCount(0);
  await page.screenshot({path:join(root,'asr-soniox-call.png'),fullPage:true});
});

test('ASR saves call defaults without media and uses current call drafts with saved connections',async({page})=>{
  await page.evaluate(()=>applyCanonicalProject({media:'',segments:[]},'empty.mosp'));
  await open(page);await page.locator('#msw-asr-language').fill('en');
  await page.locator('#msw-asr-save-settings').click();await expect(page.locator('#msw-asr-message')).toContainText('已保存');
  await page.locator('#msw-asr-language').fill('zh');await expect(page.locator('#msw-asr-start')).toBeDisabled();
  await page.reload();await open(page);await expect(page.locator('#msw-asr-language')).toHaveValue('en');
  await page.locator('#msw-asr-close').click();await page.evaluate(()=>MSWE.resolve('processing-host').openAsrEnvironment());
  await page.locator('#msw-asr-workspaceId').fill('saved-workspace');
  await page.locator('#msw-asr-save-environment').click();await expect(page.locator('#msw-asr-environment-message')).toContainText('已保存');
  await page.locator('#msw-asr-workspaceId').fill('unsaved-workspace');
  await page.locator('#msw-asr-environment-return').click();await page.locator('#msw-asr-close').click();
  await clickMenubarItem(page,'文件','load-media');await expect.poll(()=>page.evaluate(()=>Boolean(MSWE.resolve('media').current))).toBe(true);
  await open(page);await page.locator('#msw-asr-language').fill('zh');
  let submitted;await page.route('**/jobs',async route=>{if(route.request().method()==='POST')submitted=route.request().postDataJSON();await route.continue();});
  await page.locator('#msw-asr-start').click();await completed(page);
  expect(submitted.provider).toMatchObject({language:'zh',workspaceId:'saved-workspace',apiKey:''});
});
