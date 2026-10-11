import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {disableOnboarding,findFreePort,generateWav,makeTempDir,startTtsServer} from './helpers.mjs';

let server,mock,dir,calls,held,hold;
test.beforeEach(async({page})=>{
  test.skip(!process.env.FFMPEG_PATH,'Explicit synthetic-media toolchain required');
  dir=makeTempDir('flat-processing');calls=[];held=[];hold=false;
  const wav=readFileSync(generateWav(join(dir,'voice.wav'),1)),video=join(dir,'source.mp4');
  execFileSync(join(process.env.FFMPEG_PATH,'ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=10:d=3','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
  mock=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));calls.push(body);
    if(body.asr){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({segments:[{start:100,end:800,text:'Recognized speech',items:[{start:100,end:800,text:'Recognized speech'}]}]}));}
    else if(body.messages){const input=JSON.parse(body.messages.find(m=>m.role==='user').content);const send=()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({groups:input.map(c=>({source_ids:[c.id],text:'译文 '+c.text}))})}}]}));};if(hold)held.push(send);else send();}
    else {res.setHeader('Content-Type','audio/wav');res.end(wav);}
  });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');process.env.MSW_TEST_MEDIA_SOURCE=video;
  writeFileSync(process.env.MAW_ENV_FILE,'DASHSCOPE_API_KEY=synthetic-test-key\n');
  const project=join(dir,'initial.mosp');writeFileSync(project,JSON.stringify({media:video,msw:{schema:'msw.editor.v1',project_id:'flat-integration'},segments:[{id:'a',start:100,end:1400,text:'Hello world'},{id:'b',start:1500,end:2900,text:'Second sentence'}]}));
  server=await startTtsServer(project,video,await findFreePort(),`http://127.0.0.1:${mock.address().port}`);
  await disableOnboarding(page);page.on('dialog',d=>d.accept());await page.goto(server.url+'?flat-subtitles=1');await expect(page.locator('#flat-trial-bar')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!MSWFlatServices.media)).toBe(true);
  await page.evaluate(async baseUrl=>{await MSWFlatServices.request('providers',{providerId:'custom',baseUrl,model:'synthetic-model',apiKey:'synthetic-key',reasoningMode:'off'});},`http://127.0.0.1:${mock.address().port}/v1`);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});for(const send of held||[])send();await server?.stop();if(mock)await new Promise(r=>mock.close(r));});
const snap=page=>page.evaluate(()=>MSWFlatEditor.snapshot());
async function open(page,kind){await page.getByRole('button',{name:'字幕处理',exact:true}).click();await page.locator('#flat-processing-kind').selectOption(kind);await expect(page.locator('#flat-processing-provider option')).not.toHaveCount(0);if(kind==='translation')await page.locator('#flat-processing-provider').selectOption('custom');}
async function done(page){const card=page.locator('#flat-processing-panel .flat-job').first();await expect(card).toContainText('待检查',{timeout:25000});return card;}

test('ASR uses registered audio and applies only to new target; undo and v4 download remain native',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const before=await snap(page);await open(page,'asr');await page.locator('#flat-processing-start').click();const card=await done(page);
  expect((await snap(page)).subtitles.cues).toHaveLength(2);await card.getByRole('button',{name:'应用到目标轨道'}).click();
  await expect.poll(async()=>(await snap(page)).subtitles.cues.length).toBe(3);const p=await snap(page);expect(p.subtitles.cues).toHaveLength(3);expect(p.subtitles.cues.at(-1).content.items[0].start).toBe(100);expect(p.subtitles.cues.at(-1).track_id).not.toBe(before.subtitles.cues[0].track_id);
  expect(calls.find(c=>c.asr).asr.duration_ms).toBe(3000);await page.locator('#flat-processing-panel').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('#flat-undo').click();expect((await snap(page)).subtitles.cues).toEqual(before.subtitles.cues);await page.locator('#flat-redo').click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();const saved=JSON.parse(readFileSync(await(await download).path(),'utf8'));expect(saved.schema).toBe('msw.project.v4');expect(saved.segments).toBeUndefined();expect(saved.subtitles.cues).toHaveLength(3);expect(errors).toEqual([]);
});

