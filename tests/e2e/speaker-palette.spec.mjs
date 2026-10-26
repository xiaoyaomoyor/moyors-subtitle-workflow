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
  page.on('pageerror',error=>appendFileSync(join(dir,'page-errors.log'),error.stack+'\n'));
  page.on('response',async response=>{if(response.status()>=400&&response.url().includes('/api/'))appendFileSync(join(dir,'responses.log'),response.url()+' '+response.status()+' '+await response.text().catch(()=>'' )+'\n');});
  for(const stream of [server.proc.stdout,server.proc.stderr])stream.on('data',chunk=>appendFileSync(join(dir,'server.log'),chunk));
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2);
  await page.evaluate(()=>{player.pause();updateEditorSettings({autoSaveProject:false});});
});
test.afterEach(async()=>{await server?.stop();});
async function settings(page){await page.evaluate(()=>setEditorSettingsPanelOpen(true));await page.getByRole('button',{name:'说话人色系',exact:true}).click();}

test('speaker schemes carry names and appearance across projects with explicit mapping, undo and independent snapshots',async({page,browser})=>{
  await page.evaluate(()=>{
    const row=MSWSpeaker.ensure(DATA).rows[0];Object.assign(row,{name:'Erwyn',names:{'zh-hans':'艾尔文'},mode:'stroke',color:'#33aa44',style:{fontSize:60}});
    speakerPaletteChanged();
  });
  await settings(page);await page.locator('#speaker-scheme-save').click();await page.locator('#speaker-scheme-name').fill('同一期团录');
  await page.locator('#speaker-scheme-form button[type=submit]').click();
  await expect(page.locator('#speaker-scheme-status')).toContainText('方案已保存');
  const scheme=await page.evaluate(()=>JSON.parse(MSWConfig.storage.getItem('msw.speaker-schemes.v1')).schemes[0]);
  expect(scheme.rows[0].id).not.toBe('yellow');expect(scheme.rows[0].scheme_ref).toBeUndefined();
  const raw=await page.evaluate(()=>MSWConfig.request({action:'export',categories:['speakerSchemes']}));
  expect(raw.package.sections.speakerSchemes.schemes[0]).toEqual(scheme);
  const second=join(dir,'second.mosp'),media=join(dir,'video.mp4');
  const model=await page.evaluate(()=>{
    let p=MSWFlatSubtitles.migrate({language:'en',segments:[{id:'different',start:0,end:3000,text:'Second video',items:[],color:{name:'green',start:0,end:3000}}]});
    const main=p.subtitles.tracks[0];p=MSWFlatSubtitles.addTrack(p,{...main,id:'chinese',language:'zh',secondary_for:main.id,style:{...main.style,slot:'secondary'}});
    p.subtitles.cues.push({id:'translated',track_id:'chinese',content:{start:0,end:3000,text:'第二个视频',items:[],color_ref:{cue_id:p.subtitles.cues[0].id},subtitle_style:{outlineColor:'#abcdef'}}});
    p=MSWFlatSubtitles.bind(p,p.subtitles.cues[0].id,'translated','pair');
    MSWSpeaker.ensure(p);p.preview.speaker_labels_visible=true;return p;
  });
  writeFileSync(second,JSON.stringify({...model,media,waveform:generateWaveformPayload(6000)}));
  const other=await startServer(second,media,await findFreePort()),target=await browser.newPage(),errors=[];
  target.on('pageerror',e=>errors.push(e.message));
  try{
    await disableOnboarding(target);await target.goto(other.url);await target.waitForFunction(()=>MSWSubtitleStyle?.ready&&player.readyState>=2);
    await target.evaluate(()=>{updateEditorSettings({autoSaveProject:false,exportSpeakerLabels:true});player.currentTime=1;});
    await settings(target);await target.locator('#speaker-scheme-select').selectOption(scheme.id);await target.locator('#speaker-scheme-open').click();
    expect(await target.locator('#speaker-scheme-mapping-rows select').evaluateAll(rows=>rows.map(r=>r.value))).toEqual(['','','','','']);
    await expect(target.locator('#speaker-scheme-mapping-rows')).toContainText('2 条 · Second video');
    const before=await target.evaluate(()=>JSON.parse(buildJson()));
    await target.locator('#speaker-scheme-mapping-rows select[data-speaker-id="green"]').selectOption(scheme.rows[0].id);
    await expect(target.locator('#speaker-scheme-plan')).toHaveText('更新 1 人 · 新增 0 人');
    await target.screenshot({path:join(dir,'speaker-scheme-mapping.png')});
    await target.evaluate(()=>{updateEditorSettings({themePreset:'alice',colors:null});applyThemeAndColors();});
    await expect(target.locator('html')).toHaveAttribute('data-theme','light');
    await target.screenshot({path:join(dir,'speaker-scheme-mapping-light.png')});
    await target.locator('#speaker-scheme-apply').click();
    const applied=await target.evaluate(()=>JSON.parse(buildJson()));
    expect(applied.subtitles).toEqual(before.subtitles);expect(applied.preview.speaker_palette.rows[0]).toEqual(before.preview.speaker_palette.rows[0]);
    expect(applied.preview.speaker_palette.rows[1]).toMatchObject({id:'green',name:'Erwyn',names:{'zh-hans':'艾尔文'},color:'#33aa44',scheme_ref:{scheme_id:scheme.id,person_id:scheme.rows[0].id}});
    await target.evaluate(()=>performUndo());expect(await target.evaluate(()=>DATA.preview.speaker_palette)).toEqual(before.preview.speaker_palette);
    await target.evaluate(()=>performRedo());expect(await target.evaluate(()=>DATA.preview.speaker_palette)).toEqual(applied.preview.speaker_palette);
    await target.evaluate(()=>setEditorSettingsPanelOpen(false));
    await target.waitForFunction(()=>!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.geometry.some(r=>r.text.startsWith('艾尔文：')),null,{timeout:20000});
    const ass=await target.evaluate(()=>fixedAssDocument());expect(ass).toContain('Erwyn：');expect(ass).toContain('艾尔文：');expect(ass).toContain('EFCDAB');
    await target.waitForFunction(()=>!projectSaveInFlight&&!projectCheckpointInFlight);expect(await target.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
    await target.reload();await target.waitForFunction(()=>MSWSubtitleStyle?.ready&&player.readyState>=2);
    await settings(target);await target.locator('#speaker-scheme-select').selectOption(scheme.id);await target.locator('#speaker-scheme-open').click();
    await expect(target.locator('#speaker-scheme-mapping-rows select[data-speaker-id="green"]')).toHaveValue(scheme.rows[0].id);
    await expect(target.locator('#speaker-scheme-plan')).toHaveText('更新 0 人 · 新增 0 人');
    await target.locator('#speaker-scheme-cancel').click();await target.locator('#speaker-scheme-delete').click();await target.locator('#speaker-scheme-delete-confirm').click();
    await expect(target.locator('#speaker-scheme-status')).toContainText('方案已删除');
    expect(await target.evaluate(()=>DATA.preview.speaker_palette.rows[1].name)).toBe('Erwyn');
    expect(JSON.parse(readFileSync(second)).preview.speaker_palette.rows[1].scheme_ref.person_id).toBe(scheme.rows[0].id);
    // The first window still has the old library. It must not resurrect a
    // scheme deleted in the second window or silently overwrite that change.
    await page.locator('#speaker-palette-rows tr[data-speaker-id="yellow"] input[type="text"]').first().fill('Erwyn updated');
    await page.locator('#speaker-palette-rows tr[data-speaker-id="yellow"] input[type="text"]').first().press('Tab');
    await page.locator('#speaker-scheme-overwrite').click();await page.locator('#speaker-scheme-form button[type=submit]').click();
    await expect(page.locator('#speaker-scheme-status')).toContainText('其他窗口');
    const persisted=await target.evaluate(()=>MSWConfig.request({action:'export',categories:['speakerSchemes']}));
    expect(persisted.package.sections.speakerSchemes.schemes).toEqual([]);
    expect(errors).toEqual([]);
  }finally{await target.close();await other.stop();}
});

test('localized speaker names follow physical languages through UI, preview, SRT, ASS and reopen',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{
    let p=JSON.parse(buildJson());const a=p.subtitles.tracks[0];a.language='en';
    p=MSWFlatSubtitles.addTrack(p,{...a,id:'chinese',language:'zh',secondary_for:a.id,style:{...a.style,slot:'secondary'}});
    p.subtitles.cues[1].track_id='chinese';p.subtitles.cues[1].content={start:0,end:3000,text:'你好',items:[]};
    for(const c of p.subtitles.cues)c.content.color={name:'yellow',start:c.content.start,end:c.content.end};
    p=MSWFlatSubtitles.bind(p,p.subtitles.cues[0].id,p.subtitles.cues[1].id,'pair');
    productionCommitProject(p,'names fixture');updateEditorSettings({exportSpeakerLabels:true});
    DATA.preview.speaker_labels_visible=true;player.currentTime=1;
  });
  await settings(page);
  const name=page.locator('#speaker-palette-rows tr[data-speaker-id="yellow"] input[type="text"]').first();
  await name.fill('Erwyn');await name.press('Tab');
  await page.locator('#speaker-name-language').selectOption('zh-hans');
  await expect(name).toHaveValue('');await expect(name).toHaveAttribute('placeholder','Erwyn');
  await name.fill('艾尔文');await name.press('Tab');
  await page.screenshot({path:join(dir,'localized-names.png')});
  await page.evaluate(()=>setEditorSettingsPanelOpen(false));
  await expect(page.locator('.waveform-cue-block[data-track="main"][data-idx="0"]').first()).toHaveAttribute('title',/^Erwyn：Hello/);
  await expect(page.locator('.waveform-cue-block[data-track="extension"][data-ext-idx="0"]').first()).toHaveAttribute('title',/^艾尔文：你好/);
  await page.waitForFunction(()=>!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.geometry.some(r=>r.text.startsWith('艾尔文：')),null,{timeout:20000});
  const output=await page.evaluate(async()=>({srt:buildSrt(),ass:await fixedAssDocument(),body:JSON.parse(buildJson()).subtitles.cues.map(c=>c.content.text)}));
  expect(output.srt).toContain('Erwyn：Hello');expect(output.srt).toContain('艾尔文：你好');
  expect(output.ass).toContain('Erwyn：');expect(output.ass).toContain('艾尔文：');expect(output.body).toEqual(['Hello 世界','你好']);
  const merged=await page.evaluate(async()=>{
    const original=downloadFile;let complete;const done=new Promise(resolve=>complete=resolve);
    try{downloadFile=async text=>complete(text);document.getElementById('download-merged-srt').click();return await done;}
    finally{downloadFile=original;}
  });
  expect(merged).toContain('Erwyn：Hello 世界');expect(merged).toContain('艾尔文：你好');
  expect(await page.evaluate(()=>JSON.parse(buildJson()).subtitles.cues.map(c=>c.content.text))).toEqual(output.body);
  await page.evaluate(()=>fixedTrackMenu(DATA.subtitle_tracks.tracks.find(t=>t.id==='chinese'),500,220));
  await page.getByRole('menuitem',{name:'轨道语言',exact:true}).hover();
  await page.getByRole('menuitem',{name:'法文',exact:true}).click();
  expect(await page.evaluate(()=>buildSrt())).toContain('Erwyn：你好');
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>buildSrt())).toContain('艾尔文：你好');
  await page.evaluate(()=>productionCommitProject(MSWProductionProject.swapColumns(DATA),'交换显示列'));
  expect(await page.evaluate(()=>buildSrt())).toContain('艾尔文：你好');
  await page.waitForFunction(()=>!projectSaveInFlight&&!projectCheckpointInFlight);
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const saved=JSON.parse(readFileSync(project));expect(saved.preview.speaker_palette.rows[0].names).toEqual({'zh-hans':'艾尔文'});
  expect(saved.subtitles.tracks.find(t=>t.id==='chinese').language).toBe('zh');
  await page.reload();await page.waitForFunction(()=>MSWSubtitleStyle?.ready&&player.readyState>=2);
  expect(await page.evaluate(()=>buildSrt())).toContain('艾尔文：你好');
  await settings(page);await page.locator('#speaker-name-language').selectOption('zh-hans');
  await name.fill('');await name.press('Tab');
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[0].names)).toBeUndefined();
  expect(await page.evaluate(()=>buildSrt())).toContain('Erwyn：你好');
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>buildSrt())).toContain('艾尔文：你好');
  expect(errors).toEqual([]);
});

