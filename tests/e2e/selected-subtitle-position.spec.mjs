import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
let server,folder,project;
test.beforeEach(async({page})=>{
  folder=makeTempDir('selected-position');project=join(folder,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(folder,'local');process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const video=join(folder,'synthetic.mp4');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media:video,segments:[{id:'m',start:0,end:6000,text:'Main subtitle'}],
    multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'s',role:'extension',segments:[{id:'s1',start:0,end:6000,text:'Secondary subtitle'}]}],
      bindings:[{id:'b',track_id:'s',main_segment_ids:['m'],extension_segment_ids:['s1']}]},waveform:generateWaveformPayload(6000)}));
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,selectBoundSubtitlePair:false,subtitleAvoidControls:false})));
  page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(project,video,await findFreePort());await page.goto(server.url);
  await page.evaluate(()=>{player.currentTime=1;overlayToggle.checked=true;extensionOverlayToggle.checked=true;MSWSubtitleRenderer.invalidate();});
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status),{timeout:30000}).toBe('libass');await idle(page);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
async function idle(page){await expect.poll(()=>page.evaluate(()=>!MSWSubtitleRenderer.pending&&MSWPreviewControls.settled),{timeout:15000}).toBe(true);}
const events=page=>page.evaluate(async()=>await MSWSubtitleRenderer.renderer.renderer.getEvents());
const pos=text=>text.match(/\\pos\(([^,]+),([^)]*)\)/).slice(1).map(Number);

test('fullscreen arrow seek ignores hidden cue selection and stays consistent across player controls',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);player.pause();player.currentTime=3;});
  const before=await snap(page);
  await page.locator('#media-fullscreen').click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===playerWrap)).toBe(true);
  const step=await page.evaluate(()=>timelineMediaSeekStepMilliseconds()/1000);
  for(const id of ['player','media-fullscreen','media-seek','media-volume','media-play-toggle']){
    await page.evaluate(id=>{const el=document.getElementById(id);el.tabIndex=0;el.focus();player.currentTime=3;},id);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(()=>page.evaluate(()=>player.currentTime)).toBeCloseTo(3-step,2);
    await page.keyboard.press('ArrowRight');
    await expect.poll(()=>page.evaluate(()=>player.currentTime)).toBeCloseTo(3,2);
    expect((await snap(page)).subtitles).toEqual(before.subtitles);
  }
  await page.evaluate(()=>document.exitFullscreen());
});
async function open(page,both=false){
  await page.evaluate(both=>{selectOnly(0);if(both)addExtensionToSelection(0);MSWSubtitleStyle.editTrack(fixedTrack(DATA.segments[0]).id);},both);
  await page.locator('#style-position-scope').selectOption('cue');await idle(page);
}
async function axis(page,key,value){await page.locator('#style-position-'+key).fill(String(value));await page.locator('#style-position-'+key).blur();await idle(page);}
async function position(page){
  await page.setViewportSize({width:1920,height:1000});
  await page.locator('#media-settings-modal').evaluate(el=>{el.style.left='1350px';el.style.top='20px';});
  await page.locator('#style-position-drag').click();await idle(page);
  await expect(page.locator('#media-settings-modal')).toBeVisible();
  await expect(page.locator('#style-position-cancel')).toBeVisible();
  await expect(page.locator('#fixed-position-toolbar')).toHaveCount(0);
}

test('track percentage position persists through redraw, ASS rendering, save and reopen',async({page})=>{
  await page.evaluate(()=>MSWSubtitleStyle.editTrack(fixedTrack(DATA.segments[0]).id));
  await page.locator('#style-track-placement').selectOption('fixed');
  await idle(page);const prior=pos((await events(page))[0].Text)[1];
  await axis(page,'y',45);
  const changed=await snap(page);
  expect(changed.subtitles.tracks[0].position).toEqual({x:.5,y:.45});
  await expect(page.locator('#style-position-y')).toHaveValue('45');
  expect(pos((await events(page))[0].Text)[1]-prior).toBeCloseTo((.45-.08)*1080,3);
  await page.evaluate(()=>renderAll());await idle(page);
  expect((await snap(page)).subtitles.tracks[0].position).toEqual({x:.5,y:.45});
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
  await page.reload();await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status),{timeout:30000}).toBe('libass');await idle(page);
  expect((await snap(page)).subtitles.tracks[0].position).toEqual({x:.5,y:.45});
});

test('selected cue percentage keeps typed decimals during refresh and commits with Enter',async({page})=>{
  await open(page);
  const y=page.locator('#style-position-y');await y.fill('45.25');
  await page.evaluate(()=>MSWSubtitleStyle.syncPosition());
  await expect(y).toHaveValue('45.25');
  await y.press('Enter');await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_position.y).toBeCloseTo(.4525,5);
  expect(pos((await events(page))[0].Text)[1]).toBeCloseTo(488.7,3);
  await y.fill('101');await y.press('Tab');
  expect((await snap(page)).subtitles.cues[0].content.subtitle_position.y).toBeCloseTo(.4525,5);
  await page.locator('#style-position-reset').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_position).toBeUndefined();
  expect(Number(await y.inputValue())).toBeLessThanOrEqual(100);
});

