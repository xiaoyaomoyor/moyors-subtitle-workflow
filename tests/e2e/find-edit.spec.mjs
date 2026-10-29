import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,generateWav,makeTempDir,startStaticServer,clickBatchOperation} from './helpers.mjs';
let server,audioPath;
test.beforeAll(async()=>{const dir=makeTempDir('find-edit');process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');audioPath=generateWav(join(dir,'test-audio.wav'),60);server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
 await disableOnboarding(page);await page.goto(server.url);
 await page.evaluate(waveform=>{
  const rows=[1000,22000,45000].map((start,i)=>({id:'a'+i,start,end:start+1800,text:'Alpha alpha '+i,items:[]}));
  applyCanonicalProject({segments:rows,waveform,multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'ext',role:'extension',segments:rows.map((c,i)=>({...c,id:'b'+i,text:'中文 alpha '+i}))}],bindings:rows.map((c,i)=>({id:'bind'+i,track_id:'ext',main_segment_ids:[c.id],extension_segment_ids:['b'+i],start_offset_ms:0,end_offset_ms:0}))}},'find-edit.mosp');
  const p=JSON.parse(buildJson());p.subtitles.tracks.push({...p.subtitles.tracks[0],id:'third',name:'S2',display_number:2});p.subtitles.next_track_number=3;
  window.findTestIds={a0:p.subtitles.cues.find(c=>c.content.text==='Alpha alpha 0').id,a1:p.subtitles.cues.find(c=>c.content.text==='Alpha alpha 1').id};
  p.subtitles.cues.push({id:'c0',track_id:'third',content:{start:51000,end:53000,text:'隐藏 Alpha <script> 中文',items:[],disabled:true}});
  applyCanonicalProject(p,'find-edit.mosp');clearSelection({silent:true});renderAll({waveform:'full'});
 },generateWaveformPayload(60000));
});
const search=async(page,text='alpha')=>{await page.keyboard.press('Control+f');await expect(page.locator('#find-edit-panel')).toBeVisible();await page.locator('#find-edit-query').fill(text);await expect(page.locator('#find-edit-results')).toHaveAttribute('aria-busy','false');};
const count=(page,text)=>expect(page.locator('#find-edit-count')).toHaveText(text);
test('Ctrl+F searches all physical tracks, marks visible waveform text, and preserves project and selection',async({page})=>{
 const before=await page.evaluate(()=>({p:JSON.parse(buildJson()),ids:batchSelectedIds(),history:editorHistory.undoLength()}));
 await search(page);await count(page,'7 条字幕 · 10 处匹配');
 await expect(page.locator('.waveform-cue-block.msw-search-hit').first()).toBeVisible();
 await expect(page.locator('.waveform-cue-label mark').first()).toHaveText(/alpha/i);
 expect(await page.evaluate(()=>({p:JSON.parse(buildJson()),ids:batchSelectedIds(),history:editorHistory.undoLength()}))).toEqual(before);
 await page.keyboard.press('Escape');await expect(page.locator('#find-edit-panel')).not.toBeVisible();await expect(page.locator('.msw-search-hit')).toHaveCount(0);
 await page.keyboard.press('Control+f');await count(page,'7 条字幕 · 10 处匹配');await expect(page.locator('#find-edit-query')).toBeFocused();
});
test('specific tracks support multiple and empty scopes; current selection is frozen during navigation',async({page})=>{
 await search(page);await count(page,'7 条字幕 · 10 处匹配');await page.locator('#find-edit-scope').selectOption('tracks');
 for(const input of await page.locator('#find-edit-tracks input').all())await input.uncheck();await count(page,'0 条字幕 · 0 处匹配');
 await page.locator('#find-edit-tracks input[value="third"]').check();await count(page,'1 条字幕 · 1 处匹配');
 await page.evaluate(()=>{clearSelection({silent:true});for(const id of Object.values(findTestIds))selectedIdxs.add(DATA.segments.findIndex(c=>c.id===id));updateSelectionCountText();});
 await page.locator('#find-edit-scope').selectOption('selected');await count(page,'2 条字幕 · 4 处匹配');
 await page.locator('.find-result').last().click();await count(page,'2 条字幕 · 4 处匹配');expect(await page.evaluate(()=>batchSelectedIds())).toContain(await page.evaluate(()=>findTestIds.a1));
 await page.evaluate(()=>clearSelection({silent:true}));await page.locator('#find-edit-use-selection').click();await count(page,'0 条字幕 · 0 处匹配');
});
test('result navigation reveals a folded locked disabled cue without enabling or editing it',async({page})=>{
 await page.evaluate(()=>{const p=JSON.parse(buildJson()),t=p.subtitles.tracks.find(t=>t.id==='third');t.collapsed=true;t.locked=true;t.enabled=false;applyCanonicalProject(p,'folded.mosp');waveformEditor.settings.disabledDisplay='hidden';updateEditorSettings({cueListHideDisabled:true});applyCueListDisplaySettings();});
 await page.evaluate(data=>{player.src=URL.createObjectURL(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'audio/wav'}));player.load();},readFileSync(audioPath).toString('base64'));await expect.poll(()=>page.evaluate(()=>player.readyState)).toBeGreaterThan(1);
 await expect.poll(()=>page.evaluate(()=>player.seekable.length?player.seekable.end(0):0)).toBe(60);
 await search(page,'隐藏');await count(page,'1 条字幕 · 1 处匹配');await expect(page.locator('.find-result')).toContainText('已锁定');await page.locator('.find-result').click();
 await expect(page.locator('.waveform-cue-block[data-cue-id="c0"]')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>player.currentTime)).toBe(51);
 const state=await page.evaluate(()=>({track:JSON.parse(buildJson()).subtitles.tracks.find(t=>t.id==='third'),ids:batchSelectedIds(),time:MSWE.resolve('audio-timeline').currentTimeMs()??player.currentTime*1000,paused:player.paused}));
 expect(state.track.collapsed).toBe(false);expect(state.track.locked).toBe(true);expect(state.track.enabled).toBe(false);expect(state.ids).toContain('c0');expect(state.time).toBe(51000);expect(state.paused).toBe(true);
});
test('case and safe regex matching, next occurrence navigation, and clearing highlights',async({page})=>{
 await search(page,'Alpha');await count(page,'7 条字幕 · 10 处匹配');await page.locator('.find-edit-options summary').click();await page.locator('#find-edit-case').check();await count(page,'4 条字幕 · 4 处匹配');
 await page.locator('#find-edit-regex').check();await page.locator('#find-edit-query').fill('[');await expect(page.locator('#find-edit-message')).toHaveText('正则表达式无效');await expect(page.locator('#find-edit-next')).toBeDisabled();
 await page.locator('#find-edit-case').uncheck();await page.locator('#find-edit-query').fill('alpha');await count(page,'7 条字幕 · 10 处匹配');
 await page.locator('#find-edit-query').press('Enter');await expect(page.locator('.find-result[aria-current="true"]')).toContainText('S1主_1');
 await page.locator('#find-edit-query').press('Enter');await expect(page.locator('.waveform-cue-block.msw-search-current mark.current').first()).toHaveText('alpha');
 await page.locator('#find-edit-clear').click();await count(page,'0 条字幕 · 0 处匹配');await expect(page.locator('.msw-search-hit')).toHaveCount(0);
});
test('editing and reordering cues updates results by ID; a different project resets the scope',async({page})=>{
 await search(page);await count(page,'7 条字幕 · 10 处匹配');
 await page.evaluate(()=>{const i=DATA.segments.findIndex(c=>c.id===findTestIds.a0);DATA.segments[i].text='Beta';waveformEditor.refreshCueLabel(i);});await count(page,'6 条字幕 · 8 处匹配');
 await page.locator('#find-edit-query').fill('Beta');await count(page,'1 条字幕 · 1 处匹配');
 await page.evaluate(()=>{DATA.segments.reverse();fixedInvalidate();renderAll({changedCueIds:new Set([findTestIds.a0])});});await page.locator('.find-result').click();expect(await page.evaluate(()=>batchSelectedIds())).toContain(await page.evaluate(()=>findTestIds.a0));
 await page.evaluate(()=>applyCanonicalProject({segments:[]},'another.mosp'));await expect(page.locator('#find-edit-query')).toHaveValue('');await expect(page.locator('#find-edit-scope')).toHaveValue('all');await count(page,'0 条字幕 · 0 处匹配');
});