test('track presets yield to speaker colors and manual cue overrides in properties and ASS',async({page})=>{
  await settings(page);
  await page.locator('#speaker-palette-rows tr[data-speaker-id="green"] select').selectOption('stroke');
  await page.evaluate(()=>setEditorSettingsPanelOpen(false));
  await page.evaluate(()=>{
    const p=MSWE.resolve('processing-host').exportProject();
    for(const c of p.subtitles.cues)c.content.color={name:'green',start:c.content.start,end:c.content.end};
    p.subtitles.cues[1].content.subtitle_style={outlineColor:'#abcdef'};
    productionCommitProject(p,'Speaker priority fixture');selectOnly(0);MSWSubtitleStyle.open('track');
  });
  for(const preset of ['large','default']) {
    await page.locator('#style-project-preset').selectOption(preset);
    await page.locator('#style-edit-scope').selectOption('cue');
    await expect(page.locator('#style-field-outlineColor')).toHaveValue('#66bb6a');
    await page.evaluate(()=>selectOnly(1));
    await expect(page.locator('#style-field-outlineColor')).toHaveValue('#abcdef');
    const ass=await page.evaluate(async()=>{
      const result=await MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),video:{width:640,height:360}});
      return result.ass;
    });
    expect(ass).toContain('6ABB66');expect(ass).toContain('EFCDAB');
    await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('track');});
  }
});

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
  await expect(page.locator('.waveform-cue-block[data-idx="0"]').first()).toHaveAttribute('title',/^九号：Hello 世界/);
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
  await expect(page.locator('.media-preview-checks #style-preview-speakers')).toHaveCount(1);
  await expect(page.locator('#style-preview-speakers').locator('..')).toHaveText('预览说话人');
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

