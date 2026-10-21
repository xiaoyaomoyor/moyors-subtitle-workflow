import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer,clickMenubarItem,clickBatchOperation} from './helpers.mjs';
let server;
const snapshot=page=>page.evaluate(()=>JSON.parse(buildJson()));
const contents=(p,track)=>p.subtitles.cues.filter(c=>c.track_id===track).sort((a,b)=>a.content.start-b.content.start);
test.beforeAll(async()=>{const dir=makeTempDir('batch-tools');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
 await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,clickBehavior:'select-only'})));
 await page.goto(server.url);
 await page.evaluate(waveform=>{
  const rows=[1000,4000].map((start,i)=>({id:'a'+i,start,end:start+1000,text:'Alpha Bravo',items:[{text:'Alpha',start,end:start+500},{text:' Bravo',start:start+500,end:start+1000}]}));
  applyCanonicalProject({segments:rows,waveform,multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'ext',role:'extension',segments:rows.map((c,i)=>({...c,id:'b'+i,start:c.start+50,end:c.end+50,items:[],text:'对应字幕'}))}],bindings:rows.map((c,i)=>({id:'bind'+i,track_id:'ext',main_segment_ids:[c.id],extension_segment_ids:['b'+i],start_offset_ms:50,end_offset_ms:50}))}},'batch-tools.mosp');
  const p=JSON.parse(buildJson());p.subtitles.tracks.push({...p.subtitles.tracks[0],id:'third',name:'S2',display_number:2});p.subtitles.next_track_number=3;
  p.subtitles.cues.push(...rows.map(({id,...content},i)=>({id:'third-'+i,track_id:'third',content})));
  p.subtitle_view.secondary_cue_ids.push('third-1');applyCanonicalProject(p,'batch-tools.mosp');clearSelection({silent:true});fixedActiveTrackId=p.subtitles.tracks[0].id;renderAll({waveform:'full'});
 },generateWaveformPayload(10000));
});
async function openTime(page,track='third') {await clickMenubarItem(page,'字幕','subtitle-scale-offset-open');await page.locator('#subtitle-time-track').selectOption(track);}
async function offset(page,value){await page.locator('#subtitle-time-operation').selectOption('shift');await page.locator('#subtitle-time-direction').selectOption(value<0?'earlier':'later');await page.locator('#subtitle-time-seconds').fill((Math.abs(value)/1000).toFixed(3));await page.locator('#subtitle-time-seconds').press('Enter');if(await page.locator('#subtitle-time-apply').isEnabled())await page.locator('#subtitle-time-apply').click();}
test('time drafts show readable seconds, direction and before/after without mutating on blur',async({page},info)=>{
 const before=await snapshot(page);await selectIds(page,['third-0']);await openTime(page);
 await page.locator('#subtitle-time-direction').selectOption('earlier');await page.locator('#subtitle-time-seconds').fill('0.250');await page.locator('#subtitle-time-seconds').press('Tab');
 await expect(page.locator('#subtitle-time-after')).toContainText('00:00.750 → 00:01.750');
 expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await page.locator('#subtitle-time-apply').click();expect(contents(await snapshot(page),'third')[0].content.start).toBe(750);
 await expect(page.locator('#subtitle-time-seconds')).toHaveValue('0.000');await expect(page.locator('#subtitle-time-apply')).toBeDisabled();
 await page.locator('#subtitle-scale-offset-close').click();await page.keyboard.press('Control+z');expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
});
for(const [anchor,ranges] of [['start',[[1000,3000],[4000,6000]]],['center',[[500,2500],[3500,5500]]],['end',[[0,2000],[3000,5000]]],['group',[[1000,3000],[7000,9000]]]])
test('duration scaling keeps '+anchor+' fixed and preserves word timing',async({page})=>{
 const before=await snapshot(page);await openTime(page);await page.locator('#subtitle-time-operation').selectOption('scale');
 await page.locator('#subtitle-scale-anchor').selectOption(anchor);await page.locator('#subtitle-scale-percent').fill('200');await page.locator('#subtitle-scale-percent').press('Enter');
 await expect(page.locator('#subtitle-time-after')).toContainText('2.000 s');expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await page.locator('#subtitle-time-apply').click();const after=contents(await snapshot(page),'third');expect(after.map(c=>[c.content.start,c.content.end])).toEqual(ranges);
 expect(after.every(c=>c.content.items[0].start===c.content.start&&c.content.items.at(-1).end===c.content.end)).toBe(true);
});
for(const [operation,expected] of [['start',[1250,2000]],['end',[1000,2250]]])test('boundary draft adjusts only '+operation,async({page})=>{
 await selectIds(page,['third-0']);await openTime(page);await page.locator('#subtitle-time-operation').selectOption(operation);await page.locator('#subtitle-time-seconds').fill('0.250');
 await page.locator('#subtitle-time-seconds').press('Enter');await page.locator('#subtitle-time-apply').click();const cue=contents(await snapshot(page),'third')[0].content;
 expect([cue.start,cue.end]).toEqual(expected);
});
test('time tools keep help accessible and fit a narrow light window',async({page},info)=>{
 await page.setViewportSize({width:640,height:600});await page.evaluate(()=>{updateEditorSettings({theme:'light',themePreset:'alice',colors:{}});applyThemeAndColors();});await openTime(page);
 await page.locator('#subtitle-time-operation').selectOption('scale');await page.locator('#subtitle-scale-percent').fill('150');
 const help=page.locator('#subtitle-scale-percent').locator('xpath=../..').locator('.msw-help-button');await help.click();await expect(page.locator('#msw-option-help')).toContainText('不是字号或播放速度');
 await page.mouse.move(620,580);await expect(page.locator('#msw-option-help')).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.locator('#subtitle-time-apply')).toBeInViewport();
 expect(await page.locator('#subtitle-scale-offset-modal').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('time-light-small.png')});
 await page.evaluate(()=>MSWE_I18N.applyLanguage('en'));await page.screenshot({path:info.outputPath('time-english-small.png')});
});
async function selectIds(page,ids){await page.evaluate(ids=>{clearSelection({silent:true});DATA.segments.forEach((c,i)=>{if(ids.includes(c.id))selectedIdxs.add(i);});getActiveExtensionTrack().segments.forEach((c,i)=>{if(ids.includes(c.id))selectedExtensionIdxs.add(i);});updateSelectionCountText();},ids);}

