import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer,clickMenubarItem} from './helpers.mjs';
let server;
const fixture=()=>{
 const rows=[{id:'a',start:0,end:1000,text:'This is a longer subtitle',items:[]},{id:'b',start:1100,end:1600,text:'yes',items:[]},
 {id:'c',start:3000,end:4000,text:'Another longer subtitle',items:[]},{id:'d',start:4100,end:4600,text:'ok',items:[]}];
 return {segments:rows,split_mode:'word',waveform:generateWaveformPayload(10000),multi_subtitle:{enabled:true,display_mode:'both',
  tracks:[{id:'zh',role:'extension',split_mode:'continuous',segments:rows.map((c,i)=>({...c,id:'z'+i,start:c.start+50,end:c.end+50,text:'对应字幕内容'+i}))}],
  bindings:rows.map((c,i)=>({id:'b'+i,track_id:'zh',main_segment_ids:[c.id],extension_segment_ids:['z'+i],start_offset_ms:50,end_offset_ms:50}))}};
};
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
const open=page=>clickMenubarItem(page,'字幕','auto-merge-manage');
const byId=values=>values.slice().sort((a,b)=>a.id.localeCompare(b.id));
test.beforeAll(async()=>{const dir=makeTempDir('batch-merge');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
 await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,clickBehavior:'select-only'})));
 await page.goto(server.url);await page.evaluate(p=>{applyCanonicalProject(p,'batch.mosp');clearSelection({silent:true});renderAll({waveform:'full'});},fixture());
});

test('panel previews track batch without edits, applies parameters and undoes the whole batch',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const before=await snap(page);
 await open(page);await expect(page.locator('#auto-merge-scope')).toHaveValue('track');
 await expect(page.locator('#auto-merge-preview')).toContainText('4 条合并为 2 条');
 expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await expect(page.locator('#auto-merge-panel')).toHaveCSS('opacity','1');await page.mouse.move(1100,700);
 await page.screenshot({path:info.outputPath('batch-merge-dark.png')});
 await page.locator('#auto-merge-gap-ms').fill('50');await expect(page.locator('#auto-merge-run')).toBeDisabled();
 await page.locator('#auto-merge-gap-ms').fill('200');await expect(page.locator('#auto-merge-run')).toBeEnabled();
 await page.locator('#auto-merge-run').click();
 await expect(page.locator('#auto-merge-preview')).toContainText('已应用');
 const after=await snap(page);expect(after.subtitles.cues).toHaveLength(4);expect(after.subtitles.bindings).toHaveLength(2);
 expect(after.subtitles.bindings.every(b=>b.start_offset_ms===50&&b.end_offset_ms===50)).toBe(true);
 await page.locator('#auto-merge-close').click();await page.keyboard.press('Control+z');
 expect(byId((await snap(page)).subtitles.cues)).toEqual(byId(before.subtitles.cues));expect((await snap(page)).subtitles.bindings).toEqual(before.subtitles.bindings);
 expect(errors).toEqual([]);
});

test('selected scope stays narrow and never falls back to all after clearing selection',async({page})=>{
 await page.evaluate(()=>{selectOnly(0);selectedIdxs.add(1);updateSelectionCountText();});await open(page);
 await expect(page.locator('#auto-merge-scope')).toHaveValue('selected');
 await expect(page.locator('#auto-merge-preview')).toContainText('2 条合并为 1 条');
 await page.evaluate(()=>clearSelection());await expect(page.locator('#auto-merge-preview')).toContainText('本轨道未选择字幕');
 await expect(page.locator('#auto-merge-run')).toBeDisabled();expect((await snap(page)).subtitles.cues).toHaveLength(8);
});

