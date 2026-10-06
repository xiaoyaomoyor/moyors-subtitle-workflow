import {expect,test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer,toggleMediaSettings,clickMenubarItem} from './helpers.mjs';

let server,folder;
test.beforeAll(async()=>{
  folder=makeTempDir('project-subtitle-style');
  const media=join(folder,'synthetic.mp4'),project=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=4','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media:'synthetic.mp4',segments:[{start:0,end:3000,text:'中文字幕 Sample'}],waveform:generateWaveformPayload(4000)}));
  server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});

test('project style renders in the player and proofreading does not alter outputs',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready),{timeout:30000}).toBe(true);
  await toggleMediaSettings(page);
  await expect(page.locator('#project-subtitle-style')).toBeVisible();
  await expect(page.locator('#style-preview-mode')).toHaveValue('project');
  await page.locator('#media-settings-modal').screenshot({path:join(folder,'style-settings.png')});
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer?.status),{timeout:45000}).toBe('libass');
  await page.locator('#style-field-primaryColor').fill('#ff0000');
  await page.locator('#style-field-primaryColor').dispatchEvent('change');
  const saved=await page.evaluate(()=>window.MSWE.resolve('processing-host').exportProject().preview.project_style);
  expect(saved.main.primaryColor).toBe('#ff0000');
  await page.evaluate(()=>performUndo());
  await expect(page.locator('#style-field-primaryColor')).not.toHaveValue('#ff0000');
  await page.evaluate(()=>performRedo());
  await expect(page.locator('#style-field-primaryColor')).toHaveValue('#ff0000');
  await page.locator('#style-preview-mode').selectOption('large');
  await expect(page.locator('#style-scope')).toHaveCount(0);
  expect(await page.evaluate(()=>window.MSWSubtitleStyle.currentPreview().scope)).toBe('proof');
  expect(await page.evaluate(()=>window.MSWE.resolve('processing-host').exportProject().preview.project_style)).toEqual(saved);
  await page.locator('#style-preview-mode').selectOption('project');
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer?.status)).toBe('libass');
  await page.locator('#media-settings-close').click();
  await page.evaluate(()=>{const p=window.MSWE.resolve('processing-host').player;p.currentTime=1;p.pause();});
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer.pending)).toBe(false);
  await page.evaluate(()=>window.MSWSubtitleRenderer.repaint());
  await expect(page.locator('.JASSUB')).toBeVisible();
  const png=join(folder,'libass-canvas.png');await page.locator('.JASSUB').screenshot({path:png});
  const count=Number(execFileSync(process.env.MSW_E2E_PYTHON||'python',['-c','from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert("RGB"); print(sum(r>80 and r>g*2 and r>b*2 for r,g,b in im.getdata()))',png],{encoding:'utf8',windowsHide:true}));
  expect(count).toBeGreaterThan(30);
  const payload=await page.evaluate(async()=>{const h=window.MSWE.resolve('processing-host');return window.MSWSubtitleStyle.request('subtitle-preview',{project:h.exportProject(),target:'main',video:{width:640,height:360}});});
  writeFileSync(join(folder,'compare.ass'),payload.ass);
  const dimensions=await page.locator('.JASSUB').boundingBox();
  const ref=join(folder,'ffmpeg-reference.png');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=1','-vf',`ass=compare.ass,scale=${Math.round(dimensions.width)}:${Math.round(dimensions.height)}`,'-frames:v','1',ref],{cwd:folder,windowsHide:true});
  const comparison=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON||'python',['-c',`from PIL import Image
import sys,json
def mask(path):
 im=Image.open(path).convert('RGB'); return {(x,y) for y in range(im.height) for x in range(im.width) if (lambda c:c[0]>80 and c[0]>2*c[1] and c[0]>2*c[2])(im.getpixel((x,y)))}
a,b=mask(sys.argv[1]),mask(sys.argv[2])
print(json.dumps({'browser':len(a),'ffmpeg':len(b),'iou':len(a&b)/max(1,len(a|b))}))`,png,ref],{encoding:'utf8',windowsHide:true}));
  expect(comparison.ffmpeg).toBeGreaterThan(30);expect(comparison.iou).toBeGreaterThan(.5);
  await page.locator('.player-stage').screenshot({path:join(folder,'player-project-style.png')});
  expect(errors).toEqual([]);
});

