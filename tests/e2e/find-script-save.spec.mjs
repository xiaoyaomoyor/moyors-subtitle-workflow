import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
import {editScriptText} from './find-unified-fixture.mjs';

test('script edits and export records persist through local server save and reload without changing bindings',async({page})=>{
 const dir=makeTempDir('find-script-save'),path=join(dir,'script.mosp'),media=join(dir,'speech.wav');
 const env={MAW_ENV_FILE:process.env.MAW_ENV_FILE,MSW_APP_DATA_ROOT:process.env.MSW_APP_DATA_ROOT};
 process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'settings');
 generateWav(media,3);
 writeFileSync(path,JSON.stringify({media,segments:[{id:'main',start:0,end:1000,text:'译文',items:[]}],multi_subtitle:{enabled:true,tracks:[{id:'original',segments:[{id:'sub',start:0,end:1000,text:'Original',items:[]}]}],bindings:[{id:'pair',track_id:'original',main_segment_ids:['main'],extension_segment_ids:['sub']}]},waveform:generateWaveformPayload(3000)}));
 let server;const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  server=await startServer(path,media,await findFreePort());await disableOnboarding(page);await page.goto(server.url);await expect(page.locator('#editor-loading')).toBeHidden();
  await page.evaluate(()=>updateEditorSettings({autoSaveProject:false}));
  const before=await page.evaluate(()=>JSON.parse(buildJson()));
  await page.keyboard.press('Control+f');await expect(page.locator('#find-edit-count')).toContainText('2 条');await page.locator('#find-edit-group').selectOption('script');
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});const downloading=page.waitForEvent('download');await page.locator('#script-exchange-export').click();const download=await downloading;
  const exported=readFileSync(await download.path(),'utf8'),records=await page.evaluate(()=>MSWFindEdit.exportRecords());expect(records).toHaveLength(1);
  const input=page.locator('#find-edit-rows textarea');await editScriptText(page,input,'译文','修改译文\n第二行');await editScriptText(page,input,'Original','Revised original');
  await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();await expect(page.locator('#find-edit-message')).toContainText('已修改 2 条');
  const after=await page.evaluate(()=>JSON.parse(buildJson()));expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
  expect(after.subtitles.cues.map(c=>c.content.text).sort()).toEqual(['Revised original','修改译文\n第二行'].sort());
  await expect.poll(()=>page.evaluate(()=>!projectSaveInFlight&&!projectCheckpointInFlight)).toBe(true);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);expect(JSON.parse(readFileSync(path,'utf8')).subtitles).toEqual(after.subtitles);
  await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();expect((await page.evaluate(()=>JSON.parse(buildJson()))).subtitles).toEqual(after.subtitles);
  expect(await page.evaluate(()=>MSWFindEdit.exportRecords())).toEqual(records);
  await page.keyboard.press('Control+f');await page.locator('#find-edit-group').selectOption('script');await expect(input).toHaveValue(/修改译文\n第二行/);expect(errors).toEqual([]);
  await page.locator('#script-exchange-open').click();await page.locator('#script-exchange-text').fill(exported.replace('Original','External original'));await page.locator('#script-exchange-analyze').click();
  await expect(page.locator('#script-exchange-counts')).toContainText('正文冲突 1');await expect(page.locator('#script-exchange-counts')).toContainText('保留当前修改 1');
 }finally{await page.close({runBeforeUnload:false});await server?.stop();for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