test('translation creates correspondence, rejects stale edits, can cancel and recover jobs after refresh',async({page})=>{
  await page.locator('.flat-cue').first().click();await open(page,'translation');await page.locator('#flat-processing-start').click();let card=await done(page);await card.getByRole('button',{name:'应用到目标轨道'}).click();
  let p=await snap(page);expect(p.subtitles.bindings).toHaveLength(1);expect(p.subtitles.cues.at(-1).content.text).toContain('译文');const target=p.subtitles.tracks.at(-1).id;
  await page.locator('#flat-processing-panel').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.flat-cue').first().click();await open(page,'translation');await page.locator('#flat-processing-target').selectOption(target);hold=true;await page.locator('#flat-processing-start').click();await expect.poll(()=>held.length).toBe(1);
  await page.locator('#flat-processing-panel').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('#flat-text').fill('Changed during processing');await page.locator('#flat-end').click();hold=false;held.splice(0).forEach(fn=>fn());await open(page,'translation');card=await done(page);await card.getByRole('button',{name:'应用到目标轨道'}).click();await expect(page.locator('#flat-message')).toContainText('已变化');expect((await snap(page)).subtitles.cues[0].content.text).toBe('Changed during processing');
  hold=true;await page.locator('#flat-processing-start').click();await expect.poll(()=>held.length).toBe(1);await page.locator('#flat-processing-panel .flat-job').first().getByRole('button',{name:'取消任务'}).click();hold=false;held.splice(0).forEach(fn=>fn());await expect(page.locator('#flat-processing-panel .flat-job').first()).toContainText('已取消');
  await page.reload();await page.getByRole('button',{name:'恢复上次试用草稿'}).click();await open(page,'translation');await expect(page.locator('#flat-processing-panel .flat-job')).toHaveCount(3);expect(calls.filter(c=>c.messages)).toHaveLength(3);
});

test('TTS records global source identity, auditions, inserts a clip and downloads a native project/audio bundle',async({page})=>{
  await page.locator('.flat-cue').first().click();await open(page,'tts');await page.locator('#flat-processing-start').click();const card=await done(page);await card.locator('summary').click();await card.getByRole('button',{name:'试听',exact:true}).click();await expect(card.locator('audio')).toBeVisible();await card.getByRole('button',{name:'收入配音素材'}).click();
  await expect.poll(async()=>(await snap(page)).msw.assets?.length).toBe(1);const p=await snap(page);expect(p.msw.assets).toHaveLength(1);expect(p.msw.assets[0].source_ref.subtitle_cue_id).toBe(p.subtitles.cues[0].id);
  await page.locator('#flat-processing-panel').getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'配音素材',exact:true}).click();await page.getByRole('button',{name:'按来源时间放入配音轨'}).click();expect((await snap(page)).msw.audio_clips[0].start_ms).toBe(100);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程与配音包'}).click();expect(readFileSync(await(await download).path()).subarray(0,2).toString()).toBe('PK');
  await page.locator('#flat-audio-panel').getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>MSWFlatEditor.player.play());await expect.poll(()=>page.evaluate(()=>MSWFlatServices.transport.diagnostics().decoded)).toBeGreaterThan(0);await page.evaluate(()=>MSWFlatEditor.player.pause());
  await page.locator('#flat-undo').click();expect((await snap(page)).msw.audio_clips||[]).toHaveLength(0);expect((await snap(page)).msw.assets).toHaveLength(1);
});

test('native libass preview shows three independent tracks and uses the exact ASS export document',async({page},info)=>{
  await page.evaluate(()=>MSWFlatEditor.apply('Render fixture',p=>{let n=structuredClone(p);for(const [tid,text] of [['second','译文'],['note','ANNOTATION']]){n=MSWFlatSubtitles.addTrack(n,{...n.subtitles.tracks[0],id:tid,name:tid,layout:tid==='note'?'fixed':'auto',...(tid==='note'?{position:{x:.5,y:.12}}:{})});n=MSWFlatEditing.addCue(n,tid,tid+'-cue',100,1400,text);}return n;}));
  await page.evaluate(()=>{MSWFlatEditor.player.currentTime=.5;});await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status),{timeout:30000}).toBe('libass');
  await page.getByRole('button',{name:'字幕样式',exact:true}).click();await page.locator('#flat-style-track').selectOption('note');await page.locator('#flat-style-size').fill('60');await page.getByRole('button',{name:'应用样式',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 ASS',exact:true}).click();const ass=readFileSync(await(await download).path(),'utf8');for(const text of ['Hello world','译文','ANNOTATION'])expect(ass).toContain(text);
  const payload=await page.evaluate(()=>MSWFlatServices.request('subtitle-preview',{project:MSWFlatEditor.snapshot(),target:'both',video:{width:640,height:360}}));expect(ass).toBe(payload.ass);expect(payload.geometry).toHaveLength(4);
  await page.locator('#flat-style-panel').getByRole('button',{name:'关闭',exact:true}).click();await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.pending)).toBe(false);await page.screenshot({path:info.outputPath('flat-native-render.png')});
  await page.getByRole('button',{name:'字幕样式',exact:true}).click();await page.setViewportSize({width:620,height:800});expect(await page.locator('#flat-style-panel').evaluate(n=>n.scrollWidth-n.clientWidth)).toBeLessThanOrEqual(2);
  await page.screenshot({path:info.outputPath('flat-style-panel.png')});
});

