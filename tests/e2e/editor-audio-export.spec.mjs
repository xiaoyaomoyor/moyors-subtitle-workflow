import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {disableOnboarding,generateWav,generateWaveformPayload,makeTempDir,startServer,findFreePort,clickMenubarItem} from './helpers.mjs';

let server, dir, assetPath;
test.beforeEach(async ({page}) => {
  dir=makeTempDir('audio-export');
  process.env.MAW_ENV_FILE=join(dir,'isolated.env'); process.env.MSW_APP_DATA_ROOT=join(dir,'local');
  if (process.env.MSW_TEST_FFMPEG) process.env.FFMPEG_PATH=process.env.MSW_TEST_FFMPEG;
  const media=generateWav(join(dir,'media.wav'),4), id='audio-'+'a'.repeat(32);
  const path='msw-'+'b'.repeat(24)+'.assets/audio/'+id+'.wav';
  assetPath=join(dir,path); mkdirSync(dirname(assetPath),{recursive:true}); generateWav(assetPath,2);
  const data=readFileSync(assetPath);
  const asset={id,kind:'audio',path,sha256:createHash('sha256').update(data).digest('hex'),sample_rate:8000,channels:1,sample_count:16000,byte_size:data.length,
    job_id:'job',source_ref:{key:'cue',id:'cue',track_id:null,text:'Hello',start:1000,end:3000},
    generation:{provider:'bailian',model:'test',voice:'Cherry',language_type:'Auto',display_text:'Hello',spoken_text:'Hello'}};
  const project={media,segments:[{id:'cue',start:1000,end:3000,text:'Hello'}],waveform:generateWaveformPayload(4000),
    gap_remove:{schema:'moy.asr.gap_remove.v1',detector:'audio_gate',skip_playback:true,gaps:[{start:1500,end:2500,removed:true}]},
    msw:{schema:'msw.editor.v1',project_id:'audio-project',assets:[asset],audio_tracks:[{id:'voice',name:'配音',gain_db:0,muted:false}],
      audio_clips:[{id:'clip',asset_id:id,track_id:'voice',start_ms:1000,source_in_sample:0,source_out_sample:16000,playback_rate:1,gain_db:0,muted:false,label:'Hello'}],
      audio_settings:{gap_policy:'protect'}}};
  const projectPath=join(dir,'project.mosp'); writeFileSync(projectPath,JSON.stringify(project));
  await disableOnboarding(page); page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(projectPath,media,await findFreePort()); await page.goto(server.url);
  await expect(page.locator('#editor-loading')).not.toBeVisible();
  await expect(page.locator('.msw-audio-clip').first()).toBeVisible();
});
test.afterEach(async()=>{await server?.stop();server=null;});

async function open(page) {
  await clickMenubarItem(page,'文件','audio-export-btn');
  await expect(page.locator('#audio-export-panel')).toBeVisible();
  await expect(page.locator('#audio-export-start')).toBeEnabled();
}
async function finish(page) {
  await page.locator('#audio-export-start').click();
  const card=page.locator('#audio-export-jobs .msw-processing-job').first();
  await expect(card.getByRole('button',{name:'下载 WAV',exact:true})).toBeVisible({timeout:30000});
  return card;
}
async function download(page,card,name) {
  const ready=page.waitForEvent('download'); await card.getByRole('button',{name:'下载 WAV',exact:true}).click();
  const file=await ready, path=join(dir,name); await file.saveAs(path);
  const data=readFileSync(path); let format, samples;
  for(let pos=12;pos+8<=data.length;) {
    const size=data.readUInt32LE(pos+4), kind=data.toString('ascii',pos,pos+4);
    if(kind==='fmt ') format={channels:data.readUInt16LE(pos+10),rate:data.readUInt32LE(pos+12),bits:data.readUInt16LE(pos+22)};
    if(kind==='data') samples=data.subarray(pos+8,pos+8+size);
    pos+=8+size+(size%2);
  }
  expect(format.bits).toBe(16); expect(format.channels).toBe(2);
  return {format,frames:samples.length/4,at:sec=>samples.readInt16LE(Math.round(sec*format.rate)*4)};
}

