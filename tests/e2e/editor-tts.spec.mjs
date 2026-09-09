import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, openMenubarMenu, startTtsServer, startStaticServer, openTtsEnvironment, closeTtsEnvironment } from './helpers.mjs';

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
  mkdirSync(join(dir,'saved'));
  process.env.MSW_TEST_SAVE_TARGET=join(dir,'saved','copy.mosp');
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
    await openTtsEnvironment(page);
    if (!(await page.locator('#tts-key').isVisible())) await page.locator('#tts-settings > summary').click();
    await page.locator('#tts-key').fill('synthetic-tts-key');
    await closeTtsEnvironment(page);
  }
}
const countAssets=page=>page.evaluate(()=>DATA.msw?.assets?.length||0);

test('library transport seeks, mutes and changes speed using the module theme', async ({page}) => {
  wav = readFileSync(generateWav(join(dir, 'preview-long.wav'), 5));
  await open(page); await panel(page); await page.locator('#tts-start').click();
  await expect.poll(() => countAssets(page)).toBe(2); await page.locator('#tts-close').click();
  await page.locator('.msw-asset-row').first().getByRole('button', {name: '试听', exact: true}).click();
  await expect(page.locator('#asset-seek')).toBeEnabled();
  await page.locator('#asset-play-toggle').click();
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => audio.paused)).toBe(true);
  await expect(page.locator('#asset-playing')).toHaveText(/^(Hello|World)$/);
  await expect(page.locator('#asset-notice')).not.toContainText('interrupted');
  const seek = await page.locator('#asset-seek').boundingBox();
  await page.mouse.click(seek.x + seek.width * .45, seek.y + seek.height / 2);
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(1);
  await page.locator('#asset-volume').fill('0.3');
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => audio.volume)).toBeCloseTo(.3);
  await page.locator('#asset-mute').click(); await expect(page.locator('#asset-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#asset-mute').click(); await expect(page.locator('#asset-mute')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#asset-rate').selectOption('1.5');
  expect(await page.locator('#asset-audio').evaluate(audio => audio.playbackRate)).toBe(1.5);
  await page.evaluate(() => {
    for (const [key, value] of Object.entries({raised: '#25364a', input: '#152433', toolbar: '#30465b', accent: '#ee9944'})) {
      const input = document.getElementById('interface-color-' + key);
      input.value = value; input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));
    }
  });
  await expect(page.locator('#asset-library')).toHaveCSS('background-color', 'rgb(37, 54, 74)');
  await expect(page.locator('.msw-asset-row').first()).toHaveCSS('background-color', 'rgb(21, 36, 51)');
  await expect(page.locator('#asset-search')).toHaveCSS('background-color', 'rgb(21, 36, 51)');
  await expect(page.locator('#asset-player')).toHaveCSS('background-color', 'rgb(48, 70, 91)');
  await expect(page.locator('.msw-asset-toolbar')).toHaveCSS('background-color', 'rgb(48, 70, 91)');
  await expect(page.locator('#asset-seek')).toHaveCSS('accent-color', 'rgb(238, 153, 68)');
  await page.mouse.move(0, 0);
  await expect(page.locator('.msw-asset-actions button').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('#asset-audio')).not.toHaveAttribute('controls');
  const plus = page.locator('.module-tab-add').first();
  await expect(plus).toBeVisible(); await expect(plus).not.toHaveAttribute('title'); await expect(plus).toHaveAttribute('aria-label', '复制当前窗口为新标签');
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.locator('#asset-library').screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'asset-theme-player.png')});
  await page.setViewportSize({width: 560, height: 650});
  expect(await page.locator('#asset-player').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
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
test('save as collects audio and optional media and continues saving the new project', async ({page}) => {
  await prepareClips(page);
  await page.evaluate(async () => {
    updateEditorSettings({ autoSaveProject: false }); scheduleAutoSave(); scheduleAutoSaveFlush();
    await saveCurrentProject({ silent: true });
  });
  await expect.poll(() => JSON.parse(readFileSync(projectPath, 'utf8')).msw?.audio_clips?.length || 0).toBe(1);
  const original = readFileSync(projectPath, 'utf8');
  const originalId = await page.evaluate(() => DATA.msw.project_id);
  await openMenubarMenu(page, '文件'); await page.locator('#save-project-as').click();
  await expect(page.locator('#project-save-as-modal')).toBeVisible();
  await page.locator('#project-save-choose').click();
  await expect(page.locator('#project-save-confirm')).toBeEnabled();
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'd0-save-as.png')});
  await page.locator('#project-save-collect-media').check();
  await page.locator('#project-save-confirm').click();
  await expect(page.locator('#project-save-as-modal')).not.toBeVisible();
  await expect(page.locator('#json-name')).toHaveText('copy.mosp');
  const target = join(dir, 'saved', 'copy.mosp');
  const saved = JSON.parse(readFileSync(target, 'utf8'));
  expect(saved.msw.project_id).not.toBe(originalId);
  expect(saved.msw.audio_clips).toHaveLength(1);
  expect(saved.msw.assets).toHaveLength(2);
  for (const asset of saved.msw.assets) expect(existsSync(join(dir, 'saved', asset.path))).toBe(true);
  expect(existsSync(join(dir, 'saved', saved.media))).toBe(true);
  expect(readFileSync(projectPath, 'utf8')).toBe(original);
  await page.evaluate(() => { DATA.segments[0].text = 'Edited copy'; DATA.segments[0]._dirty = true; });
  await page.keyboard.press('Control+s');
  await expect.poll(() => JSON.parse(readFileSync(target, 'utf8')).segments[0].text).toBe('Edited copy');
  expect(readFileSync(projectPath, 'utf8')).toBe(original);
  await page.reload();
  await expect(page.locator('#json-name')).toHaveText('copy.mosp');
  await expect.poll(() => page.evaluate(() => DATA.msw.audio_clips.length)).toBe(1);
  await expect(page.locator('.msw-audio-clip').first()).toBeVisible();
});

