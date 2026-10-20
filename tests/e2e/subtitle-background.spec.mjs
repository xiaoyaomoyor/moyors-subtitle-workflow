import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer,toggleMediaSettings} from './helpers.mjs';
let server,folder,errors;
test.beforeEach(async({page})=>{
  folder=makeTempDir('subtitle-background');
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

async function openBackground(page) {
  await page.locator('#style-more').evaluate(el=>el.open=true);
  await page.locator('#style-background').evaluate(el=>el.open=true);
}
test('backgrounds inherit per field, support cross-track edits, undo and saving',async({page},info)=>{
  await page.evaluate(()=>MSWSubtitleStyle.open('track'));await openBackground(page);
  await page.locator('#style-field-backgroundShape').selectOption('rounded');await idle(page);
  await field(page,'backgroundPaddingX',30);
  await page.locator('#style-edit-scope').selectOption('cue');
  await expect(page.locator('#style-field-backgroundShape')).toHaveValue('rounded');
  await field(page,'backgroundColor','#882244');
  let p=await snap(page);expect(p.subtitles.cues[0].content.subtitle_style).toEqual({backgroundColor:'#882244'});
  await page.evaluate(()=>addExtensionToSelection(0));
  await expect(page.locator('#style-field-backgroundShape')).toHaveValue('');
  await page.locator('#style-field-backgroundShape').selectOption('rect');await idle(page);
  p=await snap(page);const secondary=p.subtitles.cues.find(c=>c.content.text==='Translation');
  expect(secondary.content.subtitle_style).toEqual({backgroundShape:'rect'});
  expect(p.subtitles.cues[0].content.subtitle_style).toEqual({backgroundColor:'#882244',backgroundShape:'rect'});
  await page.evaluate(()=>performUndo());await idle(page);
  expect((await snap(page)).subtitles.cues.find(c=>c.content.text==='Translation').content.subtitle_style).toBeUndefined();
  await page.evaluate(()=>performRedo());await idle(page);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);const saved=await snap(page);
  await page.reload();await idle(page);expect((await snap(page)).subtitles).toEqual(saved.subtitles);
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});await openBackground(page);
  await page.locator('[data-reset-style=backgroundShape]').click();await idle(page);
  await expect(page.locator('#style-field-backgroundShape')).toHaveValue('rounded');
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('Rounded test');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-message')).toContainText('预设已保存');
  const preset=await page.locator('#style-project-preset').inputValue();
  await page.locator('#style-field-backgroundShape').selectOption('none');await idle(page);
  await page.locator('#style-project-preset').selectOption(preset);await idle(page);
  await expect(page.locator('#style-field-backgroundShape')).toHaveValue('rounded');
  await page.evaluate(()=>Object.assign(document.getElementById('subtitle-properties').style,{position:'fixed',top:'30px',left:'10px',width:'310px',height:'730px',zIndex:'60'}));
  await page.locator('#style-background').scrollIntoViewIfNeeded();
  expect(await page.locator('#subtitle-properties-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('background-controls.png')});
});

test('picker reads the original paused frame, supports cancel and undo, ignores UI',async({page},info)=>{
  await openBackground(page);await page.locator('#style-field-backgroundShape').selectOption('rect');await idle(page);
  await field(page,'backgroundColor','#ff0000');await field(page,'backgroundOpacity',100);
  const before=await snap(page);
  await page.locator('#style-pick-backgroundColor').click();
  await expect(page.locator('.msw-video-color-picker')).toBeVisible();
  expect(await page.evaluate(()=>player.paused)).toBe(true);
  await page.keyboard.press('Escape');await expect(page.locator('.msw-video-color-picker')).toHaveCount(0);
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.locator('#style-pick-backgroundColor').click();
  const point=await page.evaluate(()=>{
    const b=fixedVideoRect(),r=fixedPreviewLayout().layout.entries.find(e=>e.cue_id===DATA.segments[0].id);return {x:b.clientLeft+(r.x+r.width/2)*b.height/1080,y:b.clientTop+(r.y+r.height/2)*b.height/1080};
  });
  await page.mouse.move(point.x,point.y);
  await page.locator('.msw-video-color-picker').screenshot({path:info.outputPath('video-picker.png')});
  await page.mouse.click(point.x,point.y);await idle(page);
  const hex=await page.locator('#style-field-backgroundColor').inputValue();
  expect(parseInt(hex.slice(1,3),16)).toBeLessThan(5);
  expect(parseInt(hex.slice(5,7),16)).toBeGreaterThan(120);
  await page.evaluate(()=>performUndo());await idle(page);
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(()=>selectOnly(0));
  await page.locator('#style-pick-primaryColor').scrollIntoViewIfNeeded();
  await page.locator('#style-pick-primaryColor').click();
  await page.evaluate(()=>selectOnly(1));
  await expect(page.locator('.msw-video-color-picker')).toHaveCount(0);
  expect((await snap(page)).subtitles.cues[1].content.subtitle_style).toBeUndefined();
});

test('rounded multiline backdrop is stable during typing; ASS preview matches burned pixels',async({page},info)=>{
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),c=p.subtitles.cues[0];p.subtitles.cues=[c];p.subtitles.bindings=[];
    c.content.text='First line\nSecond line';c.content.start=0;c.content.end=6000;
    c.content.subtitle_style={fontSize:88,backgroundShape:'rounded',backgroundColor:'#ff0000',backgroundOpacity:100,backgroundPaddingX:30,backgroundPaddingY:20,backgroundRadius:35};
    c.content.subtitle_position={x:.5,y:.65,alignment:5};
    const a=MSWSubtitleAnimation.defaults();Object.assign(a.effects.typewriter,{enabled:true,end:100});
    c.content.subtitle_animation=a;productionCommitProject(p,'background',[c.id]);updateEditorSettings({exportStartAtZero:false});
    waveformEditor.closeDockModule('properties');
  });await idle(page);
  const ass=await page.evaluate(()=>fixedAssDocument('both'));writeFileSync(join(folder,'background.ass'),ass);
  const shots=[];
  for(const time of [.5,4]) {
    await page.evaluate(t=>{player.currentTime=t;refreshSubtitlePreview();},time);await idle(page);
    await page.waitForTimeout(150);
    const screen=join(folder,`preview-${time}.png`);shots.push(screen);
    const clip=await page.evaluate(()=>{const r=fixedVideoRect();return {x:r.clientLeft,y:r.clientTop,width:r.width,height:r.height};});
    await page.screenshot({path:screen,clip});
    const burned=join(folder,`burn-${time}.png`);shots.push(burned);
    execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-i','video.mp4','-ss',String(time),'-vf',`ass=background.ass,scale=${Math.round(clip.width)}:${Math.round(clip.height)}`,'-frames:v','1',burned],{cwd:folder,windowsHide:true});
  }
  const bounds=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image
