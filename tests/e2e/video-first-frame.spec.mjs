import {expect,test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer,toggleMediaSettings} from './helpers.mjs';

let server,folder;
test.beforeAll(async()=>{
  folder=makeTempDir('video-first-frame');
  const media=join(folder,'synthetic.mp4'),project=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x287bc1:s=640x360:r=25:d=4','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media:'synthetic.mp4',segments:[],waveform:generateWaveformPayload(4000)}));
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});

function centerPixel(png){
  return JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON||'python',['-c','from PIL import Image; import sys,json,io; im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB"); print(json.dumps(im.getpixel((im.width//2,im.height//2))))'],{input:png,windowsHide:true}).toString());
}

test('new project displays the paused video before opening media settings',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWE?.resolve('processing-host').player.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer?.status),{timeout:45000}).toBe('libass');
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer.pending)).toBe(false);
  const state=await page.evaluate(()=>{
    const video=document.getElementById('player'),canvas=document.querySelector('.JASSUB');
    return {video:video.getBoundingClientRect().toJSON(),canvas:canvas?.getBoundingClientRect().toJSON(),paused:video.paused,time:video.currentTime};
  });
  const before=await page.locator('.player-stage').screenshot({path:testInfo.outputPath('before-settings.png')});
  await page.evaluate(()=>{const video=document.getElementById('player');video.muted=true;return video.play();});
  await expect.poll(()=>page.evaluate(()=>document.getElementById('player').currentTime)).toBeGreaterThan(.1);
  expect(centerPixel(await page.locator('.player-stage').screenshot())[2]).toBeGreaterThan(150);
  await page.evaluate(()=>document.getElementById('player').pause());
  await toggleMediaSettings(page);await page.locator('#media-settings-close').click();
  const after=await page.locator('.player-stage').screenshot({path:testInfo.outputPath('after-settings.png')});
  const colors={before:centerPixel(before),after:centerPixel(after),state};
  await testInfo.attach('frame-state',{body:JSON.stringify(colors,null,2),contentType:'application/json'});
  expect(colors.before[2]).toBeGreaterThan(150);
  expect(colors.before[1]).toBeGreaterThan(80);
  expect(state.paused).toBe(true);expect(state.time).toBe(0);
  expect(errors).toEqual([]);
});

test('an initializing subtitle canvas stays hidden while video remains playable',async({page})=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/subtitle-renderer/worker.js',async route=>{await gate;await route.continue();});
  await disableOnboarding(page);await page.goto(server.url);
  try {
    await expect(page.locator('.JASSUB')).toBeAttached({timeout:30000});
    await expect(page.locator('.JASSUB')).toBeHidden();
    await page.evaluate(()=>{const video=document.getElementById('player');video.muted=true;return video.play();});
    await expect.poll(()=>page.evaluate(()=>document.getElementById('player').currentTime)).toBeGreaterThan(.1);
    expect(centerPixel(await page.locator('.player-stage').screenshot())[2]).toBeGreaterThan(150);
  } finally {release();}
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer?.status),{timeout:30000}).toBe('libass');
  await expect(page.locator('.JASSUB')).toBeVisible();
});

test('replacing the player immediately removes its old subtitle canvas',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer?.status),{timeout:30000}).toBe('libass');
  const reset=await page.evaluate(()=>{
    const url=document.getElementById('player').currentSrc;
    resetLoadedMedia();
    return {url,canvases:document.querySelectorAll('.JASSUB').length};
  });
  expect(reset.canvases).toBe(0);
  await page.evaluate(url=>loadMediaFile({url,name:'synthetic.mp4',type:'video/mp4'},{localOnly:true,previewOnly:true}),reset.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer?.status),{timeout:30000}).toBe('libass');
  await expect(page.locator('.JASSUB')).toHaveCount(1);
  expect(centerPixel(await page.locator('.player-stage').screenshot())[2]).toBeGreaterThan(150);
  expect(errors).toEqual([]);
});

test('switching projects during renderer startup cannot restore the old canvas',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/subtitle-renderer/worker.js',async route=>{await gate;await route.continue();});
  await disableOnboarding(page);await page.goto(server.url);
  try {
    await expect(page.locator('.JASSUB')).toBeAttached({timeout:30000});
    const result=await page.evaluate(async()=>{
      const url=document.getElementById('player').currentSrc;
      window.oldSubtitleCanvas=document.querySelector('.JASSUB');
      applyCanonicalProject({segments:[],media:''},'untitled.mosp');
      const removed=!window.oldSubtitleCanvas.isConnected;
      await loadMediaFile({url,name:'synthetic.mp4',type:'video/mp4'},{localOnly:true,previewOnly:true});
      return removed;
    });
    expect(result).toBe(true);
  } finally {release();}
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer?.status),{timeout:30000}).toBe('libass');
  await expect(page.locator('.JASSUB')).toHaveCount(1);
  expect(await page.evaluate(()=>document.querySelector('.JASSUB')===window.oldSubtitleCanvas)).toBe(false);
  expect(centerPixel(await page.locator('.player-stage').screenshot())[2]).toBeGreaterThan(150);
  expect(errors).toEqual([]);
});

test('subtitle renderer failure leaves video visible and explains the fallback',async({page})=>{
  await page.route('**/subtitle-renderer/jassub.js',route=>route.fulfill({contentType:'text/javascript',body:'throw new Error("Renderer unavailable in test");'}));
  await disableOnboarding(page);await page.goto(server.url);
  await expect(page.locator('#subtitle-render-status')).toContainText('近似预览：Renderer unavailable in test',{timeout:30000});
  await expect(page.locator('.JASSUB')).toHaveCount(0);
  expect(centerPixel(await page.locator('.player-stage').screenshot())[2]).toBeGreaterThan(150);
});

test('video remains visible after a hidden player is shown and resized',async({page})=>{
  await disableOnboarding(page);
  await page.addInitScript(()=>{
    document.addEventListener('DOMContentLoaded',()=>{document.querySelector('.player-wrap').style.display='none';},{once:true});
  });
  await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer?.status),{timeout:30000}).toBe('libass');
  await page.evaluate(()=>document.querySelector('.player-wrap').style.removeProperty('display'));
  await page.setViewportSize({width:1500,height:900});
  await expect.poll(()=>page.locator('.JASSUB').evaluate(canvas=>canvas.getBoundingClientRect().width)).toBeGreaterThan(100);
  expect(centerPixel(await page.locator('.player-stage').screenshot())[2]).toBeGreaterThan(150);
  await expect(page.locator('#media-settings-modal')).not.toBeVisible();
});