test('time drafts use physical tracks across display columns and apply once after wheel input',async({page},info)=>{
 const before=await snapshot(page);await openTime(page);await expect(page.locator('#subtitle-time-scope')).toHaveValue('all');
 const history=await page.evaluate(()=>editorHistory.undoLength());
 await page.locator('#subtitle-time-seconds').evaluate(input=>{input.focus();for(let i=0;i<3;i++)input.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));});
 expect((await snapshot(page)).subtitles).toEqual(before.subtitles);await page.locator('#subtitle-time-seconds').press('Enter');await page.locator('#subtitle-time-apply').click();
 const after=await snapshot(page);expect(contents(after,'third').map(c=>c.content.start)).toEqual([1030,4030]);
 expect(after.subtitles.cues.filter(c=>c.track_id!=='third')).toEqual(before.subtitles.cues.filter(c=>c.track_id!=='third'));
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 await page.screenshot({path:info.outputPath('time-tools.png')});await page.keyboard.press('Escape');await page.keyboard.press('Control+z');
 expect(contents(await snapshot(page),'third')).toEqual(contents(before,'third'));
});
test('empty selected time scope never widens and collisions or locks do not partly apply',async({page})=>{
 const before=await snapshot(page);await selectIds(page,['third-0']);await openTime(page);await expect(page.locator('#subtitle-time-scope')).toHaveValue('selected');
 await offset(page,3000);await expect(page.locator('#subtitle-time-status')).toContainText('重叠');expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await selectIds(page,[]);await offset(page,100);await expect(page.locator('#subtitle-time-status')).toContainText('当前范围没有字幕');
 const p=await snapshot(page);p.subtitles.tracks[1].locked=true;await page.evaluate(p=>applyCanonicalProject(p,'locked.mosp'),p);
 await page.locator('#subtitle-time-track').selectOption(p.subtitles.tracks[0].id);await page.locator('#subtitle-time-scope').selectOption('all');
 await offset(page,100);await expect(page.locator('#subtitle-time-status')).toContainText('锁定');
 await page.locator('#subtitle-time-linked').uncheck();await offset(page,100);await expect(page.locator('#subtitle-time-status')).toContainText('锁定');
 p.subtitles.tracks[1].locked=false;await page.evaluate(p=>applyCanonicalProject(p,'unlocked.mosp'),p);
 await offset(page,100);expect((await snapshot(page)).subtitles.bindings[0].start_offset_ms).toBe(-50);
});
test('batch replacement changes only the explicit track, retains word timing and binding, and uses theme controls',async({page},info)=>{
 const before=await snapshot(page);await clickBatchOperation(page,'replace-btn');await page.locator('#replace-track').selectOption('third');
 await page.locator('#replace-modal-title .msw-help-button').click();await expect(page.locator('#msw-option-help')).toContainText('不修改伙伴文字');await page.keyboard.press('Escape');
 await page.locator('#find-input').fill('Bravo');await page.locator('#replace-input').fill('bravo');
 await expect(page.locator('#replace-preview')).toContainText('预计修改 2 条');await page.screenshot({path:info.outputPath('replace-tools.png')});
 await page.locator('#replace-confirm').click();const after=await snapshot(page);
 expect(contents(after,'third').map(c=>c.content.text)).toEqual(['Alpha bravo','Alpha bravo']);expect(contents(after,'third').every(c=>c.content.items.length>0)).toBe(true);
 expect(after.subtitles.cues.filter(c=>c.track_id!=='third')).toEqual(before.subtitles.cues.filter(c=>c.track_id!=='third'));
 await page.keyboard.press('Control+z');expect(contents(await snapshot(page),'third')).toEqual(contents(before,'third'));
});
test('replacement selected IDs survive display changes, invalid regex and empty track scope are inert',async({page})=>{
 await selectIds(page,['third-1']);await clickBatchOperation(page,'replace-btn');await expect(page.locator('#replace-track')).toHaveValue('third');
 await page.locator('#find-input').fill('[');await page.locator('#use-regex').check();await expect(page.locator('#replace-confirm')).toBeDisabled();
 await page.locator('#use-regex').uncheck();await page.locator('#find-input').fill('Alpha');await page.locator('#replace-input').fill('Beta');
 await page.locator('#replace-confirm').click();expect(contents(await snapshot(page),'third').map(c=>c.content.text)).toEqual(['Alpha Bravo','Beta Bravo']);
 await clickBatchOperation(page,'replace-btn');const p=await snapshot(page);await page.locator('#replace-track').selectOption(p.subtitles.tracks[0].id);
 await expect(page.locator('#replace-preview')).toContainText('当前范围没有字幕');await expect(page.locator('#replace-confirm')).toBeDisabled();
});
test('text processing has track scope, no partner text edits and preserves empty lines',async({page},info)=>{
 const before=await snapshot(page);await clickBatchOperation(page,'text-process-btn');
 await page.locator('#text-process-prefix').check();await page.locator('#text-process-prefix-input').fill('注：');
 await expect(page.locator('#text-process-preview')).toContainText('预计修改 2 条');await page.screenshot({path:info.outputPath('text-tools.png')});
 await page.locator('#text-process-confirm').click();const after=await snapshot(page);
 expect(contents(after,after.subtitles.tracks[0].id).every(c=>c.content.text.startsWith('注：'))).toBe(true);
 expect(contents(after,after.subtitles.tracks[1].id)).toEqual(contents(before,before.subtitles.tracks[1].id));expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
});
test('pure text keeps bound structure, allows wording edits and blocks stale drafts',async({page})=>{
 const before=await snapshot(page);await clickBatchOperation(page,'timed-text-edit-btn');
 await page.locator('#timed-text-edit-rows textarea').first().fill('Alpha\nBravo');
 await expect(page.locator('#timed-text-edit-report-hint')).toContainText('联动切分');await expect(page.locator('#timed-text-edit-apply')).toBeDisabled();
 expect((await snapshot(page)).subtitles.bindings).toEqual(before.subtitles.bindings);
 await page.evaluate(()=>{loadTimedTextEditTrack(timedTextEditDraft.kind);});
 await page.locator('#timed-text-edit-rows textarea').first().fill('alpha Bravo');await expect(page.locator('#timed-text-edit-apply')).toBeEnabled();
 await page.locator('#timed-text-edit-apply').click();expect((await snapshot(page)).subtitles.bindings).toEqual(before.subtitles.bindings);
 await clickBatchOperation(page,'timed-text-edit-btn');await page.locator('#timed-text-edit-rows textarea').first().fill('different');
 await page.evaluate(()=>{const cue=[...DATA.segments,...getActiveExtensionTrack().segments].find(c=>c.id===timedTextEditDraft.sourceSegments[0].id);cue.color={name:'red',start:cue.start,end:cue.end};});
 await expect(page.locator('#timed-text-edit-report-hint')).toContainText('编辑期间');await expect(page.locator('#timed-text-edit-apply')).toBeDisabled();
});
test('pure text edits selected independent rows, roundtrips JSON and restores in one undo',async({page},info)=>{
 await selectIds(page,['third-0']);const before=await snapshot(page);await clickBatchOperation(page,'timed-text-edit-btn');
 await expect(page.locator('#timed-text-edit-track')).toHaveValue('third');await expect(page.locator('#timed-text-edit-rows textarea')).toHaveCount(1);
 await page.locator('#timed-text-edit-rows textarea').first().fill('Alpha\nBravo');await expect(page.locator('#timed-text-edit-apply')).toBeEnabled();
 await page.screenshot({path:info.outputPath('pure-text-tools.png')});await page.locator('#timed-text-edit-apply').click();
 const after=await snapshot(page);expect(contents(after,'third')).toHaveLength(3);expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
 await page.keyboard.press('Control+z');expect(contents(await snapshot(page),'third')).toEqual(contents(before,'third'));
 await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),after);expect((await snapshot(page)).subtitles).toEqual(after.subtitles);
});
test('cleanup previews actual deletions, preserves partners and supports one undo',async({page},info)=>{
 await page.evaluate(()=>{DATA.segments[0].text='';DATA.segments[0].items=[];});const before=await snapshot(page);
 await clickBatchOperation(page,'clear-empty-cues');await expect(page.locator('#subtitle-cleanup-status')).toContainText('将删除 1 条');
 await expect(page.locator('#subtitle-cleanup-status')).toContainText('另一侧字幕保留');await page.screenshot({path:info.outputPath('cleanup-tools.png')});
 await page.locator('#subtitle-cleanup-apply').click();const after=await snapshot(page);expect(after.subtitles.cues).toHaveLength(before.subtitles.cues.length-1);
 expect(contents(after,before.subtitles.tracks[1].id)).toEqual(contents(before,before.subtitles.tracks[1].id));
 await page.locator('#subtitle-cleanup-close').click();await page.keyboard.press('Control+z');expect((await snapshot(page)).subtitles.bindings).toEqual(before.subtitles.bindings);
});

