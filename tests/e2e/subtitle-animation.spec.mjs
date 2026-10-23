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

test('fixed keyframes anchor from cue end, preserve multi-selection, undo and saved timing',async({page},info)=>{
  await page.evaluate(()=>addToSelection(1));await page.locator('#style-animation').evaluate(el=>el.open=true);
  await page.locator('#motion-timing').selectOption('ms');await page.locator('#motion-custom').click();
  await frame(page,0,100);await frame(page,2.2,100);await frame(page,2.5,0);
  for(const index of [2,1]){
    await page.locator(`#curve-graph [data-point="${index}"]`).click({button:'right'});
    await page.locator('#ctxmenu .item').filter({hasText:/^终点前$/}).click();await idle(page);
  }
  await expect(page.locator('#curve-time-label')).toHaveText('终点前 (秒)');
  await page.locator('#curve-time').fill('0.400');await page.locator('#curve-time').blur();await idle(page);
  const saved=await snap(page),changed=saved.subtitles.cues.filter(c=>c.content.subtitle_animation);
  expect(changed).toHaveLength(2);
  for(const cue of changed){
    expect(cue.content.subtitle_animation).toMatchObject({timing:'ms',effects:{curves:{unit:'ms',channels:{opacity:[{time:0,anchor:'start'},{time:400,anchor:'end'},{time:0,anchor:'end'}]}}}});
  }
  await page.evaluate(()=>performUndo());await idle(page);expect((await snap(page)).subtitles).not.toEqual(saved.subtitles);
  await page.evaluate(()=>performRedo());await idle(page);expect((await snap(page)).subtitles).toEqual(saved.subtitles);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);await page.reload();await idle(page);
  expect((await snap(page)).subtitles).toEqual(saved.subtitles);
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});await page.locator('#style-animation').evaluate(el=>el.open=true);
  await page.locator('#curve-graph').scrollIntoViewIfNeeded();
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('anchored-curves.png')});
});

test('selected frame time edits in place, drag keeps guides, playhead creates a local frame',async({page})=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);await page.locator('#motion-custom').click();
  await frame(page,10,20);await frame(page,90,90);
  await page.locator('#curve-graph [data-point="0"]').click();
  await page.locator('#curve-time').fill('25');await page.locator('#curve-time').blur();await idle(page);
  let points=(await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.curves.channels.opacity;
  expect(points.map(p=>p.time)).toEqual([25,90]);
  await page.locator('#curve-value').fill('40');await page.locator('#curve-value').blur();await idle(page);
  const r=await page.locator('#curve-graph [data-point="0"]').boundingBox();
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+15,r.y+r.height/2-10);
  await expect(page.locator('.curve-crosshair')).toHaveAttribute('visibility','visible');
  await page.keyboard.press('Escape');await page.mouse.up();
  await page.evaluate(()=>{player.currentTime=1.25;});await idle(page);
  await page.locator('#curve-playhead').click();await idle(page);
  points=(await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.curves.channels.opacity;
  expect(points.map(p=>p.time)).toEqual([25,50,90]);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);await page.reload();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.curves.channels.opacity).toEqual(points);
});

test('fixed fades use equal seconds on different cue lengths; slide and stretch convert with typewriter',async({page},info)=>{
  await page.evaluate(()=>addToSelection(1));await page.locator('#style-animation').evaluate(el=>el.open=true);
  await page.locator('#motion-preset-fade').click();await page.locator('#motion-timing').selectOption('ms');
  await expect(page.locator('#motion-fade-timing,#motion-fade-durations')).toHaveCount(0);
  for(const [edge,key,count] of [[1,'ArrowRight',5],[2,'ArrowLeft',15]]){
    await page.locator(`#motion-fade-graph [data-edge="${edge}"]`).focus();
    for(let i=0;i<count;i++)await page.keyboard.press(key);
  }
  await idle(page);let p=await snap(page);
  for(const cue of p.subtitles.cues.filter(c=>['First subtitle','Second subtitle'].includes(c.content.text)))expect(cue.content.subtitle_animation.effects.fade).toEqual({enabled:true,unit:'ms',in:300,out:400,start:0,end:0,endAnchor:'end'});
  await page.evaluate(()=>selectOnly(0));
  for(const name of ['slide','transform','typewriter','blink'])await page.locator('#motion-preset-'+name).click();
  await page.locator('#motion-slide-direction').selectOption('up');await idle(page);
  p=await snap(page);const before=p.subtitles.cues[0].content.subtitle_animation;
  expect(before.effects.transform).toMatchObject({fromScale:100,toScale:115});
  await page.screenshot({path:info.outputPath('preset-blocks.png')});
  await page.locator('#motion-custom').click();await idle(page);
  await expect(page.locator('#motion-custom-typewriter')).toBeVisible();
  await expect(page.locator('#curve-pulse')).toBeVisible();
  const after=(await snap(page)).subtitles.cues[0].content.subtitle_animation;
  const difference=await page.evaluate(({before,after})=>{const A=MSWSubtitleAnimation,a=A.normalize(before),b=A.normalize(after);let max=0;for(let time=0;time<=2500;time+=31)for(const key of ['opacity','x','y','scale','revealed'])max=Math.max(max,Math.abs(A.sample(a,time,2500,12)[key]-A.sample(b,time,2500,12)[key]));return max;},{before,after});
  expect(difference).toBeLessThan(.002);
  await page.locator('#motion-custom-typewriter').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.typewriter.custom).toBe(false);
});

