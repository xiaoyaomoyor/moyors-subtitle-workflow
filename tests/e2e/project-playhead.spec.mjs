import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,generateWav,makeTempDir,startServer} from './helpers.mjs';

let server,dir,project;
test.setTimeout(90000);
test.beforeEach(async({page})=>{
  dir=makeTempDir('project-playhead');const media=join(dir,'video.mp4');project=join(dir,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(dir,'app');process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media,editor_state:{playhead_ms:2345,other:'keep'},segments:[{id:'a',start:0,end:6000,text:'Playhead'}],waveform:generateWaveformPayload(6000)}));
  server=await startServer(project,media,await findFreePort());
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2);
  await page.evaluate(()=>updateEditorSettings({autoSaveProject:false}));
});
test.afterEach(async()=>{await server?.stop();});

test('saved position restores paused; saving captures current position without making every seek dirty',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await expect.poll(()=>page.evaluate(()=>player.currentTime)).toBeCloseTo(2.345,2);
  expect(await page.evaluate(()=>player.paused)).toBe(true);
  await page.evaluate(()=>seekFromWaveform(4.125,{pauseAfterSeek:true}));
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  expect(JSON.parse(readFileSync(project)).editor_state).toEqual({playhead_ms:4125,other:'keep'});
  const before=await page.evaluate(()=>MSWE.resolve('persistence-host').draftFingerprint());
  await page.evaluate(()=>seekFromWaveform(3.25,{pauseAfterSeek:true}));
  const after=await page.evaluate(()=>({fingerprint:MSWE.resolve('persistence-host').draftFingerprint(),stored:JSON.parse(buildJson()).editor_state,dirty:projectImportDirty}));
  expect(after.fingerprint).toBe(before);expect(after.stored.playhead_ms).toBe(4125);expect(after.dirty).toBe(false);
  await page.reload();await page.waitForFunction(()=>player.readyState>=2);
  await expect.poll(()=>page.evaluate(()=>player.currentTime)).toBeCloseTo(4.125,2);
  expect(await page.evaluate(()=>player.paused)).toBe(true);expect(errors).toEqual([]);
});

test('navigation while saving does not invalidate saved content; file handles and recovery capture the clock',async({page})=>{
  await page.evaluate(()=>seekFromWaveform(1.375,{pauseAfterSeek:true}));
  await page.route('**/api/msw/project',async route=>{
    const response=await route.fetch();
    await page.evaluate(()=>seekFromWaveform(5.25,{pauseAfterSeek:true}));
    await route.fulfill({response});
  });
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  expect(JSON.parse(readFileSync(project)).editor_state.playhead_ms).toBe(1375);
  expect(await page.evaluate(()=>player.currentTime)).toBeCloseTo(5.25,2);
  expect(await page.evaluate(()=>projectImportDirty)).toBe(false);
  const handle=await page.evaluate(async()=>{
    seekFromWaveform(3.875,{pauseAfterSeek:true});
    let written;
    projectFileHandle={name:'copy.mosp',getFile:async()=>new File([buildJson()],'copy.mosp'),createWritable:async()=>({write:async blob=>{written=JSON.parse(await blob.text());},close:async()=>{}})};
    const saved=await saveProjectToHandle({silent:true});projectFileHandle=null;
    seekFromWaveform(4.5,{pauseAfterSeek:true});
    const host=MSWE.resolve('persistence-host');
    return {saved,written:written?.editor_state,saveAs:host.snapshot().editor_state,draft:host.draftSnapshot().editor_state};
  });
  expect(handle).toEqual({saved:true,written:{playhead_ms:3875,other:'keep'},saveAs:{playhead_ms:4500,other:'keep'},draft:{playhead_ms:4500,other:'keep'}});
});

test('loading another project resets pending restoration, clamps shortened media and respects a new seek',async({page})=>{
  const result=await page.evaluate(async()=>{
    const source=player.currentSrc,p=JSON.parse(buildJson());
    p.editor_state={playhead_ms:999999};applyCanonicalProject(p,'shortened.mosp');
    await loadMediaFile({name:'video.mp4',type:'video/mp4',url:source},{localOnly:true,previewOnly:true});
    await new Promise(resolve=>setTimeout(resolve,200));
    const clamped=player.currentTime,paused=player.paused;
    delete p.editor_state;applyCanonicalProject(p,'legacy.mosp');
    await loadMediaFile({name:'video.mp4',type:'video/mp4',url:source},{localOnly:true,previewOnly:true});
    const legacy=player.currentTime;
    p.editor_state={playhead_ms:4500};applyCanonicalProject(p,'later.mosp');
    seekFromWaveform(1.25,{pauseAfterSeek:true});
    await loadMediaFile({name:'video.mp4',type:'video/mp4',url:source},{localOnly:true,previewOnly:true});
    await new Promise(resolve=>setTimeout(resolve,200));
    return {clamped,paused,legacy,navigated:player.currentTime};
  });
  expect(result.clamped).toBeCloseTo(6,2);expect(result.paused).toBe(true);expect(result.legacy).toBe(0);expect(result.navigated).toBeCloseTo(1.25,2);
});

test('audio tail and audio-only timelines save and restore their virtual playhead',async({page})=>{
  const id='audio-'+'a'.repeat(32),path='msw-'+'b'.repeat(24)+'.assets/audio/'+id+'.wav';
  const assetPath=join(dir,path);mkdirSync(dirname(assetPath),{recursive:true});generateWav(assetPath,1);
  const bytes=readFileSync(assetPath),asset={id,kind:'audio',path,sha256:createHash('sha256').update(bytes).digest('hex'),sample_rate:8000,channels:1,sample_count:8000,byte_size:bytes.length,
    job_id:'job',source_ref:{key:'cue',id:'a',track_id:null,text:'Playhead',start:0,end:6000},
    generation:{provider:'bailian',model:'test',voice:'Cherry',language_type:'Auto',display_text:'Playhead',spoken_text:'Playhead'}};
  await page.evaluate(asset=>{
    MSWE.resolve('processing-host').commitAudio('Test audio tail',ext=>{
      ext.assets=[asset];ext.audio_tracks=[{id:'voice',name:'配音',gain_db:0,muted:false}];
      ext.audio_clips=[{id:'clip',asset_id:asset.id,track_id:'voice',start_ms:8000,source_in_sample:0,source_out_sample:8000,playback_rate:1,gain_db:0,muted:false,label:'Tail'}];
    });
    seekFromWaveform(8.5,{pauseAfterSeek:true});
  },asset);
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  expect(JSON.parse(readFileSync(project)).editor_state.playhead_ms).toBe(8500);
  await page.reload();await page.waitForFunction(()=>window.MSWE?.resolve('audio-timeline')?.currentTimeMs()===8500);
  expect(await page.evaluate(()=>MSWE.resolve('audio-timeline').virtualPlaying())).toBe(false);
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson());p.media='';applyCanonicalProject(p,'audio-only.mosp');
  });
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').currentTimeMs())).toBe(8500);
  expect(await page.evaluate(()=>MSWE.resolve('audio-timeline').virtualPlaying())).toBe(false);
});