test('save-as pauses original auto-save and preserves edits made while the copy is being written', async ({page}) => {
  await open(page);
  const original = readFileSync(projectPath, 'utf8');
  await openMenubarMenu(page, '文件'); await page.locator('#save-project-as').click();
  await page.evaluate(() => {
    DATA.segments[0].text = 'Copy snapshot'; DATA.segments[0]._dirty = true;
    scheduleAutoSaveFlush();
  });
  await expect.poll(() => page.evaluate(() => autoSaveFlushTimer)).toBe(null);
  expect(readFileSync(projectPath, 'utf8')).toBe(original);
  await page.locator('#project-save-choose').click();
  await expect(page.locator('#project-save-confirm')).toBeEnabled();
  let resume; const gate = new Promise(resolve => { resume = resolve; }); let posted = false;
  await page.route('**/api/msw/save-as', async route => { posted = true; await gate; await route.continue(); });
  await page.locator('#project-save-confirm').click();
  await expect.poll(() => posted).toBe(true);
  await page.evaluate(() => { DATA.segments[0].text = 'Edited during copy'; DATA.segments[0]._dirty = true; });
  resume();
  await expect(page.locator('#project-save-as-modal')).not.toBeVisible();
  const copyPath = join(dir, 'saved', 'copy.mosp');
  expect(JSON.parse(readFileSync(copyPath, 'utf8')).segments[0].text).toBe('Copy snapshot');
  expect(await page.evaluate(() => [DATA.segments[0].text, hasUnsavedProjectChanges()])).toEqual(['Edited during copy', true]);
  await page.keyboard.press('Control+s');
  await expect.poll(() => JSON.parse(readFileSync(copyPath, 'utf8')).segments[0].text).toBe('Edited during copy');
  expect(readFileSync(projectPath, 'utf8')).toBe(original);
});

