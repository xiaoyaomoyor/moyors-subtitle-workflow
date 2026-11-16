import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server,folder,projectFile;
const source='普通 **重点** //斜体// %%弱化%% __下划线__ ~~删除线~~ ++放大++ --缩小--';
test.setTimeout(120000);
test.beforeAll(async()=>{
  folder=makeTempDir('inline-markup');process.env.MSW_APP_DATA_ROOT=join(folder,'settings');
  process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const media=join(folder,'synthetic.mp4');projectFile=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=960x540:r=25:d=8','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(projectFile,JSON.stringify({media,segments:[{id:'a',start:0,end:6000,text:source}],waveform:generateWaveformPayload(8000,10)}));
  server=await startServer(projectFile,media,await findFreePort());
});
test.afterAll(async()=>server?.stop());
async function ready(page){await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:90000});}

test('project switch, actual ASS preview, plain exports, split, undo and save reopen',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,subtitleAvoidControls:false})));
  await page.goto(server.url);await ready(page);
  await page.evaluate(()=>{selectOnly(0);player.currentTime=1;cueEditorSettingsFloatingPanel.open();});
  const toggle=page.locator('#cue-editor-inline-markup');await expect(toggle).not.toBeChecked();
  await toggle.check();await ready(page);
  const ass=await page.evaluate(async()=>{
    const p=MSWE.resolve('processing-host').exportProject();
    return (await MSWSubtitleStyle.request('subtitle-preview',{project:p,video:{width:960,height:540}})).ass;
  });
  expect(ass).toContain('\\i1');expect(ass).toContain('\\1c&H999999&');expect(ass).not.toContain('**重点**');
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe(source);
  const srt=await page.evaluate(()=>buildSrt());expect(srt).toContain('普通 重点 斜体 弱化 下划线 删除线 放大 缩小');expect(srt).not.toContain('//');
  const halves=await page.evaluate(()=>{
    const segment={...DATA.segments[0],text:'甲**乙丙**丁',items:[]};
    const pair=buildSplitPair(segment,4,3000,'split',false,'continuous',{exactCut:true});
    return [pair.left.text,pair.right.text];
  });
  expect(halves).toEqual(['甲**乙**','**丙**丁']);
  await page.screenshot({path:info.outputPath('inline-markup-dark.png')});
  await page.evaluate(()=>performUndo());await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(()=>buildSrt())).toContain('**重点**');
  await page.evaluate(()=>performRedo());await expect(toggle).toBeChecked();await ready(page);
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const saved=JSON.parse(readFileSync(projectFile,'utf8'));expect(saved.preview.inline_markup).toBe(true);expect(saved.subtitles.cues[0].content.text).toBe(source);
  await page.reload();await ready(page);
  await page.evaluate(()=>{player.currentTime=1;cueEditorSettingsFloatingPanel.open();updateEditorSettings({themePreset:'alice',colors:null});applyThemeAndColors();});
  await expect(toggle).toBeChecked();await page.screenshot({path:info.outputPath('inline-markup-light.png')});
  const merged=await page.evaluate(()=>{
    const preview=structuredClone(DATA.preview);
    applyCanonicalProject({preview,segments:[{id:'first',start:0,end:2000,text:'**甲**',items:[{start:0,end:2000,text:'**甲**'}]},
      {id:'second',start:2000,end:4000,text:'**乙**',items:[{start:2000,end:4000,text:'**乙**'}]}]},'merge-inline.mosp');
    mergeSegments([0,1]);const merged=JSON.parse(buildJson());performUndo();const undone=DATA.segments.map(c=>c.text);performRedo();
    return {merged,undone,redone:DATA.segments[0].text};
  });
  expect(merged.merged.subtitles.cues[0].content.text).toBe('**甲乙**');
  expect(merged.merged.subtitles.cues[0].content.items.map(i=>i.text).join('')).toBe('**甲乙**');
  expect(merged.undone).toEqual(['**甲**','**乙**']);expect(merged.redone).toBe('**甲乙**');
  expect(errors).toEqual([]);
});
