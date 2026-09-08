import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, openMenubarMenu, startTtsServer, startStaticServer } from './helpers.mjs';

let mock, origin, server, dir, projectPath, mediaPath, wav, calls, held, holdText, failText;
test.beforeAll(async () => {
  mock = createServer(async (req, res) => {
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    const data=JSON.parse(Buffer.concat(chunks)); calls.push(data);
    const respond=()=>{ res.writeHead(data.text === failText ? 503 : 200, {'Content-Type':'audio/wav'}); res.end(wav); };
    if (data.text === holdText) held.push(respond); else respond();
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve)); origin=`http://127.0.0.1:${mock.address().port}`;
});
test.afterAll(async()=>{ await new Promise(resolve=>mock.close(resolve)); });
test.beforeEach(async({page})=>{
  calls=[]; held=[]; holdText=null; failText=null;
  dir=makeTempDir('editor-tts'); process.env.MAW_ENV_FILE=join(dir,'isolated.env'); process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');
  wav=readFileSync(generateWav(join(dir,'tts-result.wav'),.2));
  await disableOnboarding(page);
  page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());
});
test.afterEach(async()=>{ for(const respond of held.splice(0)) respond(); await server?.stop(); server=null; });
function fixture(dual=false,count=2) {
  return {media:'',language:'Chinese',msw:{schema:'msw.editor.v1',project_id:randomUUID()},
    segments:Array.from({length:count},(_,i)=>({id:`main-${i}`,start:i*2000,end:i*2000+1500,text:i===0?'Hello':i===1?'World':`Line ${i}`})),
    waveform:generateWaveformPayload(Math.max(10000,count*2000)),
    ...(dual?{multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',
      tracks:[{id:'ext',role:'extension',name:'Secondary',language:'English',split_mode:'word',segments:[
        {id:'x',start:100,end:1400,text:'Secondary Hello'},{id:'y',start:4100,end:5000,text:'Independent'}]}],
      bindings:[{id:'link',track_id:'ext',main_segment_ids:['main-0'],extension_segment_ids:['x'],start_offset_ms:100,end_offset_ms:-100}]}}:{})};
}
async function open(page,dual=false,count=2) {
  projectPath=join(dir,'test.mosp'); mediaPath=generateWav(join(dir,'synthetic.wav'),Math.max(10,count*2));
  writeFileSync(projectPath,JSON.stringify(fixture(dual,count)));
  server=await startTtsServer(projectPath,mediaPath,await findFreePort(),origin);
  await page.goto(server.url); await expect(page.locator('#editor-loading')).not.toBeVisible();
  await expect.poll(()=>page.evaluate(()=>DATA.segments.length)).toBe(count);
}
async function panel(page,configure=true) {
  await openMenubarMenu(page,'媒体'); await page.locator('#tts-open').click();
  await expect(page.locator('#tts-panel')).toBeVisible();
  if(configure) {
    await expect(page.locator('#tts-model option')).toHaveCount(5);
    await page.locator('#tts-settings').evaluate(el=>el.open=true);
    await page.locator('#tts-key').fill('synthetic-tts-key');
  }
}
const countAssets=page=>page.evaluate(()=>DATA.msw?.assets?.length||0);
async function prepareClips(page) {
  await open(page,true);
  wav=readFileSync(generateWav(join(dir,'clip.wav'),1.5));
  // Distinct PCM16 levels verify an actual time-varying RMS analysis.
  let dataOffset=12;
  while(wav.toString('ascii',dataOffset,dataOffset+4)!=='data') { const size=wav.readUInt32LE(dataOffset+4); dataOffset+=8+size+(size%2); }
  const frames=(wav.length-dataOffset-8)/2;
  for(let i=0;i<frames;i++) wav.writeInt16LE(Math.round(Math.sin(i*.08)*(i<frames/3?400:i<frames*2/3?20000:3000)),dataOffset+8+i*2);
  await panel(page); await page.locator('#tts-target').selectOption('main'); await page.locator('#tts-start').click();
  await expect.poll(()=>countAssets(page)).toBe(2); await page.locator('#tts-close').click();
  const row=page.locator('.waveform-row').first(), bounds=await row.boundingBox();
  await page.locator('.msw-asset-row').first().dragTo(row,{sourcePosition:{x:30,y:15},targetPosition:{x:bounds.width*.2,y:bounds.height*.75}});
  await expect.poll(()=>page.evaluate(()=>DATA.msw.audio_clips?.length||0)).toBe(1);
  return page.locator('.msw-audio-clip').first();
}
test('audio clip click seeks to the pointer while move and trim keep their own gestures',async({page})=>{
  const clip=await prepareClips(page);
  await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  const initial=await page.evaluate(()=>({...DATA.msw.audio_clips[0]}));
  const box=await clip.boundingBox(), row=await page.locator('.waveform-row').first().boundingBox();
  const point={x:box.width*.72,y:10};
  const expected=await page.locator('.waveform-row').first().evaluate((el,{x,left,width})=>{
    const start=Number(el.dataset.startMs), end=Number(el.dataset.endMs); return (start+(x-left)/width*(end-start))/1000;
  },{x:box.x+point.x,left:row.x,width:row.width});
  await clip.click({position:point});
  await expect.poll(()=>page.evaluate(()=>document.getElementById('player').currentTime)).toBeCloseTo(expected,2);
  expect(await page.evaluate(()=>DATA.msw.audio_clips[0])).toEqual(initial);
  const before=await page.evaluate(()=>document.getElementById('player').currentTime);
  const b=await clip.boundingBox(); await page.mouse.move(b.x+b.width/2,b.y+10); await page.mouse.down();
  await page.mouse.move(b.x+b.width/2+35,b.y+10,{steps:5}); await page.mouse.up();
  expect(await page.evaluate(()=>DATA.msw.audio_clips[0].start_ms)).toBeGreaterThan(initial.start_ms);
  expect(await page.evaluate(()=>document.getElementById('player').currentTime)).toBeCloseTo(before,2);
  const trimmed=await clip.boundingBox(); await page.mouse.move(trimmed.x+trimmed.width-3,trimmed.y+10); await page.mouse.down();
  await page.mouse.move(trimmed.x+trimmed.width-22,trimmed.y+10,{steps:5}); await page.mouse.up();
  expect(await page.evaluate(()=>DATA.msw.audio_clips[0].source_out_sample)).toBeLessThan(initial.source_out_sample);
  expect(await page.evaluate(()=>document.getElementById('player').currentTime)).toBeCloseTo(before,2);
});

