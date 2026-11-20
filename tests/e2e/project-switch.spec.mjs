import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cleanupTempDir,disableOnboarding,findFreePort,generateWav,makeTempDir,startBlankServer} from './helpers.mjs';

let dir, server;
test.beforeEach(async ({page}) => {
  dir = makeTempDir('project-switch');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env');
  process.env.MSW_APP_DATA_ROOT = join(dir, 'appdata');
  server = await startBlankServer(await findFreePort(), join(dir, 'settings'));
  await disableOnboarding(page);
  await page.goto(server.url);
  await expect(page.locator('#editor-loading')).not.toBeVisible();
});
test.afterEach(async ({page}) => {
  await page.close({runBeforeUnload:false});
  await server?.stop();
  cleanupTempDir(dir);
});

test('a slow dropped project cannot replace the latest open or attach its media', async ({page}) => {
  await page.evaluate(() => {
    const data = JSON.stringify({segments:[{start:0,end:1000,text:'Earlier subtitle'}]});
    const old = new File([data], 'earlier.mosp');
    old.arrayBuffer = () => new Promise(resolve => {
      window.finishEarlierRead = () => resolve(new TextEncoder().encode(data).buffer);
    });
    window.earlierOpen = handleDroppedFiles([old, new File(['synthetic'], 'old.wav', {type:'audio/wav'})]);
  });
  await page.waitForFunction(() => typeof window.finishEarlierRead === 'function');
  await page.locator('#open-project-file').setInputFiles({
    name:'later.mosp', mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({segments:[{start:2000,end:3000,text:'Later subtitle'}]})),
  });
  await expect(page.locator('#json-name')).toHaveText('later.mosp');
  await page.evaluate(async () => { window.finishEarlierRead(); await window.earlierOpen; });
  await expect(page.locator('#editor-loading')).not.toBeVisible();
  const live = await page.evaluate(() => JSON.parse(buildJson()));
  expect(live.subtitles.cues.map(cue => cue.content.text)).toEqual(['Later subtitle']);
  expect(live.media || '').toBe('');
});

test('a delayed attach cannot take over the server after another project opens locally', async ({page}) => {
  const media = generateWav(join(dir, 'old.wav'), 3);
  const project = join(dir, 'earlier.mosp');
  writeFileSync(project, JSON.stringify({media, segments:[{start:0,end:1000,text:'Earlier subtitle'}]}));
  let start, resume;
  const started = new Promise(resolve => { start=resolve; });
  const release = new Promise(resolve => { resume=resolve; });
  await page.route('**/api/project/attach', async route => {
    start();
    await release;
    await route.continue();
  });
  await page.evaluate(buffer => {
    window.earlierOpen = openProjectFile(new File([buffer], 'earlier.mosp'));
  }, readFileSync(project, 'utf8'));
  try {
    await started;
    expect(await page.evaluate(() => openProjectFile(new File([
      JSON.stringify({segments:[{start:2000,end:3000,text:'Later subtitle'}]})
    ], 'later.mosp')))).toBe(true);
    const stale = page.waitForResponse(r => r.url().endsWith('/api/project/attach'));
    resume();
    expect((await stale).status()).toBe(409);
    expect(await page.evaluate(() => window.earlierOpen)).toBe(false);
    await expect(page.locator('#json-name')).toHaveText('later.mosp');
    await page.reload();
    expect(await page.evaluate(() => JSON.parse(buildJson()).subtitles.cues.map(cue => cue.content.text))).toEqual([]);
  } finally {
    resume();
  }
});