test('actual track choice works after swapping columns and saves the display sides',async({page})=>{
 await page.evaluate(()=>swapMainAndExtensionSubtitles());const before=await snap(page),track=before.subtitles.tracks[0];
 await open(page);await page.locator('#auto-merge-track').selectOption(track.id);await page.locator('#auto-merge-scope').selectOption('track');
 await expect(page.locator('#auto-merge-preview')).toContainText('4 条合并为 2 条');await page.locator('#auto-merge-run').click();
 const after=await snap(page);expect(after.subtitles.cues.filter(c=>c.track_id===track.id)).toHaveLength(2);
 expect(after.subtitles.cues.filter(c=>c.track_id===track.id).every(c=>after.subtitle_view.secondary_cue_ids.includes(c.id))).toBe(true);
 await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),after);
 expect((await snap(page)).subtitles).toEqual(after.subtitles);
});

test('gap-only mode changes the chosen edge and leaves text and IDs intact',async({page})=>{
 const before=await snap(page);await open(page);await page.locator('#auto-merge-absorb-short').uncheck();
 await page.locator('#auto-merge-snap-direction').selectOption('forward');
 await expect(page.locator('#auto-merge-preview')).toContainText('2 处间隔');await page.locator('#auto-merge-run').click();
 const after=await snap(page);expect(after.subtitles.cues.map(c=>c.id)).toEqual(before.subtitles.cues.map(c=>c.id));
 expect(after.subtitles.cues.find(c=>c.content.text==='This is a longer subtitle').content.end).toBe(1100);
 expect(after.subtitles.cues.find(c=>c.content.text==='对应字幕内容0').content.end).toBe(1150);
 expect(after.subtitles.cues.map(c=>c.content.text)).toEqual(before.subtitles.cues.map(c=>c.content.text));
});

test('collision and lock errors stay in the panel and cannot partially modify any track',async({page})=>{
 let p=await snap(page);p.subtitles.cues.push({id:'obstacle',track_id:p.subtitles.tracks[1].id,content:{start:1060,end:1090,text:'obstacle',items:[]}});
 await page.evaluate(p=>applyCanonicalProject(p,'blocked.mosp'),p);const before=await snap(page);await open(page);
 await expect(page.locator('#auto-merge-preview')).toContainText('重叠');await expect(page.locator('#auto-merge-run')).toBeDisabled();
 expect((await snap(page)).subtitles).toEqual(before.subtitles);
 p.subtitles.cues.pop();p.subtitles.tracks[1].locked=true;await page.evaluate(p=>applyCanonicalProject(p,'locked.mosp'),p);
 await expect(page.locator('#auto-merge-preview')).toContainText('锁定');await expect(page.locator('#auto-merge-run')).toBeDisabled();
});

test('shared state mode respects marks and closed panels do not eat C or create extra undo',async({page})=>{
 await page.evaluate(()=>{DATA.segments[0].color={name:'red',start:0,end:1000};renderAll();});
 await open(page);await page.locator('#auto-merge-state-mode').selectOption('common');await page.locator('#auto-merge-snap-gaps').uncheck();
 await expect(page.locator('#auto-merge-run')).toBeEnabled();await page.locator('#auto-merge-run').click();
 expect((await snap(page)).subtitles.cues.every(c=>!c.content.color)).toBe(true);
 await page.locator('#auto-merge-close').click();await page.keyboard.press('Control+z');
 expect((await snap(page)).subtitles.cues).toHaveLength(8);
 await page.evaluate(()=>{clearSelection({silent:true});selectedIdxs.add(0);selectedIdxs.add(2);lastEditRegion='list';document.activeElement.blur();});
 await page.keyboard.press('c'); // Existing direct merge still decides its own collision policy.
 expect((await snap(page)).subtitles.cues).toHaveLength(8);
});