test('new project binds the new file and a failed save picker allows a data-only download', async ({page}) => {
  await open(page);
  const original = readFileSync(projectPath, 'utf8');
  page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept());
  await openMenubarMenu(page, '文件'); await page.locator('#new-project').click();
  await expect(page.locator('#project-save-as-modal')).toBeVisible();
  await page.locator('#project-save-choose').click();
  await expect(page.locator('#project-save-confirm')).toBeEnabled();
  await page.locator('#project-save-confirm').click();
  await expect(page.locator('#project-save-as-modal')).not.toBeVisible();
  expect(await page.evaluate(() => DATA.segments.length)).toBe(0);
  expect(await page.evaluate(() => SERVER_CONFIG.canSave)).toBe(true);
  expect(readFileSync(projectPath, 'utf8')).toBe(original);
  await page.route('**/api/msw/save-target', route => route.abort());
  await openMenubarMenu(page, '文件'); await page.locator('#save-project-as').click();
  await page.locator('#project-save-choose').click();
  await expect(page.locator('#project-save-local')).toBeVisible();
  const pending = page.waitForEvent('download'); await page.locator('#project-save-local').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('copy.mosp');
  expect(await page.evaluate(() => projectSaveInFlight)).toBe(false);
});

test('recovery drafts restore subtitle and audio clip edits into an unsaved copy', async ({page}) => {
  await prepareClips(page);
  await page.evaluate(async () => {
    updateEditorSettings({ autoSaveProject: false }); scheduleAutoSave(); scheduleAutoSaveFlush();
    await saveCurrentProject({silent:true});
  });
  await expect.poll(() => JSON.parse(readFileSync(projectPath, 'utf8')).msw?.audio_clips?.length || 0).toBe(1);
  const original = readFileSync(projectPath, 'utf8');
  await page.evaluate(async () => {
    DATA.segments[0].text = 'Recovered main'; DATA.segments[0]._dirty = true;
    DATA.multi_subtitle.tracks[0].segments[0].text = 'Recovered secondary';
    DATA.msw.audio_clips[0].muted = true;
  });
  await expect.poll(() => page.evaluate(() => MSWE.resolve('project-persistence').captureDraft({force:true}))).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => DATA.segments[0].text)).toBe('Hello');
  await openMenubarMenu(page, '文件'); await page.locator('#project-recovery-open').click();
  const draft = page.locator('.msw-recovery-row').filter({hasText: '恢复草稿'}).first();
  await expect(draft).toBeVisible();
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'd0-recovery.png')});
  await draft.getByRole('button').click();
  await expect(page.locator('#project-recovery-modal')).not.toBeVisible();
  expect(await page.evaluate(() => [DATA.segments[0].text, DATA.multi_subtitle.tracks[0].segments[0].text, DATA.msw.audio_clips[0].muted]))
    .toEqual(['Recovered main', 'Recovered secondary', true]);
  expect(await page.evaluate(() => SERVER_CONFIG.canSave)).toBe(false);
  expect(readFileSync(projectPath, 'utf8')).toBe(original);
  await openMenubarMenu(page, '文件'); await page.locator('#save-project-as').click();
  await page.locator('#project-save-choose').click();
  await expect(page.locator('#project-save-confirm')).toBeEnabled();
  await page.locator('#project-save-collect-media').check();
  await page.locator('#project-save-confirm').click();
  await expect(page.locator('#project-save-as-modal')).not.toBeVisible();
  const copy = JSON.parse(readFileSync(join(dir, 'saved', 'copy.mosp'), 'utf8'));
  expect(copy.segments[0].text).toBe('Recovered main');
  expect(copy.msw.audio_clips[0].muted).toBe(true);
  expect(readFileSync(projectPath, 'utf8')).toBe(original);
});