import sys,json
def bounds(path):
 im=Image.open(path).convert('RGB')
 pts=[(x,y) for y in range(im.height) for x in range(im.width) if (lambda c:c[0]>160 and c[1]<60 and c[2]<60)(im.getpixel((x,y)))]
 return [min(x for x,y in pts),max(x for x,y in pts),min(y for x,y in pts),max(y for x,y in pts)]
print(json.dumps([bounds(p) for p in sys.argv[1:]]))`,...shots],{encoding:'utf8',windowsHide:true}));
  for(let k=0;k<4;k++){expect(Math.abs(bounds[0][k]-bounds[2][k])).toBeLessThan(2);expect(Math.abs(bounds[0][k]-bounds[1][k])).toBeLessThan(3);expect(Math.abs(bounds[2][k]-bounds[3][k])).toBeLessThan(3);}
  await page.screenshot({path:info.outputPath('rounded-preview.png')});
});

test('background transforms, trim and removed gaps keep the same source state',async({page})=>{
  const p=await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),c=p.subtitles.cues[0];p.subtitles.cues=[c];p.subtitles.bindings=[];
    c.content.end=6000;c.content.subtitle_style={backgroundShape:'rounded',backgroundColor:'#dd2233',backgroundOpacity:65};
    const a=MSWSubtitleAnimation.defaults();for(const n of ['fade','typewriter','blink','transform'])a.effects[n].enabled=true;
    Object.assign(a.effects.transform,{fromX:-80,toX:80,fromScale:60,toScale:120,toRotation:20,end:100});
    a.effects.blink.opacity=40;c.content.subtitle_animation=a;return p;
  });
  execFileSync(process.env.MSW_E2E_PYTHON,['-c',`import json,sys
from pathlib import Path
from maw.msw.subtitle_style import styled_ass
p=json.loads(sys.argv[1]);folder=Path(sys.argv[2]);v=dict(width=640,height=360)
plan=dict(intervals=[dict(start_ms=0,end_ms=6000,output_start_ms=0)])
(folder/'full.ass').write_text(styled_ass(p,plan,'both',v),encoding='utf-8')
(folder/'clip.ass').write_text(styled_ass(p,plan,'both',v,start_ms=1000),encoding='utf-8')
gap=dict(intervals=[dict(start_ms=0,end_ms=500,output_start_ms=0),dict(start_ms=1000,end_ms=6000,output_start_ms=500)])
(folder/'gap.ass').write_text(styled_ass(p,gap,'both',v),encoding='utf-8')`,JSON.stringify(p),folder],{windowsHide:true});
  const images=[];
  for(const [name,time] of [['full',1.68],['clip',.68],['gap',1.18]]) {
    const file=join(folder,name+'.png');images.push(file);
    execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-i','video.mp4','-ss',String(time),'-vf',`ass=${name}.ass`,'-frames:v','1',file],{cwd:folder,windowsHide:true});
  }
  const delta=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image,ImageChops,ImageStat
import sys,json
a=[Image.open(p).convert('RGB') for p in sys.argv[1:]]
print(json.dumps([max(ImageStat.Stat(ImageChops.difference(a[0],b)).mean) for b in a[1:]]))`,...images],{encoding:'utf8',windowsHide:true}));
  delta.forEach(d=>expect(d).toBeLessThan(.4));
});


test('extending background and text to zero preserves their later animation clock',async({page})=>{
  const files=await page.evaluate(async()=>{
    const p=JSON.parse(buildJson()),cue=p.subtitles.cues[0];
    p.subtitles.cues=[cue];p.subtitles.bindings=[];cue.content.start=1000;cue.content.end=5000;
    const motion=MSWSubtitleAnimation.defaults();
    Object.assign(motion.effects.transform,{enabled:true,end:100,easing:'linear',fromX:-80,toX:80,fromScale:70,toScale:120});
    cue.content.subtitle_style={backgroundShape:'rounded',backgroundColor:'#cc2233',backgroundOpacity:70};
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