test('single auto cue positioning preserves its bound partner, saves, reopens and resets inheritance',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const before=await snap(page),original=await events(page);await open(page);
  await expect(page.locator('#style-position-note')).toContainText('S1主_1');
  await expect(page.locator('#style-position-drag')).toBeEnabled();
  await expect(page.locator('#media-controls')).toHaveClass(/media-controls-outside/);
  await axis(page,'y',50);
  const moved=await snap(page),rendered=await events(page);
  expect(moved.subtitles.tracks).toEqual(before.subtitles.tracks);expect(moved.subtitles.bindings).toEqual(before.subtitles.bindings);
  expect(moved.subtitles.cues[0].content.subtitle_position).toMatchObject({y:.5,alignment:2});
  expect(moved.subtitles.cues[1]).toEqual(before.subtitles.cues[1]);
  expect(pos(rendered[0].Text)[1]).toBe(540);expect(rendered[1].Text).toBe(original[1].Text);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(()=>performRedo());expect((await snap(page)).subtitles).toEqual(moved.subtitles);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
  expect(JSON.parse(readFileSync(project,'utf8')).subtitles).toEqual(moved.subtitles);
  await page.reload();await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status),{timeout:30000}).toBe('libass');await idle(page);
  expect((await snap(page)).subtitles).toEqual(moved.subtitles);
  const ass=await page.evaluate(()=>fixedAssDocument('both'));expect(ass).toContain('\\pos(960.0000,540.0000)');
  await open(page);await page.locator('#style-position-note').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('selected-position-panel.png')});
  await page.locator('#style-position-reset').click();await idle(page);
  expect((await snap(page)).subtitles).toEqual(before.subtitles);expect((await events(page)).map(r=>r.Text)).toEqual(original.map(r=>r.Text));
  expect(errors).toEqual([]);
});

test('multi selection preserves the pair gap, exposes mixed values and commits one undo',async({page})=>{
  const before=await snap(page),original=await events(page);await open(page,true);
  await expect(page.locator('#style-position-note')).toContainText('已选 2 条');
  await expect(page.locator('#style-position-y')).toHaveAttribute('placeholder','多个值');
  await axis(page,'y',40);const shifted=await events(page);
  const deltas=shifted.map((r,i)=>pos(r.Text)[1]-pos(original[i].Text)[1]);expect(deltas[0]).toBeLessThan(0);expect(deltas[1]).toBeCloseTo(deltas[0],3);
  expect((await snap(page)).subtitles.cues.every(c=>c.content.subtitle_position?.alignment===2)).toBe(true);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('picture drag moves only the selected cue, preserves proof choice, cancels and undoes once',async({page})=>{
  await open(page);await page.locator('#style-preview-mode').selectOption('default');
  const before=await snap(page);await position(page);
  await expect(page.locator('#media-controls')).toHaveClass(/media-controls-outside/);
  const row=page.locator('.fixed-subtitle-row.position-target').first(),box=await row.boundingBox();expect(box).toBeTruthy();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-30,box.y+box.height/2-40,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await expect(page.locator('#style-position-drag')).toBeVisible();await position(page);
  const b=await row.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2-30,b.y+b.height/2-40,{steps:5});await page.mouse.up();await idle(page);
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.getByRole('button',{name:'完成定位',exact:true}).click();await idle(page);
  const moved=await snap(page);expect(moved.subtitles.cues[0].content.subtitle_position).toBeTruthy();expect(moved.subtitles.cues[1]).toEqual(before.subtitles.cues[1]);
  await expect(page.locator('#media-settings-modal')).toBeVisible();await page.locator('#media-settings-close').click();await idle(page);
  expect(await page.evaluate(()=>MSWSubtitleStyle.currentPreview().scope)).toBe('proof');
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('empty and locked selections disable positioning; track edits and presets keep cue overrides',async({page})=>{
  await open(page);await page.evaluate(()=>clearSelection());await expect(page.locator('#style-position-drag')).toBeDisabled();
  await expect(page.locator('#style-position-note')).toContainText('请先');await page.evaluate(()=>selectOnly(0));await expect(page.locator('#style-position-drag')).toBeEnabled();
  await page.evaluate(()=>fixedUpdateTrack(DATA.subtitle_tracks.tracks[1].id,{locked:true}));
  await axis(page,'x',30);const position=(await snap(page)).subtitles.cues[0].content.subtitle_position;
  expect(position?.x).toBe(.3);await page.evaluate(()=>fixedUpdateTrack(DATA.subtitle_tracks.tracks[1].id,{locked:false}));
  await page.locator('#style-position-scope').selectOption('track');await page.locator('#style-track-placement').selectOption('fixed');await axis(page,'y',20);
  await page.locator('#style-project-preset').selectOption('default');expect((await snap(page)).subtitles.cues[0].content.subtitle_position).toEqual(position);
  await page.locator('#style-position-scope').selectOption('cue');await page.evaluate(()=>fixedUpdateTrack(fixedStyleTrackId,{locked:true}));
  await expect(page.locator('#style-position-x')).toBeDisabled();await expect(page.locator('#style-position-reset')).toBeDisabled();
});

test('editing one member of a legacy positioned pair does not move or rewrite its partner',async({page})=>{
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson());for(const c of p.subtitles.cues)c.content.subtitle_position={x:.5,y:.2};
    productionCommitProject(p,'旧位置夹具');MSWSubtitleRenderer.invalidate();
  });await idle(page);
  const before=await snap(page),original=await events(page);await open(page);await axis(page,'x',30);
  const after=await snap(page);expect(after.subtitles.cues[1]).toEqual(before.subtitles.cues[1]);
  expect((await events(page))[1].Text).toBe(original[1].Text);
  expect(after.subtitles.cues[0].content.subtitle_position).toMatchObject({x:.3,base:{x:.5,y:.2}});
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);await page.reload();
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status),{timeout:30000}).toBe('libass');await idle(page);
  expect((await events(page))[1].Text).toBe(original[1].Text);
});

