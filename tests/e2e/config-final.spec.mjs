import {test,expect} from '@playwright/test';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {makeTempDir,cleanupTempDir,findFreePort,startServer,generateWav,generateProjectJson} from './helpers.mjs';

test.beforeEach(()=>{delete process.env.MSW_APP_DATA_ROOT;delete process.env.MAW_APP_DATA_ROOT;});

test('cache analysis uses the active media and cannot delete unreviewed files',async({page})=>{
  const root=makeTempDir('config-cache'),media=join(root,'synthetic.wav'),project=join(root,'fixture.mosp');
  generateWav(media);generateProjectJson(project);
  const server=await startServer(project,media,await findFreePort()),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(server.url);await page.waitForFunction(()=>window.MSWConfig?.connected);
    const before=await page.evaluate(()=>JSON.stringify(DATA));
    await page.evaluate(()=>MSWConfigManager.open());await page.locator('.config-maintenance summary').click();await page.locator('[data-config-mode="cache"]').click();
    await page.locator('#config-cache-analyze').click();
    await expect(page.locator('#config-cache-result')).toContainText('synthetic.wav');
    await expect(page.locator('#config-cache-clean')).toBeDisabled();
    const denied=await page.evaluate(async()=>{try{await MSWConfig.request({action:'cache-clean',token:'invalid-preview'});return '';}catch(e){return e.message;}});
    expect(denied).toContain('重新分析');
    expect(await page.evaluate(()=>JSON.stringify(DATA))).toBe(before);
    await page.screenshot({path:'output/config56-cache-panel.png'});
    expect(errors).toEqual([]);
  }finally{await server.stop();cleanupTempDir(root);}
});

test('portable keep-local merges libraries and never exports project navigation',async({page})=>{
  await page.goto(pathToFileURL(resolve('blank-editor.html')).href);
  await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
  const result=await page.evaluate(async()=>{
    const base=JSON.parse(JSON.stringify(MSWConfig.snapshot.sections));
    base.browser??={};base.browser['moy.asr.editor.customThemes.v1']=[{name:'Local',accent:'#123456'}];
    base.server={saved_workspaces:{Personal:{schema:'moy.asr.editor.workspace.v1',preset:'classic',navigation:{playhead:1234}}}};
    MSWConfig.adopt({sections:base});
    const file={format:'msw-config',version:1,kind:'preferences',categories:['interface'],sections:{browser:{'moy.asr.editor.customThemes.v1':[{name:'Local',accent:'#ffffff'},{name:'Additional',accent:'#654321'}]}}};
    const payload={package:file,categories:['interface'],policy:'keep'};
    const preview=await MSWConfig.request({...payload,action:'preview'});
    await MSWConfig.request({...payload,action:'import',token:preview.token,revision:preview.revision});
    const saved=MSWConfig.snapshot.sections.browser['moy.asr.editor.customThemes.v1'];
    const exported=await MSWConfig.request({action:'export',categories:['waveform']});
    let invalid='';try{await MSWConfig.request({...payload,package:{...file,sections:{...file.sections,unknown:{data:1}}},action:'preview'});}catch(e){invalid=e.message;}
    return {saved,exported,invalid};
  });
  expect(result.saved).toEqual([{name:'Local',accent:'#123456'},{name:'Additional',accent:'#654321'}]);
  expect(JSON.stringify(result.exported)).not.toContain('playhead');
  expect(result.invalid).toContain('未登记字段');
});
