import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

test('filename indicator follows drafts, failed saves and edits made during a real save',async({page},info)=>{
 const dir=makeTempDir('save-indicator'),file=join(dir,'fixture.mosp'),media=join(dir,'synthetic.wav');
 process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'settings');
 generateWav(media,3);writeFileSync(file,JSON.stringify({segments:[{id:'one',start:0,end:2000,text:'Original'}],waveform:generateWaveformPayload(3000)}));
 const server=await startServer(file,media,await findFreePort()),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let release;
 try{
  await disableOnboarding(page);await page.goto(server.url);await expect(page.locator('#editor-loading')).toBeHidden();
  await page.evaluate(()=>updateEditorSettings({autoSaveProject:false}));
  // Loading a legacy fixture may normalize project defaults. Establish an
  // acknowledged disk baseline before asserting the clean display.
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const indicator=page.locator('#project-save-indicator');await expect(indicator).toBeHidden();
  await page.keyboard.press('Control+f');const input=page.locator('#find-edit-rows textarea').first();
  await input.fill('Draft');await expect(indicator).toHaveAttribute('data-state','dirty');
  await page.locator('#find-edit-apply').click();await expect(page.locator('#find-edit-message')).toContainText('已修改');
  await page.route('**/api/msw/project',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'Synthetic write failure'})}));
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(false);
  await expect(indicator).toHaveAttribute('data-state','failed');await expect(indicator).toHaveAttribute('title','保存失败，请重试');
  await page.unroute('**/api/msw/project');
  const gate=new Promise(resolve=>{release=resolve;});let held=false;
  await page.route('**/api/msw/project',async route=>{held=true;await gate;await route.continue();});
  await page.evaluate(()=>{window.indicatorSave=saveCurrentProject({silent:true});});
  await expect.poll(()=>held).toBe(true);await expect(indicator).toHaveAttribute('data-state','saving');
  await input.fill('Changed while saving');await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();
  release();expect(await page.evaluate(()=>window.indicatorSave)).toBe(true);
  await expect(indicator).toHaveAttribute('data-state','dirty');await page.unroute('**/api/msw/project');
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);await expect(indicator).toBeHidden();
  await expect(page.locator('#json-name')).toHaveText('fixture.mosp');
  await input.fill('Unapplied draft');await expect(indicator).toHaveAttribute('data-state','dirty');
  await page.screenshot({path:info.outputPath('unsaved-indicator.png')});
  await page.evaluate(()=>applyCanonicalProject({segments:[]},'other.mosp'));
  const state=await page.evaluate(()=>hasUnsavedProjectChanges()?'dirty':'saved');
  await expect(indicator).toHaveAttribute('data-state',state);expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(false);
  expect(errors).toEqual([]);
 }finally{release?.();await page.close({runBeforeUnload:false});await server.stop();}
});
