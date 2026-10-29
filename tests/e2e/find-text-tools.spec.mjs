import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server;const errors=new WeakMap();const snapshot=page=>page.evaluate(()=>JSON.parse(buildJson()));
const contents=(p,track)=>p.subtitles.cues.filter(c=>c.track_id===track).sort((a,b)=>a.content.start-b.content.start);
test.beforeAll(async()=>{const dir=makeTempDir('find-text-tools');process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
 errors.set(page,[]);page.on('pageerror',error=>errors.get(page).push(error.message));
 await disableOnboarding(page);await page.goto(server.url);
 await page.evaluate(waveform=>{
  const rows=[1000,4000].map((start,i)=>({id:'a'+i,start,end:start+1000,text:'Alpha Bravo',items:[{text:'Alpha',start,end:start+500},{text:' Bravo',start:start+500,end:start+1000}]}));
  applyCanonicalProject({segments:rows,waveform,multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:rows.map((c,i)=>({...c,id:'b'+i,text:' 中文 ',items:[]}))}],bindings:rows.map((c,i)=>({id:'bind'+i,track_id:'zh',main_segment_ids:[c.id],extension_segment_ids:['b'+i]}))}},'tools.mosp');
  const p=JSON.parse(buildJson());p.subtitles.tracks.push({...p.subtitles.tracks[0],id:'third',name:'S2',display_number:2});
  p.subtitles.cues.push(...rows.map(({id,...content},i)=>({id:'third-'+i,track_id:'third',content:{...content,disabled:i===1}})));
  p.subtitles.next_track_number=3;window.toolTracks=p.subtitles.tracks.map(t=>t.id);applyCanonicalProject(p,'tools.mosp');clearSelection({silent:true});
 },generateWaveformPayload(10000));
});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
const open=async(page,mode)=>{await page.keyboard.press('Control+f');await page.locator(`[data-find-view="${mode}"]`).click();};
async function track(page,id){await page.locator('#find-edit-scope').selectOption('tracks');for(const input of await page.locator('#find-edit-tracks input').all())await input.setChecked(await input.inputValue()===id);}