test('help icons pin and dismiss, and the compact panel fits small and light layouts',async({page},info)=>{
 await page.evaluate(()=>{updateEditorSettings({theme:'light',themePreset:'alice',colors:{}});applyThemeAndColors();});await page.setViewportSize({width:900,height:600});
 await open(page);await page.locator('#auto-merge-panel-title .msw-help-button').click();
 await expect(page.locator('#msw-option-help')).toContainText('整批可一次撤销');await page.keyboard.press('Escape');
 await expect(page.locator('#msw-option-help')).toBeHidden();await expect(page.locator('#auto-merge-panel')).toBeVisible();
 expect(await page.locator('#auto-merge-panel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(page.locator('#auto-merge-panel')).toHaveCSS('opacity','1');await page.mouse.move(850,500);
 const checks=await page.locator('#auto-merge-panel input[type=checkbox]').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().width));
 expect(checks.every(width=>width<=18)).toBe(true);
 await expect(page.locator('#auto-merge-run')).toBeInViewport();
 await page.screenshot({path:info.outputPath('batch-merge-light-small.png')});
});

test('an independent third track is processed without changing the paired tracks',async({page})=>{
 const p=await snap(page);p.subtitles.tracks.push({...p.subtitles.tracks[0],id:'third',name:'S2',display_number:2});p.subtitles.next_track_number=3;
 p.subtitles.cues.push(...p.subtitles.cues.filter(c=>c.track_id===p.subtitles.tracks[0].id).map(c=>({...c,id:'third-'+c.id,track_id:'third'})));
 await page.evaluate(p=>applyCanonicalProject(p,'third.mosp'),p);const before=await snap(page);
 await open(page);await page.locator('#auto-merge-track').selectOption('third');await page.locator('#auto-merge-scope').selectOption('track');
 await expect(page.locator('#auto-merge-preview')).toContainText('4 条合并为 2 条');await page.locator('#auto-merge-run').click();
 const after=await snap(page);expect(after.subtitles.cues.filter(c=>c.track_id==='third')).toHaveLength(2);
 expect(after.subtitles.cues.filter(c=>c.track_id!=='third')).toEqual(before.subtitles.cues.filter(c=>c.track_id!=='third'));
 expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
});

test('Apply recalculates current contents instead of committing a stale preview',async({page})=>{
 await open(page);await expect(page.locator('#auto-merge-run')).toBeEnabled();
 const result=await page.evaluate(()=>{
  const p=MSWProductionProject.toProject(DATA);p.subtitles.tracks[1].locked=true;applyCanonicalProject(p,'locked.mosp');
  const before=buildJson();autoMergeSegments();return {before,after:buildJson(),message:autoMergePreview.textContent};
 });
 expect(result.after).toBe(result.before);expect(result.message).toContain('锁定');
});

test('English labels, explanations and live batch counts are translated',async({page},info)=>{
 await page.evaluate(()=>MSWE_I18N.applyLanguage('en'));await open(page);
 await expect(page.locator('#auto-merge-preview')).toContainText('4 subtitles → 2');
 await page.locator('#auto-merge-panel-title .msw-help-button').click();
 await expect(page.locator('#msw-option-help')).toContainText('one undo step');await page.keyboard.press('Escape');
 const text=await page.locator('#auto-merge-panel').evaluate(el=>{const copy=el.cloneNode(true);copy.querySelector('#auto-merge-track').remove();return copy.innerText||copy.textContent;});
 expect(text).not.toMatch(/[\u3400-\u9fff]/u);
 await page.locator('#auto-merge-run').click();await expect(page.locator('#auto-merge-preview')).toContainText('Applied');
 await page.screenshot({path:info.outputPath('batch-merge-english.png')});
});

test('batch tape marks each actual pair of joins without bridging unrelated groups',async({page})=>{
 await open(page);await expect(page.locator('#auto-merge-run')).toBeEnabled();
 const tapes=await page.evaluate(async()=>{
  EDITOR_SETTINGS.mergeTapeEffect=true;lastPointerPos={x:0,y:0};lastEditRegion='waveform';autoMergeSegments();
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  return [...document.querySelectorAll('.merge-tape-flash')].map(el=>Number(el.dataset.timeMs)).sort((a,b)=>a-b);
 });
 expect(tapes).toEqual([1050,1100,4050,4100]);await expect(page.locator('.merge-tape-flash')).toHaveCount(0);
});
