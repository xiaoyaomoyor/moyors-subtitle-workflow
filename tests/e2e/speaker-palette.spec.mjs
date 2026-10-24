import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server,dir,project;
test.setTimeout(120000);
test.beforeEach(async({page})=>{
  dir=makeTempDir('speaker-palette');const media=join(dir,'video.mp4');project=join(dir,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(dir,'app');process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media,segments:[{id:'a',start:0,end:3000,text:'Hello 世界'},{id:'b',start:3500,end:5500,text:'Second'}],waveform:generateWaveformPayload(6000)}));
  server=await startServer(project,media,await findFreePort());
  page.on('response',async response=>{if(response.status()>=400&&response.url().includes('/api/'))appendFileSync(join(dir,'responses.log'),response.url()+' '+response.status()+' '+await response.text().catch(()=>'' )+'\n');});
  for(const stream of [server.proc.stdout,server.proc.stderr])stream.on('data',chunk=>appendFileSync(join(dir,'server.log'),chunk));
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2);
  await page.evaluate(()=>{player.pause();updateEditorSettings({autoSaveProject:false});});
});
test.afterEach(async()=>{await server?.stop();});
async function settings(page){await page.evaluate(()=>setEditorSettingsPanelOpen(true));await page.getByRole('button',{name:'说话人色系',exact:true}).click();}

test('project speaker table extends beyond five, marks from menu and saves renamed identities',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await settings(page);
  const rows=page.locator('#speaker-palette-rows tr');await expect(rows).toHaveCount(6);
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows.map(r=>r.mode))).toEqual(Array(5).fill('none'));
  for(let i=0;i<4;i++)await page.locator('#speaker-palette-add').click();
  await expect(rows).toHaveCount(10);const ninth=rows.nth(9);
  await ninth.locator('td:nth-child(2) input').fill('九号');await ninth.locator('td:nth-child(2) input').press('Tab');
  await ninth.locator('select').selectOption('text');
  await page.evaluate(()=>{setEditorSettingsPanelOpen(false);selectOnly(0);});await page.locator('.player-stage').click({position:{x:10,y:10}});
  await page.keyboard.press('9');
  expect(await page.evaluate(()=>DATA.segments[0].color.name)).toBe('speaker-9');
  await page.evaluate(()=>showContextMenu(500,300,0));
  await expect(page.locator('#ctxmenu > .item').filter({hasText:/^标记颜色|^清除颜色/})).toHaveCount(0);
  await page.getByRole('menuitem',{name:'标记字幕',exact:true}).hover();
  await expect(page.locator('.speaker-mark-swatches button')).toHaveCount(9);
  await expect(page.locator('[data-speaker="speaker-9"]')).toHaveAttribute('title','九号（9）');
  await expect(page.locator('[data-speaker="speaker-9"]')).toHaveText('九');
  const swatchPositions=await page.locator('.speaker-mark-swatches button').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));
  expect(swatchPositions[4].y).toBe(swatchPositions[0].y);expect(swatchPositions[5].y).toBeGreaterThan(swatchPositions[0].y);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const disk=JSON.parse(readFileSync(project));expect(disk.preview.speaker_palette.rows[8].name).toBe('九号');
  await page.reload();await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
  await settings(page);await page.screenshot({path:join(dir,'speakers-dark.png')});
  await page.evaluate(()=>{updateEditorSettings({themePreset:'alice',colors:null});applyThemeAndColors();});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.screenshot({path:join(dir,'speakers-light.png'),animations:'disabled'});
  expect(await page.evaluate(()=>COLOR_PALETTE[8].label)).toBe('九号');expect(errors).toEqual([]);
});