test('audio clip palette follows subtitle, accent, selection and muted text colors live',async({page})=>{
  const clip=await prepareClips(page);
  await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  for(const [key,value] of Object.entries({accent:'#d9577e',cueBlock:'#387ab9',gap:'#81d86b',textMuted:'#ba8fa2',subtitle:'#f0be71'})) {
    await page.locator(`#interface-color-${key}`).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
  }
  const labels=page.locator('.cues-container .cue .text, .waveform-cue-label, .msw-audio-clip-label');
  expect(await labels.count()).toBeGreaterThanOrEqual(5);
  expect(await labels.evaluateAll(els=>[...new Set(els.map(el=>getComputedStyle(el).color))])).toEqual(['rgb(240, 190, 113)']);
  const heat=await clip.evaluate(el=>el.style.backgroundImage);
  await clip.click(); await expect(clip).toHaveCSS('outline-color','rgb(129, 216, 107)');
  await expect(clip).toHaveCSS('border-radius','4px');
  expect(await clip.evaluate(el=>el.style.backgroundImage)).toBe(heat);
  await page.locator('#waveform-settings-item').evaluate(el=>el.click()); await page.locator('#audio-clips-heatmap').uncheck(); await page.keyboard.press('Escape');
  const solid=await clip.evaluate(el=>{
    const probe=document.createElement('span');probe.style.backgroundColor='color-mix(in srgb, var(--accent) 42%, var(--wave-cue-mix))';el.appendChild(probe);
    const color=getComputedStyle(probe).backgroundColor;probe.remove();return {actual:getComputedStyle(el).backgroundColor,expected:color,image:getComputedStyle(el).backgroundImage};
  });
  expect(solid.actual).toBe(solid.expected); expect(solid.image).toBe('none');
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'audio-clips-palette.png')});
  await clip.click({button:'right'}); await page.locator('.msw-audio-menu').getByRole('button',{name:'静音音频贴片',exact:true}).click();
  await expect(clip.locator('.msw-audio-clip-label')).toHaveCSS('color','rgb(186, 143, 162)');
  await expect(clip.locator('.msw-audio-clip-label')).toHaveCSS('text-decoration-line','line-through');
  await expect(clip).toHaveCSS('outline-color','rgb(129, 216, 107)');
  expect(await clip.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await page.locator('.waveform-cue-block[data-track="main"]').first().evaluate(el=>getComputedStyle(el).backgroundColor));
  expect(await clip.locator('.msw-audio-icon').evaluate(el=>getComputedStyle(el,'::after').content)).toBe('""');
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'audio-clips-palette-muted.png')});
  await page.locator('#waveform-settings-item').evaluate(el=>el.click()); await page.locator('#audio-clips-heatmap').check(); await page.keyboard.press('Escape');
  await expect(clip).toHaveCSS('background-image','none');
  await clip.click({button:'right'}); await page.locator('.msw-audio-menu').getByRole('button',{name:'取消静音',exact:true}).click();
  await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  await expect(clip.locator('.msw-audio-clip-label')).toHaveCSS('color','rgb(240, 190, 113)');
  await page.locator('#interface-color-subtitle').evaluate(el=>{el.value='#99ccee';el.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(await labels.evaluateAll(els=>[...new Set(els.map(el=>getComputedStyle(el).color))])).toEqual(['rgb(153, 204, 238)']);
});

