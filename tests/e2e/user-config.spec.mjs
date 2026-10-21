import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {makeTempDir,cleanupTempDir,findFreePort,startBlankServer} from './helpers.mjs';

test.beforeEach(()=>{delete process.env.MSW_APP_DATA_ROOT;delete process.env.MAW_APP_DATA_ROOT;});

test('preferences migrate once and survive different browsers, ports and service restart',async({browser})=>{
  test.setTimeout(90000);
  const root=makeTempDir('user-config'), servers=[], contexts=[];
  const errors=[];
  try {
    const first=await startBlankServer(await findFreePort(),root);servers.push(first);
    const a=await browser.newContext();contexts.push(a);
    const page=await a.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{if(!localStorage.getItem('seeded')){localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({mediaSeekStepMs:1750,theme:'light'}));localStorage.setItem('seeded','1');}});
    await page.goto(first.url);
    await page.waitForFunction(()=>window.MSWConfig?.connected&&typeof updateEditorSettings==='function');
    await page.evaluate(()=>window.MSWConfig.flush());
    const guards=await page.evaluate(async()=>{
      const boot=MSW_CONFIG_BOOTSTRAP;
      const denied=await fetch(boot.url);
      const invalid=await fetch(boot.url,{method:'POST',headers:{'Content-Type':'application/json','X-MSW-Token':boot.token},body:JSON.stringify({action:'migrate',sections:{credentials:{apiKey:'test-only'}}})});
      return [denied.status,invalid.status];
    });
    expect(guards).toEqual([403,400]);
    const second=await startBlankServer(await findFreePort(),root);servers.push(second);
    const b=await browser.newContext();contexts.push(b);
    const other=await b.newPage();other.on('pageerror',e=>errors.push(e.message));
    await other.goto(second.url);
    await other.waitForFunction(()=>window.MSWConfig?.connected&&typeof updateEditorSettings==='function');
    await other.evaluate(()=>window.MSWConfig.flush());
    expect(await other.evaluate(()=>JSON.parse(MSWConfig.storage.getItem('moy.asr.editor.settings.v1')).mediaSeekStepMs)).toBe(1750);
    // Both pages retain their own older settings snapshot. Independent edits merge.
    await page.evaluate(async()=>{updateEditorSettings({mediaSeekStepMs:2500});await MSWConfig.flush();});
    await other.evaluate(async()=>{updateEditorSettings({cueListShowTime:false});await MSWConfig.flush();});
    const disk=()=>JSON.parse(readFileSync(join(root,'MSW','user-settings.mswconfig'),'utf8'));
    expect(disk().sections.browser['moy.asr.editor.settings.v1'].mediaSeekStepMs).toBe(2500);
    expect(disk().sections.browser['moy.asr.editor.settings.v1'].cueListShowTime).toBe(false);
    // A conflicting edit is rejected and saved locally for recovery.
    const conflict=await other.evaluate(async()=>{updateEditorSettings({mediaSeekStepMs:3000});try{await MSWConfig.flush();return '';}catch(e){return e.message;}});
    expect(conflict).toBeTruthy();
    expect(disk().sections.browser['moy.asr.editor.settings.v1'].mediaSeekStepMs).toBe(2500);
    expect(await other.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('msw.config.conflict.')))).toBeTruthy();
    await first.stop();
    const restarted=await startBlankServer(await findFreePort(),root);servers.push(restarted);
    const c=await browser.newContext();contexts.push(c);
    const fresh=await c.newPage();fresh.on('pageerror',e=>errors.push(e.message));
    await fresh.goto(restarted.url);
    await fresh.waitForFunction(()=>window.MSWConfig?.connected&&typeof updateEditorSettings==='function');
    await fresh.evaluate(()=>MSWConfig.flush());
    expect(await fresh.evaluate(()=>JSON.parse(MSWConfig.storage.getItem('moy.asr.editor.settings.v1')).mediaSeekStepMs)).toBe(2500);
    expect(errors).toEqual([]);
  }finally{
    for(const context of contexts)await context.close();
    for(const server of servers)await server.stop();
    cleanupTempDir(root);
  }
});

test('property preset saves to the common library and workspace changes persist',async({browser})=>{
  const root=makeTempDir('config-presets'),server=await startBlankServer(await findFreePort(),root),context=await browser.newContext();
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
    await page.evaluate(()=>{
      applyCanonicalProject({segments:[{id:'a',start:0,end:3000,text:'Sample',items:[]}]},'fixture.mosp');
      updateEditorSettings({autoSaveProject:false});
    });
    await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
    await page.evaluate(()=>MSWSubtitleStyle.open('track'));
    await expect(page.locator('#style-project-preset')).toBeEnabled();
    await page.locator('#style-project-preset').selectOption('large');
    await page.locator('#style-save-as').click();
    await page.locator('#style-preset-name').fill('Shared preset');
    await page.locator('#style-save-preset').click();
    await expect(page.locator('#style-message')).toHaveText('预设已保存。');
    await page.evaluate(async()=>{
      await updateServerWorkspaceSettings({saveWorkspace:{name:'Shared workspace',workspace:waveformEditor.getLayoutData()}});
      await MSWConfig.flush();
    });
    const data=JSON.parse(readFileSync(join(root,'MSW','user-settings.mswconfig'),'utf8'));
    expect(data.sections.subtitlePresets.presets[0].name).toBe('Shared preset');
    expect(data.sections.server.saved_workspaces['Shared workspace']).toBeTruthy();
    const fresh=await browser.newContext();
    try {
      const other=await fresh.newPage();await other.goto(server.url);await other.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
      expect(await other.evaluate(()=>JSON.parse(MSWConfig.storage.getItem('msw.subtitle-presets.v1'))[0].name)).toBe('Shared preset');
      expect(await other.evaluate(()=>SERVER_CONFIG.activeWorkspaceName)).toBe('Shared workspace');
      await other.evaluate(()=>MSWConfig.flush());
    }finally{await fresh.close();}
    expect(errors).toEqual([]);
  }finally{await context.close();await server.stop();cleanupTempDir(root);}
});
