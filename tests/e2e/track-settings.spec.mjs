import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server;
const fixture=()=>({segments:[{id:'a',start:0,end:4000,text:'alpha beta gamma delta',items:[]}],
 multi_subtitle:{enabled:true,main_split_mode:'word',display_mode:'both',tracks:[{id:'zh',role:'extension',split_mode:'continuous',segments:[{id:'b',start:200,end:4200,text:'甲乙丙丁',items:[]}]}],
 bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:200,end_offset_ms:200}]},waveform:generateWaveformPayload(10000)});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
const byId=values=>values.slice().sort((a,b)=>a.id.localeCompare(b.id));
test.beforeAll(async()=>{const dir=makeTempDir('track-settings');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
 await disableOnboarding(page);
 await page.addInitScript(()=>{if(!localStorage.getItem('moy.asr.editor.settings.v1'))localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,clickBehavior:'select-only'}));});
 await page.goto(server.url);
 await page.evaluate(p=>{applyCanonicalProject(p,'settings.mosp');renderAll({waveform:'full'});},fixture());
});

test('normal editor splits legacy settings among existing panels with compact controls',async({page},info)=>{
 await expect(page.locator('#multi-subtitle-settings-dropdown')).toBeHidden();
 await expect(page.locator('#overlay-track-controls')).toBeHidden();
 await page.evaluate(()=>cueEditorSettingsFloatingPanel.open());
 await expect(page.locator('#track-split-track')).toBeVisible();
 await expect(page.locator('#track-split-mode')).toHaveValue('word');
 await expect(page.locator('#track-select-bound')).not.toBeChecked();
 await expect(page.locator('#track-bind-sync')).toBeChecked();
 await page.locator('#track-select-bound').check();await page.locator('#track-bind-sync').uncheck();
 await page.screenshot({path:info.outputPath('editor-settings.png')});
 await page.evaluate(()=>{cueEditorSettingsFloatingPanel.close();setWaveformSettingsPanelOpen(true);});
 await expect(page.locator('#wave-cross-track-snap')).toBeVisible();
 await page.locator('#wave-cross-track-snap').uncheck();
 expect(await page.evaluate(()=>({pair:EDITOR_SETTINGS.selectBoundSubtitlePair,sync:EDITOR_SETTINGS.multiSubtitleAutoSyncDuration,snap:EDITOR_SETTINGS.crossTrackSnap}))).toEqual({pair:true,sync:false,snap:false});
 await page.screenshot({path:info.outputPath('wave-settings.png')});
});

test('track split mode is independent of list side, survives save/reopen and can be undone',async({page})=>{
 const before=await snap(page),[main,secondary]=before.subtitles.tracks;
 await page.evaluate(()=>cueEditorSettingsFloatingPanel.open());
 await page.locator('#track-split-track').selectOption(secondary.id);await page.locator('#track-split-mode').selectOption('word');
 let saved=await snap(page);expect(saved.subtitles.tracks.map(t=>t.split_mode)).toEqual(['word','word']);
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles.tracks.find(t=>t.id===secondary.id).split_mode).toBe('continuous');
 await page.locator('#track-split-mode').selectOption('auto');saved=await snap(page);
 await page.evaluate(p=>{applyCanonicalProject(p,'reopened.mosp');cueEditorSettingsFloatingPanel.close();cueListSettingsFloatingPanel.open();},saved);
 await page.locator('#cue-list-swap-sides').click();const swapped=await snap(page);
 expect(byId(swapped.subtitles.cues)).toEqual(byId(saved.subtitles.cues));expect(swapped.subtitles.bindings).toEqual(saved.subtitles.bindings);
 expect(await page.evaluate(()=>getExtensionSubtitleSplitMode(getActiveExtensionTrack(),getActiveExtensionTrack().segments[0]))).toBe('word');
 expect(await page.evaluate(()=>getMainSubtitleSplitMode(DATA.segments[0]))).toBe('continuous');
 expect(swapped.subtitles.tracks.find(t=>t.id===main.id).split_mode).toBe('word');
 expect(swapped.subtitles.tracks.find(t=>t.id===secondary.id).split_mode).toBe('auto');
 await page.evaluate(p=>applyCanonicalProject(p,'swapped.mosp'),swapped);
 expect((await snap(page)).subtitle_view.secondary_cue_ids).toEqual(swapped.subtitle_view.secondary_cue_ids);
});