test('speaker properties inherit across tracks, preserve cue overrides, undo and save; preview names stay independent',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{
    let p=MSWE.resolve('processing-host').exportProject();
    delete p.preview.speaker_label_export;
    p=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id:'extra',name:'S2'});
    p.subtitles.cues[1].track_id='extra';
    for(const c of p.subtitles.cues)c.content.color={name:'yellow',start:c.content.start,end:c.content.end};
    p.subtitles.cues[1].content.subtitle_style={fontSize:55};
    productionCommitProject(p,'测试说话人跨轨继承',[]);selectOnly(0);MSWSubtitleStyle.open('cue');
  });
  await page.waitForFunction(()=>MSWSubtitleStyle.ready&&player.readyState>=2);
  await page.locator('#style-edit-scope').selectOption('speaker');
  await expect(page.locator('#style-speaker-target')).toBeVisible();
  await expect(page.locator('#style-track-position')).toBeHidden();
  await page.locator('#style-field-fontSize').fill('80');await page.locator('#style-field-fontSize').press('Tab');
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[0].style.fontSize)).toBe(80);
  await expect(page.locator('[data-reset-style="fontSize"]')).toHaveClass(/is-overridden/);
  const rendered=await page.evaluate(async()=>{
    const project=MSWE.resolve('processing-host').exportProject();
    return await MSWSubtitleStyle.request('subtitle-preview',{project,video:{width:640,height:360}});
  });
  expect(rendered.ass).toContain('80');expect(rendered.ass).toContain('55');
  await page.evaluate(()=>performUndo());
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[0].style)).toBeUndefined();
  await page.locator('#style-field-fontSize').fill('80');await page.locator('#style-field-fontSize').press('Tab');
  await page.locator('#style-animation > summary').click();
  await page.locator('#motion-preset-fade').click();
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[0].animation.effects.fade.enabled)).toBe(true);
  await page.locator('#motion-inherit').click();
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[0].animation)).toBeUndefined();
  await page.locator('#style-project-preset').selectOption('default');
  await page.locator('#style-field-fontSize').fill('81');await page.locator('#style-field-fontSize').press('Tab');
  await page.locator('#style-reset').click();
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[0].style.fontSize)).toBe(await page.evaluate(()=>MSWProjectStyle.defaults().main.fontSize));
  await page.locator('#style-inherit-appearance').click();
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[0].style)).toBeUndefined();
  await page.locator('#style-field-fontSize').fill('80');await page.locator('#style-field-fontSize').press('Tab');
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('Speaker custom');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('Speaker custom');
  await page.evaluate(()=>setSubtitlePreviewSettingsPanelOpen(true));
  await page.locator('#style-preview-speakers').check();
  await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.geometry.some(r=>r.text.startsWith('SP1：')),null,{timeout:15000}).catch(async e=>{
    writeFileSync(join(dir,'preview-diagnostic.json'),JSON.stringify(await page.evaluate(()=>({status:MSWSubtitleRenderer.status,pending:MSWSubtitleRenderer.pending,geometry:MSWSubtitleRenderer.geometry,preview:DATA.preview,requestPreview:MSWE.resolve('processing-host').subtitlePreviewProject().preview,media:{state:player.readyState,source:player.currentSrc},label:document.getElementById('style-message').textContent})),null,2));throw e;
  });
  const names=await page.evaluate(async()=>{
    const project=MSWE.resolve('processing-host').subtitlePreviewProject();
    const preview=await MSWSubtitleStyle.request('subtitle-preview',{project,video:{width:640,height:360}});
    project.preview.speaker_label_export=false;
    const exported=await MSWSubtitleStyle.request('subtitle-preview',{project,video:{width:640,height:360}});
    return {preview:preview.ass,exported:exported.ass};
  });
  expect(names.preview).toContain('SP1：');expect(names.exported).not.toContain('SP1：');
  await page.locator('#style-preview-speakers').uncheck();
  await page.evaluate(()=>setSubtitlePreviewSettingsPanelOpen(false));
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const disk=JSON.parse(readFileSync(project));expect(disk.preview.speaker_palette.rows[0].style.fontSize).toBe(80);expect(disk.preview.speaker_labels_visible).toBe(false);
  await page.reload();await page.waitForFunction(()=>MSWSubtitleStyle?.ready);
  await page.evaluate(()=>MSWSubtitleStyle.open('cue'));
  await page.locator('#style-edit-scope').selectOption('speaker');
  await expect(page.locator('#style-field-fontSize')).toHaveValue('80');
  await page.locator('#style-speaker-target').selectOption('green');
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('Speaker inherited');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('Speaker inherited');
  await page.locator('#style-speaker-target').selectOption('yellow');
  await page.screenshot({path:join(dir,'speaker-properties.png'),animations:'disabled'});
  expect(errors).toEqual([]);
});

