import {expect,test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
let server,folder,path;
test.beforeEach(async({page})=>{
  folder=makeTempDir('fixed-track-flow');path=join(folder,'project.mosp');
  const media=join(folder,'video.mp4');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=6','-f','lavfi','-i','sine=frequency=220:duration=6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',media],{windowsHide:true});
  writeFileSync(path,JSON.stringify({schema:'msw.project.v2',media:'video.mp4',segments:[{id:'a',start:0,end:5000,text:'Dialogue sample'},{id:'b',start:500,end:4000,text:'Annotation sample'}],subtitle_layers:{schema:'msw.subtitle_layers.v1',allow_overlap:true,legacy_overlay:{visible:true,cue_ids:[]}},waveform:generateWaveformPayload(6000)}));
  process.env.MAW_ENV_FILE=join(folder,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(folder,'app-data');
  server=await startServer(path,media,await findFreePort());
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url);await page.waitForFunction(()=>MSWSubtitleStyle.ready&&player.readyState>=2);
  await page.evaluate(()=>{
    fixedSetPresentation('fixed');const id=fixedTrack(DATA.segments.find(c=>c.id==='b')).id;
    fixedUpdateTrack(id,{kind:'annotation',position:{x:.3,y:.15}});
    const style=MSWProjectStyle.defaults();style.main.primaryColor='#ff0000';MSWE.resolve('processing-host').commitProjectStyle(style);
    overlayToggle.checked=true;extensionOverlayToggle.checked=true;player.currentTime=1;player.pause();
    window.MSWSubtitleRenderer.invalidate();
  });
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();});

test('default fixed model applies processing atomically, preserves annotations, saves and reopens',async({page})=>{
  await page.waitForFunction(()=>MSWE.resolve('media').current?.metadata?.audio_tracks?.length,{},{timeout:45000});
  const result=await page.evaluate(()=>{
    const host=MSWE.resolve('processing-host'),media=MSWE.resolve('media').current,owner=fixedTrack(DATA.segments.find(c=>c.id==='a')).id;
    const snapshot=MSWAsr.snapshot(DATA,media,'whole',null,owner);
    const job={kind:'asr',id:'job-flow',project_id:DATA.msw.project_id,created_at:1,status:'succeeded',snapshot,result:{segments:[{id:'raw',start:0,end:5000,text:'Recognized synthetic speech'}]}};
    MSWResults.register(DATA.msw,[job]);host.applyProcessing([job],'main',null,media);
    const source=DATA.segments.find(c=>c.text==='Recognized synthetic speech');
    const tr={kind:'translation',id:'translation-flow',project_id:DATA.msw.project_id,created_at:2,status:'succeeded',snapshot:MSWTranslation.snapshot(DATA,{mainIds:[source.id],hasSelection:true}),result:{translations:[{id:source.id,text:'合成字幕译文'}],language:'zh'}};
    MSWResults.register(DATA.msw,[tr]);const undo=editorHistory.undoLength();host.applyProcessing([tr],'secondary');
    const tts=MSWTts.snapshot(DATA,{mainIds:['b'],hasSelection:true});
    return {schema:DATA.schema,owner:fixedTrack(DATA.segments.find(c=>c.id===source.id)).id,expected:owner,undo:editorHistory.undoLength()-undo,annotation:DATA.segments.find(c=>c.id==='b').text,tts:tts.entries[0].id,bindings:DATA.multi_subtitle.bindings.length};
  });
  expect(result.schema).toBe('msw.project.v3');expect(result.owner).toBe(result.expected);expect(result.undo).toBe(1);expect(result.annotation).toBe('Annotation sample');expect(result.tts).toBe('b');expect(result.bindings).toBe(1);
  await page.evaluate(()=>saveCurrentProject());
  await expect.poll(()=>JSON.parse(readFileSync(path,'utf8')).schema).toBe('msw.project.v3');
  expect(readdirSync(folder).filter(n=>n.startsWith('.msw-tracks-backup-'))).toHaveLength(1);
  const saved=await page.evaluate(()=>JSON.parse(buildJson()).subtitle_tracks);
  await page.reload();await page.waitForFunction(()=>MSWSubtitleStyle.ready);
  expect(await page.evaluate(()=>JSON.parse(buildJson()).subtitle_tracks)).toEqual(saved);
});

test('browser libass and downloaded ASS match actual FFmpeg with fixed annotations',async({page},info)=>{
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending),{timeout:45000}).toBe(true);
  await page.evaluate(()=>MSWSubtitleRenderer.repaint());
  const ass=await page.evaluate(()=>buildAss());expect(ass).toContain('Annotation sample');expect(ass).toContain('\\pos(');
  writeFileSync(join(folder,'compare.ass'),ass);
  const png=info.outputPath('browser-fixed.png');await page.locator('.JASSUB').screenshot({path:png});
  const box=await page.locator('.JASSUB').boundingBox(),ref=info.outputPath('burn-fixed.png');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=2','-ss','1','-vf',`ass=compare.ass,scale=${Math.round(box.width)}:${Math.round(box.height)}`,'-frames:v','1',ref],{cwd:folder,windowsHide:true});
  const comparison=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image
import sys,json
def mask(path):
 im=Image.open(path).convert('RGB');return {(x,y) for y in range(im.height) for x in range(im.width) if (lambda c:c[0]>80 and c[0]>2*c[1] and c[0]>2*c[2])(im.getpixel((x,y)))}
a,b=mask(sys.argv[1]),mask(sys.argv[2]);print(json.dumps({'pixels':len(a),'iou':len(a&b)/max(1,len(a|b))}))`,png,ref],{encoding:'utf8',windowsHide:true}));
  expect(comparison.pixels).toBeGreaterThan(50);expect(comparison.iou).toBeGreaterThan(.5);
  await page.locator('.player-stage').screenshot({path:info.outputPath('player-fixed.png')});
  expect(await page.evaluate(()=>getComputedStyle(document.querySelector('#fixed-subtitle-preview')).visibility)).toBe('hidden');
});

test('SRT scope excludes annotations by default and explicitly includes a selected track',async({page})=>{
  expect(await page.evaluate(()=>buildSrt())).toContain('Dialogue sample');
  expect(await page.evaluate(()=>buildSrt())).not.toContain('Annotation sample');
  await page.evaluate(()=>{fixedSrtAnnotations=true;fixedSrtScope=fixedTrack(DATA.segments.find(c=>c.id==='b')).id;});
  const text=await page.evaluate(()=>buildSrt());expect(text).toContain('Annotation sample');expect(text).not.toContain('Dialogue sample');
  expect(await page.evaluate(()=>buildAss())).toContain('Dialogue sample');
});

test('new projects default to fixed layout while existing empty projects retain legacy layout',async({page})=>{
  expect(await page.evaluate(()=>prepareLayerProject(buildBlankProject()).subtitle_tracks.presentation)).toBe('fixed');
  expect(await page.evaluate(()=>prepareLayerProject({schema:'moy.asr.project.v1',segments:[]}).subtitle_tracks.presentation)).toBe('legacy');
  expect(await page.evaluate(()=>MSWE.resolve('processing-host').audioExportPreview().subtitle_tracks.schema)).toBe('msw.subtitle_tracks.v1');
  const result=await page.evaluate(async()=>{
    const p=MSWProjectStyle.presetSnapshot(DATA,MSWProjectStyle.defaults());p.annotation.main.fontSize=29;
    MSWE.resolve('processing-host').commitProjectStyle(p);
    return (await buildAss()).includes(',29,');
  });expect(result).toBe(true);
});