test('tidy previews changes, includes disabled tracks, skips locks and commits once',async({page},info)=>{
 await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks.find(t=>t.id==='third').locked=true;applyCanonicalProject(p,'locked.mosp');});
 const before=await snapshot(page),history=await page.evaluate(()=>editorHistory.undoLength());await open(page,'tidy');
 await page.locator('#find-tidy-trim').check();await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('Note: ');
 await expect(page.locator('#find-tools-status')).toHaveText('修改 4 条 · 跳过 2 条锁定字幕');
 expect((await snapshot(page)).subtitles).toEqual(before.subtitles);await page.locator('#find-edit-panel').screenshot({path:info.outputPath('tidy-dark.png')});
 await page.locator('#find-tools-apply').click();const after=await snapshot(page);expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
 expect(contents(after,'third')).toEqual(contents(before,'third'));expect(after.subtitles.cues.filter(c=>c.content.text.startsWith('Note: '))).toHaveLength(4);
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);await page.evaluate(()=>performUndo());expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await page.evaluate(()=>performRedo());expect((await snapshot(page)).subtitles).toEqual(after.subtitles);
});
test('tidy only matched is opt-in, an empty scope never widens, and all operations share preview semantics',async({page})=>{
 await page.evaluate(()=>{for(const c of DATA.segments)if(c.id==='third-0'){c.text='  **alpha**\n\nBravo  ';c.items=[];}MSWFindEdit.changed();});
 await open(page,'search');await page.locator('#find-edit-query').fill('alpha');await expect(page.locator('#find-edit-count')).toHaveText('4 条字幕 · 4 处匹配');
 await page.locator('[data-find-view="tidy"]').click();await expect(page.locator('#find-tidy-matched')).not.toBeChecked();await page.locator('#find-tidy-matched').check();
 await track(page,'third');await page.locator('#find-tidy-markdown').check();await page.locator('#find-tidy-trim').check();await page.locator('#find-tidy-capitalize').check();await page.locator('#find-tidy-suffix').check();await page.locator('#find-tidy-suffix-text').fill('!');
 await expect(page.locator('#find-tools-status')).toHaveText('修改 2 条 · 跳过 0 条锁定字幕');await page.locator('#find-tools-apply').click();
 expect(contents(await snapshot(page),'third').map(c=>c.content.text)).toEqual(['Alpha\n\nBravo!','Alpha Bravo!']);
 await page.locator('#find-edit-tracks input').last().uncheck();await expect(page.locator('#find-tools-status')).toHaveText('修改 0 条 · 跳过 0 条锁定字幕');await expect(page.locator('#find-tools-apply')).toBeDisabled();
});
test('continuous multi-track edits preserve multiline cues, partner text and local undo',async({page},info)=>{
 const before=await snapshot(page),history=await page.evaluate(()=>editorHistory.undoLength());await open(page,'edit');await expect(page.locator('#find-continuous-whole')).toBeDisabled();
 const inputs=page.locator('#find-tools-rows textarea');await expect(inputs).toHaveCount(6);await inputs.nth(0).fill('New\nline');await inputs.nth(2).fill('Third track');
 await page.locator('#find-edit-panel').screenshot({path:info.outputPath('continuous-dark.png')});await expect(page.locator('#find-tools-status')).toHaveText('修改 2 条 · 跳过 0 条锁定字幕');
 await page.locator('#find-tools-apply').click();const after=await snapshot(page);expect(after.subtitles.cues).toHaveLength(6);expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
 expect(after.subtitles.cues.filter(c=>c.content.text===' 中文 ')).toEqual(before.subtitles.cues.filter(c=>c.content.text===' 中文 '));
 expect(after.subtitles.cues.some(c=>c.content.text==='New\nline')).toBe(true);expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 await page.evaluate(()=>performUndo());expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
});
test('continuous drafts survive view, scope and close; conflicts retain drafts without partial writes',async({page})=>{
 await open(page,'edit');await track(page,'third');await page.locator('#find-tools-rows textarea').first().fill('Pending');
 await page.locator('[data-find-view="tidy"]').click();await page.locator('#find-edit-close').click();await page.keyboard.press('Control+f');await page.locator('[data-find-view="edit"]').click();
 await expect(page.locator('#find-tools-rows textarea').first()).toHaveValue('Pending');
 await page.locator('#find-edit-scope').selectOption('all');await expect(page.locator('#find-edit-drafts')).toHaveText('1 条未应用修改');
 await page.evaluate(()=>{DATA.segments.find(c=>c.id==='third-0').text='Concurrent';MSWFindEdit.changed();});
 await expect(page.locator('#find-tools-status')).toHaveText('目标字幕已改变，草稿已保留');await expect(page.locator('#find-tools-apply')).toBeDisabled();
 await page.locator('#find-tools-discard').click();expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(false);
});
test('whole edit splits only independent cues, preserves metadata, saves and restores one transaction',async({page})=>{
 await page.evaluate(()=>{const p=JSON.parse(buildJson()),a=p.subtitles.cues.find(c=>c.id==='third-0'),b=p.subtitles.cues.find(c=>c.id==='third-1');a.content.speaker='2';a.content.color={name:'red',value:'#ff0000',start:1000,end:5000};b.content.color_ref={cue_id:a.id};applyCanonicalProject(p,'markers.mosp');});
 const before=await snapshot(page);await open(page,'edit');await page.evaluate(()=>MSWFindEdit.open({view:'edit',ids:['third-0']}));await page.locator('#find-continuous-whole').click();
 await page.locator('#find-whole-text').fill('Alpha\nBravo');await expect(page.locator('#find-tools-status')).toContainText('新增 1 条');await expect(page.locator('#find-tools-apply')).toBeEnabled();await page.locator('#find-tools-apply').click();
 const after=await snapshot(page);expect(contents(after,'third')).toHaveLength(3);expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
 expect(contents(after,'third').slice(0,2).every(c=>c.content.speaker==='2')).toBe(true);expect(contents(after,'third')[0].content.color.name).toBe('red');expect(contents(after,'third')[1].content.color_ref).toEqual({cue_id:'third-0'});expect(contents(after,'third')[2].content.color_ref).toEqual({cue_id:'third-0'});
 await page.evaluate(()=>performUndo());expect((await snapshot(page)).subtitles).toEqual(before.subtitles);await page.evaluate(()=>performRedo());expect((await snapshot(page)).subtitles).toEqual(after.subtitles);
 await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),after);expect((await snapshot(page)).subtitles).toEqual(after.subtitles);
});
test('whole edit blocks bound structure, locks and existing multiline text',async({page})=>{
 await open(page,'edit');await track(page,(await page.evaluate(()=>toolTracks))[0]);await page.locator('#find-continuous-whole').click();
 const before=await snapshot(page);await page.locator('#find-whole-text').fill('Alpha\nBravo\nAlpha Bravo');await expect(page.locator('#find-tools-status')).toContainText('已绑定字幕');await expect(page.locator('#find-tools-apply')).toBeDisabled();
 expect((await snapshot(page)).subtitles).toEqual(before.subtitles);await page.locator('#find-tools-discard').click();
 await page.locator('#find-whole-text').fill('alpha Bravo\nAlpha Bravo');await expect(page.locator('#find-tools-apply')).toBeEnabled();await page.locator('#find-tools-apply').click();
 expect((await snapshot(page)).subtitles.bindings).toEqual(before.subtitles.bindings);
 await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks[0].locked=true;applyCanonicalProject(p,'locked.mosp');});
 await open(page,'edit');await track(page,(await page.evaluate(()=>toolTracks))[0]);await page.locator('#find-continuous-whole').click();await expect(page.locator('#find-whole-text')).toHaveAttribute('readonly','');
 await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks[0].locked=false;p.subtitles.cues[0].content.text='A\nB';p.subtitles.cues[0].content.items=[];applyCanonicalProject(p,'multiline.mosp');});
 await open(page,'edit');await track(page,(await page.evaluate(()=>toolTracks))[0]);await page.locator('#find-continuous-whole').click();await expect(page.locator('#find-tools-status')).toHaveText('当前字幕含有换行，请使用逐条编辑。');
});
test('whole draft survives scope changes, accepts unrelated edits but rejects source changes',async({page})=>{
 await open(page,'edit');await page.evaluate(()=>MSWFindEdit.open({view:'edit',ids:['third-0']}));await page.locator('#find-continuous-whole').click();await page.locator('#find-whole-text').fill('Alpha\nBravo');
 await page.locator('#find-edit-scope').selectOption('all');await page.locator('#find-edit-drafts').click();await expect(page.locator('#find-whole-text')).toHaveValue('Alpha\nBravo');
 await page.evaluate(()=>{DATA.segments.find(c=>c.id==='third-1').text='Unrelated';MSWFindEdit.changed();});await expect(page.locator('#find-tools-apply')).toBeEnabled();
 await page.locator('#find-tools-apply').click();expect(contents(await snapshot(page),'third').map(c=>c.content.text)).toEqual(['Alpha','Bravo','Unrelated']);
 await page.locator('#find-whole-text').fill('Alpha changed');await page.evaluate(()=>{DATA.segments.find(c=>c.id==='third-0').color={name:'red',start:1000,end:1500};MSWFindEdit.changed();});
 await expect(page.locator('#find-tools-status')).toContainText('目标字幕已改变');await expect(page.locator('#find-tools-apply')).toBeDisabled();
});
test('new panel removes legacy modals and uses compact light controls',async({page},info)=>{
 await page.setViewportSize({width:640,height:740});await page.evaluate(()=>{updateEditorSettings({theme:'light',themePreset:'alice',colors:{}});applyThemeAndColors();});await open(page,'tidy');
 await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('Note: ');
 await expect(page.locator('#find-tools-status')).toContainText('修改 6 条');
 await page.locator('#find-edit-panel').evaluate(n=>{n.style.width='360px';n.style.height='620px';});
 await expect(page.locator('#find-tools-apply')).toBeInViewport();expect(await page.locator('#find-edit-panel').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
 expect(await page.locator('#find-tidy-options').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
 await expect(page.locator('#replace-modal,#text-process-modal,#timed-text-edit-modal,#replace-btn,#text-process-btn,#timed-text-edit-btn')).toHaveCount(0);
 await page.locator('#find-edit-panel').screenshot({path:info.outputPath('tidy-light-narrow.png')});
 await page.locator('[data-find-view="edit"]').click();await page.locator('#find-continuous-threshold').fill('20');await expect(page.locator('#find-tools-rows textarea')).toHaveCount(0);
});

test('whole drafts can still be recovered and discarded when all source cues are removed',async({page})=>{
 await page.evaluate(()=>MSWFindEdit.open({view:'edit',ids:['third-0']}));await page.locator('#find-continuous-whole').click();await page.locator('#find-whole-text').fill('Alpha\nBravo');
 await page.evaluate(()=>{DATA.segments=DATA.segments.filter(c=>c.id!=='third-0');renderAll();MSWFindEdit.changed();});
 await page.locator('#find-edit-scope').selectOption('all');await page.locator('#find-edit-drafts').click();
 await expect(page.locator('#find-whole-text')).toHaveValue('Alpha\nBravo');await expect(page.locator('#find-tools-status')).toContainText('目标字幕已改变');await expect(page.locator('#find-tools-apply')).toBeDisabled();
 await page.locator('#find-tools-discard').click();expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(false);
});

test('pending drafts cycles through per-cue and whole-text edits',async({page})=>{
 await page.evaluate(()=>MSWFindEdit.open({view:'edit',ids:['third-0']}));await page.locator('#find-continuous-whole').click();await page.locator('#find-whole-text').fill('Alpha\nBravo');
 await page.locator('#find-continuous-rows').click();await page.locator('#find-tools-rows textarea').fill('Different draft');
 await expect(page.locator('#find-edit-drafts')).toHaveText('2 条未应用修改');await page.locator('#find-edit-drafts').click();await expect(page.locator('#find-edit-text')).toHaveValue('Different draft');
 await page.locator('#find-edit-drafts').click();await expect(page.locator('#find-whole-text')).toHaveValue('Alpha\nBravo');
});

test('undo and later track locking replace the previous success notice with the current plan',async({page})=>{
 await page.evaluate(()=>MSWFindEdit.open({view:'tidy',ids:['third-0']}));await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('Note: ');
 await expect(page.locator('#find-tools-apply')).toBeEnabled();await page.locator('#find-tools-apply').click();await expect(page.locator('#find-tools-status')).toContainText('已修改 1 条');
 await page.evaluate(()=>performUndo());await expect(page.locator('#find-tools-status')).toHaveText('修改 1 条 · 跳过 0 条锁定字幕');
 await page.evaluate(()=>fixedUpdateTrack('third',{locked:true}));await expect(page.locator('#find-tools-status')).toHaveText('修改 0 条 · 跳过 1 条锁定字幕');await expect(page.locator('#find-tools-apply')).toBeDisabled();
});