test('waveform height no longer changes when tracks or paired visibility change',async({page})=>{
 const result=await page.evaluate(()=>{
  waveformEditor.setRowHeight(80);fixedAddTrack('subtitle');renderAll();const added=waveformEditor.getRowHeight();
  const ext=getActiveExtensionTrack();fixedUpdateTrack(fixedOwner(ext.segments[0],'extension',ext.id),{collapsed:true});
  return {added,collapsed:waveformEditor.getRowHeight(),migrated:EDITOR_SETTINGS.flatTrackSettingsMigrated};
 });
 expect(result).toEqual({added:80,collapsed:80,migrated:true});
});

test('new binding uses first selected cue as reference and sync preference applies atomically',async({page})=>{
 const before=await snap(page);before.subtitles.bindings=[];
 await page.evaluate(p=>{applyCanonicalProject(p,'unbound.mosp');EDITOR_SETTINGS.selectBoundSubtitlePair=false;},before);
 await page.locator('.multi-cue-column.extension .time').click();
 await page.locator('.multi-cue-column.main .time').click({modifiers:['Control']});
 await page.keyboard.press('g');
 const after=await snap(page),secondary=before.subtitles.cues.find(c=>c.content.text==='甲乙丙丁');
 expect(after.subtitles.bindings).toHaveLength(1);expect(after.subtitles.bindings[0].source_id).toBe(secondary.id);
 expect(after.subtitles.cues.every(c=>c.content.start===200&&c.content.end===4200)).toBe(true);
 await page.keyboard.press('Control+z');expect(byId((await snap(page)).subtitles.cues)).toEqual(byId(before.subtitles.cues));
 await page.evaluate(()=>{EDITOR_SETTINGS.multiSubtitleAutoSyncDuration=false;});
 await page.locator('.multi-cue-column.main .time').click();await page.locator('.multi-cue-column.extension .time').click({modifiers:['Control']});
 await page.keyboard.press('g');const preserved=await snap(page);
 expect(byId(preserved.subtitles.cues)).toEqual(byId(before.subtitles.cues));expect(preserved.subtitles.bindings[0].start_offset_ms).toBe(200);
});

test('binding context submenu separates reference reversal from H alignment and supports undo',async({page})=>{
 const before=await snap(page);
 await page.locator('.multi-cue-column.main .time').click({button:'right'});
 await page.locator('#ctxmenu .ctx-submenu-toggle').filter({hasText:'绑定操作'}).hover();
 await page.locator('#ctxmenu .ctx-submenu-menu .item').filter({hasText:'反转绑定方向'}).click();
 const reversed=await snap(page);expect(reversed.subtitles.bindings[0].source_id).toBe(before.subtitles.bindings[0].target_id);
 expect(reversed.subtitle_view.secondary_cue_ids).toEqual(before.subtitle_view.secondary_cue_ids);
 expect(byId(reversed.subtitles.cues)).toEqual(byId(before.subtitles.cues));
 await page.mouse.move(1,1);await page.keyboard.press('h');const aligned=await snap(page);
 expect(aligned.subtitles.cues.every(c=>c.content.start===200&&c.content.end===4200)).toBe(true);
 await page.keyboard.press('Control+z');expect((await snap(page)).subtitles.bindings).toEqual(reversed.subtitles.bindings);
 expect(byId((await snap(page)).subtitles.cues)).toEqual(byId(before.subtitles.cues));
});

test('old disabled secondary stays disabled after migration and settings do not require an enable switch',async({page})=>{
 const p=fixture();p.multi_subtitle.enabled=false;
 await page.evaluate(p=>applyCanonicalProject(p,'old-disabled.mosp'),p);
 const saved=await snap(page);expect(saved.subtitles.tracks[1].enabled).toBe(false);
 await page.evaluate(()=>cueEditorSettingsFloatingPanel.open());
 await page.locator('#track-split-track').selectOption(saved.subtitles.tracks[1].id);
 await expect(page.locator('#track-split-mode')).toHaveValue('continuous');
 await page.locator('#track-split-mode').selectOption('word');
 expect((await snap(page)).subtitles.tracks[1].enabled).toBe(false);
});

