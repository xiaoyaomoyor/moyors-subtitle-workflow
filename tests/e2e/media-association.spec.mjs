import {test, expect} from '@playwright/test';
import {mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {disableOnboarding, findFreePort, generateWav, makeTempDir, startServer} from './helpers.mjs';

let dir, media, projectPath, server;
test.beforeAll(async () => {
  dir=makeTempDir('media-association');
  process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');
  writeFileSync(process.env.MAW_ENV_FILE,'');
  media=join(dir,'original #1 & 2.wav');generateWav(media,2);
  mkdirSync(join(dir,'_msw'));
  projectPath=join(dir,'_msw','project.mosp');
  writeFileSync(projectPath,JSON.stringify({media:'../original #1 & 2.wav',segments:[{start:0,end:1000,text:'Synthetic subtitle'}]}));
  server=await startServer(projectPath,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});

async function launcher(page) {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(()=>window.MSWLauncher?.config?.postprocessProviders?.length);
  await page.evaluate(()=>{
    window.__requests=[];
    MSWLauncher.bridgeOverride=async(method,payload,next)=>{
      if(method==='choose_file')return {ok:true,path:'D:/Synthetic/new.wav'};
      if(method==='start_server'){__requests.push(payload);return {ok:true,url:'http://127.0.0.1:8250/'};}
      if(method==='open_url')return {ok:true};
      return next();
    };
    MSWLauncher.openMediaRelink('D:/Synthetic/project.mosp');
  });
}

test('launcher remembers by default, supports session-only, and fits compact themes',async({page},info)=>{
  await launcher(page);
  await expect(page.locator('#mediaRelinkRemember')).toBeChecked();
  expect((await page.locator('#mediaRelinkRemember').boundingBox()).width).toBeLessThan(20);
  await expect(page.locator('#mediaRelinkOpen')).toBeDisabled();
  for(const theme of ['dark','light']) {
    await page.setViewportSize({width:900,height:650});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    expect(await page.locator('.media-relink-card').evaluate(el=>{
      const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;
    })).toBe(true);
    await page.screenshot({path:info.outputPath(`relink-${theme}.png`),animations:'disabled'});
  }
  await page.locator('#mediaRelinkChoose').click();
  await expect(page.locator('#mediaRelinkPath')).toHaveValue('D:/Synthetic/new.wav');
  await page.locator('#mediaRelinkRemember').uncheck();
  await page.locator('#mediaRelinkOpen').click();
  expect(await page.evaluate(()=>__requests[0])).toMatchObject({jsonPath:'D:/Synthetic/project.mosp',mediaPath:'D:/Synthetic/new.wav',rememberMedia:false});
  await page.evaluate(()=>MSWLauncher.openMediaRelink('D:/Synthetic/second.mosp'));
  await expect(page.locator('#mediaRelinkRemember')).toBeChecked();
  await page.locator('#mediaRelinkChoose').click();
  await page.locator('#mediaRelinkOpen').click();
  expect(await page.evaluate(()=>__requests[1].rememberMedia)).toBe(true);
});

test('cancelled selection cannot overwrite the next relink; conflicts keep captured project and media',async({page})=>{
  await launcher(page);
  await page.evaluate(()=>{
    const original=MSWLauncher.bridgeOverride;
    MSWLauncher.bridgeOverride=(method,payload,next)=>method==='choose_file'
      ? new Promise(resolve=>window.__choose=resolve):original(method,payload,next);
  });
  await page.locator('#mediaRelinkChoose').click();
  await page.locator('#mediaRelinkCancel').click();
  await page.evaluate(()=>{MSWLauncher.openMediaRelink('D:/Synthetic/second.mosp');__choose({ok:true,path:'D:/Synthetic/stale.wav'});});
  await expect(page.locator('#mediaRelinkPath')).toHaveValue('');
  await expect(page.locator('#mediaRelinkOpen')).toBeDisabled();
  await page.evaluate(()=>{
    MSWLauncher.confirm=async()=>{const n=window.__confirmCount||0;window.__confirmCount=n+1;return n>0;};
    MSWLauncher.bridgeOverride=async(method,payload,next)=>{
      if(method==='choose_file')return {ok:true,path:'D:/Synthetic/new.wav'};
      if(method==='start_server'){
        __requests.push(payload);
        document.getElementById('jsonPath').value='D:/Synthetic/unrelated.mosp';
        return payload.independentPort?{ok:true,url:'http://127.0.0.1:9250/'}
          :{ok:false,code:'server_conflict',conflict:{mediaConflict:true,projectPath:payload.jsonPath,owned:false}};
      }
      if(method==='open_url')return {ok:true};
      return next();
    };
  });
  await page.locator('#mediaRelinkChoose').click();
  await page.locator('#mediaRelinkOpen').click();
  await expect.poll(()=>page.evaluate(()=>__requests.length)).toBe(2);
  expect(await page.evaluate(()=>__requests[1])).toMatchObject({jsonPath:'D:/Synthetic/second.mosp',mediaPath:'D:/Synthetic/new.wav',rememberMedia:true,independentPort:true});
});

test('selected project footer and card menu both open media association',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('MSW_HOME_GROUPS_V2',JSON.stringify({recent:false,all:false})));
  await launcher(page);
  await page.locator('#mediaRelinkCancel').click();
  const card=page.locator('#recentGrid .recent-card[data-path$="clip.mosp"]');
  await card.click();
  await page.locator('#homeRelinkMedia').click();
  await expect(page.locator('#mediaRelinkModal')).toBeVisible();
  await expect(page.locator('#mediaRelinkProject')).toContainText('clip.mosp');
  await page.keyboard.press('Escape');
  await card.click({button:'right'});
  await page.getByRole('menuitem',{name:'关联媒体',exact:true}).click();
  await expect(page.locator('#mediaRelinkModal')).toBeVisible();
  await expect(page.locator('#mediaRelinkProject')).toContainText('clip.mosp');
});