test('light compact layouts and English labels keep the same scoped controls',async({page},info)=>{
 await page.evaluate(()=>{updateEditorSettings({theme:'light',themePreset:'alice',colors:{}});applyThemeAndColors();MSWE_I18N.applyLanguage('en');});
 await page.setViewportSize({width:900,height:600});
 await page.evaluate(()=>openTextProcessModal());await page.locator('#text-process-prefix').check();await page.locator('#text-process-prefix-input').fill('Note: ');
 await expect(page.locator('#text-process-preview')).toContainText('Scope: 2 subtitles');
 await page.locator('#text-process-title .msw-help-button').click();await expect(page.locator('#msw-option-help')).toContainText('bound partners');await page.keyboard.press('Escape');
 const text=await page.locator('#text-process-modal').evaluate(el=>{const clone=el.cloneNode(true);clone.querySelectorAll('[data-legacy-settings],select,#text-process-preview').forEach(e=>e.remove());return clone.textContent;});
 expect(text).not.toMatch(/[\u3400-\u9fff]/u);
 const bounds=await page.locator('#text-process-modal .modal').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(900);expect(bounds.y+bounds.height).toBeLessThanOrEqual(600);
 await page.screenshot({path:info.outputPath('batch-tools-light-english.png')});await page.locator('#text-process-cancel').click();
 await page.evaluate(()=>openSubtitleCleanup());await expect(page.locator('#subtitle-cleanup-status')).toHaveText('No subtitles to remove in this scope');
});