test('speaker properties show palette defaults and report overrides without losing the base mode',async({page})=>{
  await settings(page);
  await page.locator('#speaker-palette-rows tr[data-speaker-id="green"] select').selectOption('stroke');
  await page.evaluate(()=>{setEditorSettingsPanelOpen(false);selectOnly(0);MSWSubtitleStyle.open('cue');});
  await page.locator('#style-edit-scope').selectOption('speaker');
  await page.locator('#style-speaker-target').selectOption('green');
  await expect(page.locator('#style-field-outlineColor')).toHaveValue('#66bb6a');
  await page.locator('#style-field-outline').fill('5');await page.locator('#style-field-outline').press('Tab');
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[1].mode)).toBe('stroke');
  await settings(page);
  await expect(page.locator('#speaker-palette-rows tr[data-speaker-id="green"] select')).toHaveValue('properties');
  await page.evaluate(()=>setEditorSettingsPanelOpen(false));
  await page.locator('#style-inherit-appearance').click();
  await expect(page.locator('#style-field-outlineColor')).toHaveValue('#66bb6a');
  await expect(page.locator('#speaker-palette-rows tr[data-speaker-id="green"] select')).toHaveValue('stroke');
  await page.locator('#style-field-outline').fill('6');await page.locator('#style-field-outline').press('Tab');
  await page.locator('#style-animation > summary').click();
  await page.locator('#motion-preset-fade').click();
  const motion=await page.evaluate(()=>DATA.preview.speaker_palette.rows[1].animation);
  await settings(page);
  await page.locator('#speaker-palette-rows tr[data-speaker-id="green"] select').selectOption('text');
  await page.evaluate(()=>setEditorSettingsPanelOpen(false));
  await expect(page.locator('#style-field-primaryColor')).toHaveValue('#66bb6a');
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[1].style)).toBeUndefined();
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows[1].animation)).toEqual(motion);
});

