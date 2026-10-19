import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer,toggleMediaSettings} from './helpers.mjs';
let server,folder,errors;
test.beforeEach(async({page})=>{
  folder=makeTempDir('subtitle-animation');
  process.env.MSW_APP_DATA_ROOT=join(folder,'settings');process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const video=join(folder,'video.mp4'),project=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media:video,segments:[{id:'a',start:0,end:2500,text:'First subtitle'},{id:'b',start:3000,end:6000,text:'Second subtitle'}],multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[{id:'c',start:0,end:2500,text:'Translation'}]}],bindings:[{id:'binding',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['c']}]},waveform:generateWaveformPayload(6000)}));
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,selectBoundSubtitlePair:false,subtitleAvoidControls:false})));
  errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(project,video,await findFreePort());await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready),{timeout:30000}).toBe(true);
  await page.evaluate(()=>{player.currentTime=1;overlayToggle.checked=true;extensionOverlayToggle.checked=true;selectOnly(0);MSWSubtitleStyle.open('cue');MSWSubtitleRenderer.invalidate();});
  await idle(page);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();expect(errors).toEqual([]);});
async function idle(page){await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&MSWPreviewControls.settled),{timeout:30000}).toBe(true);}
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
async function field(page,name,value){await page.locator('#style-field-'+name).fill(String(value));await page.locator('#style-field-'+name).blur();await idle(page);}

async function effect(page,name,key,value){const node=page.locator('#motion-'+name+'-'+key);if(typeof value==='boolean')await node.setChecked(value);else if(key==='unit'||key==='easing')await node.selectOption(value);else {await node.fill(String(value));await node.blur();}await idle(page);}

test('track animation is role-specific; cues override only the edited effect with undo and reload',async({page})=>{
  await page.evaluate(()=>MSWSubtitleStyle.open('track'));
  await page.locator('#style-animation').evaluate(el=>el.open=true);
  await effect(page,'fade','enabled',true);await effect(page,'fade','unit','ms');await effect(page,'fade','in',400);
  const trackSet=await snap(page),main=trackSet.subtitles.tracks[0],secondary=trackSet.subtitles.tracks[1];
  expect(main.style.value.main.animation.effects.fade.in).toBe(400);expect(secondary.style.value?.secondary.animation).toBeUndefined();
  await page.locator('#style-edit-scope').selectOption('cue');await expect(page.locator('#motion-fade-enabled')).toBeChecked();
  await effect(page,'fade','enabled',false);await effect(page,'typewriter','enabled',true);
  let p=await snap(page);expect(Object.keys(p.subtitles.cues[0].content.subtitle_animation.effects)).toEqual(['fade','typewriter']);
  expect(p.subtitles.cues.find(c=>c.content.text==='Translation').content.subtitle_animation).toBeUndefined();
  await page.evaluate(()=>performUndo());await idle(page);expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.typewriter).toBeUndefined();
  await page.evaluate(()=>performRedo());await idle(page);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);const saved=await snap(page);
  await page.reload();await idle(page);expect((await snap(page)).subtitles).toEqual(saved.subtitles);
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});await page.locator('#style-animation').evaluate(el=>el.open=true);
  await page.locator('#motion-inherit').click();await idle(page);await expect(page.locator('#motion-fade-enabled')).toBeChecked();
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation).toBeUndefined();
});

test('cross-track selections preserve mixed effects and reject locked targets atomically',async({page})=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);await effect(page,'fade','enabled',true);
  await page.evaluate(()=>addExtensionToSelection(0));await expect(page.locator('#motion-fade-enabled')).toHaveJSProperty('indeterminate',true);
  await effect(page,'blink','enabled',true);await effect(page,'blink','period',800);
  const p=await snap(page),a=p.subtitles.cues[0],b=p.subtitles.cues.find(c=>c.content.text==='Translation');
  expect(a.content.subtitle_animation.effects.fade.enabled).toBe(true);expect(b.content.subtitle_animation.effects.fade).toBeUndefined();
  expect(b.content.subtitle_animation.effects.blink.period).toBe(800);expect(a.content.subtitle_animation.effects.blink.period).toBe(800);
  await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks[1].locked=true;productionCommitProject(p,'lock',[p.subtitles.cues[0].id,p.subtitles.cues.find(c=>c.content.text==='Translation').id]);});
  await expect(page.locator('#motion-blink-period')).toBeDisabled();
});

test('animation controls remain compact in a narrow dock and unit changes preserve duration',async({page},info)=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);await effect(page,'transform','enabled',true);
  await effect(page,'transform','unit','ms');await expect(page.locator('#motion-transform-end')).toHaveValue('625');
  await effect(page,'transform','unit','percent');await expect(page.locator('#motion-transform-end')).toHaveValue('25');
  await page.evaluate(()=>Object.assign(document.getElementById('subtitle-properties').style,{position:'fixed',top:'30px',left:'10px',width:'300px',height:'730px',zIndex:'60'}));
  await page.locator('#style-animation').scrollIntoViewIfNeeded();
  expect(await page.locator('#subtitle-properties-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('animation-controls.png')});
});