test('swapped cards keep reference direction through linked split, merge, undo and reopen',async({page})=>{
 const before=await snap(page),referenceTrack=before.subtitles.cues.find(c=>c.id===before.subtitles.bindings[0].source_id).track_id;
 await page.evaluate(()=>swapMainAndExtensionSubtitles());
 await page.locator('.multi-cue-column.main .time').click();await page.mouse.move(1,1);
 await page.evaluate(()=>{player.currentTime=2;lastEditRegion='waveform';EDITOR_SETTINGS.keyboardOperationReference='playhead';setCuePanelTarget('main',0);});
 await page.keyboard.press('Control+b');
 await expect.poll(async()=>(await snap(page)).subtitles.bindings.length).toBe(2);
 const split=await snap(page);
 for(const b of split.subtitles.bindings)expect(split.subtitles.cues.find(c=>c.id===b.source_id).track_id).toBe(referenceTrack);
 await page.evaluate(()=>{clearSelection({silent:true});DATA.segments.forEach((_,i)=>selectedIdxs.add(i));mergeSegments([...selectedIdxs]);});
 const merged=await snap(page);expect(merged.subtitles.bindings).toHaveLength(1);
 expect(merged.subtitles.cues.find(c=>c.id===merged.subtitles.bindings[0].source_id).track_id).toBe(referenceTrack);
 expect(merged.subtitles.tracks.map(t=>t.split_mode)).toEqual(['word','continuous']);
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(split.subtitles);
 await page.evaluate(p=>applyCanonicalProject(p,'reopened.mosp'),merged);expect((await snap(page)).subtitles).toEqual(merged.subtitles);
});

test('locked tracks allow display swapping without changing their contents or binding direction',async({page})=>{
 const p=await snap(page);p.subtitles.tracks.forEach(t=>t.locked=true);
 await page.evaluate(p=>{applyCanonicalProject(p,'locked.mosp');cueListSettingsFloatingPanel.open();},p);
 await page.locator('#cue-list-swap-sides').click();
 const swapped=await snap(page);expect(swapped.subtitle_view.secondary_cue_ids).not.toEqual(p.subtitle_view.secondary_cue_ids);
 expect(byId(swapped.subtitles.cues)).toEqual(byId(p.subtitles.cues));expect(swapped.subtitles.bindings).toEqual(p.subtitles.bindings);
 expect(swapped.subtitles.tracks).toEqual(p.subtitles.tracks);
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(p.subtitles);
});

test('old height migrates once, with saved waveform height taking precedence even before a project opens',async({page})=>{
 await page.evaluate(()=>{
  localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,multiSubtitleRowHeight:168}));
  localStorage.removeItem('moy.asr.waveform.settings.v1');
 });
 await page.reload();expect(await page.evaluate(()=>waveformEditor.getRowHeight())).toBe(168);
 await page.evaluate(()=>{waveformEditor.setRowHeight(80);updateEditorSettings({flatTrackSettingsMigrated:false,multiSubtitleRowHeight:240});});
 await page.reload();expect(await page.evaluate(()=>waveformEditor.getRowHeight())).toBe(80);
});

test('cross-track snap applies to physical tracks on the same list side and remains optional',async({page})=>{
 const p=await snap(page),first=p.subtitles.tracks[0];p.subtitles.bindings=[];
 p.subtitles.tracks.push({...first,id:'extra',name:'S2',display_number:2});p.subtitles.next_track_number=3;
 p.subtitles.cues.push({id:'anchor',track_id:'extra',content:{start:6000,end:8000,text:'anchor',items:[]}});
 const move=async(snapEnabled)=>{
  await page.evaluate(({p,snapEnabled})=>{applyCanonicalProject(p,'snap.mosp');EDITOR_SETTINGS.crossTrackSnap=snapEnabled;waveformEditor.render();},{p,snapEnabled});
  const box=await page.locator('.waveform-cue-block[data-cue-id="'+p.subtitles.cues[0].id+'"]').first().boundingBox();
  const row=await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.keyboard.down('Shift');
  await page.mouse.move(box.x+box.width/2+row.width*0.196,box.y+box.height/2,{steps:6});await page.mouse.up();await page.keyboard.up('Shift');
  return (await snap(page)).subtitles.cues.find(c=>c.id===p.subtitles.cues[0].id).content.end;
 };
 expect(await move(true)).toBe(6000);expect(await move(false)).toBeLessThan(6000);
});