// Legacy effect fixtures exercise unchanged ASS rendering; new authoring uses
// presets and the parameter editor below.
async function effect(page,name,key,value){
  await page.evaluate(({name,key,value})=>{
    const p=JSON.parse(buildJson()),cue=p.subtitles.cues[0],a=MSWSubtitleAnimation.resolve(undefined,cue.content.subtitle_animation)||MSWSubtitleAnimation.defaults();
    a.effects[name][key]=value;cue.content.subtitle_animation=a;productionCommitProject(p,'legacy animation fixture',[cue.id]);
  },{name,key,value});await idle(page);
}
async function axis(page,label,value){
  if(label==='X 轴'){await page.locator('#motion-timing').selectOption(value==='时间百分比'?'percent':'ms');await idle(page);return;}
  await page.locator('#curve-graph').click({button:'right',position:{x:70,y:40}});
  await page.locator('#ctxmenu .ctx-submenu-toggle').filter({hasText:label}).hover();
  await page.locator('#ctxmenu .ctx-submenu.open .item').filter({hasText:new RegExp('^'+value+'$')}).click();
  await idle(page);
}
async function frame(page,time,value){
  await page.locator('#curve-graph').click({position:{x:15,y:12}});
  await page.locator('#curve-time').fill(String(time));await page.locator('#curve-time').blur();
  if(await page.locator('#curve-add').isDisabled()){const idx=await page.evaluate(time=>{const graph=document.getElementById('curve-graph');return [...graph.querySelectorAll('[data-point]')].findIndex(el=>el.getAttribute('aria-label').includes((document.getElementById('curve-time-label').textContent.includes('秒')?Number(time).toFixed(3)+' s':time+'%')+'，'));},time);if(idx>=0)await page.locator('#curve-graph [data-point="'+idx+'"]').click();}
  await page.locator('#curve-value').fill(String(value));await page.locator('#curve-value').blur();
  if(await page.locator('#curve-add').isEnabled())await page.locator('#curve-add').click();
  await idle(page);
}
async function rangeValue(page,id,value){
  const node=page.locator(id);await node.scrollIntoViewIfNeeded();
  const hit=await node.locator('rect').boundingBox(),graph=await node.locator('xpath=..').boundingBox(),max=Number(await node.getAttribute('aria-valuemax'));
  await page.keyboard.down('Control');
  await page.mouse.move(hit.x+hit.width/2,hit.y+hit.height/2);await page.mouse.down();
  await page.mouse.move(graph.x+26+(graph.width-52)*value/max,hit.y+hit.height/2,{steps:8});
  await page.mouse.up();await page.keyboard.up('Control');await idle(page);
}