test('native video export burns all enabled tracks with the same layout and defaults to keeping gaps',async({page},info)=>{
  await page.evaluate(()=>MSWFlatEditor.apply('Burn fixture',p=>{let n=structuredClone(p);n.preview||={};n.preview.project_style=MSWProjectStyle.normalize({...MSWProjectStyle.defaults(),main:{fontSize:80}});n.subtitles.tracks[0].style={mode:'inherit',slot:'main',base:'dialogue'};n=MSWFlatSubtitles.addTrack(n,{...n.subtitles.tracks[0],id:'burn-note',name:'注释',layout:'fixed',position:{x:.5,y:.1}});return MSWFlatEditing.addCue(n,'burn-note','note-cue',100,1400,'TOP NOTE');}));
  await page.getByRole('button',{name:'导出',exact:true}).click();const panel=page.locator('#flat-export-panel');await expect(panel.getByLabel('跳过空隙')).not.toBeChecked();await panel.getByLabel('视频编码').selectOption('h264');await page.screenshot({path:info.outputPath('flat-export-panel.png')});await page.locator('#flat-export-start').click();
  const card=panel.locator('.flat-job').first();await expect(card).toContainText('已完成',{timeout:30000});const download=page.waitForEvent('download');await card.getByRole('button',{name:'下载文件'}).click();const artifact=await download;expect(artifact.suggestedFilename()).toBe('initial_MSW.mp4');
  const output=await artifact.path();const probe=JSON.parse(execFileSync(join(process.env.FFMPEG_PATH,'ffprobe.exe'),['-v','error','-show_streams','-of','json',output],{encoding:'utf8'}));expect(probe.streams.some(s=>s.codec_type==='video')).toBe(true);expect(probe.streams.some(s=>s.codec_type==='audio')).toBe(true);
  const frame=execFileSync(join(process.env.FFMPEG_PATH,'ffmpeg.exe'),['-v','error','-ss','0.5','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);let top=0,bottom=0;for(let i=0;i<frame.length;i+=3)if(frame[i]>150&&frame[i+1]>150&&frame[i+2]>150){if(i<640*180*3)top++;else bottom++;}expect(top).toBeGreaterThan(80);expect(bottom).toBeGreaterThan(80);
});

test('temporary audition cannot recognize or export the previous media; explicit import restores a registered waveform',async({page})=>{
  const before=await snap(page);await page.locator('#flat-media-file').setInputFiles(join(dir,'voice.wav'));
  await expect.poll(()=>page.evaluate(()=>MSWFlatServices.media)).toBeNull();expect((await snap(page)).media).toBe(before.media);
  await page.getByRole('button',{name:'导出',exact:true}).click();await page.locator('#flat-export-start').click();await expect(page.locator('#flat-message')).toContainText('临时试听');
  await page.locator('#flat-export-panel').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('#flat-trial-bar').getByRole('button',{name:'导入媒体',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>MSWFlatServices.media?.metadata.duration_ms)).toBe(3000);await expect.poll(async()=>!!(await snap(page)).waveform,{timeout:20000}).toBe(true);
  await open(page,'asr');await expect(page.locator('#flat-processing-panel')).toContainText('source.mp4');await page.locator('#flat-processing-kind').focus();await page.keyboard.press('Escape');await expect(page.locator('#flat-processing-panel')).not.toBeVisible();
});