test('speaker palette is the default preset and can restore inherited appearance without removing animation',async({page})=>{
  await settings(page);
  await page.locator('#speaker-palette-rows tr[data-speaker-id="green"] select').selectOption('stroke');
  await page.evaluate(()=>{setEditorSettingsPanelOpen(false);selectOnly(0);MSWSubtitleStyle.open('cue');});
  await page.locator('#style-edit-scope').selectOption('speaker');
  await page.locator('#style-speaker-target').selectOption('green');
  const preset=page.locator('#style-project-preset');
  await expect(preset).toHaveValue('speaker-palette');
  await expect(preset.locator('option:checked')).toHaveText('跟随说话人色系');
  await expect(page.locator('#style-field-outlineColor')).toHaveValue('#66bb6a');
  await page.locator('#style-animation > summary').click();
  await page.locator('#motion-preset-fade').click();
  const animation=await page.evaluate(()=>DATA.preview.speaker_palette.rows[1].animation);
  await preset.selectOption('large');
  await expect(preset).toHaveValue('large');
  await preset.selectOption('speaker-palette');
  const inherited=()=>page.evaluate(()=>{const r=DATA.preview.speaker_palette.rows[1];return {style:r.style,preset:r.style_preset,mode:r.mode,animation:r.animation};});
  expect(await inherited()).toEqual({style:undefined,preset:undefined,mode:'stroke',animation});
  await expect(page.locator('#style-field-outlineColor')).toHaveValue('#66bb6a');
  await page.evaluate(()=>performUndo());await expect(preset).toHaveValue('large');
  await page.evaluate(()=>performRedo());await expect(preset).toHaveValue('speaker-palette');
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  await page.reload();await page.waitForFunction(()=>MSWSubtitleStyle?.ready);
  await page.evaluate(()=>MSWSubtitleStyle.open('cue'));
  await page.locator('#style-edit-scope').selectOption('speaker');
  await page.locator('#style-speaker-target').selectOption('green');
  await expect(preset).toHaveValue('speaker-palette');
  expect(await inherited()).toEqual({style:undefined,preset:undefined,mode:'stroke',animation});
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
    performRedo();const redone=colors();performUndo();
    assignExtensionColor([secondary],'green',getExtensionTrack(track.id));const fromSecondary=colors();
    clearColorOnTargets([main]);const cleared=colors();performUndo();const restored=colors();
    return {fromMain,undone,redone,fromSecondary,cleared,restored};
  });
  expect(result).toEqual({fromMain:['blue','blue'],undone:[null,null],redone:['blue','blue'],fromSecondary:['green','green'],cleared:[null,null],restored:['green','green']});
});

