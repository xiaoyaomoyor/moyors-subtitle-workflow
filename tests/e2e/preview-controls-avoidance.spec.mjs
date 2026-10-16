import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
let server,folder;
test.beforeEach(async({page})=>{
  folder=makeTempDir('preview-controls');
  process.env.MSW_APP_DATA_ROOT=join(folder,'local');process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const video=join(folder,'synthetic.mp4'),project=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media:video,segments:[{id:'m',start:0,end:6000,text:'Main subtitle'}],
    multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'s',role:'extension',segments:[{id:'s1',start:0,end:6000,text:'Secondary subtitle'}]}],
      bindings:[{id:'b',track_id:'s',main_segment_ids:['m'],extension_segment_ids:['s1']}]},waveform:generateWaveformPayload(6000)}));
  await disableOnboarding(page);await page.addInitScript(()=>{if(!localStorage.getItem('moy.asr.editor.settings.v1'))localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false}));});
  page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(project,video,await findFreePort());await page.goto(server.url);
  await page.evaluate(()=>{const stage=document.querySelector('.player-stage');stage.style.flex='none';stage.style.width='400px';stage.style.height='225px';player.currentTime=1;overlayToggle.checked=true;extensionOverlayToggle.checked=true;MSWSubtitleRenderer.invalidate();});
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status),{timeout:30000}).toBe('libass');
  await idle(page);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();});
async function idle(page){await expect.poll(()=>page.evaluate(()=>!MSWSubtitleRenderer.pending&&MSWPreviewControls.settled),{timeout:15000}).toBe(true);}
async function toggle(page,value){await page.evaluate(value=>{const el=document.getElementById('subtitle-avoid-controls');el.checked=value;el.dispatchEvent(new Event('change'));},value);await idle(page);}
const events=page=>page.evaluate(async()=>await MSWSubtitleRenderer.renderer.renderer.getEvents());
const pos=text=>[...text.match(/\\pos\(([^,]+),([^)]*)\)/)].slice(1).map(Number);
async function assertVisibleAboveControls(page){
  const bounds=await page.evaluate(async()=>{
    const capture=await MSWSubtitleRenderer.renderer.renderer._drawCapture(player.currentTime);
    let bottom=-1;for(let i=3;i<capture.data.length;i+=4)if(capture.data[i]>32)bottom=Math.max(bottom,Math.floor((i/4)/capture.width));
    const canvas=document.querySelector('.JASSUB').getBoundingClientRect(),bar=document.getElementById('media-controls').getBoundingClientRect();
    return {bottom:canvas.top+(bottom+1)*canvas.height/capture.height,bar:bar.top,pixels:bottom};
  });expect(bounds.pixels).toBeGreaterThan(0);expect(bounds.bottom).toBeLessThan(bounds.bar);
}

test('precise paired captions avoid controls, restore exactly, and never affect project or export',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const source=await page.evaluate(()=>({project:buildJson(),ass:fixedAssDocument('both'),undo:editorHistory.canUndo()}));
  const shifted=await events(page);
  expect(await page.evaluate(()=>[...MSWPreviewControls.offsets.values()].some(v=>v<0))).toBe(true);
  await toggle(page,false);const original=await events(page);
  expect(original).toHaveLength(2);
  const deltas=original.map((r,i)=>pos(shifted[i].Text)[1]-pos(r.Text)[1]);
  expect(deltas[0]).toBeLessThan(0);expect(deltas[0]).toBeCloseTo(deltas[1],3);
  await toggle(page,true);expect(await events(page)).toEqual(shifted);
  await assertVisibleAboveControls(page);
  await page.screenshot({path:info.outputPath('controls-avoided.png')});
  expect(await page.evaluate(()=>({project:buildJson(),ass:fixedAssDocument('both'),undo:editorHistory.canUndo()}))).toEqual(source);
  await toggle(page,false);await page.reload();await expect(page.locator('#subtitle-avoid-controls')).not.toBeChecked();expect(errors).toEqual([]);
});

test('fullscreen recalculates the safe area and restores normal picture geometry',async({page})=>{
  const original=await page.evaluate(()=>fixedAssDocument('both'));
  await page.evaluate(async()=>{const stage=document.querySelector('.player-stage');stage.removeAttribute('style');await document.querySelector('.player-wrap').requestFullscreen();});
  await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);await idle(page);
  await assertVisibleAboveControls(page);
  await page.evaluate(()=>document.exitFullscreen());await idle(page);
  expect(await page.evaluate(()=>fixedAssDocument('both'))).toBe(original);
});