test('portable editor keeps settings usable and labels approximate preview',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await disableOnboarding(page);await page.goto(pathToFileURL(resolve('blank-editor.html')).href);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await toggleMediaSettings(page);await page.locator('#style-project-preset').selectOption('large');
  await expect(page.locator('#style-field-fontSize')).toHaveValue('72');
  await expect(page.locator('#subtitle-render-status')).toContainText('近似预览');
  expect(errors).toEqual([]);
});

test('preview style badge follows main and secondary visibility, including delayed renderer updates',async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  const badge=page.locator('#subtitle-render-status');
  await expect(badge).toBeVisible();
  for(const [main,secondary] of [[false,false],[false,true],[true,false],[true,true],[false,false]]){
    await page.evaluate(({main,secondary})=>{
      const h=window.MSWE.resolve('processing-host');
      h.data.multi_subtitle={enabled:true,tracks:[{id:'sub',segments:[]}]};
      for(const [id,checked] of [['overlay-toggle',main],['extension-overlay-toggle',secondary]]){const el=document.getElementById(id);el.checked=checked;el.dispatchEvent(new Event('change'));}
    },{main,secondary});
    if(main||secondary)await expect(badge).toBeVisible();else await expect(badge).toBeHidden();
  }
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer.pending)).toBe(false);
  await expect(badge).toBeHidden();
});

for(const legacy of [false,true])for(const bound of [true,false])test(`paired subtitle order renders above and below consistently in libass and FFmpeg (${legacy?'legacy':'modern'}, ${bound?'bound':'unbound'})`,async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await page.evaluate(({legacy,bound})=>{
    const h=window.MSWE.resolve('processing-host'),p=h.data,S=window.MSWProjectStyle;
    const style=legacy?S.fromBurn({main:{color:'#ff0000'},secondary:{color:'#00ff00'}}):S.defaults();
    style.main.primaryColor='#ff0000';style.secondary.primaryColor='#00ff00';
    p.segments=[{id:'main-cue',start:0,end:3000,text:'Main subtitle',items:[]}];
    p.multi_subtitle={schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'sub',role:'extension',segments:[{id:'sub-cue',start:0,end:3000,text:'Secondary subtitle',items:[]}]}],bindings:[{id:'pair',track_id:'sub',main_segment_ids:['main-cue'],extension_segment_ids:['sub-cue']}]};
    if(!bound){p.multi_subtitle.bindings=[];p.multi_subtitle.tracks[0].segments[0].start=100;}
    h.commitProjectStyle(style);dispatchEvent(new Event('msw:subtitles-changed'));
  },{legacy,bound});
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await toggleMediaSettings(page);await page.locator('#style-preview-mode').selectOption('project');
  await page.evaluate(()=>{for(const id of ['overlay-toggle','extension-overlay-toggle']){const el=document.getElementById(id);el.checked=true;el.dispatchEvent(new Event('change'));}});
  await page.evaluate(()=>{const p=window.MSWE.resolve('processing-host').player;p.currentTime=1;p.pause();});
  const distances=new Map();
  for(const [order,gap] of [['main-above',12],['secondary-above',36],['secondary-above',-12],['main-above',-12]]){
    await page.locator('#style-pair-order').selectOption(order);
    const rendered=page.waitForResponse(r=>r.url().endsWith('/subtitle-preview')&&r.status()===200);
    await page.locator('#style-pair-gap').fill(String(gap));await page.locator('#style-pair-gap').dispatchEvent('change');
    await rendered;
    await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer.status==='libass'&&!window.MSWSubtitleRenderer.pending)).toBe(true);
    await page.locator('#media-settings-close').click();await page.evaluate(()=>window.MSWSubtitleRenderer.repaint());
    const name=`${legacy?'legacy':'modern'}-${bound?'bound':'unbound'}-${order}-${gap}`;
    const png=join(folder,name+'.png');await page.locator('.JASSUB').screenshot({path:png});
    const payload=await page.evaluate(()=>{const h=window.MSWE.resolve('processing-host');return window.MSWSubtitleStyle.request('subtitle-preview',{project:h.exportProject(),target:'both',video:{width:640,height:360}});});
    writeFileSync(join(folder,name+'.ass'),payload.ass);
    const box=await page.locator('.JASSUB').boundingBox(),ref=join(folder,name+'-reference.png');
    execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=2','-ss','1','-vf',`ass=${name}.ass,scale=${Math.round(box.width)}:${Math.round(box.height)}`,'-frames:v','1',ref],{cwd:folder,windowsHide:true});
    const rows=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON||'python',['-c',`from PIL import Image
import json,sys
def rows(path):
 im=Image.open(path).convert('RGB'); result=[]
 for channel in (0,1):
  points=[y for y in range(im.height) for x in range(im.width) if (lambda c:c[channel]>80 and c[channel]>2*c[1-channel] and c[channel]>2*c[2])(im.getpixel((x,y)))]
  result.append({'count':len(points),'y':sum(points)/max(1,len(points))})
 return result
print(json.dumps([rows(path) for path in sys.argv[1:]]))`,png,ref],{encoding:'utf8',windowsHide:true}));
    for(const result of rows){for(const row of result)expect(row.count).toBeGreaterThan(30);expect(result[0].y<result[1].y).toBe(order==='main-above');}
    for(let i=0;i<2;i++)expect(Math.abs(rows[0][i].y-rows[1][i].y)).toBeLessThan(3);
    const distance=Math.abs(rows[0][0].y-rows[0][1].y);
    if(gap<0)expect(distance).toBeLessThan(distances.get(order)-1);else distances.set(order,distance);
    await toggleMediaSettings(page);
  }
});