test('audio clips drag below compact subtitle lanes, mute, undo and delete independently',async({page})=>{
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const clip=await prepareClips(page);
  await expect(clip).toBeVisible();
  const main=await page.locator('.waveform-cue-block[data-track="main"]').first().boundingBox();
  const ext=await page.locator('.waveform-cue-block[data-track="extension"]').first().boundingBox();
  const audio=await clip.boundingBox();
  expect(main.height).toBeLessThanOrEqual(22); expect(ext.height).toBeLessThanOrEqual(22);
  expect(main.y+main.height).toBeLessThanOrEqual(ext.y+1); expect(ext.y+ext.height).toBeLessThanOrEqual(audio.y);
  await clip.click({button:'right'}); await page.locator('.msw-audio-menu').getByRole('button',{name:'静音音频贴片',exact:true}).click();
  await expect(clip).toHaveClass(/muted/);
  await expect(clip.locator('.msw-audio-clip-label')).toHaveCSS('text-decoration-line','line-through');
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'audio-clips-muted.png')});
  await page.keyboard.press('Control+z'); await expect(clip).not.toHaveClass(/muted/);
  await clip.click(); await page.keyboard.press('Delete'); await expect.poll(()=>page.evaluate(()=>DATA.msw.audio_clips.length)).toBe(0);
  expect(await page.evaluate(()=>DATA.segments.length)).toBe(2); expect(await countAssets(page)).toBe(2);
  await page.keyboard.press('Control+z'); await expect.poll(()=>page.evaluate(()=>DATA.msw.audio_clips.length)).toBe(1);
  expect(errors).toEqual([]);
});
test('audio clips move, trim, stack, save and restore with heatmap settings',async({page})=>{
  const clip=await prepareClips(page);
  await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  expect(await clip.evaluate(el=>new Set(el.style.backgroundImage.match(/rgb\([^)]+\)/g)).size)).toBeGreaterThan(2);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'audio-clips-heatmap.png')});
  const original=await page.evaluate(()=>({...DATA.msw.audio_clips[0]}));
  const b=await clip.boundingBox(); await page.mouse.move(b.x+b.width/2,b.y+10); await page.mouse.down(); await page.mouse.move(b.x+b.width/2+40,b.y+10,{steps:5}); await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>DATA.msw.audio_clips[0].start_ms)).toBeGreaterThan(original.start_ms);
  const trimmed=await clip.boundingBox(); await page.mouse.move(trimmed.x+trimmed.width-3,trimmed.y+10); await page.mouse.down(); await page.mouse.move(trimmed.x+trimmed.width-23,trimmed.y+10,{steps:5}); await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>DATA.msw.audio_clips[0].source_out_sample)).toBeLessThan(original.source_out_sample);
  await page.evaluate(()=>{ const c=DATA.msw.audio_clips[0]; MSWE.resolve('audio-timeline').insert(c.asset_id,c.start_ms); });
  const boxes=await page.locator('.msw-audio-clip').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().y)); expect(new Set(boxes).size).toBe(2);
  await page.locator('#waveform-settings-item').evaluate(el=>el.click());
  await page.locator('#audio-clips-heatmap').uncheck(); await page.locator('#audio-clips-gap-policy').selectOption('follow');
  await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toBe('');
  await page.keyboard.press('Escape'); await page.keyboard.press('Control+s');
  await expect.poll(()=>JSON.parse(readFileSync(projectPath)).msw.audio_clips?.length||0).toBe(2);
  await page.reload(); await expect.poll(()=>page.evaluate(()=>DATA.msw.audio_clips.length)).toBe(2);
  expect(await page.evaluate(()=>DATA.msw.audio_settings)).toEqual({heatmap:false,gap_policy:'follow'});
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'audio-clips.png')});
});
test('audio clip playback stops old sources on seek and mute',async({page})=>{
  const clip=await prepareClips(page); await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  await page.evaluate(async()=>{ const p=document.getElementById('player'); p.currentTime=DATA.msw.audio_clips[0].start_ms/1000+.1; await p.play(); });
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(1);
  await page.evaluate(()=>document.getElementById('player').currentTime=8);
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(0);
  await page.evaluate(()=>document.getElementById('player').pause());
  await clip.click({button:'right'}); await page.locator('.msw-audio-menu').getByRole('button',{name:'静音音频贴片',exact:true}).click();
  await page.evaluate(async()=>{ const p=document.getElementById('player'); p.currentTime=DATA.msw.audio_clips[0].start_ms/1000; await p.play(); });
  expect(await page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(0);
});
test('audio clips buffer before playing and a cancelled load cannot restart playback',async({page})=>{
  await prepareClips(page); await page.keyboard.press('Control+s');
  await expect.poll(()=>JSON.parse(readFileSync(projectPath)).msw.audio_clips?.length||0).toBe(1);
  let release; const gate=new Promise(resolve=>release=resolve);
  await page.route('**/asset-audio?*',async route=>{await gate; await route.continue();});
  await page.reload(); await expect(page.locator('.msw-audio-clip').first()).toBeVisible();
  await page.evaluate(()=>MSWE.resolve('processing-host').seek(DATA.msw.audio_clips[0].start_ms/1000));
  await page.locator('#media-play-toggle').click();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().buffering)).toBe(true);
  const start=await page.evaluate(()=>document.getElementById('player').currentTime);
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>document.getElementById('player').currentTime)).toBeCloseTo(start,2);
  await page.locator('#media-play-toggle').click(); release();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().decoded)).toBe(1);
  expect(await page.evaluate(()=>document.getElementById('player').paused)).toBe(true);
  await page.locator('#media-play-toggle').click();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(1);
});

