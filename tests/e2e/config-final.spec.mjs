import {test,expect} from '@playwright/test';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {makeTempDir,cleanupTempDir,findFreePort,startServer,generateWav,generateProjectJson} from './helpers.mjs';

test.beforeEach(()=>{delete process.env.MSW_APP_DATA_ROOT;delete process.env.MAW_APP_DATA_ROOT;});

test('portable speaker scheme import stays separate from project and subsequent deletion persists',async({page})=>{
  await page.goto(pathToFileURL(resolve('blank-editor.html')).href);await page.waitForFunction(()=>MSWSubtitleStyle?.ready);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const original=await page.evaluate(()=>JSON.stringify(DATA));
  const imported=await page.evaluate(async()=>{
    const scheme={id:'series',name:'便携团录',rows:[{...MSWSpeaker.row(0,'person-1'),name:'Erwyn',names:{'zh-hans':'艾尔文'}}]};
    const raw={format:'msw-config',version:1,kind:'preferences',categories:['speakerSchemes'],sections:{speakerSchemes:{version:1,schemes:[scheme]}}};
    const request={package:raw,categories:['speakerSchemes'],policy:'replace'};
    const p=await MSWConfig.request({...request,action:'preview'});await MSWConfig.request({...request,action:'import',revision:p.revision,token:p.token});
    return (await MSWConfig.request({action:'export',categories:['speakerSchemes']})).package;
  });
  expect(imported.sections.speakerSchemes.schemes[0].rows[0].names['zh-hans']).toBe('艾尔文');
  expect(await page.evaluate(()=>JSON.stringify(DATA))).toBe(original);
  await page.evaluate(()=>setEditorSettingsPanelOpen(true));await page.getByRole('button',{name:'说话人色系',exact:true}).click();
  await page.locator('#speaker-scheme-select').selectOption('series');await page.locator('#speaker-scheme-open').click();
  await page.locator('#speaker-scheme-add-missing').check();await expect(page.locator('#speaker-scheme-plan')).toHaveText('更新 0 人 · 新增 1 人');
  await page.locator('#speaker-scheme-apply').click();expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows.at(-1).name)).toBe('Erwyn');
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows.length)).toBe(5);
  await page.locator('#speaker-scheme-delete').click();await page.locator('#speaker-scheme-delete-confirm').click();await expect(page.locator('#speaker-scheme-status')).toContainText('方案已删除');
  expect(await page.evaluate(()=>MSWConfig.snapshot.sections.speakerSchemes.schemes)).toEqual([]);
  await page.reload();await page.waitForFunction(()=>MSWSubtitleStyle?.ready);
  expect(await page.evaluate(()=>JSON.parse(MSWConfig.storage.getItem('msw.speaker-schemes.v1')).schemes)).toEqual([]);
  expect(errors).toEqual([]);
});

test('cache analysis uses the active media and cannot delete unreviewed files',async({page})=>{
  const root=makeTempDir('config-cache'),media=join(root,'synthetic.wav'),project=join(root,'fixture.mosp');
  generateWav(media);generateProjectJson(project);
  const server=await startServer(project,media,await findFreePort()),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(server.url);await page.waitForFunction(()=>window.MSWConfig?.connected);
    // Boot may write the saved playhead while cache I/O runs. Compare content,
    // not that independent navigation checkpoint.
    const before=await page.evaluate(()=>{const {editor_state,...content}=DATA;return JSON.stringify(content);});
    await page.evaluate(()=>MSWConfigManager.open());
    await expect(page.locator('[data-config-mode]')).toHaveCount(2);
    await expect(page.locator('#config-cache-analyze')).toHaveCount(0);
    const report=await page.evaluate(()=>MSWConfig.request({action:'cache-analyze'}));
    expect(report.media).toBe('synthetic.wav');expect(report.count).toBe(0);
    const denied=await page.evaluate(async()=>{try{await MSWConfig.request({action:'cache-clean',token:'invalid-preview'});return '';}catch(e){return e.message;}});
    expect(denied).toContain('重新分析');
    expect(await page.evaluate(()=>{const {editor_state,...content}=DATA;return JSON.stringify(content);})).toBe(before);
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
