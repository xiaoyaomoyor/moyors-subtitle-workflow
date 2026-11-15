import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server;
test.setTimeout(120000);
test.beforeAll(async()=>{
  const dir=makeTempDir('subtitle-glyphs'),media=join(dir,'synthetic.mp4'),project=join(dir,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(dir,'settings');process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE;
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=8','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media,segments:[
    {id:'normal',start:0,end:1500,text:'Normal subtitle'},
    {id:'missing',start:2000,end:6000,text:'Missing \u{10fffd}'}
  ],waveform:generateWaveformPayload(8000,10)}));
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});
async function ready(page){await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:90000});}
test.beforeEach(async({page})=>{
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,subtitleAvoidControls:false})));
  await page.goto(server.url);await ready(page);
});

test('real libass warns during playback and clears after editing the offending text',async({page},info)=>{
  const badge=page.locator('#subtitle-render-status');
  await expect(badge).not.toContainText('仍缺字');
  await page.evaluate(()=>{player.currentTime=1;return player.play();});
  await expect(badge).toContainText('U+10FFFD',{timeout:15000});
  await page.evaluate(()=>{player.pause();selectOnly(1);seekFromWaveform(3);});
  await expect(badge).toHaveClass(/has-missing-glyphs/);
  await page.screenshot({path:info.outputPath('missing-glyph-warning.png')});
  await page.evaluate(()=>{cuePanelText.value='Repaired subtitle';cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));});
  await ready(page);
  await expect(badge).not.toContainText('仍缺字');
  await expect(badge).not.toHaveClass(/has-missing-glyphs/);
  expect(await page.evaluate(()=>MSWSubtitleRenderer.renderer.renderer.getMissingGlyphs())).toBe('');
  await page.screenshot({path:info.outputPath('repaired-glyph-warning.png')});
});

test('an absent requested font that falls back successfully is not a missing glyph',async({page})=>{
  await page.evaluate(()=>{
    const style=MSWSubtitleStyle.currentPreview().style;
    style.main.fontName='MSW Deliberately Absent Font';
    MSWE.resolve('processing-host').commitProjectStyle(style);
    player.currentTime=.5;
  });
  await ready(page);
  await expect(page.locator('#subtitle-render-status')).toContainText('已回退');
  await expect(page.locator('#subtitle-render-status')).not.toContainText('仍缺字');
  expect(await page.evaluate(()=>MSWSubtitleRenderer.renderer.renderer.getMissingGlyphs())).toBe('');
});

test('diagnostic polling preserves refresh errors and leaves unchanged status alone',async({page})=>{
  await page.evaluate(()=>{
    window.statusWrites=0;
    new MutationObserver(()=>statusWrites++).observe(document.getElementById('subtitle-render-status'),{childList:true});
  });
  await page.waitForTimeout(1700); // Observe two diagnostic polling intervals.
  expect(await page.evaluate(()=>statusWrites)).toBe(0);
  await page.route('**/subtitle-preview',route=>route.fulfill({status:500,json:{ok:false,error:'Test transient error'}}));
  await page.evaluate(()=>{selectOnly(0);cuePanelText.value='Changed';cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));});
  const badge=page.locator('#subtitle-render-status');
  await expect(badge).toContainText('更新失败');
  await page.waitForTimeout(1700);
  await expect(badge).toContainText('更新失败');
  await page.unroute('**/subtitle-preview');
  await page.evaluate(()=>{cuePanelText.value='Recovered';cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));});
  await ready(page);
  await expect(badge).not.toContainText('更新失败');
});