test('an unnamed draft captures pending inline text without ending the edit', async ({page}) => {
  await open(page);
  await page.evaluate(() => {
    updateEditorSettings({autoSaveProject:false}); scheduleAutoSave(); scheduleAutoSaveFlush();
    const project = {media:'',segments:[{id:'new',start:0,end:1000,text:'New draft'}]};
    applyCanonicalProject(project, 'untitled.mosp'); detachServerProjectSaving();
    startEdit(document.querySelector('.cue[data-idx="0"]'), 0);
  });
  const text = page.locator('.cue[data-idx="0"] .text[contenteditable="plaintext-only"]');
  await text.fill('Pending inline draft');
  await expect.poll(() => page.evaluate(() => MSWE.resolve('project-persistence').captureDraft({force:true}))).toBe(true);
  await expect(text).toBeVisible();
  await page.reload();
  await openMenubarMenu(page, '文件'); await page.locator('#project-recovery-open').click();
  await page.locator('.msw-recovery-row').filter({hasText:'untitled.mosp'}).first().getByRole('button').click();
  await expect.poll(() => page.evaluate(() => DATA.segments[0].text)).toBe('Pending inline draft');
  expect(await page.evaluate(() => SERVER_CONFIG.canSave)).toBe(false);
});

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
  await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toContain('linear-gradient');
  const heat=await clip.evaluate(el=>el.style.backgroundImage);
  await clip.click(); await expect(clip).toHaveCSS('outline-color','rgb(129, 216, 107)');
  await expect(clip).toHaveCSS('border-radius','4px');
  await expect.poll(()=>clip.evaluate(el=>el.style.backgroundImage)).toBe(heat);
  await page.locator('#waveform-settings-item').evaluate(el=>el.click()); await page.locator('#audio-clips-heatmap').uncheck(); await page.keyboard.press('Escape');
  await expect(clip).toHaveCSS('background-image','none');
  // Timeline refresh replaces nodes. Read and probe the current node in one
  // browser task instead of retaining an element handle across the refresh.
  const solid=await page.evaluate(()=>{
    const el=document.querySelector('.msw-audio-clip');
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

test('unselected audio clips follow the playhead while selected and muted clips keep their semantics',async({page})=>{
  const clip=await prepareClips(page);
  await page.locator('#interface-color-hit').evaluate(el=>{el.value='#f42b76';el.dispatchEvent(new Event('input',{bubbles:true}));});
  const seek=offset=>page.evaluate(offset=>{
    const c=DATA.msw.audio_clips[0]; MSWE.resolve('processing-host').seek((c.start_ms+offset)/1000);
  },offset);
  await page.keyboard.press('Escape'); await seek(100);
  await expect(clip).not.toHaveClass(/selected/); await expect(clip).toHaveClass(/active/);
  await expect(clip).toHaveCSS('outline-color','rgb(244, 43, 118)');
  await seek(1500); await expect(clip).not.toHaveClass(/active/);
  await seek(-1); await expect(clip).not.toHaveClass(/active/);
  await seek(0); await expect(clip).toHaveClass(/active/);
  await clip.click(); await expect(clip).toHaveClass(/selected/);
  await expect(clip).toHaveCSS('outline-width','2px');
  await clip.click({button:'right'}); await page.locator('.msw-audio-menu').getByRole('button',{name:'静音音频贴片',exact:true}).click();
  await page.keyboard.press('Escape'); await seek(100);
  await expect(clip).toHaveClass(/muted/); await expect(clip).toHaveCSS('outline-color','rgb(244, 43, 118)');
  await page.evaluate(()=>MSWE.resolve('processing-host').togglePlayback());
  await expect(clip).not.toHaveClass(/active/,{timeout:5000});
  await page.evaluate(()=>MSWE.resolve('processing-host').pauseMedia());
  await seek(100);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'audio-playhead-outline.png')});
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
  // Audio lanes render on the next animation frame; wait for their full extent.
  await expect.poll(()=>lanes.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(900);
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
  const downloaded=page.waitForEvent('download'); await page.locator('.msw-asset-row').first().getByRole('button',{name:'下载 WAV',exact:true}).click();
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
  await expect(page.locator('#tts-target')).toBeVisible(); await expect(page.locator('#tts-target')).toHaveValue('main');
  await page.locator('#tts-target').selectOption('secondary'); await page.locator('#tts-start').click();
  await expect.poll(()=>countAssets(page)).toBe(2); expect(calls.map(c=>c.text)).toEqual(['Secondary Hello','Independent']);
  await page.locator('#tts-close').click();
  await page.locator('.multi-cue-column.main .text').filter({hasText:/^Hello$/}).click();
  await panel(page); await expect(page.locator('#tts-target')).toHaveValue('secondary');
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
  await page.locator('.msw-asset-row').getByRole('button',{name:'下载 WAV',exact:true}).click();
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
  await expect(page.locator('.msw-asset-row')).toHaveCount(90);
  await expect.poll(()=>page.locator('#asset-list').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
  expect(await page.locator('#asset-list').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await page.locator('#asset-next').click(); await expect(page.locator('#asset-page')).toHaveText('2 / 2');
  await expect(page.locator('.msw-asset-row')).toHaveCount(15);
  await page.locator('#asset-search').fill('Hello'); await expect(page.locator('.msw-asset-row')).toHaveCount(1);
  await page.locator('#asset-library .tab-close').click(); await expect(page.locator('#asset-library')).not.toBeVisible();
  await openMenubarMenu(page,'窗口');
  const toggle=page.locator('#show-module-submenu > .dropdown-submenu-toggle'); await toggle.focus(); await toggle.press('ArrowRight');
  await page.locator('#show-module-menu').getByRole('menuitem',{name:'素材库',exact:true}).click();
  await expect(page.locator('#asset-library')).toBeVisible();
});

test('asset cards show three columns, icon actions and responsive saved density',async({page})=>{
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await open(page,false,18); wav=readFileSync(generateWav(join(dir,'preview-long.wav'),2));
  await page.evaluate(()=>{DATA.segments[0].text='这是一段较长的配音文本，用来核对卡片中的换行、截断与完整文本提示。';});
  await panel(page); await page.locator('#tts-start').click();
  await expect.poll(()=>countAssets(page)).toBe(18); await page.locator('#tts-close').click();
  const list=page.locator('#asset-list'), cards=page.locator('.msw-asset-row');
  const columns=()=>list.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
  await expect.poll(columns).toBe(3);
  const geometry=await cards.evaluateAll(els=>els.slice(0,4).map(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y};}));
  expect(geometry[0].y).toBe(geometry[2].y);expect(geometry[3].y).toBeGreaterThan(geometry[0].y);
  const first=cards.first(); await expect(first.locator('button svg')).toHaveCount(4);
  expect(await first.locator('button').allTextContents()).toEqual(['','','','']);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'asset-cards-default.png')});
  await first.getByRole('button',{name:'试听',exact:true}).click();
  await first.getByRole('button',{name:'暂停试听',exact:true}).click();
  await expect(first.getByRole('button',{name:'试听',exact:true})).toBeVisible();
  expect(await page.locator('#asset-audio').evaluate(el=>el.paused)).toBe(true);
  const downloaded=page.waitForEvent('download');await first.getByRole('button',{name:'下载 WAV',exact:true}).click();
  expect(readFileSync(await(await downloaded).path()).subarray(0,4).toString()).toBe('RIFF');
  await first.getByRole('button',{name:'放入时间轴',exact:true}).click();
  await expect(page.locator('.msw-audio-clip').first()).toBeVisible();
  await openMenubarMenu(page,'媒体'); await page.locator('#asset-settings-submenu > .dropdown-submenu-toggle').hover();
  const slider=page.locator('#asset-density');await slider.focus();await slider.press('End');
  await expect.poll(columns).toBe(5);
  await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
  const focused=first.getByRole('button',{name:'试听',exact:true});await focused.focus();
  await page.locator('#asset-refresh').evaluate(el=>el.click());await expect(focused).toBeFocused();
  // Density is independent of whether the module is open. Reopen through the
  // window menu before measuring; a hidden grid reports the CSS fallback.
  await page.locator('#asset-library .tab-close').click();
  await expect(page.locator('#asset-library')).not.toBeVisible();
  await page.reload();await expect(slider).toHaveValue('5');
  await expect(page.locator('#editor-loading')).not.toBeVisible();
  if (!await page.locator('#asset-library').isVisible()) {
    await openMenubarMenu(page,'窗口');
    const toggle=page.locator('#show-module-submenu > .dropdown-submenu-toggle');
    await toggle.focus();await toggle.press('ArrowRight');
    await page.locator('#show-module-menu').getByRole('menuitem',{name:'素材库',exact:true}).click();
  }
  await expect(page.locator('#asset-library')).toBeVisible();
  await expect.poll(columns).toBe(5);
  await page.locator('#asset-library').evaluate(el=>{el.style.width='270px';el.style.maxWidth='270px';});
  await expect.poll(columns).toBe(2);
  expect(await list.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await cards.evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth))).toBe(true);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.locator('#asset-library').screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'asset-cards-narrow.png')});
  expect(errors).toEqual([]);
});

