import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,makeTempDir,startBlankServer} from './helpers.mjs';

test('find view preference survives project switches and a fresh browser context without changing the project',async({page,browser})=>{
  const dir=makeTempDir('find-view');process.env.MSW_APP_DATA_ROOT=join(dir,'settings');
  process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  const server=await startBlankServer(await findFreePort(),join(dir,'app-data'));
  let context;
  try{
    await disableOnboarding(page);await page.goto(server.url);await page.keyboard.press('Control+f');
    const before=await page.evaluate(()=>({project:buildJson(),history:editorHistory.undoLength()}));
    for(const mode of ['track','speaker','script','rows']){
      await page.locator('#find-edit-group').selectOption(mode);await page.evaluate(()=>MSWConfig.flush());
      expect(await page.evaluate(()=>({project:buildJson(),history:editorHistory.undoLength()}))).toEqual(before);
    }
    await page.locator('#find-edit-group').selectOption('script');await page.evaluate(()=>MSWConfig.flush());
    await page.evaluate(()=>applyCanonicalProject({segments:[{start:0,end:1000,text:'中文'}]},'next.mosp'));
    await expect(page.locator('#find-edit-group')).toHaveValue('script');
    context=await browser.newContext();const fresh=await context.newPage();await disableOnboarding(fresh);await fresh.goto(server.url);
    await fresh.keyboard.press('Control+f');await expect(fresh.locator('#find-edit-group')).toHaveValue('script');
    await fresh.evaluate(()=>{MSWConfig.storage.setItem('msw.find-edit.view.v1','unknown');});
    await fresh.evaluate(()=>MSWConfig.flush());await fresh.reload();await fresh.keyboard.press('Control+f');
    await expect(fresh.locator('#find-edit-group')).toHaveValue('rows');
  }finally{await context?.close();await server.stop();}
});
