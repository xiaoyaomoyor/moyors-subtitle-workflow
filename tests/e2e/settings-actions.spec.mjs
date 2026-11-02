import {test,expect} from '@playwright/test';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startBlankServer} from './helpers.mjs';
let server,errors;
const fixture=()=>({segments:[{id:'a',start:0,end:3000,text:'Source',items:[]}],multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[{id:'b',start:0,end:3000,text:'译文',items:[]}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]},waveform:generateWaveformPayload(6000)});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
const open=(page,category)=>page.evaluate(c=>setProjectSettingsPanelOpen(true,c),category);
test.beforeEach(async({page})=>{
 server=await startBlankServer(await findFreePort(),makeTempDir('settings-actions'));
 errors=[];page.on('pageerror',e=>errors.push(e.message));
 await disableOnboarding(page);await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
 await page.evaluate(p=>{
  applyCanonicalProject(p,'actions.mosp');updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false});
  const project=JSON.parse(buildJson()),base=project.subtitles.tracks[0];
  let next=MSWFlatSubtitles.addTrack(project,{...base,id:'s2',secondary_for:undefined,language:'en'});
  next=MSWFlatSubtitles.addTrack(next,{...base,id:'s2-secondary',secondary_for:'s2',language:'zh'});
  applyCanonicalProject(next,'actions.mosp');selectOnly(0);
 },fixture());
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();expect(errors).toEqual([]);});

test('explicit track routes preserve selection, edit the secondary only and return to that track',async({page},info)=>{
 const before=await snap(page),selection=await page.evaluate(()=>snapshotEditorSelection());
 await open(page,'subtitle-layout');await page.locator('#project-style-tracks button').filter({hasText:'S2副'}).click();
 await expect(page.locator('#style-edit-scope')).toHaveValue('s2');
 await expect(page.locator('#style-secondary')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>snapshotEditorSelection())).toEqual(selection);
 expect(await page.evaluate(()=>editorHistory.canUndo())).toBe(false);
 await page.locator('#style-field-fontSize').fill('72');await page.locator('#style-field-fontSize').blur();
 const changed=await snap(page);
 expect(changed.subtitles.tracks.find(t=>t.id==='s2-secondary').style.value.secondary.fontSize).toBe(72);
 expect(await page.evaluate(()=>MSWTrackPresentation.styleFor(DATA,DATA.subtitle_tracks.tracks.find(t=>t.id==='s2')).main.fontSize)).toBe(48);
 expect(changed.subtitles.cues).toEqual(before.subtitles.cues);
 await page.locator('#style-project-settings-open').click();
 await expect(page.locator('#track-split-track')).toHaveValue('s2-secondary');
 await page.locator('#track-project-language').selectOption('ja');
 expect((await snap(page)).subtitles.tracks.find(t=>t.id==='s2-secondary').language).toBe('ja');
 await page.evaluate(()=>performUndo());await expect(page.locator('#track-project-language')).toHaveValue('zh-hans');
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await page.evaluate(()=>performRedo());await page.evaluate(()=>performRedo());
 const saved=await snap(page);await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),saved);
 await open(page,'time-tracks');await page.locator('#track-split-track').selectOption('s2-secondary');
 await expect(page.locator('#track-project-language')).toHaveValue('ja');
 await page.locator('#project-settings-modal').screenshot({path:info.outputPath('project-track-actions.png')});
});

test('speaker table and properties target the same person, undo preserves per-cue overrides and user presets',async({page},info)=>{
 await page.evaluate(()=>{
  const row=MSWSpeaker.ensure(DATA).rows[1];Object.assign(row,{name:'Second speaker',mode:'stroke',color:'#33aa44'});
  DATA.segments[0].color={name:row.id,start:0,end:3000};DATA.segments[0].subtitle_style={fontSize:101};speakerPaletteChanged();editorHistory.clear();
 });
 const id=await page.evaluate(()=>MSWSpeaker.ensure(DATA).rows[1].id),before=await snap(page);
 const library=await page.evaluate(()=>MSWConfig.storage.getItem('msw.subtitle-presets.v1'));
 await open(page,'subtitle-speakers');
 await page.locator(`#speaker-palette-rows tr[data-speaker-id="${id}"] .speaker-style-action`).click();
 await expect(page.locator('#style-edit-scope')).toHaveValue('speaker');await expect(page.locator('#style-speaker-target')).toHaveValue(id);
 await expect(page.locator('#style-field-outlineColor')).toHaveValue('#33aa44');
 await expect(page.locator('#style-project-preset')).toHaveValue('speaker-palette');
 await page.locator('#style-field-fontSize').fill('64');await page.locator('#style-field-fontSize').blur();
 expect((await snap(page)).preview.speaker_palette.rows[1].style.fontSize).toBe(64);
 expect((await snap(page)).subtitles.cues).toEqual(before.subtitles.cues);
 await page.locator('#style-project-settings-open').click();
 await expect(page.locator(`#speaker-palette-rows tr[data-speaker-id="${id}"] input[type=text]`).first()).toBeFocused();
 await expect(page.locator(`#speaker-palette-rows tr[data-speaker-id="${id}"] select`)).toHaveValue('properties');
 await page.locator('#project-settings-modal').screenshot({path:info.outputPath('speaker-properties-link.png')});
 await page.evaluate(()=>performUndo());expect((await snap(page)).preview.speaker_palette).toEqual(before.preview.speaker_palette);
 await page.evaluate(()=>performRedo());const saved=await snap(page);
 expect(await page.evaluate(()=>MSWConfig.storage.getItem('msw.subtitle-presets.v1'))).toBe(library);
 await page.evaluate(p=>applyCanonicalProject(p,'speaker-reopen.mosp'),saved);await open(page,'subtitle-speakers');
 await page.locator(`#speaker-palette-rows tr[data-speaker-id="${id}"] .speaker-style-action`).click();
 await expect(page.locator('#style-field-fontSize')).toHaveValue('64');
});