test('closing before the debounced report still protects text drafts',async({page})=>{
 await clickBatchOperation(page,'timed-text-edit-btn');
 let prompted=false;page.once('dialog',async dialog=>{prompted=true;await dialog.dismiss();});
 await page.evaluate(()=>{const input=timedTextEditRows.querySelector('textarea');input.value='Unapplied words';input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('timed-text-edit-cancel').click();});
 expect(prompted).toBe(true);await expect(page.locator('#timed-text-edit-modal')).toHaveClass(/show/);
 expect(await page.locator('#timed-text-edit-rows textarea').first().inputValue()).toBe('Unapplied words');
});

test('cleanup selected scope follows selection changes while its floating panel stays open',async({page})=>{
 await clickBatchOperation(page,'clear-empty-cues');await page.locator('#subtitle-cleanup-track').selectOption('third');
 await page.locator('#subtitle-cleanup-scope').selectOption('selected');await page.locator('#subtitle-cleanup-mode').selectOption('all');
 await expect(page.locator('#subtitle-cleanup-apply')).toBeDisabled();await selectIds(page,['third-1']);
 await expect(page.locator('#subtitle-cleanup-status')).toContainText('将删除 1 条');await expect(page.locator('#subtitle-cleanup-apply')).toBeEnabled();
 await selectIds(page,[]);await expect(page.locator('#subtitle-cleanup-apply')).toBeDisabled();
});