test('audio clips overlap audibly, protect skipped gaps and can follow gap removal',async({page})=>{
  const clip=await prepareClips(page); await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  await page.evaluate(()=>{
    const h=MSWE.resolve('processing-host'), c=DATA.msw.audio_clips[0];
    MSWE.resolve('audio-timeline').insert(c.asset_id,c.start_ms);
    DATA.gap_remove={schema:'moy.asr.gap_remove.v1',enabled:true,skip_playback:true,gaps:[{start:c.start_ms,end:c.start_ms+1500,removed:true}]};
    h.seek(c.start_ms/1000); h.togglePlayback();
  });
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(2);
  expect(await page.evaluate(()=>document.getElementById('player').currentTime*1000-DATA.msw.audio_clips[0].start_ms)).toBeLessThan(1400);
  await page.evaluate(()=>{
    const h=MSWE.resolve('processing-host'); h.pauseMedia();
    h.commitAudio('test gap policy',ext=>ext.audio_settings={gap_policy:'follow'});
    h.seek(DATA.msw.audio_clips[0].start_ms/1000); h.togglePlayback();
  });
  await expect.poll(()=>page.evaluate(()=>document.getElementById('player').currentTime*1000-DATA.msw.audio_clips[0].start_ms)).toBeGreaterThanOrEqual(1500);
  expect(await page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(0);
});

test('audio clips continue after source media ends and work without original media',async({page})=>{
  const clip=await prepareClips(page); await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  await page.evaluate(()=>{
    const h=MSWE.resolve('processing-host'); h.commitAudio('test tail',ext=>ext.audio_clips[0].start_ms=9800);
    h.seek(9.85); h.togglePlayback();
  });
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().virtual)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').virtualPlaying())).toBe(false);
  await page.locator('#media-play-toggle').click();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().virtual)).toBe(false);
  await page.evaluate(()=>MSWE.resolve('processing-host').pauseMedia());
  await page.keyboard.press('Control+s');
  await expect.poll(()=>JSON.parse(readFileSync(projectPath)).msw.audio_clips?.[0]?.start_ms).toBe(9800);
  await server.stop();
  const audioOnly=JSON.parse(readFileSync(projectPath)); audioOnly.media=''; delete audioOnly.waveform;
  writeFileSync(projectPath,JSON.stringify(audioOnly));
  server=await startTtsServer(projectPath,null,await findFreePort(),origin); await page.goto(server.url);
  await expect(page.locator('.msw-audio-clip').first()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.getElementById('player').readyState)).toBe(0);
  await page.evaluate(()=>{const h=MSWE.resolve('processing-host'); h.seek(10); h.togglePlayback();});
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(1);
  await page.locator('#media-play-toggle').click();
  expect(await page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(0);
});