test('multi cue picture drag keeps precise rendering and spacing through hold, cancel, undo and redo',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,true);await position(page);
  const before=await snap(page),original=await events(page),row=page.locator('.fixed-subtitle-row.position-target').first();
  const box=await row.boundingBox(),rect=await page.evaluate(()=>fixedVideoRect());
  const requests=[];page.on('request',r=>{if(r.url().endsWith('/subtitle-preview'))requests.push(r.url());});
  const start={x:box.x+box.width/2,y:box.y+box.height/2};
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+30,start.y-25,{steps:5});
  await expect.poll(async()=>pos((await events(page))[0].Text)[0]-pos(original[0].Text)[0]).toBeCloseTo(30*rect.referenceWidth/rect.width,2);
  expect(await page.locator('.JASSUB').evaluate(el=>getComputedStyle(el).visibility)).toBe('visible');
  const held=await events(page),delta=held.map((r,i)=>pos(r.Text).map((v,k)=>v-pos(original[i].Text)[k]));
  expect(delta[0][0]).toBeCloseTo(delta[1][0],2);expect(delta[0][1]).toBeCloseTo(delta[1][1],2);
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,1700)));
  expect(requests).toHaveLength(0);expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.screenshot({path:info.outputPath('precise-multi-drag.png')});
  await page.keyboard.press('Escape');await page.mouse.up();await idle(page);
  expect((await events(page)).map(r=>r.Text)).toEqual(original.map(r=>r.Text));
  await position(page);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+30,start.y-25,{steps:5});await page.mouse.up();await idle(page);
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.keyboard.press('Enter');await idle(page);
  const moved=await snap(page),rendered=await events(page);
  for(let i=0;i<2;i++)for(let k=0;k<2;k++)expect(pos(rendered[i].Text)[k]).toBeCloseTo(pos(held[i].Text)[k],2);
  expect(moved.subtitles.bindings).toEqual(before.subtitles.bindings);
  await page.keyboard.press('Control+z');await idle(page);expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.keyboard.press('Control+Shift+z');await idle(page);expect((await snap(page)).subtitles).toEqual(moved.subtitles);
  expect(errors).toEqual([]);
});

test('position arrows preview one pixel steps, cancel the whole session and finish as one undo',async({page})=>{
  await open(page,true);await position(page);
  const before=await snap(page),original=await events(page),time=await page.evaluate(()=>player.currentTime);
  expect(await page.evaluate(()=>MSWSubtitleStyle.currentPreview().label)).toBe('定位中：Esc取消，Enter完成');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await idle(page);
  const preview=await events(page);
  for(let i=0;i<2;i++){expect(pos(preview[i].Text)[0]).toBeCloseTo(pos(original[i].Text)[0]-1,3);expect(pos(preview[i].Text)[1]).toBeCloseTo(pos(original[i].Text)[1]-2,3);}
  expect(await page.evaluate(()=>player.currentTime)).toBe(time);expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.locator('#style-position-cancel').click();await idle(page);
  expect((await events(page)).map(r=>r.Text)).toEqual(original.map(r=>r.Text));expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await position(page);await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await idle(page);
  const after=await snap(page);expect(after.subtitles.cues.every(c=>c.content.subtitle_position)).toBe(true);
  await expect(page.locator('#media-settings-modal')).toBeVisible();
  await page.evaluate(()=>performUndo());await idle(page);expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(()=>performRedo());await idle(page);expect((await snap(page)).subtitles).toEqual(after.subtitles);
  await position(page);await page.locator('#style-position-x').focus();await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(()=>fixedPositionSession.dx)).toBe(0);
  await page.keyboard.press('Escape');await expect(page.locator('#style-position-drag')).toBeVisible();
});