test('preset toggles preserve parameters, interval dragging is atomic, and custom retains typewriter',async({page},info)=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);
  await page.locator('#motion-preset-fade').click();await idle(page);
  await expect(page.locator('#motion-fade-graph [data-edge]')).toHaveCount(4);
  await page.locator('#motion-preset-typewriter').click();await idle(page);
  const graph=page.locator('#motion-typewriter-graph');await graph.scrollIntoViewIfNeeded();
  const before=await snap(page),box=await graph.boundingBox(),x=box.x+26+(box.width-52)*.2,y=box.y+28;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y,{steps:8});
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.mouse.up();await idle(page);
  const shifted=(await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.typewriter;
  expect(shifted.start).toBeGreaterThan(0);expect(shifted.end-shifted.start).toBeCloseTo(40);
  await page.evaluate(()=>performUndo());await idle(page);expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(()=>performRedo());await idle(page);
  await page.locator('#motion-preset-typewriter').click();await page.locator('#motion-preset-typewriter').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.typewriter).toMatchObject(shifted);
  await page.locator('#motion-custom').click();await idle(page);await frame(page,0,70);
  await expect(page.locator('#motion-preset-typewriter')).toBeDisabled();
  expect(await page.evaluate(()=>{const a=MSWSubtitleAnimation.resolve(undefined,JSON.parse(buildJson()).subtitles.cues[0].content.subtitle_animation);return MSWSubtitleAnimation.sample(a,0,2500,10);})).toMatchObject({opacity:.7,revealed:0});
  await page.locator('#motion-custom').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.typewriter).toMatchObject(shifted);
  await page.locator('#motion-typewriter-reset').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.typewriter).toMatchObject({enabled:true,start:0,end:40});
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('animation-presets.png')});
});

test('track presets are role-specific, cues restore inheritance, and modes survive reload',async({page})=>{
  await page.evaluate(()=>MSWSubtitleStyle.open('track'));await page.locator('#style-animation').evaluate(el=>el.open=true);
  await page.locator('#motion-preset-blink').click();await rangeValue(page,'#motion-blink-opacity',40);
  const trackSet=await snap(page),main=trackSet.subtitles.tracks[0],secondary=trackSet.subtitles.tracks[1];
  expect(main.style.value.main.animation.effects.blink.opacity).toBe(40);expect(secondary.style.value?.secondary.animation).toBeUndefined();
  await page.locator('#style-edit-scope').selectOption('cue');await page.locator('#motion-custom').click();await frame(page,0,65);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);const saved=await snap(page);
  await page.reload();await idle(page);expect((await snap(page)).subtitles).toEqual(saved.subtitles);
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});await page.locator('#style-animation').evaluate(el=>el.open=true);
  await expect(page.locator('#motion-custom')).toHaveAttribute('aria-pressed','true');
  await page.locator('#motion-inherit').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation).toBeUndefined();
  await expect(page.locator('#motion-preset-blink')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#motion-blink-opacity')).toHaveAttribute('aria-valuenow','40');
});

test('cross-track preset edits preserve other effects and locks reject edits atomically',async({page})=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);await page.locator('#motion-preset-fade').click();await idle(page);
  await page.evaluate(()=>addExtensionToSelection(0));await expect(page.locator('#motion-preset-fade')).toHaveClass(/is-mixed/);
  await page.locator('#motion-preset-blink').click();await rangeValue(page,'#motion-blink-period',32);
  const p=await snap(page),a=p.subtitles.cues[0],b=p.subtitles.cues.find(c=>c.content.text==='Translation');
  expect(a.content.subtitle_animation.effects.fade.enabled).toBe(true);expect(b.content.subtitle_animation.effects.fade).toBeUndefined();
  for(const c of [a,b])expect(c.content.subtitle_animation.effects.blink).toMatchObject({period:32,periodUnit:'percent'});
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),a=p.subtitles.cues[0],b=p.subtitles.cues.find(c=>c.content.text==='Translation');
    a.content.subtitle_animation.effects.blink.opacity=20;b.content.subtitle_animation.effects.blink.opacity=65;
    productionCommitProject(p,'mixed intensity',[a.id,b.id]);
  });
  const edge=page.locator('#motion-blink-graph [data-edge="1"]');await edge.focus();await page.keyboard.press('ArrowLeft');await idle(page);
  const moved=await snap(page);
  expect(moved.subtitles.cues.map(c=>[c.id,c.content.start,c.content.end])).toEqual(p.subtitles.cues.map(c=>[c.id,c.content.start,c.content.end]));
  expect(moved.subtitles.cues[0].content.subtitle_animation.effects.blink).toMatchObject({end:99,opacity:20});
  expect(moved.subtitles.cues.find(c=>c.content.text==='Translation').content.subtitle_animation.effects.blink).toMatchObject({end:99,opacity:65});
  await page.keyboard.press('Delete');expect((await snap(page)).subtitles).toEqual(moved.subtitles);
  await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks[1].locked=true;productionCommitProject(p,'lock',[p.subtitles.cues[0].id,p.subtitles.cues.find(c=>c.content.text==='Translation').id]);});
  await expect(page.locator('#motion-blink-period')).toHaveAttribute('aria-disabled','true');
});

