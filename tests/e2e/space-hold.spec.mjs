import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server;
test.beforeAll(async()=>{
  const folder=makeTempDir('space-hold');process.env.MSW_APP_DATA_ROOT=join(folder,'settings');
  process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const media=join(folder,'synthetic.mp4'),project=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=10:d=20','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media,segments:[{start:0,end:15000,text:'Preview text'}],waveform:generateWaveformPayload(20000,10)}));
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,subtitleAvoidControls:false})));
  await page.goto(server.url);
  await page.waitForFunction(()=>typeof togglePlayback==='function'&&document.getElementById('player').readyState>=2);
  await page.evaluate(()=>{player.muted=true;player.currentTime=3;});
});
const state=page=>page.evaluate(()=>({rate:player.playbackRate,paused:player.paused,reverse:jklReversePlaying,jkl:jklPlaybackRate}));
const badge=page=>page.locator('#media-speed-hold');
async function hold(page){await page.keyboard.down('Space');await expect(badge(page)).toBeVisible();await expect.poll(()=>state(page)).toMatchObject({rate:2,paused:false,reverse:false});}

test('short taps toggle exactly once and held key repeats do not toggle playback',async({page})=>{
  // Keep the tap in one browser task so runner round trips cannot turn it into a hold.
  const pausedOnKeydown = await page.locator('#media-play-toggle').evaluate(button => {
    button.focus();
    const key = { key: ' ', code: 'Space', bubbles: true, cancelable: true };
    button.dispatchEvent(new KeyboardEvent('keydown', key));
    const paused = player.paused;
    button.dispatchEvent(new KeyboardEvent('keyup', key));
    return paused;
  });
  expect(pausedOnKeydown).toBe(true);
  await expect.poll(()=>state(page)).toMatchObject({paused:false});
  await hold(page);await page.keyboard.down('Space');expect((await state(page)).paused).toBe(false);
  await page.keyboard.up('Space');await expect.poll(()=>state(page)).toMatchObject({rate:1,paused:false});
  await page.keyboard.press('Space');await expect.poll(()=>state(page)).toMatchObject({paused:true});
});

for(const paused of [false,true])test(`hold restores the original 1.5x rate and paused=${paused}`,async({page},info)=>{
  await page.evaluate(()=>{player.playbackRate=1.5;jklPlaybackRate=1.5;});
  if(!paused)await page.keyboard.press('Space');
  await hold(page);const before=await page.locator('#player').evaluate(p=>p.currentTime);
  await expect.poll(()=>page.locator('#player').evaluate(p=>p.currentTime)).toBeGreaterThan(before+.2);
  await expect(page.locator('#media-playback-rate')).toHaveValue('2');
  if(paused)await page.screenshot({path:info.outputPath('space-hold-preview.png')});
  await page.keyboard.up('Space');await expect(badge(page)).toBeHidden();
  await expect.poll(()=>state(page)).toMatchObject({rate:1.5,paused,jkl:1.5});
});

test('text input, native controls and composition keep their own space behavior',async({page})=>{
  await page.evaluate(()=>selectOnly(0));
  const text=page.locator('#cue-panel-text');await text.fill('hello');await text.press('End');
  await page.keyboard.down('Space');await page.waitForTimeout(450);await page.keyboard.up('Space');
  await expect(text).toHaveValue('hello ');expect((await state(page)).paused).toBe(true);await expect(badge(page)).toBeHidden();
  await page.locator('#help-toggle').focus();await page.keyboard.down('Space');await page.waitForTimeout(450);await page.keyboard.up('Space');
  expect((await state(page)).paused).toBe(true);await expect(badge(page)).toBeHidden();
  const blocked=await page.evaluate(()=>{
    const e=new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true,isComposing:true});
    document.body.dispatchEvent(e);return e.defaultPrevented;
  });expect(blocked).toBe(false);
});

for(const reason of ['blur','hidden','focus','pause','ended','project'])test(`temporary speed is cleared on ${reason}`,async({page})=>{
  await hold(page);
  await page.evaluate(reason=>{
    if(reason==='blur')window.dispatchEvent(new Event('blur'));
    if(reason==='hidden'){Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}
    if(reason==='focus'){selectOnly(0);document.getElementById('cue-panel-text').focus();}
    if(reason==='pause')player.pause();
    if(reason==='ended')player.currentTime=player.duration-.01;
    if(reason==='project')applyCanonicalProject({segments:[]},'new.mosp');
  },reason);
  await expect(badge(page)).toBeHidden();await expect.poll(()=>state(page)).toMatchObject({rate:1,paused:true});
  await page.keyboard.up('Space');await expect.poll(()=>state(page)).toMatchObject({rate:1,paused:true});
});

test('releasing a temporary forward preview restores JKL reverse playback',async({page})=>{
  await page.evaluate(()=>{updateEditorSettings({jklPlaybackMode:'direction'});jklPlaybackRate=-.5;startJklReversePlayback();});
  await expect.poll(()=>state(page)).toMatchObject({reverse:true});await hold(page);
  await page.keyboard.up('Space');await expect.poll(()=>state(page)).toMatchObject({rate:.5,paused:true,reverse:true,jkl:-.5});
});

test('dubbed timeline retains the existing 1x synchronization constraint',async({page})=>{
  await page.evaluate(()=>{const audio=MSWE.resolve('audio-timeline');audio.hasAudible=()=>true;});
  await page.keyboard.down('Space');await page.waitForTimeout(450);await page.keyboard.up('Space');
  await expect(badge(page)).toBeHidden();expect((await state(page)).rate).toBe(1);
});

test('a new speed choice cancels the hold without being overwritten on release',async({page})=>{
  await page.keyboard.press('Space');await hold(page);
  await page.evaluate(()=>{player.playbackRate=1.25;});
  await expect(badge(page)).toBeHidden();await page.keyboard.up('Space');
  await expect.poll(()=>state(page)).toMatchObject({rate:1.25,jkl:1.25,paused:false});
});