test('playing hides controls, hovering restores avoidance; picture positioning docks controls',async({page})=>{
  await page.mouse.move(1200,780);await page.evaluate(()=>player.play());
  await expect.poll(()=>page.evaluate(()=>[...MSWPreviewControls.offsets.values()].every(v=>v===0))).toBe(true);
  await page.locator('#player').hover();
  await expect.poll(()=>page.evaluate(()=>[...MSWPreviewControls.offsets.values()].some(v=>v<0))).toBe(true);
  await page.evaluate(()=>{player.pause();fixedStyleTrackId=DATA.subtitle_tracks.tracks[0].id;fixedUpdateTrack(fixedStyleTrackId,{layout:'fixed',position:{x:.5,y:.7}});fixedStartPositioning();});
  await expect(page.locator('#media-controls')).toHaveClass(/media-controls-outside/);
  await expect.poll(()=>page.evaluate(()=>[...MSWPreviewControls.offsets.values()].every(v=>v===0))).toBe(true);await idle(page);
  const boxes=await page.evaluate(()=>({bar:document.getElementById('media-controls').getBoundingClientRect().toJSON(),stage:document.querySelector('.player-stage').getBoundingClientRect().toJSON()}));
  expect(boxes.bar.top).toBeGreaterThanOrEqual(boxes.stage.bottom-1);
  await page.keyboard.press('Escape');await expect(page.locator('#media-controls')).not.toHaveClass(/media-controls-outside/);
});

test('black borders, resized preview and hidden subtitles do not leave stale avoidance',async({page})=>{
  await page.evaluate(()=>{const stage=document.querySelector('.player-stage');stage.style.flex='none';stage.style.height='500px';stage.style.width='400px';});
  await expect.poll(()=>page.evaluate(()=>[...MSWPreviewControls.offsets.values()].every(v=>v===0))).toBe(true);await idle(page);
  await page.evaluate(()=>{const stage=document.querySelector('.player-stage');stage.style.height='225px';});
  await expect.poll(()=>page.evaluate(()=>[...MSWPreviewControls.offsets.values()].some(v=>v<0))).toBe(true);
  await page.evaluate(()=>{overlayToggle.checked=false;extensionOverlayToggle.checked=false;overlayToggle.dispatchEvent(new Event('change'));extensionOverlayToggle.dispatchEvent(new Event('change'));});
  await idle(page);expect(await events(page)).toHaveLength(0);
});

test('brief pointer exits keep captions stable and hiding during a worker write still restores them',async({page})=>{
  await page.locator('#player').hover();await page.evaluate(()=>player.play());await idle(page);
  const initial=await page.evaluate(()=>[...MSWPreviewControls.offsets.values()]);
  expect(initial.some(v=>v<0)).toBe(true);
  for(let i=0;i<4;i++) {
    await page.mouse.move(1200,780);await page.waitForTimeout(90);
    expect(await page.evaluate(()=>[...MSWPreviewControls.offsets.values()])).toEqual(initial);
    await expect(page.locator('#media-controls')).toHaveCSS('opacity','1');
    await page.locator('#player').hover();
  }
  await page.mouse.move(1200,780);await idle(page);
  await expect.poll(()=>page.evaluate(()=>[...MSWPreviewControls.offsets.values()].every(v=>v===0))).toBe(true);
  // Hold the final write to the worker, then remove its nonzero target. A
  // continuation that checks only target keys would leave the captions raised.
  await toggle(page,false);await page.locator('#player').hover();await idle(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{
    const original=MSWSubtitleRenderer.applyPreviewOffsets;
    MSWSubtitleRenderer.applyPreviewOffsets=async offsets=>{
      await original(offsets);
      if([...offsets.values()].some(v=>v<0)&&!window.avoidanceWriteHeld) {
        window.avoidanceWriteHeld=true;
        await new Promise(resolve=>{window.releaseAvoidanceWrite=resolve;});
      }
    };
    const el=document.getElementById('subtitle-avoid-controls');el.checked=true;el.dispatchEvent(new Event('change'));
  });
  await expect.poll(()=>page.evaluate(()=>!!window.releaseAvoidanceWrite)).toBe(true);
  await page.evaluate(()=>{const el=document.getElementById('subtitle-avoid-controls');el.checked=false;el.dispatchEvent(new Event('change'));});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>window.releaseAvoidanceWrite());await idle(page);
  expect(await page.evaluate(()=>[...MSWPreviewControls.offsets.values()].every(v=>v===0))).toBe(true);
});