test('presets and custom graphs stay compact in a narrow dock without duplicate controls',async({page},info)=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);
  for(const name of ['fade','typewriter','blink','transform'])await page.locator('#motion-preset-'+name).click();
  await page.evaluate(()=>Object.assign(document.getElementById('subtitle-properties').style,{position:'fixed',top:'30px',left:'10px',width:'300px',height:'730px',zIndex:'60'}));
  await page.locator('#style-animation').scrollIntoViewIfNeeded();
  await expect(page.locator('#motion-clear,#motion-preview,#motion-unit,#motion-parameter,#curve-active,#curve-easing')).toHaveCount(0);
  expect(await page.locator('#subtitle-properties-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('animation-narrow-presets.png')});
  await page.locator('#motion-timing').selectOption('ms');
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('animation-narrow-fixed-light.png')});
  await page.locator('#motion-timing').selectOption('percent');
  await page.locator('#motion-custom').click();await page.locator('#curve-reset').click();await frame(page,10,20);await frame(page,90,90);
  expect(await page.locator('#subtitle-properties-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.locator('#curve-graph').hover({position:{x:120,y:95}});
  await expect(page.locator('.curve-crosshair')).toHaveAttribute('visibility','visible');
  await page.locator('#curve-graph').click({button:'right',position:{x:140,y:75}});
  await page.locator('#ctxmenu .item').filter({hasText:/^在这里新建关键帧$/}).click();await idle(page);
  await expect(page.locator('.curve-handle')).toHaveCount(3);
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('animation-narrow-custom.png')});
});

test('single-rail strength and curve drags snap with Ctrl, cancel and undo without crossing frames',async({page})=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);
  expect(await page.locator('#style-inherit-appearance svg').innerHTML()).toBe(await page.locator('#motion-inherit svg').innerHTML());
  await page.locator('#motion-preset-blink').click();await idle(page);
  await expect(page.locator('#motion-blink input[type=range]')).toHaveCount(0);
  await rangeValue(page,'#motion-blink-period',20);await rangeValue(page,'#motion-blink-opacity',20);
  // Coincident parameter values remain individually reachable on the same rail.
  await rangeValue(page,'#motion-blink-period',35);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.blink).toMatchObject({period:35,opacity:20});
  await page.locator('#motion-preset-transform').click();await idle(page);
  await expect(page.locator('#motion-transform [data-parameter]')).toHaveCount(1);
  await rangeValue(page,'#motion-transform-toScale',125);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.transform).toMatchObject({fromScale:100,toScale:125});
  await page.evaluate(()=>performUndo());await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.transform.fromScale).toBe(100);
  const dragEdge=async(modifiers,time,cancel=false)=>{
    const graph=page.locator('#motion-blink-graph');await graph.scrollIntoViewIfNeeded();
    const hit=await graph.locator('[data-edge="1"] rect').boundingBox(),box=await graph.boundingBox();
    for(const key of modifiers)await page.keyboard.down(key);
    await page.mouse.move(hit.x+10,hit.y+9);await page.mouse.down();
    await page.mouse.move(box.x+26+(box.width-52)*time/100,hit.y+9,{steps:5});
    if(cancel)await page.keyboard.press('Escape');
    await page.mouse.up();for(const key of modifiers.reverse())await page.keyboard.up(key);await idle(page);
  };
  await dragEdge(['Control'],82.7);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.blink.end).toBe(83);
  await dragEdge(['Control','Shift'],72.7);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.blink.end).toBe(75);
  const before=await snap(page);await dragEdge(['Control'],30,true);expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.locator('#motion-custom').click();await page.locator('#curve-reset').click();await frame(page,10,20);await frame(page,90,90);
  const graph=page.locator('#curve-graph');
  const dragFrame=async(modifiers,time,value)=>{
    await graph.scrollIntoViewIfNeeded();const box=await graph.boundingBox(),node=await graph.locator('[data-point="0"]').boundingBox();
    for(const key of modifiers)await page.keyboard.down(key);
    await page.mouse.move(node.x+node.width/2,node.y+node.height/2);await page.mouse.down();
    await page.mouse.move(box.x+44+(box.width-60)*time/100,box.y+164-1.4*value,{steps:8});
    await page.mouse.up();for(const key of modifiers.reverse())await page.keyboard.up(key);await idle(page);
  };
  await dragFrame(['Control'],23.7,42.6);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.curves.channels.opacity[0]).toMatchObject({time:24,value:43});
  await dragFrame(['Control','Shift'],32.7,57.8);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.curves.channels.opacity[0]).toMatchObject({time:35,value:60});
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
});