test('search navigation does not complete a pending subtitle binding',async({page})=>{
 const bindings=await page.evaluate(()=>{
  const track=getActiveExtensionTrack();pendingExtensionBinding={trackId:track.id,extensionId:track.segments[0].id};
  return JSON.parse(buildJson()).subtitles.bindings;
 });
 await search(page,'Alpha alpha 1');await count(page,'1 条字幕 · 1 处匹配');await page.locator('.find-result').click();
 expect(await page.evaluate(()=>JSON.parse(buildJson()).subtitles.bindings)).toEqual(bindings);
 expect(await page.evaluate(()=>pendingExtensionBinding)).toBeNull();
 expect(await page.evaluate(()=>batchSelectedIds())).toContain(await page.evaluate(()=>findTestIds.a1));
});
test('tool window drags, resizes, fits light narrow layout and respects existing modals',async({page},info)=>{
 await page.setViewportSize({width:640,height:600});await page.evaluate(()=>{updateEditorSettings({theme:'light',themePreset:'alice',colors:{}});applyThemeAndColors();});
 await clickBatchOperation(page,'find-edit-open');await page.locator('#find-edit-query').fill('中文');await count(page,'4 条字幕 · 4 处匹配');
 const panel=page.locator('#find-edit-panel');await expect(panel).toBeInViewport();const box=await panel.boundingBox();
 await page.mouse.move(box.x+90,box.y+25);await page.mouse.down();await page.mouse.move(box.x+120,box.y+45,{steps:8});await page.mouse.up();
 expect((await panel.boundingBox()).x).not.toBe(box.x);
 expect(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath('find-light.png')});
 await panel.evaluate(n=>{n.style.width='350px';n.style.height='340px';});await expect(panel).toBeInViewport();await page.screenshot({path:info.outputPath('find-compact.png')});
 await page.locator('#find-edit-close').click();await page.evaluate(()=>document.getElementById('sticker-modal').classList.add('show'));await page.keyboard.press('Control+f');await expect(panel).not.toBeVisible();await expect(page.locator('#sticker-modal')).toBeVisible();
});
test('6000-cue search virtualizes results and a runaway regex can be cancelled without freezing the page',async({page})=>{
 // Search loads 6000 real cues; high-density waveform decoding is covered separately.
 await page.evaluate(waveform=>{applyCanonicalProject({segments:Array.from({length:6000},(_,i)=>({id:'large'+i,start:i*2000,end:i*2000+1500,text:'Alpha subtitle '+i,items:[]})),waveform},'large.mosp');},generateWaveformPayload(12000000,1));
 const start=Date.now();await search(page);await count(page,'6000 条字幕 · 6000 处匹配');console.log('6000-cue query including panel open (ms):',Date.now()-start);
 expect(await page.locator('.find-result').count()).toBeLessThan(30);
 await page.locator('#find-edit-results').evaluate(n=>{n.scrollTop=n.scrollHeight;});await expect(page.locator('.find-result').last()).toContainText('5999');
 await page.evaluate(()=>{DATA.segments[0].text='a'.repeat(200)+'!';waveformEditor.refreshCueLabel(0);});
 await page.locator('.find-edit-options summary').click();await page.locator('#find-edit-regex').check();await page.locator('#find-edit-query').fill('(a+)+$');
 // Locator assertions build a full accessibility snapshot on a retry, which blocks
 // this 6000-cue fixture itself. Poll the status without traversing the project DOM.
 await expect.poll(()=>page.locator('#find-edit-message').textContent(),{timeout:6000}).toBe('查询耗时过长，请简化正则表达式');
 await page.locator('#find-edit-regex').uncheck();await page.locator('#find-edit-query').fill('subtitle 42');await count(page,'111 条字幕 · 111 处匹配');
});