test('voice export uses a snapshot and downloads a WAV while editing remains available',async({page})=>{
  await open(page);
  await expect(page.locator('#audio-export-summary')).toContainText('4.000 s');
  let release, submitted, fulfilled; const gate=new Promise(r=>release=r), seen=new Promise(r=>submitted=r), handled=new Promise(r=>fulfilled=r);
  await page.route('**/api/msw/audio-exports',async route=>{
    if(route.request().method()!=='POST') return route.continue();
    const response=await route.fetch(); submitted(); await gate; await route.fulfill({response}); fulfilled();
  });
  await page.locator('#audio-export-start').click(); await seen;
  await page.locator('#audio-export-close').click();
  await page.evaluate(()=>window.MSWE.resolve('processing-host').commitAudio('Move after submission',ext=>{ext.audio_clips[0].start_ms=2000;}));
  await expect(page.locator('.msw-audio-clip').first()).toBeVisible(); release(); await handled;
  await page.unroute('**/api/msw/audio-exports');
  await clickMenubarItem(page,'文件','audio-export-btn');
  const card=page.locator('#audio-export-jobs .msw-processing-job').first();
  await expect(card.getByRole('button',{name:'下载 WAV',exact:true})).toBeVisible();
  const wav=await download(page,card,'voice.wav'); expect(wav.frames).toBe(4*48000); expect(wav.at(.5)).toBe(0); expect(wav.at(1.2)).not.toBe(0);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'d1-audio-export.png')});
  await page.reload(); await open(page);
  await expect(page.locator('#audio-export-jobs')).toContainText('先前的工程快照');
});

test('mixed WAV includes original audio independently from muted monitoring',async({page})=>{
  await open(page); await page.locator('#audio-export-mode').selectOption('mix');
  await expect(page.locator('#audio-export-source')).toBeVisible();
  await page.evaluate(()=>{player.muted=true;player.volume=0;});
  const card=await finish(page), wav=await download(page,card,'mix.wav');
  expect(wav.frames).toBe(4*48000); expect(wav.at(.3)).not.toBe(0);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'d2-mix-export.png')});
});

test('follow gaps and custom source range match the downloaded output length',async({page})=>{
  await page.evaluate(()=>window.MSWE.resolve('processing-host').commitAudio('Follow gaps',ext=>{ext.audio_settings.gap_policy='follow';}));
  await open(page); await page.locator('#audio-export-rate').selectOption('44100');
  await page.locator('#audio-export-range').selectOption('custom');
  await page.locator('#audio-export-start-time').fill('0.5'); await page.locator('#audio-export-end-time').fill('3.5');
  await expect(page.locator('#audio-export-summary')).toContainText('2.000 s');
  const wav=await download(page,await finish(page),'follow.wav'); expect(wav.frames).toBe(2*44100);
  await page.locator('#audio-export-start-time').fill('4'); await expect(page.locator('#audio-export-start')).toBeDisabled();
});

test('missing used audio produces an explicit failed task with no download',async({page})=>{
  await open(page); unlinkSync(assetPath); await page.locator('#audio-export-start').click();
  const card=page.locator('#audio-export-jobs .msw-processing-job').first();
  await expect(card).toContainText('导出失败',{timeout:15000});
  await expect(card.locator('.is-error')).toBeVisible();
  await expect(card.getByRole('button',{name:'下载 WAV',exact:true})).toHaveCount(0);
});

test('old server gives an actionable restart hint instead of enabling export',async({page})=>{
  await page.route('**/api/msw/audio-export-context?*',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({ok:false,error:'任务或接口不存在'})}));
  await clickMenubarItem(page,'文件','audio-export-btn');
  await expect(page.locator('#audio-export-message')).toContainText('重启本机编辑器服务');
  await expect(page.locator('#audio-export-start')).toBeDisabled();
});

test('export panel fits a small viewport and scrolls expanded options',async({page})=>{
  await page.setViewportSize({width:900,height:600}); await open(page);
  await page.locator('#audio-export-mode').selectOption('mix');
  await page.locator('#audio-export-range').selectOption('custom');
  await expect.poll(()=>page.locator('#audio-export-panel').evaluate(panel=>{
    const r=panel.getBoundingClientRect(); return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
  })).toBe(true);
  await page.locator('#audio-export-start').scrollIntoViewIfNeeded();
  await expect(page.locator('#audio-export-start')).toBeVisible();
});