test('asset settings are in the media menu and module context submenu',async({page})=>{
  await prepareClips(page);
  expect(await page.locator('#asset-library #asset-density').count()).toBe(0);
  await openMenubarMenu(page,'媒体'); await page.locator('#asset-settings-submenu > .dropdown-submenu-toggle').hover();
  await expect(page.locator('#asset-density')).toBeVisible();
  await page.locator('#asset-density').fill('2'); await page.locator('#asset-density').dispatchEvent('input');
  await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
  await page.locator('#asset-list').click({button:'right',position:{x:20,y:20}});
  const header=page.locator('#ctxmenu .ctx-submenu-toggle').filter({hasText:'素材库设置'});
  await expect(header).toBeVisible(); await header.hover();
  const choice=page.locator('#ctxmenu .ctx-subitem').filter({hasText:'密度：4 列'});
  await expect(choice).toBeVisible(); await choice.click();
  await expect(page.locator('#asset-density')).toHaveValue('4');
  expect(await page.locator('#ctxmenu .ctx-subitem').allTextContents()).toEqual([
    '卡片密度：1 列','卡片密度：2 列','卡片密度：3 列','✓ 卡片密度：4 列','卡片密度：5 列']);
  expect(await choice.locator('span').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length;})).toBe(1);
  expect(await choice.evaluate(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight;})).toBe(true);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'asset-settings-context.png')});
});