test('old running backend is distinguished from invalid animation data',async({page})=>{
  const project=await snap(page);
  await page.route('**/subtitle-preview',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'平级字幕：字幕动画覆盖包含无效参数'})}));
  const error=()=>page.evaluate(async project=>{
    try{await MSWSubtitleStyle.request('subtitle-preview',{project,target:'both',video:{width:640,height:360}});return '';}catch(e){return e.message;}
  },project);
  // Current service advertises its validator version: genuine data errors stay visible.
  expect(await error()).toBe('平级字幕：字幕动画覆盖包含无效参数');
  await page.route('**/capabilities',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,flatSubtitles:1})}));
  expect(await error()).toContain('重启编辑器服务并刷新页面');
  expect((await snap(page)).subtitles).toEqual(project.subtitles);
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
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),c=p.subtitles.cues[0].content;
    c.subtitle_animation.effects.curves={enabled:true,unit:'percent',channels:{
      x:[{time:0,value:-40,easing:'smooth'},{time:60,value:40,easing:'linear'},{time:100,value:0,easing:'hold'}],
      opacity:[{time:0,value:40,easing:'smooth'},{time:100,value:100,easing:'linear'}]}};
    c.subtitle_style={...c.subtitle_style,gradientMode:'characters',gradientStart:'#ff0000',gradientEnd:'#00ff00',backgroundShape:'rounded',backgroundColor:'#442266'};
    productionCommitProject(p,'curve gradient background',[p.subtitles.cues[0].id]);
  });await idle(page);
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

test('custom graph context menu, hover, keyframe dragging, units, undo and save work together',async({page},info)=>{
  await page.locator('#style-animation').evaluate(el=>el.open=true);await page.locator('#motion-custom').click();
  await axis(page,'Y 轴','缩放');await frame(page,0,70);await frame(page,100,120);await frame(page,50,150);
  await page.locator('.curve-handle.selected').click({button:'right'});
  await page.locator('#ctxmenu .item').filter({hasText:/^定格$/}).click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.curves.channels.scale[1].easing).toBe('hold');
  const before=await snap(page);await page.locator('#curve-graph').scrollIntoViewIfNeeded();
  const handle=await page.locator('.curve-handle.selected').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+25,handle.y+25,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  const point=await page.locator('.curve-handle.selected').boundingBox();
  await page.mouse.move(point.x+point.width/2,point.y+point.height/2);await page.mouse.down();await page.mouse.move(point.x+30,point.y+25,{steps:10});
  expect((await snap(page)).subtitles).toEqual(before.subtitles);await page.mouse.up();await idle(page);
  const after=await snap(page);expect(after.subtitles).not.toEqual(before.subtitles);
  await page.evaluate(()=>performUndo());await idle(page);expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(()=>performRedo());await idle(page);expect((await snap(page)).subtitles).toEqual(after.subtitles);
  await axis(page,'X 轴','精确时间（秒）');expect((await snap(page)).subtitles.cues[0].content.subtitle_animation.effects.curves.channels.scale[2].time).toBe(2500);
  await axis(page,'X 轴','时间百分比');await axis(page,'Y 轴','旋转');
  await expect(page.locator('.curve-other-frame')).toHaveCount(3);await frame(page,20,-12);
  await axis(page,'Y 轴','缩放');await expect(page.locator('.curve-handle')).toHaveCount(3);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);const saved=await snap(page);
  await page.reload();await idle(page);expect((await snap(page)).subtitles).toEqual(saved.subtitles);
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});await page.locator('#style-animation').evaluate(el=>el.open=true);await axis(page,'Y 轴','缩放');
  await page.locator('.curve-handle').nth(1).click({button:'right'});await page.locator('#ctxmenu .item').filter({hasText:/^删除关键帧$/}).click();await idle(page);
  await expect(page.locator('.curve-handle')).toHaveCount(2);await page.evaluate(()=>performUndo());await idle(page);await expect(page.locator('.curve-handle')).toHaveCount(3);
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('keyframe-controls.png')});
});