test('audio clips keep dense lanes scrollable in basic and multi modes',async({page})=>{
  await prepareClips(page);
  await page.evaluate(()=>MSWE.resolve('processing-host').commitAudio('test dense clips',ext=>{
    const c=ext.audio_clips[0]; ext.audio_clips=Array.from({length:50},(_,i)=>({...c,id:`dense-${i}`}));
  }));
  const lanes=page.locator('.msw-audio-lanes').first();
  expect(await page.locator('.msw-audio-clip').count()).toBeLessThan(10);
  await lanes.evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect.poll(()=>lanes.evaluate(el=>el.scrollTop)).toBeGreaterThan(900);
  await expect(page.locator('[data-clip-id="dense-9"]')).toBeVisible();
  await page.locator('#waveform-settings-item').evaluate(el=>el.click());
  await page.locator('#waveform-display-mode').selectOption('basic');
  await page.keyboard.press('Escape');
  const ext=await page.locator('.waveform-cue-block[data-track="extension"]').first().boundingBox();
  const band=await lanes.boundingBox(); expect(ext.y+ext.height).toBeLessThanOrEqual(band.y);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'audio-clips-dense.png')});
  await page.evaluate(()=>MSWE.resolve('processing-host').commitAudio('test short clips',ext=>{
    const c=ext.audio_clips[0], samples=ext.assets[0].sample_rate/1000;
    ext.audio_clips=[{...c,id:'tiny-1',start_ms:2000,source_in_sample:0,source_out_sample:samples},
      {...c,id:'tiny-2',start_ms:2001,source_in_sample:0,source_out_sample:samples}];
  }));
  const tiny=await page.locator('.msw-audio-clip').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {x:b.x,right:b.right};}));
  expect(tiny).toHaveLength(2); expect(tiny[0].right).toBeLessThanOrEqual(tiny[1].x+.02);
});