test('synthesis history collapses without hiding controls and scrolls older jobs',async({page})=>{
  await open(page); await panel(page);
  await page.route('**/api/msw/jobs?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,revision:99,jobs:
    Array.from({length:24},(_,i)=>({id:`history-${i}`,kind:'tts',project_id:'test',status:'succeeded',count:2,progress:{ready:2},created_at:i+1,recipe:{voice:'Cherry'}}))})}));
  await page.locator('#asset-refresh').evaluate(el=>el.click());
  await expect(page.locator('#tts-jobs .msw-processing-job')).toHaveCount(24);
  const history=page.locator('#tts-history'), jobs=page.locator('#tts-jobs');
  await expect(history.locator('summary')).toContainText('合成记录');
  expect(await jobs.evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=280)).toBe(true);
  await history.locator('summary').click(); await expect(jobs).toBeHidden(); await expect(page.locator('#tts-start')).toBeVisible();
  await page.locator('#asset-refresh').evaluate(el=>el.click()); await expect(jobs).toBeHidden();
  await history.locator('summary').click(); await jobs.evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect(page.locator('[data-job-id="history-0"]')).toBeVisible();
});

test('deleting a used asset confirms, removes all clips, undoes and stays removed after refresh',async({page})=>{
  await prepareClips(page);
  const id=await page.evaluate(()=>DATA.msw.audio_clips[0].asset_id);
  const card=page.locator(`.msw-asset-row[data-asset-id="${id}"]`);
  await card.getByRole('button',{name:'放入时间轴',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>DATA.msw.audio_clips.length)).toBe(2);
  // The default dialog handler dismisses: no data is changed.
  await card.getByRole('button',{name:'删除素材',exact:true}).click();
  expect(await countAssets(page)).toBe(2);
  page.removeAllListeners('dialog'); page.on('dialog',dialog=>dialog.accept());
  await card.getByRole('button',{name:'删除素材',exact:true}).click();
  await expect.poll(()=>countAssets(page)).toBe(1); await expect(page.locator('.msw-audio-clip')).toHaveCount(0);
  await page.evaluate(()=>performUndo()); await expect.poll(()=>countAssets(page)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>DATA.msw.audio_clips.length)).toBe(2);
  await page.evaluate(()=>performRedo()); await expect.poll(()=>countAssets(page)).toBe(1);
  await page.evaluate(async()=>{updateEditorSettings({autoSaveProject:false});scheduleAutoSave();scheduleAutoSaveFlush();await saveCurrentProject({silent:true});});
  await page.reload(); await expect.poll(()=>countAssets(page)).toBe(1);
  expect(await page.evaluate(id=>DATA.msw.removed_asset_ids.includes(id),id)).toBe(true);
  await page.locator('#asset-refresh').evaluate(el=>el.click());
  await expect(card).toHaveCount(0);
});