test('track custom curves are inherited, cue restoration and default reset are distinct',async({page})=>{
  await page.evaluate(()=>MSWSubtitleStyle.open('track'));await page.locator('#style-animation').evaluate(el=>el.open=true);
  await page.locator('#motion-custom').click();await frame(page,0,50);
  await page.locator('#style-edit-scope').selectOption('cue');await page.locator('.curve-handle').first().click();await expect(page.locator('#curve-value')).toHaveValue('50');
  await frame(page,0,80);await page.locator('#curve-reset').click();await idle(page);await expect(page.locator('.curve-handle')).toHaveCount(0);
  await page.locator('#motion-inherit').click();await idle(page);await page.locator('.curve-handle').first().click();await expect(page.locator('#curve-value')).toHaveValue('50');
  const p=await snap(page);expect(p.subtitles.cues[0].content.subtitle_animation).toBeUndefined();
  expect(p.subtitles.tracks[0].style.value.main.animation.effects.curves.channels.opacity[0].value).toBe(50);
});

test('custom multiselect changes one channel, retains other channels and respects locks',async({page})=>{
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),[main]=p.subtitles.cues,sub=p.subtitles.cues.find(c=>c.content.text==='Translation');
    for(const [c,key,value] of [[main,'x',30],[sub,'y',60]]){
      const a=MSWSubtitleAnimation.defaults();a.mode='custom';a.effects.curves={enabled:true,unit:'percent',channels:{[key]:[{time:0,value,easing:'linear'}]}};c.content.subtitle_animation=a;
    }
    productionCommitProject(p,'curves',[main.id,sub.id]);
  });
  await page.locator('#style-animation').evaluate(el=>el.open=true);await axis(page,'Y 轴','缩放');await frame(page,0,80);
  let p=await snap(page);const [main]=p.subtitles.cues,sub=p.subtitles.cues.find(c=>c.content.text==='Translation');
  expect(main.content.subtitle_animation.effects.curves.channels.x[0].value).toBe(30);expect(sub.content.subtitle_animation.effects.curves.channels.y[0].value).toBe(60);
  for(const c of [main,sub])expect(c.content.subtitle_animation.effects.curves.channels.scale[0].value).toBe(80);
  const bindings=p.subtitles.bindings;
  await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks[1].locked=true;productionCommitProject(p,'lock',p.subtitles.cues.filter(c=>c.content.start===0).map(c=>c.id));});
  await expect(page.locator('#curve-value')).toBeDisabled();expect((await snap(page)).subtitles.bindings).toEqual(bindings);
});

test('seconds display and input preserve milliseconds and allow equal-time curves on unequal-length cues',async({page})=>{
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),ids=p.subtitles.cues.filter(c=>['First subtitle','Second subtitle'].includes(c.content.text)).map(c=>c.id);
    productionCommitProject(p,'select two durations',ids);
  });
  await page.locator('#style-animation').evaluate(el=>el.open=true);await page.locator('#motion-custom').click();
  await axis(page,'X 轴','精确时间（秒）');await frame(page,0,0);await frame(page,.3,100);
  await expect(page.locator('#curve-time')).toHaveValue('0.300');
  await expect(page.locator('#curve-time-label')).toHaveText('起点后 (秒)');
  const changed=(await snap(page)).subtitles.cues.filter(c=>c.content.subtitle_animation);
  expect(changed).toHaveLength(2);
  for(const c of changed){
    expect(c.content.subtitle_animation.effects.curves).toMatchObject({unit:'ms',channels:{opacity:[{time:0,value:0},{time:300,value:100}]}});
  }
  await expect(page.locator('#curve-graph')).toContainText('2.500 s');
  await page.locator('#curve-graph').hover({position:{x:100,y:90}});
  await expect(page.locator('.curve-hover-x')).toHaveText(/^\d+\.\d{3} s$/);
  await axis(page,'X 轴','时间百分比');
  const converted=(await snap(page)).subtitles.cues.filter(c=>c.content.subtitle_animation);
  expect(converted.map(c=>c.content.subtitle_animation.effects.curves.channels.opacity[1].time)).toEqual([12,12]);
  await axis(page,'X 轴','精确时间（秒）');
  const saved=await snap(page);expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
  await page.reload();await idle(page);expect((await snap(page)).subtitles).toEqual(saved.subtitles);
});

