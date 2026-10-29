import {test,expect} from '@playwright/test';
import {writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
test('replacement, single edit, cleanup and continuous editing survive save/reopen and exact ASS preview',async({page},info)=>{
 test.setTimeout(90000);
 test.skip(!process.env.MSW_TEST_FFMPEG,'Synthetic preview video requires FFmpeg');
 const dir=makeTempDir('find-edit-save'),video=join(dir,'video.mp4'),path=join(dir,'project.mosp');
 process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');
 process.env.FFMPEG_PATH=process.env.MSW_TEST_FFMPEG;
 execFileSync(join(process.env.MSW_TEST_FFMPEG,process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=3','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
 writeFileSync(path,JSON.stringify({media:video,segments:[{id:'a',start:100,end:2500,text:'Alpha Bravo',items:[{text:'Alpha',start:100,end:1000},{text:' Bravo',start:1000,end:2500}],speaker:'0',color:{name:'red',value:'#ee1111',start:100,end:2500}}],multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[{id:'b',start:100,end:2500,text:'保留译文',items:[]}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]},waveform:generateWaveformPayload(3000)}));
 const server=await startServer(path,video,await findFreePort()),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try {
  await disableOnboarding(page);await page.goto(server.url);await expect(page.locator('#editor-loading')).toBeHidden();
  await page.evaluate(()=>updateEditorSettings({autoSaveProject:false}));
  const before=await page.evaluate(()=>JSON.parse(buildJson()));
  await page.keyboard.press('Control+f');await page.locator('#find-edit-query').fill('Alpha');await page.locator('#find-edit-replace').evaluate(n=>n.open=true);
  await page.locator('#find-edit-replacement').fill('Hello');await expect(page.locator('#find-edit-replace-all')).toBeEnabled();await page.locator('#find-edit-replace-all').click();
  await expect(page.locator('#find-edit-count')).toHaveText('0 条字幕 · 0 处匹配');
  const replaced=await page.evaluate(()=>JSON.parse(buildJson()));
  const a=replaced.subtitles.cues.find(c=>c.content.text==='Hello Bravo'),old=before.subtitles.cues.find(c=>c.id===a.id);
  expect(a.content.items.at(-1)).toEqual(old.content.items.at(-1));expect(a.content.color).toEqual(old.content.color);expect(a.content.speaker).toBe(old.content.speaker);
  await page.locator('#find-edit-query').fill('Hello');await expect(page.locator('.find-edit-one')).toHaveCount(1);await page.locator('.find-edit-one').click();
  await page.locator('#find-edit-text').fill('Hello\nNew line');await page.locator('#find-edit-text').press('Control+Enter');
  await expect(page.locator('#find-edit-editor')).toBeHidden();
  const single=await page.evaluate(()=>JSON.parse(buildJson()));expect(single.subtitles.bindings).toEqual(before.subtitles.bindings);
  await page.evaluate(()=>performUndo());expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(replaced.subtitles);
  await page.evaluate(()=>performRedo());expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(single.subtitles);
  await page.locator('[data-find-view="tidy"]').click();await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('Note: ');
  await expect(page.locator('#find-tools-status')).toContainText('修改 2 条');await page.locator('#find-tools-apply').click();
  await page.locator('[data-find-view="edit"]').click();await page.locator('#find-tools-rows textarea').first().fill('Hello\nNew line edited');await page.locator('#find-tools-apply').click();
  const after=await page.evaluate(()=>JSON.parse(buildJson()));expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
  expect(after.subtitles.cues.find(c=>c.id===a.id).content.color).toEqual(old.content.color);
  await expect.poll(()=>page.evaluate(()=>!projectSaveInFlight&&!projectCheckpointInFlight)).toBe(true);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
  expect(JSON.parse(readFileSync(path,'utf8')).subtitles).toEqual(after.subtitles);
  await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();
  expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(after.subtitles);
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleStyle.ready)).toBe(true);
  const preview=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),target:'both',video:{width:640,height:360}}));
  expect(preview.ass).toContain('Hello');expect(preview.ass).toContain('New line edited');expect(preview.ass).toContain('Note: 保留译文');expect(preview.ass).not.toContain('Alpha');
  await page.evaluate(()=>{overlayToggle.checked=true;extensionOverlayToggle.checked=true;player.currentTime=1;MSWSubtitleRenderer.invalidate();});
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending),{timeout:30000}).toBe(true);
  await page.screenshot({path:info.outputPath('find-edit-saved-preview.png')});expect(errors).toEqual([]);
 } finally {await page.close({runBeforeUnload:false});await server.stop();}
});

test('whole-text structure and marker references survive disk save and ASS compilation',async({page})=>{
 const dir=makeTempDir('find-whole-save'),media=join(dir,'video.wav'),path=join(dir,'project.mosp');
 process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');generateWav(media,3);
 writeFileSync(path,JSON.stringify({media,segments:[{id:'source',start:100,end:2000,text:'Alpha Bravo',speaker:'2',color:{name:'red',start:100,end:2000},items:[{text:'Alpha',start:100,end:1000},{text:' Bravo',start:1000,end:2000}]}],waveform:generateWaveformPayload(3000)}));
 const server=await startServer(path,media,await findFreePort()),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try {
  await disableOnboarding(page);await page.goto(server.url);await expect(page.locator('#editor-loading')).toBeHidden();
  await page.evaluate(()=>{updateEditorSettings({autoSaveProject:false});MSWFindEdit.open({view:'edit'});});
  await page.locator('#find-continuous-whole').click();await page.locator('#find-whole-text').fill('Alpha\nBravo');await expect(page.locator('#find-tools-apply')).toBeEnabled();await page.locator('#find-tools-apply').click();
  const after=await page.evaluate(()=>JSON.parse(buildJson()));expect(after.subtitles.cues).toHaveLength(2);expect(after.subtitles.cues[1].content.color_ref).toEqual({cue_id:after.subtitles.cues[0].id});
  // Import/migration can already be saving its checkpoint. Await that request
  // before explicitly saving the edited result; do not assert a duplicate call.
  await expect.poll(()=>page.evaluate(()=>!projectSaveInFlight&&!projectCheckpointInFlight)).toBe(true);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);expect(JSON.parse(readFileSync(path,'utf8')).subtitles).toEqual(after.subtitles);
  await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(after.subtitles);
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleStyle.ready)).toBe(true);
  const preview=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),target:'both',video:{width:640,height:360}}));
  expect(preview.ass).toContain('Alpha');expect(preview.ass).toContain('Bravo');expect(errors).toEqual([]);
 } finally {await page.close({runBeforeUnload:false});await server.stop();}
});