test('external audio imports from file picker, reports invalid files and saves usable clips',async({page})=>{
  await open(page);
  await page.evaluate(()=>window.MSWE.resolve('processing-host').showAssets());
  const audio=generateWav(join(dir,'外部配音.wav'),1.5), bad=join(dir,'损坏.wav');writeFileSync(bad,'not an audio file');
  const chooser=page.waitForEvent('filechooser');await page.locator('#asset-import').click();
  await (await chooser).setFiles([audio,bad]);
  await expect(page.locator('#asset-import-message')).toContainText('已导入 1/2',{timeout:20000});
  await expect(page.locator('#asset-import-message')).toContainText('损坏.wav');
  await expect.poll(()=>countAssets(page)).toBe(1);
  const asset=await page.evaluate(()=>DATA.msw.assets[0]);expect(asset.generation.provider).toBe('imported');
  expect(asset.generation.display_text).toBe('外部配音');expect(asset.generation.spoken_text).toBe('');
  await page.locator('.msw-asset-row [data-asset-action="play"]').click();
  await expect.poll(()=>page.locator('#asset-audio').evaluate(el=>el.currentTime)).toBeGreaterThan(0);
  await page.locator('.msw-asset-row [data-asset-action="insert"]').click();
  await expect(page.locator('.msw-audio-clip')).toHaveCount(1);
  await page.evaluate(async()=>{updateEditorSettings({autoSaveProject:false});scheduleAutoSave();scheduleAutoSaveFlush();await saveCurrentProject({silent:true});});
  const saved=JSON.parse(readFileSync(projectPath,'utf8'));
  expect(existsSync(join(dir,saved.msw.assets[0].path))).toBe(true);
  expect(readFileSync(audio).subarray(0,4).toString()).toBe('RIFF');
  await page.reload();await expect.poll(()=>countAssets(page)).toBe(1);await expect(page.locator('.msw-audio-clip')).toHaveCount(1);
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'asset-import-result.png')});
});
test('portable editor explains TTS capability without active controls',async({page})=>{
  server=await startStaticServer('blank-editor.html',await findFreePort()); await page.goto(server.url);
  await panel(page,false); await expect(page.locator('#tts-unavailable')).toBeVisible(); await expect(page.locator('#tts-controls')).not.toBeVisible();
});

test('asset module dropdown keeps full module names on one line within the viewport',async({page})=>{
  await open(page); await page.evaluate(()=>MSWE.resolve('processing-host').showAssets());
  await page.locator('#asset-library .module-tab').click();
  const menu=page.locator('.tab-convert-menu'); await expect(menu).toBeVisible();
  const dimensions=await menu.evaluate(el=>({width:el.offsetWidth,right:el.getBoundingClientRect().right,
    viewport:innerWidth,names:[...el.querySelectorAll('.tab-name')].map(label=>{
      const range=document.createRange();range.selectNodeContents(label);
      return {lines:range.getClientRects().length,overflow:label.scrollWidth>label.clientWidth};
    })}));
  expect(dimensions.width).toBeGreaterThanOrEqual(128); expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.names).toHaveLength(5);
  for(const name of dimensions.names) {expect(name.lines).toBe(1);expect(name.overflow).toBe(false);}
  if(process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'asset-module-menu.png')});
  await menu.getByRole('button',{name:'变成字幕列表',exact:true}).click();
  await expect(menu).toHaveCount(0);
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
  await page.locator('#tts-close').click();
  await openMenubarMenu(page,'文件'); await page.locator('#save-project-as').click();
  await expect(page.locator('#project-save-title')).toHaveText('Save project as');
  await expect(page.locator('#project-save-choose')).toHaveText('Choose save location');
  expect(await page.locator('#project-save-as-modal .modal').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.locator('#project-save-cancel').click();
  expect(await page.evaluate(()=>projectSaveInFlight)).toBe(false);
});