test('cleanup all tracks supports inclusive character counts, keywords and one undo',async({page},info)=>{
 const before=await snapshot(page);await clickBatchOperation(page,'clear-empty-cues');
 await page.locator('#subtitle-cleanup-track').selectOption('*');
 await page.locator('#subtitle-cleanup-comparison').selectOption('gte');
 await page.locator('#subtitle-cleanup-threshold').fill('10');
 await expect(page.locator('#subtitle-cleanup-status')).toContainText('将删除 4 条');
 await page.locator('#subtitle-cleanup-threshold').fill('-1');await expect(page.locator('#subtitle-cleanup-apply')).toBeDisabled();
 await page.locator('#subtitle-cleanup-mode').selectOption('keyword');await expect(page.locator('#subtitle-cleanup-apply')).toBeDisabled();
 await page.locator('#subtitle-cleanup-keyword').fill('bravo');await expect(page.locator('#subtitle-cleanup-status')).toContainText('将删除 4 条');
 await page.screenshot({path:info.outputPath('cleanup-keywords.png')});
 await page.locator('#subtitle-cleanup-apply').click();
 expect((await snapshot(page)).subtitles.cues.map(c=>c.content.text)).toEqual(['对应字幕','对应字幕']);
 await page.locator('#subtitle-cleanup-close').click();await page.keyboard.press('Control+z');expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
});

test('all-track cleanup keeps selection narrow and rejects locked matches atomically',async({page},info)=>{
 const p=await snapshot(page);p.subtitles.tracks.find(t=>t.id==='third').locked=true;
 await page.evaluate(p=>applyCanonicalProject(p,'locked-cleanup.mosp'),p);await selectIds(page,['third-1']);
 await clickBatchOperation(page,'clear-empty-cues');await page.locator('#subtitle-cleanup-track').selectOption('*');
 await page.locator('#subtitle-cleanup-mode').selectOption('keyword');await page.locator('#subtitle-cleanup-keyword').fill('Alpha');
 await expect(page.locator('#subtitle-cleanup-status')).toContainText('锁定');await expect(page.locator('#subtitle-cleanup-apply')).toBeDisabled();
 await selectIds(page,[]);await expect(page.locator('#subtitle-cleanup-status')).toContainText('没有可清理');
 await page.locator('#subtitle-cleanup-scope').selectOption('all');await expect(page.locator('#subtitle-cleanup-status')).toContainText('锁定');
 await page.locator('#subtitle-cleanup-mode').selectOption('length');await page.locator('#subtitle-cleanup-threshold').fill('4');
 await expect(page.locator('#subtitle-cleanup-status')).toContainText('将删除 2 条');
 await page.setViewportSize({width:900,height:600});await page.locator('#subtitle-cleanup-panel').screenshot({path:info.outputPath('cleanup-threshold.png')});
});