test('navigation reopens the waveform; rapid queries do not leave stale results or marks',async({page},info)=>{
 await page.evaluate(()=>{waveformEditor.closeDockModule('wave');updateEditorSettings({theme:'dark'});applyThemeAndColors();});
 await search(page,'中文');await count(page,'4 条字幕 · 4 处匹配');await page.locator('.find-result').first().click();
 expect(await page.evaluate(()=>waveformEditor.getHiddenModules())).not.toContain('wave');
 await expect(page.locator('.waveform-cue-block.msw-search-current').first()).toBeVisible();
 await page.screenshot({path:info.outputPath('find-dark.png')});
 await page.locator('#find-edit-query').fill('alpha');await page.locator('#find-edit-query').fill('not in this project');
 await count(page,'0 条字幕 · 0 处匹配');await expect(page.locator('.msw-search-hit')).toHaveCount(0);
 await page.locator('#find-edit-query').fill('Alpha');await count(page,'7 条字幕 · 10 处匹配');
 await page.keyboard.press('Meta+f');await expect(page.locator('#find-edit-query')).toBeFocused();
});
test('restricted environments retain literal search without running regex on the main thread',async({page})=>{
 await page.evaluate(()=>{window.Worker=undefined;});await search(page);await count(page,'7 条字幕 · 10 处匹配');
 await page.locator('.find-edit-options summary').click();await page.locator('#find-edit-regex').check();await expect(page.locator('#find-edit-message')).toContainText('无法安全运行正则');
 await page.locator('#find-edit-regex').uncheck();await count(page,'7 条字幕 · 10 处匹配');
});