test('typewriter keeps the first glyph fixed; mid-animation seek and ASS burn use identical frames',async({page},info)=>{
  await field(page,'fontSize',96);await field(page,'primaryColor','#ff0000');
  await page.locator('#style-animation').evaluate(el=>el.open=true);await effect(page,'typewriter','enabled',true);await effect(page,'typewriter','end',100);
  await page.evaluate(()=>waveformEditor.activateModuleTab('panel'));await idle(page);
  const payload=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),target:'both',video:{width:640,height:360}}));
  writeFileSync(join(folder,'animated.ass'),payload.ass);
  const canvas=page.locator('.JASSUB'),box=await canvas.boundingBox(),shots=[];
  for(const [i,time] of [0.4,1.7,0.4].entries()){
    await page.evaluate(async t=>{player.currentTime=t;await new Promise(resolve=>player.addEventListener('seeked',resolve,{once:true}));await MSWSubtitleRenderer.repaint();},time);
    const preview=join(folder,`preview-${i}.png`),burn=join(folder,`burn-${i}.png`);await canvas.screenshot({path:preview});
    execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-i','video.mp4','-ss',String(time),'-vf',`ass=animated.ass,scale=${Math.round(box.width)}:${Math.round(box.height)}`,'-frames:v','1',burn],{cwd:folder,windowsHide:true});shots.push(preview,burn);
  }
  const bounds=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image
import json,sys
def bounds(p):
 im=Image.open(p).convert('RGB')
 pts=[(x,y) for y in range(im.height) for x in range(im.width) if (lambda c:c[0]>80 and c[0]>c[1]*2 and c[0]>c[2]*2)(im.getpixel((x,y)))]
 return [len(pts),min(x for x,y in pts),max(x for x,y in pts),min(y for x,y in pts),max(y for x,y in pts)]
print(json.dumps([bounds(p) for p in sys.argv[1:]]))`,...shots],{encoding:'utf8',windowsHide:true}));
  expect(bounds[2][0]).toBeGreaterThan(bounds[0][0]*2);
  expect(Math.abs(bounds[0][1]-bounds[2][1])).toBeLessThan(3);expect(bounds[0]).toEqual(bounds[4]);
  for(let i=0;i<bounds.length;i+=2)for(let k=1;k<5;k++)expect(Math.abs(bounds[i][k]-bounds[i+1][k])).toBeLessThan(3);
  await page.screenshot({path:info.outputPath('typewriter-preview.png')});
});

test('combined effects render the same source state after trimming and removing a gap',async({page})=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);
  for(const name of ['fade','typewriter','blink','transform'])await effect(page,name,'enabled',true);
  await effect(page,'blink','opacity',40);await effect(page,'transform','end',100);await effect(page,'transform','fromX',-80);await effect(page,'transform','toRotation',12);
  const p=await snap(page),script=`import json,sys
from pathlib import Path
from maw.msw.subtitle_style import styled_ass
p=json.loads(sys.argv[1]);folder=Path(sys.argv[2]);video=dict(width=640,height=360)
plan=dict(intervals=[dict(start_ms=0,end_ms=6000,output_start_ms=0)])
(folder/'full.ass').write_text(styled_ass(p,plan,'both',video),encoding='utf-8')
(folder/'clip.ass').write_text(styled_ass(p,plan,'both',video,start_ms=1000),encoding='utf-8')
gap=dict(intervals=[dict(start_ms=0,end_ms=500,output_start_ms=0),dict(start_ms=1000,end_ms=6000,output_start_ms=500)])
(folder/'gap.ass').write_text(styled_ass(p,gap,'both',video),encoding='utf-8')`;
  execFileSync(process.env.MSW_E2E_PYTHON,['-c',script,JSON.stringify(p),folder],{windowsHide:true});
  const files=[];for(const [name,time] of [['full',1.68],['clip',.68],['gap',1.18]]){
    const file=join(folder,name+'.png');files.push(file);
    execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-i','video.mp4','-ss',String(time),'-vf',`ass=${name}.ass`,'-frames:v','1',file],{cwd:folder,windowsHide:true});
  }
  const differences=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image,ImageChops,ImageStat
import sys,json
imgs=[Image.open(p).convert('RGB') for p in sys.argv[1:]]
print(json.dumps([max(ImageStat.Stat(ImageChops.difference(imgs[0],x)).mean) for x in imgs[1:]]))`,...files],{encoding:'utf8',windowsHide:true}));
  for(const delta of differences)expect(delta).toBeLessThan(.4);
});

test('extending the first ASS event to zero preserves its later animation clock',async({page})=>{
  const files=await page.evaluate(async()=>{
    const p=JSON.parse(buildJson()),cue=p.subtitles.cues[0];
    p.subtitles.cues=[cue];p.subtitles.bindings=[];cue.content.start=1000;cue.content.end=5000;
    const motion=MSWSubtitleAnimation.defaults();
    Object.assign(motion.effects.transform,{enabled:true,end:100,easing:'linear',fromX:-80,toX:80,fromScale:70,toScale:120});
    cue.content.subtitle_animation=motion;productionCommitProject(p,'animation',[cue.id]);
    updateEditorSettings({exportStartAtZero:false});const original=await fixedAssDocument('both');
    updateEditorSettings({exportStartAtZero:true});const extended=await fixedAssDocument('both');
    return {original,extended};
  });
  expect(files.extended).toContain('Dialogue: 0,0:00:00.00,');
  const images=[];
  for(const [name,ass] of Object.entries(files)){
    writeFileSync(join(folder,name+'.ass'),ass);
    for(const time of [1.08,3]){
      const output=join(folder,`${name}-${time}.png`);images.push(output);
      execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-i','video.mp4','-ss',String(time),'-vf',`ass=${name}.ass`,'-frames:v','1',output],{cwd:folder,windowsHide:true});
    }
  }
  const differences=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image,ImageChops,ImageStat
import sys,json
images=[Image.open(p).convert('RGB') for p in sys.argv[1:]]
print(json.dumps([max(ImageStat.Stat(ImageChops.difference(images[i],images[i+2])).mean) for i in (0,1)]))`,...images],{encoding:'utf8',windowsHide:true}));
  for(const difference of differences)expect(difference).toBeLessThan(.05);
});