test('gradient colors, picker, presets and curve animation use the same ASS frame as burning',async({page},info)=>{
  await field(page,'fontSize',96);
  await page.locator('#style-more').evaluate(el=>el.open=true);await page.locator('#style-gradient').evaluate(el=>el.open=true);
  await page.locator('#style-field-gradientMode').selectOption('characters');await idle(page);
  await field(page,'gradientStart','#ff0000');await field(page,'gradientEnd','#00ff00');
  await page.locator('#style-pick-gradientEnd').click();await expect(page.locator('.msw-video-color-picker')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#style-field-gradientEnd')).toHaveValue('#00ff00');
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('Gradient test');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-message')).toContainText('预设已保存');
  const preset=await page.locator('#style-project-preset').inputValue();
  await page.locator('#style-field-gradientMode').selectOption('none');await idle(page);
  await page.locator('#style-project-preset').selectOption(preset);await idle(page);
  await expect(page.locator('#style-field-gradientMode')).toHaveValue('characters');
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),cue=p.subtitles.cues[0],motion=MSWSubtitleAnimation.defaults();
    motion.effects.curves={enabled:true,unit:'percent',channels:{
      x:[{time:0,value:-100,easing:'smooth'},{time:50,value:100,easing:'smooth'},{time:100,value:0,easing:'hold'}],
      rotation:[{time:0,value:-12,easing:'linear'},{time:100,value:12,easing:'linear'}],
      scale:[{time:0,value:75,easing:'smooth'},{time:100,value:125,easing:'linear'}]}};
    cue.content.subtitle_animation=motion;productionCommitProject(p,'animated gradient',[cue.id]);
    waveformEditor.activateModuleTab('panel');
  });await idle(page);
  const payload=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),target:'both',video:{width:640,height:360}}));
  writeFileSync(join(folder,'gradient.ass'),payload.ass);expect(payload.ass).toContain('\\1c&H0000ff&');expect(payload.ass).toContain('\\1c&H00ff00&');
  const canvas=page.locator('.JASSUB'),box=await canvas.boundingBox(),files=[];
  for(const [i,time] of [.4,1.2,2.2].entries()){
    await page.evaluate(async t=>{player.currentTime=t;await new Promise(r=>player.addEventListener('seeked',r,{once:true}));await MSWSubtitleRenderer.repaint();},time);
    const preview=join(folder,`gradient-preview-${i}.png`),burn=join(folder,`gradient-burn-${i}.png`);
    await canvas.screenshot({path:preview});
    execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-i','video.mp4','-ss',String(time),'-vf',`ass=gradient.ass,scale=${Math.round(box.width)}:${Math.round(box.height)}`,'-frames:v','1',burn],{cwd:folder,windowsHide:true});files.push(preview,burn);
  }
  const stats=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image
import sys,json
def colors(p):
 im=Image.open(p).convert('RGB');out=[]
 for axis in (0,1):
  pts=[(x,y) for y in range(im.height) for x in range(im.width) if (lambda c:c[axis]>80 and c[axis]>c[1-axis]*1.8 and c[axis]>c[2]*1.8)(im.getpixel((x,y)))]
  out.append([len(pts),sum(x for x,y in pts)/len(pts),sum(y for x,y in pts)/len(pts)])
 return out
print(json.dumps([colors(p) for p in sys.argv[1:]]))`,...files],{encoding:'utf8',windowsHide:true}));
  for(let i=0;i<stats.length;i+=2)for(let color=0;color<2;color++){
    expect(stats[i][color][0]).toBeGreaterThan(20);
    for(const axis of [1,2])expect(Math.abs(stats[i][color][axis]-stats[i+1][color][axis])).toBeLessThan(3);
  }
  for(const s of stats)expect(s[0][1]).toBeLessThan(s[1][1]);
  await page.screenshot({path:info.outputPath('gradient-animation.png')});
});