async function replacement(page,query,value) {
 await search(page,query);await page.locator('#find-edit-replace').evaluate(n=>{n.open=true;});
 await page.locator('#find-edit-replacement').fill(value);
 await expect(page.locator('#find-edit-replace-all')).toBeEnabled();
}
const snapshot=page=>page.evaluate(()=>JSON.parse(buildJson()));
test('replacement previews all tracks, skips locks, and commits one local undo record',async({page},info)=>{
 await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks.find(t=>t.id==='third').locked=true;applyCanonicalProject(p,'locked.mosp');});
 const before=await snapshot(page),history=await page.evaluate(()=>editorHistory.undoLength());
 await replacement(page,'alpha','Beta');await expect(page.locator('#find-edit-plan')).toHaveText('修改 6 条 · 跳过 1 条锁定字幕');
 expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await expect(page.locator('.find-result-after').first()).toHaveText('替换后：Beta Beta 0');
 await page.locator('#find-edit-panel').screenshot({path:info.outputPath('replacement-preview.png')});
 await page.locator('#find-edit-replace-all').click();await count(page,'1 条字幕 · 1 处匹配');
 const after=await snapshot(page);expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
 expect(after.subtitles.cues.find(c=>c.id==='c0')).toEqual(before.subtitles.cues.find(c=>c.id==='c0'));
 expect(after.subtitles.cues.filter(c=>c.content.text.includes('Beta'))).toHaveLength(6);
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 expect(await page.evaluate(()=>snapshotCurrentForKind('subtitle-text','test',{cues:[{id:findTestIds.a0}]}).cues.length)).toBe(1);
 await page.locator('#find-edit-close').click();await page.keyboard.press('Control+z');expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await page.keyboard.press('Control+Shift+z');expect((await snapshot(page)).subtitles).toEqual(after.subtitles);
});
test('current replacement affects only one occurrence and never rewrites the bound translation',async({page})=>{
 const before=await snapshot(page);await replacement(page,'alpha','');
 await page.locator('.find-result').first().click();await page.locator('#find-edit-replace-current').click();
 await count(page,'7 条字幕 · 9 处匹配');const after=await snapshot(page),id=await page.evaluate(()=>findTestIds.a0);
 expect(after.subtitles.cues.find(c=>c.id===id).content.text).toBe(' alpha 0');
 expect(after.subtitles.cues.filter(c=>c.id!==id)).toEqual(before.subtitles.cues.filter(c=>c.id!==id));
 await page.locator('#find-edit-query').fill(' alpha 0');await expect(page.locator('#find-edit-replace-current')).toBeEnabled();
  await page.locator('#find-edit-replace-current').click();await count(page,'1 条字幕 · 1 处匹配');
 expect((await snapshot(page)).subtitles.cues.find(c=>c.id===id).content.text).toBe('');
 expect((await snapshot(page)).subtitles.cues.length).toBe(before.subtitles.cues.length);
});
test('direct edit preserves multiline drafts, rejects conflicts and applies without changing timing or bindings',async({page},info)=>{
 await search(page,'Alpha alpha 0');await count(page,'1 条字幕 · 1 处匹配');await page.locator('.find-edit-one').click();
 await page.locator('#find-edit-text').fill('New English\n新的字幕');await expect(page.locator('#find-edit-edit-status')).toHaveText('未应用');
 await page.locator('#find-edit-close').click();await page.keyboard.press('Control+f');await expect(page.locator('#find-edit-text')).toHaveValue('New English\n新的字幕');
 await page.evaluate(()=>{const c=DATA.segments.find(c=>c.id===findTestIds.a0);c.text='外部修改';MSWFindEdit.changed();});
 await expect(page.locator('#find-edit-edit-status')).toHaveText('原文已改变，草稿已保留');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.locator('#find-edit-text').press('Escape');await expect(page.locator('#find-edit-editor')).toBeHidden();await expect(page.locator('#find-edit-panel')).toBeVisible();
 await page.locator('#find-edit-query').fill('外部修改');await count(page,'1 条字幕 · 1 处匹配');await page.locator('.find-edit-one').click();
 const before=await snapshot(page);await page.locator('#find-edit-text').fill('New English\n新的字幕');
 await page.locator('#find-edit-panel').screenshot({path:info.outputPath('single-edit.png')});
 await page.locator('#find-edit-text').press('Control+Enter');await expect(page.locator('#find-edit-editor')).toBeHidden();
 const after=await snapshot(page),id=await page.evaluate(()=>findTestIds.a0),c=after.subtitles.cues.find(c=>c.id===id);
 expect(c.content.text).toBe('New English\n新的字幕');expect([c.content.start,c.content.end]).toEqual([1000,2800]);
 expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);expect(after.subtitles.cues.filter(c=>c.id!==id)).toEqual(before.subtitles.cues.filter(c=>c.id!==id));
 await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),after);expect((await snapshot(page)).subtitles).toEqual(after.subtitles);
});
test('regex captures replace safely, fixed selection excludes partners, and unchanged replacements stay disabled',async({page})=>{
 await page.evaluate(()=>{clearSelection({silent:true});selectedIdxs.add(DATA.segments.findIndex(c=>c.id===findTestIds.a0));});
 await search(page,'Alpha alpha (\\d)');await page.locator('#find-edit-scope').selectOption('selected');await page.locator('.find-edit-options summary').click();await page.locator('#find-edit-regex').check();
 await page.locator('#find-edit-replace').evaluate(n=>{n.open=true;});await page.locator('#find-edit-replacement').fill('$&');await count(page,'1 条字幕 · 1 处匹配');await expect(page.locator('#find-edit-replace-all')).toBeDisabled();
 await page.locator('#find-edit-replacement').fill('编号 $1\nline');await expect(page.locator('#find-edit-replace-all')).toBeEnabled();
 await page.locator('#find-edit-replace-all').click();await count(page,'0 条字幕 · 0 处匹配');
 expect((await snapshot(page)).subtitles.cues.filter(c=>c.content.text==='编号 0\nline')).toHaveLength(1);
});

