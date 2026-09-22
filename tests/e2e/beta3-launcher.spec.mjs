import {test,expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

test('Markdown and punctuation changes refresh both previews and discard late responses',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(()=>window.MSWLauncher?.config?.postprocessProviders?.length);
  await page.evaluate(()=>window.MSWNavigation.show('prefab'));
  await page.evaluate(()=>{
    const original=MSWLauncher.callBackend;
    window.__previews=[];
    MSWLauncher.callBackend=async(method,payload)=>{
      if(['read_script_preview','preview_script_match'].includes(method)){
        window.__previews.push({method,...payload});
        const value=payload.cleanMarkdownSymbols?'clean':'raw';
        await new Promise(resolve=>setTimeout(resolve,payload.path?.includes('slow')?350:10));
        return {ok:true,preview:(payload.path||payload.scriptPath)+' '+value,matchRate:100,originalSegmentCount:1,matchedSegmentCount:1};
      }
      return original(method,payload);
    };
  });
  // S4：文稿匹配配置在预制页独立卡内。
  await page.locator('#prefabRail input[data-module-id="match"]').check();
  await page.locator('[data-module-card="match"]').waitFor();
  await page.evaluate(() => MSWWorkflow.setCollapsed('match', false));
  await page.evaluate(() => {
    const json = document.getElementById('jsonPath');
    json.value = 'D:\\Demo\\clip.mosp';
    json.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#postprocessScriptPath').fill('D:\\Demo\\slow.md');
  await page.locator('#postprocessScriptPath').fill('D:\\Demo\\new.md');
  await expect(page.locator('#postprocessScriptPreviewText')).toContainText('new.md clean');
  await expect(page.locator('#postprocessSplitPreviewText')).toContainText('new.md clean');
  await page.locator('#postprocessCleanMarkdownSymbols').uncheck();
  await expect(page.locator('#postprocessScriptPreviewText')).toContainText('new.md raw');
  await expect(page.locator('#postprocessSplitPreviewText')).toContainText('new.md raw');
  await page.locator('#openPunctSettings').click();
  await page.locator('#postprocessPreservePunctuation').fill('！');
  await expect.poll(()=>page.evaluate(()=>window.__previews.filter(x=>x.method==='preview_script_match').at(-1)?.preservePunctuation)).toEqual(['！']);
  expect(errors).toEqual([]);
});