async function editor(page) {
  await disableOnboarding(page);await page.goto(server.url);
  await page.waitForFunction(()=>window.MSWE?.resolve('persistence-host')&&window.MSWProductionProject?.isView(DATA));
}
async function download(page,action) {
  const waiting=page.waitForEvent('download');
  await action();const downloaded=await waiting;
  return JSON.parse(readFileSync(await downloaded.path(),'utf8'));
}

test('bound save stays relative; download uses original absolute path without changing the document',async({page})=>{
  await editor(page);
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
  const saved=JSON.parse(readFileSync(projectPath,'utf8'));
  expect(saved.media).toBe('../original #1 & 2.wav');
  const exported=await download(page,()=>page.evaluate(()=>MSWE.resolve('persistence-host').downloadLocal()));
  expect(isAbsolute(exported.media)).toBe(true);
  expect(realpathSync.native(exported.media)).toBe(realpathSync.native(media));
  expect(await page.evaluate(()=>DATA.media)).toBe(saved.media);
  expect(exported.schema).toBe('msw.project.v4');
});

test('timeline file exports resolve the original media while preserving relative project data',async({page})=>{
  await editor(page);
  await page.waitForFunction(()=>player.readyState>=1);
  const result=await page.evaluate(()=>{
    setGapRemoveData({gaps:[{start:1000,end:1500,removed:true}]});
    const otio=JSON.parse(buildGapRemovedOtio());
    return {target:otio.tracks.children[0].children[0].media_references.DEFAULT_MEDIA.target_url,
      regions:JSON.parse(buildGapRemovedRegionsJson()),concat:buildGapRemovedFfconcat(),reference:DATA.media};
  });
  expect(realpathSync.native(fileURLToPath(result.target))).toBe(realpathSync.native(media));
  expect(new URL(result.target).hash).toBe('');
  expect(isAbsolute(result.regions.media)).toBe(true);
  expect(realpathSync.native(result.regions.media)).toBe(realpathSync.native(media));
  expect(result.concat).toContain(result.regions.media.replaceAll('\\','/'));
  expect(result.reference).toBe('../original #1 & 2.wav');
});

test('switching projects clears old media identity; recovery restores its own export path',async({page})=>{
  await editor(page);
  await page.evaluate(()=>{
    const snapshot=MSWE.resolve('persistence-host').snapshot();snapshot.msw.project_id='project-other';
    applyCanonicalProject(snapshot,'other.mosp');
  });
  const unrelated=await download(page,()=>page.evaluate(()=>MSWE.resolve('persistence-host').downloadLocal()));
  expect(unrelated.media).toBe('../original #1 & 2.wav');
  expect(await page.evaluate(()=>mediaTargetUrl())).toBe('');
  await page.evaluate(()=>{
    const project=MSWE.resolve('persistence-host').snapshot();
    MSWE.resolve('persistence-host').restore({project,filename:'recovered.mosp',
      fileExportMediaIdentity:{reference:project.media,path:'D:/Synthetic/recovered.wav'}});
  });
  const recovered=await download(page,()=>page.evaluate(()=>MSWE.resolve('persistence-host').downloadLocal()));
  expect(recovered.media).toBe('D:/Synthetic/recovered.wav');
  expect(await page.evaluate(()=>mediaTargetUrl())).toBe('file:///D:/Synthetic/recovered.wav');
});

test('disconnected save offers a usable file with current text and original media',async({page})=>{
  await editor(page);
  await page.route('**/api/msw/project',route=>route.abort('connectionrefused'));
  page.on('dialog',dialog=>dialog.accept());
  await page.evaluate(()=>{DATA.language='zh';window.showSaveFilePicker=undefined;});
  const exported=await download(page,()=>page.evaluate(()=>saveProjectToServer()));
  expect(exported.language).toBe('zh');expect(isAbsolute(exported.media)).toBe(true);
  expect(realpathSync.native(exported.media)).toBe(realpathSync.native(media));
});