test('a stale replacement refuses the entire transaction and refreshes its preview',async({page})=>{
 await replacement(page,'alpha','Beta');const history=await page.evaluate(()=>editorHistory.undoLength());
 await page.evaluate(()=>{DATA.segments.find(c=>c.id===findTestIds.a0).text='Modified elsewhere';});
 const before=await snapshot(page);await page.locator('#find-edit-replace-all').click();
 await expect(page.locator('#find-edit-message')).toHaveText('目标字幕已改变，请重新检查后再应用');
 expect((await snapshot(page)).subtitles).toEqual(before.subtitles);expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history);
 await expect(page.locator('#find-edit-plan')).toHaveText('修改 6 条 · 跳过 0 条锁定字幕');
});

test('drafts survive scope changes and unrelated edits, and light narrow actions stay accessible',async({page},info)=>{
 await page.setViewportSize({width:540,height:650});await page.evaluate(()=>{updateEditorSettings({theme:'light',themePreset:'alice',colors:{}});applyThemeAndColors();});
 await replacement(page,'Alpha alpha 0','Replacement');await page.locator('.find-edit-one').first().click();await page.locator('#find-edit-text').fill('独立修改\nSecond line');
 await page.locator('#find-edit-query').fill('隐藏');await count(page,'1 条字幕 · 1 处匹配');
 await page.evaluate(()=>{DATA.segments.find(c=>c.id==='c0').text+=' unrelated';MSWFindEdit.changed();});
 await expect(page.locator('#find-edit-apply')).toBeEnabled();await expect(page.locator('#find-edit-text')).toHaveValue('独立修改\nSecond line');
 const panel=page.locator('#find-edit-panel');await panel.evaluate(n=>{n.style.width='350px';n.style.height='560px';});
 await expect(page.locator('#find-edit-apply')).toBeInViewport();expect(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
 expect(await page.locator('#find-edit-apply').evaluate(n=>getComputedStyle(n).borderRadius)).not.toBe('0px');
 await expect(page.locator('.find-result')).toHaveCount(1);await expect(page.locator('.find-result')).toBeInViewport();
 expect(await panel.evaluate(n=>document.getElementById('find-edit-apply').getBoundingClientRect().bottom<=n.getBoundingClientRect().bottom)).toBe(true);
 await panel.screenshot({path:info.outputPath('find-edit-light-narrow.png')});
 await page.locator('#find-edit-text').press('Control+Enter');expect((await snapshot(page)).subtitles.cues.some(c=>c.content.text==='独立修改\nSecond line')).toBe(true);
 expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(false);
});

test('body edits reuse cards, refresh counts and filters, preserve literal UI words and undo',async({page})=>{
 await page.evaluate(()=>{window.keptCard=document.querySelector('.multi-cue-column.main');window.originalCount=keptCard.querySelector('.charcount').textContent;});
 await replacement(page,'Alpha alpha 0','主字幕\n取消');await page.locator('#find-edit-replace-all').click();await count(page,'0 条字幕 · 0 处匹配');
 expect(await page.evaluate(()=>keptCard.isConnected)).toBe(true);
 await page.evaluate(()=>MSWE_I18N.applyLanguage('en',false));
 await expect(page.locator('.multi-cue-column.main .text').first()).toHaveText('主字幕取消');
 expect(await page.evaluate(()=>keptCard.querySelector('.charcount').textContent)).not.toBe(await page.evaluate(()=>originalCount));
 expect(await page.evaluate(()=>keptCard.classList.contains('dirty'))).toBe(true);
 await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>keptCard.isConnected)).toBe(true);
 await expect(page.locator('.multi-cue-column.main .text').first()).toHaveText('Alpha alpha 0');
 await page.evaluate(()=>{MSWE_I18N.applyLanguage('zh',false);searchEl.value='Alpha alpha 0';applySearch(searchEl.value);});
 await replacement(page,'Alpha alpha 0','');await page.locator('#find-edit-replace-all').click();await count(page,'0 条字幕 · 0 处匹配');
 expect(await page.evaluate(()=>keptCard.closest('.cue').classList.contains('hidden'))).toBe(true);
 await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>keptCard.closest('.cue').classList.contains('hidden'))).toBe(false);
});

test('Escape closes a waveform context menu before the find panel',async({page})=>{
 await search(page);await count(page,'7 条字幕 · 10 处匹配');
 await page.evaluate(()=>showContextMenu(800,300,0));await page.locator('#ctxmenu').hover();
 await page.keyboard.press('Escape');await expect(page.locator('#ctxmenu')).not.toBeVisible();await expect(page.locator('#find-edit-panel')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#find-edit-panel')).not.toBeVisible();
});