test('coloring keeps existing cards and active secondary editor; deselection clears it',async({page})=>{
  await page.evaluate(()=>{
    let p=MSWE.resolve('processing-host').exportProject();const [a,b]=p.subtitles.cues;
    p=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id:'translation',name:'S1副',style:{mode:'inherit',slot:'secondary',base:'dialogue'}});
    p.subtitles.cues[1].track_id='translation';p.subtitle_view={...p.subtitle_view,secondary_cue_ids:[b.id]};
    p=MSWFlatSubtitles.bind(p,a.id,b.id,'pair');productionCommitProject(p,'绑定',[]);
    updateEditorSettings({selectBoundSubtitlePair:false});selectOnlyExtension(0);
    window.keptCard=container.querySelector('.cue');window.keptCue=getActiveExtensionTrack().segments[0];
    assignExtensionColor([0],'blue');
  });
  expect(await page.evaluate(()=>({same:keptCard.isConnected&&keptCue===getActiveExtensionTrack().segments[0],text:getCurrentCuePanelTarget()?.segment.text}))).toEqual({same:true,text:'Second'});
  await page.evaluate(()=>productionCommitProject(MSWProductionProject.toProject(DATA),'刷新', [...fixedPositionSelectedIds()]));
  expect(await page.evaluate(()=>getCurrentCuePanelTarget()?.segment.text)).toBe('Second');
  await page.locator('.waveform-cue-block').filter({hasText:'Second'}).first().click({modifiers:['Shift']});
  expect(await page.evaluate(()=>({selected:selectedExtensionIdxs.size,target:getCurrentCuePanelTarget()}))).toEqual({selected:0,target:null});
  await page.evaluate(()=>{selectOnly(0);addExtensionToSelection(0);toggleExtensionSelection(0);});
  expect(await page.evaluate(()=>getCurrentCuePanelTarget()?.segment.text)).toBe('Hello 世界');
});