test('audio clips preserve missing references, reload restored audio and stop on project switch',async({page})=>{
  await prepareClips(page); await page.keyboard.press('Control+s');
  await expect.poll(()=>JSON.parse(readFileSync(projectPath)).msw.audio_clips?.length||0).toBe(1);
  await page.route('**/asset-audio?*',route=>route.fulfill({status:404,body:'missing'}));
  await page.reload(); const clip=page.locator('.msw-audio-clip').first(); await expect(clip).toHaveClass(/missing/);
  expect(await page.evaluate(()=>DATA.msw.audio_clips.length)).toBe(1);
  await page.unroute('**/asset-audio?*'); await clip.click({button:'right'});
  await page.locator('.msw-audio-menu').getByRole('button',{name:'重新加载素材',exact:true}).click();
  await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  await page.evaluate(()=>{const h=MSWE.resolve('processing-host'); h.seek(DATA.msw.audio_clips[0].start_ms/1000); h.togglePlayback();});
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(1);
  const other=fixture(); page.removeAllListeners('dialog'); page.on('dialog',dialog=>dialog.accept());
  await openMenubarMenu(page,'文件'); const chooser=page.waitForEvent('filechooser'); await page.locator('#open-project').click();
  await(await chooser).setFiles({name:'other.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(other))});
  await expect.poll(()=>page.evaluate(()=>DATA.msw.project_id)).toBe(other.msw.project_id);
  await expect(page.locator('.msw-audio-clip')).toHaveCount(0);
  expect(await page.evaluate(()=>MSWE.resolve('audio-timeline').diagnostics().active)).toBe(0);
});

test('TTS creates durable assets, opens lower-right, previews, exports and survives reload',async({page})=>{
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await open(page); await expect(page.locator('#asset-library')).not.toBeVisible();
  await panel(page); await page.locator('#tts-save-settings').click();
  await expect(page.locator('#tts-message')).toContainText('已保存');
  await expect(page.locator('#tts-key')).toHaveValue('');
  await page.locator('#tts-start').click();
  await expect.poll(()=>countAssets(page)).toBe(2);
  await page.locator('#tts-close').click();
  await expect(page.locator('#asset-library')).toBeVisible();
  const workspace=await page.locator('#editor-workspace').boundingBox(), library=await page.locator('#asset-library').boundingBox();
  expect(library.x+library.width/2).toBeGreaterThan(workspace.x+workspace.width/2);
  expect(library.y+library.height/2).toBeGreaterThan(workspace.y+workspace.height/2);
  await page.locator('.msw-asset-row').first().getByRole('button',{name:'试听',exact:true}).click();
  await expect.poll(()=>page.locator('#asset-audio').evaluate(audio=>audio.duration)).toBeCloseTo(.2);
  const downloaded=page.waitForEvent('download'); await page.locator('.msw-asset-row').first().getByRole('button',{name:'WAV',exact:true}).click();
  expect(readFileSync(await(await downloaded).path()).subarray(0,4).toString()).toBe('RIFF');
  const bundle=page.waitForEvent('download'); await page.locator('#asset-export-project').click();
  expect(readFileSync(await(await bundle).path()).subarray(0,2).toString()).toBe('PK');
  await page.keyboard.press('Control+s');
  await expect.poll(()=>JSON.parse(readFileSync(projectPath)).msw.assets?.length||0).toBe(2);
  const saved=JSON.parse(readFileSync(projectPath)); expect(readFileSync(join(dir,saved.msw.assets[0].path)).subarray(0,4).toString()).toBe('RIFF');
  await page.reload(); await expect.poll(()=>countAssets(page)).toBe(2); expect(calls).toHaveLength(2);
  expect(errors).toEqual([]);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'tts-assets.png')});
});
test('all dual subtitles require a side and bound selection maps to secondary only',async({page})=>{
  await open(page,true); await panel(page);
  await expect(page.locator('#tts-target')).toBeVisible(); await expect(page.locator('#tts-start')).toBeDisabled();
  await page.locator('#tts-target').selectOption('secondary'); await page.locator('#tts-start').click();
  await expect.poll(()=>countAssets(page)).toBe(2); expect(calls.map(c=>c.text)).toEqual(['Secondary Hello','Independent']);
  await page.locator('#tts-close').click();
  await page.locator('.multi-cue-column.main .text').filter({hasText:/^Hello$/}).click();
  await panel(page); await expect(page.locator('#tts-start')).toBeDisabled();
  await page.locator('#tts-target').selectOption('secondary'); await page.locator('#tts-start').click();
  await expect.poll(()=>countAssets(page)).toBe(3); expect(calls.map(c=>c.text)).toEqual(['Secondary Hello','Independent','Secondary Hello']);
});
test('blank TTS key reuses ASR settings and streaming WAV becomes a playable secondary asset',async({page})=>{
  await open(page,true);
  writeFileSync(join(dir,'isolated.env'),'DASHSCOPE_API_KEY=synthetic-asr-key\n');
  let dataOffset=12;
  while(wav.toString('ascii',dataOffset,dataOffset+4)!=='data') {
    const size=wav.readUInt32LE(dataOffset+4); dataOffset+=8+size+(size%2);
    expect(dataOffset+8).toBeLessThanOrEqual(wav.length);
  }
  // Bailian's near-2-GiB data length rounded to frames previously produced
  // the user's exact "2147483546 bytes declared" validation failure.
  wav.writeUInt32LE(0x7ffffff7,4); wav.writeUInt32LE(2147483547,dataOffset+4);
  await page.locator('.multi-cue-column.extension .text').filter({hasText:/^Secondary Hello$/}).click();
  await panel(page,false);
  await expect(page.locator('#tts-key-state')).toContainText('已有本机密钥');
  await expect(page.locator('#tts-key')).toHaveValue('');
  await expect(page.locator('#tts-voice')).toHaveValue('Cherry');
  await page.locator('#tts-target').selectOption('secondary'); await page.locator('#tts-start').click();
  await expect.poll(()=>countAssets(page)).toBe(1);
  expect(calls.map(c=>c.text)).toEqual(['Secondary Hello']);
  await page.locator('#tts-close').click();
  await page.locator('.msw-asset-row').getByRole('button',{name:'试听',exact:true}).click();
  await expect.poll(()=>page.locator('#asset-audio').evaluate(audio=>audio.duration)).toBeCloseTo(.2);
  const downloaded=page.waitForEvent('download');
  await page.locator('.msw-asset-row').getByRole('button',{name:'WAV',exact:true}).click();
  const result=readFileSync(await(await downloaded).path());
  expect(result.readUInt32LE(4)).toBe(result.length-8);
  expect(result.readUInt32LE(dataOffset+4)).toBe(wav.length-dataOffset-8);
  expect(result.subarray(dataOffset+8)).toEqual(wav.subarray(dataOffset+8));
});

