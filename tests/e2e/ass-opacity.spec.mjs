import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server,folder,projectFile;
test.setTimeout(120000);
test.beforeAll(async()=>{
  folder=makeTempDir('ass-opacity');
  process.env.MSW_APP_DATA_ROOT=join(folder,'settings');
  process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const media=join(folder,'synthetic.mp4');projectFile=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=8','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(projectFile,JSON.stringify({media,segments:[{id:'a',start:0,end:6000,text:'Outline and shadow',color:{name:'speaker-9',start:0,end:6000}}],
    preview:{speaker_palette:{version:1,rows:[{id:'speaker-9',name:'角色',color:'#88aaff',mode:'none',separator:' / '}]}},waveform:generateWaveformPayload(8000,10)}));
  server=await startServer(projectFile,media,await findFreePort());
});
test.afterAll(async()=>server?.stop());
async function ready(page){await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:90000});}
async function edit(page,key,value){const input=page.locator('#style-field-'+key);await input.fill(String(value));await input.press('Tab');}
test.beforeEach(async({page})=>{
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,subtitleAvoidControls:false})));
  await page.goto(server.url);await ready(page);
});

test('track, speaker and cue opacity inherit, undo, save and reload in the existing panel',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('track');player.currentTime=1;});
  await expect(page.locator('#style-field-outlineOpacity')).toHaveValue('100');
  await edit(page,'outlineOpacity',50);
  await page.locator('#style-more > summary').click();
  await edit(page,'shadow',12);await edit(page,'shadowOpacity',75);
  await page.locator('#style-edit-scope').selectOption('speaker');
  await page.locator('#style-speaker-target').selectOption('speaker-9');
  await expect(page.locator('#style-field-outlineOpacity')).toHaveValue('50');
  await edit(page,'shadowOpacity',25);
  await page.locator('#style-edit-scope').selectOption('cue');
  await expect(page.locator('#style-field-shadowOpacity')).toHaveValue('25');
  await edit(page,'outlineOpacity',0);
  await expect(page.locator('[data-reset-style="outlineOpacity"]')).toHaveClass(/is-overridden/);
  await page.locator('[data-reset-style="outlineOpacity"]').click();
  await expect(page.locator('#style-field-outlineOpacity')).toHaveValue('50');
  await page.evaluate(()=>performUndo());
  await expect(page.locator('#style-field-outlineOpacity')).toHaveValue('0');
  await page.evaluate(()=>performRedo());
  await expect(page.locator('#style-field-outlineOpacity')).toHaveValue('50');
  await edit(page,'outlineOpacity',37.5);
  await ready(page);
  await page.screenshot({path:info.outputPath('opacity-properties-dark.png')});
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const disk=JSON.parse(readFileSync(projectFile,'utf8'));
  expect(disk.subtitles.cues[0].content.subtitle_style.outlineOpacity).toBe(37.5);
  await page.reload();await ready(page);
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});
  await expect(page.locator('#style-field-outlineOpacity')).toHaveValue('37.5');
  await expect(page.locator('#style-field-shadowOpacity')).toHaveValue('25');
  const rendered=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:MSWE.resolve('processing-host').exportProject(),video:{width:640,height:360}}));
  expect(rendered.ass).toContain('&H9F000000,&HBF000000');
  await page.evaluate(()=>{updateEditorSettings({themePreset:'alice',colors:null});applyThemeAndColors();});
  await page.screenshot({path:info.outputPath('opacity-properties-light.png')});
  expect(errors).toEqual([]);
});

test('native preview keeps a zero-opacity shadow hidden during text wave animation',async({page},info)=>{
  await page.evaluate(()=>{
    const p=MSWE.resolve('processing-host').exportProject(),cue=p.subtitles.cues[0].content;
    cue.text='ABCD';delete cue.color;
    cue.subtitle_style={fontSize:180,outline:12,shadow:20,outlineColor:'#ff0000',backColor:'#00ff00',outlineOpacity:50,shadowOpacity:0};
    const a=MSWSubtitleAnimation.defaults();a.mode='custom';
    a.effects.curves.enabled=true;a.effects.curves.channels={opacity:[{time:0,value:50,easing:'linear'}]};
    a.effects.wave.enabled=true;cue.subtitle_animation=a;
    productionCommitProject(p,'测试动画不透明度',[]);player.currentTime=.5;player.pause();
  });
  await ready(page);await page.evaluate(()=>MSWSubtitleRenderer.repaint());
  await expect(page.locator('.JASSUB')).toBeVisible();
  const png=info.outputPath('opacity-wave-libass.png');await page.locator('.JASSUB').screenshot({path:png});
  const counts=JSON.parse(execFileSync(process.env.MAW_E2E_PYTHON||'python',['-c',
    'from PIL import Image; import sys,json; p=list(Image.open(sys.argv[1]).convert("RGB").getdata()); print(json.dumps([sum(r>g+10 and r>b+10 for r,g,b in p),sum(g>r+10 and g>b+10 for r,g,b in p)]))',png],{encoding:'utf8',windowsHide:true}));
  expect(counts[0]).toBeGreaterThan(20);expect(counts[1]).toBe(0);
});