test('removed targets and project switches never edit another track or stale speaker',async({page})=>{
 await page.evaluate(()=>MSWSubtitleStyle.editTrack('s2-secondary'));
 const before=await snap(page);
 expect(await page.evaluate(()=>MSWSubtitleStyle.editTrack('missing'))).toBe(false);
 expect(await page.evaluate(()=>MSWSubtitleStyle.editSpeaker('missing'))).toBe(false);
 expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks=p.subtitles.tracks.filter(t=>t.id!=='s2-secondary');productionCommitProject(p,'remove empty track');});
 await expect(page.locator('#style-edit-scope')).toHaveValue('cue');
 await page.evaluate(()=>MSWSubtitleStyle.editSpeaker(MSWSpeaker.ensure(DATA).rows[1].id));
 await page.locator('#style-save-as').click();await expect(page.locator('#style-save-form')).toBeVisible();
 await page.evaluate(p=>applyCanonicalProject(p,'new.mosp'),fixture());
 await expect(page.locator('#style-edit-scope')).toHaveValue('cue');await expect(page.locator('#style-save-form')).toBeHidden();
 await open(page,'subtitle-speakers');await page.locator('#speaker-palette-rows tr').nth(2).locator('.speaker-style-action').click();
 await expect(page.locator('#style-edit-scope')).toHaveValue('speaker');
 expect(await page.evaluate(()=>editorHistory.canUndo())).toBe(false);
});

test('project track context actions and locks share the existing transaction',async({page})=>{
 await open(page,'time-tracks');
 const button=page.locator('#project-settings-tracks [data-track-id="s2"] button');
 await button.click();await expect(page.locator('#track-split-track')).toHaveValue('s2');
 await button.click({button:'right'});await page.locator('#ctxmenu').getByText('锁定轨道',{exact:true}).click();
 await expect(page.locator('#track-project-language')).toBeDisabled();await expect(page.locator('#track-split-mode')).toBeDisabled();
 await expect(page.locator('#project-settings-tracks [data-track-id="s2"]')).toContainText('已锁定');
 await page.evaluate(()=>performUndo());await expect(page.locator('#track-project-language')).toBeEnabled();
 await page.evaluate(()=>MSWSubtitleStyle.editTrack('s2'));await expect(page.locator('#style-field-fontSize')).toBeEnabled();
});

test('switching to an empty project clears old project resource paths',async({page})=>{
 await page.evaluate(p=>{p.sticker_root='C:/synthetic/stickers';applyCanonicalProject(p,'a.mosp');STICKERS.push({rel:'sample.png',name:'sample'});},fixture());
 await open(page,'media-resources');await page.locator('#sticker-root-btn').click();
 await expect(page.locator('#sticker-root-input')).toHaveValue('C:/synthetic/stickers');
 await page.evaluate(p=>applyCanonicalProject(p,'b.mosp'),fixture());
 await expect(page.locator('#sticker-root-modal')).toBeHidden();expect((await snap(page)).sticker_root).toBe('');
 expect(await page.evaluate(()=>STICKERS.length)).toBe(0);
 await page.locator('#sticker-root-btn').click();await expect(page.locator('#sticker-root-input')).toHaveValue('');
});

test('a delayed resource response cannot overwrite the newly opened project',async({page})=>{
 let received,release;
 const arrived=new Promise(resolve=>received=resolve),resume=new Promise(resolve=>release=resolve);
 await page.route('**/api/stickers/root',async route=>{received();await resume;await route.fulfill({json:{ok:true,root:'C:/synthetic/old',count:1,stickers:[{rel:'old.png',name:'old'}]}});});
 await open(page,'media-resources');await page.locator('#sticker-root-btn').click();
 await page.locator('#sticker-root-input').fill('C:/synthetic/old');await page.locator('#sticker-root-read').click();await arrived;
 await page.evaluate(p=>applyCanonicalProject(p,'new.mosp'),fixture());release();
 await expect(page.locator('#sticker-root-read')).toBeEnabled();
 expect((await snap(page)).sticker_root).toBe('');expect(await page.evaluate(()=>STICKERS.length)).toBe(0);
 await expect(page.locator('#sticker-root-modal')).toBeHidden();
});

test('large project overview reuses cue ownership and refreshes counts after structural undo',async({page},info)=>{
 await page.evaluate(waveform=>{
  applyCanonicalProject({waveform,segments:Array.from({length:6000},(_,i)=>({id:'large-'+i,start:i*1000,end:i*1000+800,text:'Subtitle '+i,items:[]}))},'large.mosp');
 },generateWaveformPayload(6000000));
 await open(page,'time-tracks');await expect(page.locator('#project-settings-tracks')).toContainText('6000 条字幕');
 const metrics=await page.evaluate(()=>{
  const original=MSWSubtitleTracks.ownerMap;let scans=0;
  MSWSubtitleTracks.ownerMap=(...args)=>{scans++;return original(...args);};
  try {const start=performance.now();for(let i=0;i<20;i++)settingsWindowsContent.refresh();return {scans,twentyRefreshMs:performance.now()-start};}
  finally {MSWSubtitleTracks.ownerMap=original;}
 });
 expect(metrics.scans).toBe(0);await info.attach('overview-timing',{body:JSON.stringify(metrics),contentType:'application/json'});
 await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.cues.pop();productionCommitProject(p,'remove test cue');});
 await expect(page.locator('#project-settings-tracks')).toContainText('5999 条字幕');
 await page.evaluate(()=>performUndo());await expect(page.locator('#project-settings-tracks')).toContainText('6000 条字幕');
});