test('a completed item is available while later request runs; cancel discards late audio',async({page})=>{
  await open(page); await panel(page); holdText='World'; await page.locator('#tts-start').click();
  await expect.poll(()=>held.length).toBe(1); await expect.poll(()=>countAssets(page)).toBe(1);
  await page.getByRole('button',{name:'取消任务',exact:true}).click();
  for(const respond of held.splice(0)) respond();
  await expect(page.locator('#tts-jobs')).toContainText('已取消');
  expect(await countAssets(page)).toBe(1); expect(calls).toHaveLength(2);
});
test('partial failure retries only failed text',async({page})=>{
  await open(page); await panel(page); failText='World'; await page.locator('#tts-start').click();
  await expect(page.locator('#tts-jobs')).toContainText('失败 1');
  await page.getByRole('button',{name:'检查未完成项',exact:true}).click();
  await expect(page.locator('.msw-tts-result')).toContainText('World'); failText=null;
  await page.getByRole('button',{name:'重新合成未完成项',exact:true}).click();
  await expect.poll(()=>countAssets(page)).toBe(2); expect(calls.map(c=>c.text)).toEqual(['Hello','World','World']);
});
test('asset library pages large batches and can be closed and restored from Window',async({page})=>{
  await open(page,false,105); await panel(page); await page.locator('#tts-start').click();
  await expect.poll(()=>countAssets(page),{timeout:30000}).toBe(105);
  await expect(page.locator('#tts-jobs')).toContainText('合成完成'); await page.locator('#tts-close').click();
  await expect(page.locator('.msw-asset-row')).toHaveCount(50);
  await page.locator('#asset-next').click(); await expect(page.locator('#asset-page')).toHaveText('2 / 3');
  await page.locator('#asset-next').click(); await expect(page.locator('.msw-asset-row')).toHaveCount(5);
  await page.locator('#asset-search').fill('Hello'); await expect(page.locator('.msw-asset-row')).toHaveCount(1);
  await page.locator('#asset-library .tab-close').click(); await expect(page.locator('#asset-library')).not.toBeVisible();
  await openMenubarMenu(page,'窗口');
  const toggle=page.locator('#show-module-submenu > .dropdown-submenu-toggle'); await toggle.focus(); await toggle.press('ArrowRight');
  await page.locator('#show-module-menu').getByRole('menuitem',{name:'素材库',exact:true}).click();
  await expect(page.locator('#asset-library')).toBeVisible();
});
test('portable editor explains TTS capability without active controls',async({page})=>{
  server=await startStaticServer('blank-editor.html',await findFreePort()); await page.goto(server.url);
  await panel(page,false); await expect(page.locator('#tts-unavailable')).toBeVisible(); await expect(page.locator('#tts-controls')).not.toBeVisible();
});