test('master row, per-speaker separators, native preview, export name choice and undo agree',async({page})=>{
  await settings(page);const master=page.locator('#speaker-palette-rows tr').first();
  await master.locator('select').selectOption('speaker');
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows.map(r=>r.mode))).toEqual(Array(5).fill('speaker'));
  await page.locator('#speaker-palette-rows tr').nth(1).locator('td:nth-child(5) input').fill(' / ');
  await page.locator('#speaker-palette-rows tr').nth(1).locator('td:nth-child(5) input').press('Tab');
  await page.evaluate(()=>{setEditorSettingsPanelOpen(false);selectOnly(0);assignColor([0],'yellow');seekFromWaveform(.5);});
  await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.geometry.some(r=>r.text.startsWith('SP1 / ')),null,{timeout:45000});
  const result=await page.evaluate(async()=>{
    const host=MSWE.resolve('processing-host');
    updateEditorSettings({exportSpeakerLabels:false});const plain=buildSrt(),ass=await fixedAssDocument();
    updateEditorSettings({exportSpeakerLabels:true});const named=buildSrt(),namedAss=await fixedAssDocument();
    const snapshot=host.exportProject();MSWSubtitleStyle.applyExport(snapshot);
    return {plain,ass,named,namedAss,videoNames:snapshot.preview.speaker_label_export};
  });
  expect(result.plain).not.toContain('SP1');expect(result.ass).not.toContain('SP1');
  expect(result.named).toContain('SP1 / Hello');expect(result.namedAss).toContain('SP1 / ');expect(result.videoNames).toBe(false);
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.segments[0].color)).toBeFalsy();
});

test('multi-track marking changes only selected identities, respects locking and undoes once',async({page})=>{
  const state=await page.evaluate(()=>{
    const F=MSWFlatSubtitles;let p=MSWE.resolve('processing-host').exportProject();
    const [a,b]=p.subtitles.cues;
    a.content.color={name:'red',start:0,end:5500};b.content.color_ref={name:'red',cue_id:a.id};
    p=F.addTrack(p,{...p.subtitles.tracks[0],id:'extra',name:'S2'});
    p.subtitles.cues.push({id:'extra-cue',track_id:'extra',content:{start:0,end:2000,text:'Other'}});
    applyCanonicalProject(p,'multi.mosp');
    const ids=[a.id,'extra-cue'],indices=ids.map(id=>DATA.segments.findIndex(c=>c.id===id));
    assignColor(indices,'blue');const saved=JSON.parse(buildJson());
    F.validate(saved);
    const colors=Object.fromEntries(saved.subtitles.cues.map(c=>[c.id,c.content.color?.name||c.content.color_ref?.name]));
    performUndo();const undone=DATA.segments.map(c=>MULTI_SUBTITLE_UTILS.effectiveColorName(c,DATA.segments));
    DATA.subtitle_tracks.tracks.find(t=>t.id==='extra').locked=true;
    assignColor(indices,'yellow');
    return {a:a.id,b:b.id,colors,undone,locked:DATA.segments.map(c=>MULTI_SUBTITLE_UTILS.effectiveColorName(c,DATA.segments))};
  });
  expect(state.colors).toEqual({[state.a]:'blue',[state.b]:'red','extra-cue':'blue'});
  expect(state.undone).toEqual(state.locked);expect(state.undone.filter(Boolean)).toEqual(['red','red']);
});

test('bound speaker colors propagate through both editor entry points and undo once',async({page})=>{
  const result=await page.evaluate(()=>{
    const F=MSWFlatSubtitles;let p=MSWE.resolve('processing-host').exportProject();
    const [a,b]=p.subtitles.cues;
    p=F.addTrack(p,{...p.subtitles.tracks[0],id:'translation',name:'S1副',style:{mode:'inherit',slot:'secondary',base:'dialogue'}});
    p.subtitles.cues[1].track_id='translation';
    p.subtitle_view={...p.subtitle_view,secondary_cue_ids:[b.id]};
    p=F.bind(p,a.id,b.id,'pair');productionCommitProject(p,'测试绑定',[]);
    const colors=()=>JSON.parse(buildJson()).subtitles.cues.map(c=>c.content.color?.name||null);
    const main=DATA.segments.findIndex(c=>c.id===a.id),track=DATA.multi_subtitle.tracks.find(t=>t.segments.some(c=>c.id===b.id));
    const secondary=track.segments.findIndex(c=>c.id===b.id);
    assignColor([main],'blue');const fromMain=colors();performUndo();const undone=colors();
    assignExtensionColor([secondary],'green',getExtensionTrack(track.id));const fromSecondary=colors();
    clearColorOnTargets([main]);const cleared=colors();performUndo();const restored=colors();
    return {fromMain,undone,fromSecondary,cleared,restored};
  });
  expect(result).toEqual({fromMain:['blue','blue'],undone:[null,null],fromSecondary:['green','green'],cleared:[null,null],restored:['green','green']});
});