test('top annotations stay fixed and approximate preview uses the same grouped offsets',async({page})=>{
  await page.evaluate(()=>{
    let p=JSON.parse(buildJson());
    const track={...structuredClone(p.subtitles.tracks[0]),id:'top',name:'Top',display_number:2,layout:'fixed',position:{x:.5,y:.1}};
    p=MSWFlatSubtitles.addTrack(p,track);p=MSWFlatEditing.addCue(p,'top','top-cue',0,6000,'Top annotation');
    productionCommitProject(p,'添加顶部注释');MSWSubtitleRenderer.invalidate();
  });
  await idle(page);const before=await events(page);await toggle(page,false);const original=await events(page);
  const top=rows=>rows.find(r=>r.Text.includes('Top annotation'));
  expect(top(before)).toEqual(top(original));
  await toggle(page,true);await page.evaluate(()=>{
    document.querySelector('.player-stage').dataset.subtitleRenderer='approximate';
    refreshSubtitlePreview();MSWPreviewControls.refresh();
  });await idle(page);
  const rows=await page.locator('.fixed-subtitle-row').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.cueId,offset:parseFloat(n.style.getPropertyValue('--controls-offset'))||0})));
  expect(rows.find(r=>r.id==='top-cue').offset).toBe(0);
  expect(rows.filter(r=>r.id!=='top-cue').every(r=>r.offset<0)).toBe(true);
  expect(rows[0].offset).toBeCloseTo(rows[1].offset,2);
});

test('slow rendering does not rebuild unchanged captions but still applies edits made while waiting',async({page})=>{
  let requests=0;
  await page.route('**/subtitle-preview',async route=>{
    requests++;
    // Deliberately exceed the renderer's 750ms polling period.
    await new Promise(resolve=>setTimeout(resolve,1100));
    await route.continue();
  });
  await page.evaluate(()=>MSWSubtitleRenderer.invalidate());
  await expect.poll(()=>requests).toBe(1);await idle(page);
  const stable=await page.evaluate(()=>({revision:MSWSubtitleRenderer.revision,offsets:[...MSWPreviewControls.offsets]}));
  await page.waitForTimeout(1600); // Cross two more unchanged-input polls.
  expect(requests).toBe(1);
  expect(await page.evaluate(()=>({revision:MSWSubtitleRenderer.revision,offsets:[...MSWPreviewControls.offsets]}))).toEqual(stable);

  await page.evaluate(()=>MSWSubtitleRenderer.invalidate());
  await expect.poll(()=>requests).toBe(2);
  await page.evaluate(()=>{
    DATA.segments[0].text='Changed while preview was pending';
    window.dispatchEvent(new Event('msw:subtitles-changed'));
  });
  await expect.poll(()=>requests).toBe(3);await idle(page);
  expect((await events(page)).some(e=>e.Text.includes('Changed while preview was pending'))).toBe(true);
  await page.waitForTimeout(1600);
  expect(requests).toBe(3);
  await assertVisibleAboveControls(page);
});

test('legacy subtitle preview restores its temporary offset without changing saved geometry',async({page})=>{
  await page.goto(server.url+'?subtitle-tracks=0');
  await page.evaluate(()=>{const stage=document.querySelector('.player-stage');stage.style.flex='none';stage.style.width='400px';stage.style.height='225px';player.currentTime=1;MSWSubtitleRenderer.invalidate();});
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status),{timeout:30000}).toBe('libass');await idle(page);
  const before=await page.evaluate(()=>JSON.stringify(DATA.preview));
  await expect.poll(()=>page.locator('.JASSUB').evaluate(c=>parseFloat(c.style.getPropertyValue('--controls-offset'))||0)).toBeLessThan(0);
  await toggle(page,false);
  await expect(page.locator('.JASSUB')).toHaveCSS('translate','0px');
  expect(await page.evaluate(()=>JSON.stringify(DATA.preview))).toBe(before);
});