test('editing and undo during generation preserve source snapshot and library inventory',async({page})=>{
  await open(page); await panel(page); holdText='World'; await page.locator('#tts-start').click();
  await expect.poll(()=>held.length).toBe(1); await page.locator('#tts-close').click();
  await page.locator('.cue .text').filter({hasText:/^World$/}).click();
  await page.locator('#cue-panel-text').fill('Edited while processing'); await page.locator('#cue-panel-target').click();
  for(const respond of held.splice(0)) respond();
  await expect.poll(()=>countAssets(page)).toBe(2);
  expect(await page.evaluate(()=>DATA.segments[1].text)).toBe('Edited while processing');
  expect(await page.evaluate(()=>DATA.msw.assets.map(a=>a.generation.display_text))).toEqual(['Hello','World']);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>page.evaluate(()=>DATA.segments[1].text)).toBe('World');
  expect(await countAssets(page)).toBe(2); expect(calls).toHaveLength(2);
});

test('late result after switching projects never enters the new asset library',async({page})=>{
  await open(page); await panel(page); holdText='Hello'; await page.locator('#tts-start').click();
  await expect.poll(()=>held.length).toBe(1); await page.locator('#tts-close').click();
  const other=fixture(); other.segments[0].text='Other project';
  page.removeAllListeners('dialog'); page.on('dialog', dialog=>dialog.accept());
  await openMenubarMenu(page,'文件');
  const chooser=page.waitForEvent('filechooser'); await page.locator('#open-project').click();
  await (await chooser).setFiles({name:'other.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(other))});
  await expect.poll(()=>page.evaluate(()=>DATA.msw.project_id)).toBe(other.msw.project_id);
  holdText=null; for(const respond of held.splice(0)) respond();
  await expect.poll(()=>calls.length).toBe(2);
  await panel(page); await expect(page.locator('#tts-jobs .msw-processing-job')).toHaveCount(0);
  expect(await countAssets(page)).toBe(0);
});

test('English TTS controls and narrow panel keep user text unchanged',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mawe.language','en'));
  await page.setViewportSize({width:900,height:700}); await open(page);
  await openMenubarMenu(page,'Media'); await page.locator('#tts-open').click();
  await expect(page.locator('#tts-title')).toHaveText('TTS · Subtitle voiceover');
  await expect(page.locator('#tts-model option')).toHaveCount(5);
  await page.locator('#tts-model').selectOption('qwen3-tts-instruct-flash');
  await page.locator('#tts-instructions').fill('请轻声朗读');
  await expect(page.locator('#tts-instructions')).toHaveValue('请轻声朗读');
  await expect(page.locator('#tts-start')).toHaveText('Synthesize');
  const box=await page.locator('#tts-panel').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(900);
  expect(await page.locator('#tts-panel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'tts-settings-narrow.png')});
});
