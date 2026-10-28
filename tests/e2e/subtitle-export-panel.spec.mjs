import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer,clickMenubarItem,cleanupTempDir} from './helpers.mjs';
let server,dir;
test.beforeAll(async()=>{
  dir=makeTempDir('subtitle-export-panel');process.env.MSW_APP_DATA_ROOT=join(dir,'settings');process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  const media=generateWav(join(dir,'media.wav'),6),project=join(dir,'export.mosp');
  writeFileSync(project,JSON.stringify({media,segments:[{start:1000,end:2000,text:'Source'}],waveform:generateWaveformPayload(6000)}));
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();cleanupTempDir(dir);});
test.beforeEach(async({page})=>{
  await disableOnboarding(page);await page.addInitScript(()=>{
    localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,exportSpeakerLabels:false,exportStartAtZero:false}));
    window.saves=[];window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>window.saves.push({name:options.suggestedName,text:await blob.text()}),close:async()=>{}})});
  });
  await page.goto(server.url);await expect(page.locator('#editor-loading')).not.toBeVisible();
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),base=p.subtitles.tracks[0];p.subtitles.cues=[];p.subtitles.bindings=[];p.subtitle_view.secondary_cue_ids=[];
    p.subtitles.tracks=[{...base,id:'one',display_number:1},{...base,id:'two',display_number:2,collapsed:true},{...base,id:'off',display_number:3,enabled:false}];p.subtitles.next_track_number=4;
    p.subtitles.cues=[['one',1000,2000,'Hello world'],['two',1000,2000,'你好世界'],['one',3000,4000,'Later'],['off',4000,5000,'Hidden']].map(([track_id,start,end,text],i)=>({id:'c'+i,track_id,content:{start,end,text,items:[]}}));
    applyCanonicalProject(p,'export-test.mosp');renderAll({waveform:'full'});
  });
  await clickMenubarItem(page,'文件','subtitle-export-btn');await expect(page.locator('#subtitle-export-panel')).toBeVisible();
});
test.afterEach(async({page})=>page.close());
async function save(page,format='srt'){await page.locator('#subtitle-export-format').selectOption(format);await page.locator('#subtitle-export-start').click();await expect(page.locator('#subtitle-export-message')).toContainText('已导出',{timeout:20000});return page.evaluate(()=>saves.at(-1));}
test('single panel exports selected physical tracks, including collapsed tracks; all may be unchecked',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('#subtitle-export-menu')).toHaveCount(0);
  await expect(page.locator('#subtitle-export-summary')).toHaveText('轨道：2 | 字幕块：3');
  const before=await page.evaluate(()=>buildJson());const all=await save(page);expect(all.text).toContain('Hello world');expect(all.text).toContain('你好世界');expect(all.text).not.toContain('Hidden');
  await page.locator('#subtitle-export-scope input[data-track="all"]').uncheck();await expect(page.locator('#subtitle-export-start')).toBeDisabled();
  await page.locator('#subtitle-export-scope input[data-track="two"]').check();const txt=await save(page,'txt');expect(txt.text).toBe('你好世界');
  expect(await page.evaluate(()=>buildJson())).toBe(before);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('subtitle-export-dark.png')});
});
test('merged output and start-at-zero are applied to downloads only',async({page})=>{
  await page.locator('#subtitle-export-mode').selectOption('merged');await page.locator('#subtitle-export-more summary').click();await page.locator('#export-start-at-zero').check();
  const saveResult=await save(page);expect(saveResult.text).toContain('00:00:00,000 --> 00:00:02,000');expect(saveResult.text).toContain('Hello world\n你好世界');
  expect(await page.evaluate(()=>JSON.parse(buildJson()).subtitles.cues[0].content.start)).toBe(1000);
});
test('exact ASS uses the same selected track and project styling',async({page})=>{
  await page.locator('#subtitle-export-scope input[data-track="one"]').uncheck();
  const result=await save(page,'ass');expect(result.text).toContain('[V4+ Styles]');expect(result.text).toContain('你好世界');expect(result.text).not.toContain('Hello world');expect(result.text).not.toContain('Hidden');
});
test('save cancellation keeps the form and does not fall back to a download',async({page})=>{
  let downloads=0;page.on('download',()=>downloads++);await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('Cancelled','AbortError');};});
  await page.locator('#subtitle-export-start').click();await expect(page.locator('#subtitle-export-message')).toHaveText('已取消导出');expect(downloads).toBe(0);await expect(page.locator('#subtitle-export-start')).toBeEnabled();
});
test('speaker files materialize color references and preserve unmarked subtitles',async({page})=>{
  await page.evaluate(()=>{
    DATA.segments[0].color={name:'red',value:'#ff0000',start:1000,end:4000};
    DATA.segments[2].color_ref={name:'red',headIdx:0};
    updateEditorSettings({exportColorUnified:false,exportSpeakerNamesAsSuffix:false});
    MSWSubtitleExport.open('srt');
  });
  await page.locator('#subtitle-export-mode').selectOption('speaker');await page.locator('#subtitle-export-start').click();
  await expect(page.locator('#subtitle-export-message')).toHaveText('已导出 2 份文件');
  const files=await page.evaluate(()=>saves);expect(files.find(f=>f.name.includes('红色')).text).toContain('Later');
  expect(files.find(f=>f.name.includes('default')).text).toContain('你好世界');
});
test('skip gaps remaps SRT time while retaining source times and preferences on reopen',async({page})=>{
  await page.evaluate(()=>{DATA.gap_remove={schema:'moy.asr.gap_remove.v1',detector:'audio_gate',gaps:[{start:2000,end:2500,removed:true}]};});
  await page.locator('#subtitle-export-remove-gaps').check();const result=await save(page);
  expect(result.text).toContain('00:00:02,500 --> 00:00:03,500');
  expect(await page.evaluate(()=>DATA.segments.find(c=>c.text==='Later').start)).toBe(3000);
  await page.locator('#subtitle-export-more summary').click();await page.locator('#export-start-at-zero').check();
  await page.locator('#subtitle-export-close').click();await clickMenubarItem(page,'文件','subtitle-export-btn');
  await expect(page.locator('#export-start-at-zero')).toBeChecked();await expect(page.locator('#subtitle-export-remove-gaps')).toBeChecked();
});
test('dynamic format uses one chosen physical track and shared dimensions, reports packaging errors',async({page})=>{
  await page.locator('#subtitle-export-format').selectOption('lottie');await page.locator('#subtitle-export-single-track').selectOption('two');
  await expect(page.locator('#subtitle-export-scope')).not.toBeVisible();await expect(page.locator('#subtitle-export-dynamic')).toBeVisible();
  let payload;await page.route('**/*lottie*',async route=>{if(route.request().method()!=='POST')return route.continue();payload=route.request().postDataJSON();await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Packaging test error'})});});
  await page.locator('#subtitle-export-start').click();await expect(page.locator('#subtitle-export-message')).toContainText('Packaging test error');
  expect(JSON.stringify(payload.animation)).toContain('你好世界');expect(JSON.stringify(payload.animation)).not.toContain('Hello world');await expect(page.locator('#subtitle-export-start')).toBeEnabled();
});
for(const format of ['lottie','ograf'])test(`packages ${format} through the local service from the unified panel`,async({page})=>{
  const result=await save(page,format);
  expect(result.name).toMatch(format==='lottie'?/\.lottie$/:/\.ograf\.zip$/);
  expect(result.text.startsWith('PK')).toBe(true);
});
test('narrow layout remains inside the viewport and option help is a shared popup',async({page},info)=>{
  await page.setViewportSize({width:620,height:820});await page.locator('#subtitle-export-close').click();await clickMenubarItem(page,'文件','subtitle-export-btn');
  await page.locator('#subtitle-export-panel [data-option-help]').first().locator('.msw-help-button').click();await expect(page.locator('#msw-option-help')).toBeVisible();
  const box=await page.locator('#subtitle-export-panel').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(620);
  for(const label of await page.locator('#subtitle-export-scope label').all()){const b=await label.boundingBox();expect(b.height).toBeLessThan(32);}
  await page.screenshot({path:info.outputPath('subtitle-export-narrow.png')});
  await page.keyboard.press('Escape');await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.screenshot({path:info.outputPath('subtitle-export-light.png')});
});