test('saved presets do not mutate project styles and the project survives reload',async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await toggleMediaSettings(page);
  await page.locator('#style-project-preset').selectOption('bilingual');
  await page.locator('#style-save-as').click();
  await page.locator('#style-preset-name').fill('测试双语预设');
  await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-message')).toContainText('预设已保存');
  await page.locator('#style-field-fontSize').fill('96');await page.locator('#style-field-fontSize').dispatchEvent('change');
  expect(await page.evaluate(()=>window.MSWE.resolve('processing-host').data.preview.project_style.main.fontSize)).toBe(96);
  await page.locator('#style-project-preset').selectOption({label:'测试双语预设'});
  await expect(page.locator('#style-field-fontSize')).toHaveValue('44');
  await page.locator('#style-delete-preset').click();
  await expect(page.locator('#style-delete-question')).toContainText('测试双语预设');
  await page.locator('#style-delete-confirm-button').click();
  await expect(page.locator('#style-message')).toContainText('预设已删除');
  await expect(page.locator('#style-project-preset option')).not.toContainText(['测试双语预设']);
  await page.locator('#media-settings-close').click();
  await page.keyboard.press('Control+s');
  await expect.poll(()=>page.evaluate(()=>window.MSWE.resolve('processing-host').data.preview.project_style.main.fontSize)).toBe(44);
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  expect(await page.evaluate(()=>window.MSWE.resolve('processing-host').data.preview.project_style.main.fontSize)).toBe(44);
  await toggleMediaSettings(page);
  await expect(page.locator('#style-delete-preset')).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle.currentPreview().scope)).toBe('project');
  await page.locator('#style-project-preset').selectOption('current');
  await expect(page.locator('#style-field-fontSize')).toHaveValue('96');
});

test('preview endpoints require authentication and reject arbitrary font paths',async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  const results=await page.evaluate(async()=>{
    const h=window.MSWE.resolve('processing-host'),url=h.config.processingUrl;
    const denied=await fetch(url+'/subtitle-presets');
    const invalid=await fetch(url+'/subtitle-font?id=../../private',{headers:{'X-MSW-Token':h.config.requestToken}});
    return [denied.status,invalid.status];
  });
  expect(results).toEqual([403,400]);
});

test('export selects a preset snapshot and restores proofreading on close',async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await toggleMediaSettings(page);await page.locator('#style-preview-mode').selectOption('contrast');
  await page.locator('#media-settings-close').click();
  await clickMenubarItem(page,'文件','video-export-btn');
  await page.locator('#video-export-burn-subtitles').selectOption('main');
  await page.locator('#video-export-style-source').selectOption('preset');
  await page.locator('#video-export-style-preset').selectOption('large');
  const result=await page.evaluate(()=>{const h=window.MSWE.resolve('processing-host'),p=h.exportProject();window.MSWSubtitleStyle.applyExport(p);return {output:p.preview.project_style,project:h.data.preview.project_style,preview:window.MSWSubtitleStyle.currentPreview()};});
  expect(result.output.main.fontSize).toBe(72);expect(result.project.main.fontSize).not.toBe(72);
  expect(result.preview.scope).toBe('export');expect(result.preview.target).toBe('main');
  await page.locator('#video-export-close').click();
  expect(await page.evaluate(()=>window.MSWSubtitleStyle.currentPreview().scope)).toBe('proof');
  expect(await page.evaluate(()=>window.MSWSubtitleStyle.currentPreview().style.name)).toBe('高对比底框');
});
