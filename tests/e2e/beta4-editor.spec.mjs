import {test, expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, startServer} from './helpers.mjs';

let server;
test.beforeAll(async () => {
  const directory = makeTempDir('beta4-editor');
  const media = generateWav(join(directory, 'synthetic.wav'), 8);
  const project = join(directory, 'project.mosp');
  writeFileSync(project, JSON.stringify({segments: [{id: 'one', start: 0, end: 1000, text: 'Synthetic'}], waveform: generateWaveformPayload(8000)}));
  server = await startServer(project, media, await findFreePort());
});
test.afterAll(async () => { await server?.stop(); });
test.beforeEach(async ({page}) => {
  await disableOnboarding(page);
  await page.addInitScript(() => localStorage.setItem('moy.asr.editor.settings.v1', JSON.stringify({autoSaveProject: false})));
  await page.goto(server.url);
  await expect(page.locator('#editor-loading')).toBeHidden();
});

for (const [name, msw, flag, expectedAuto] of [
  ['old MSW manual', true, undefined, false],
  ['upstream without explicit mode', false, undefined, true],
  ['upstream explicit manual', false, false, false],
  ['MSW explicit auto', true, true, true],
]) test(`${name} keeps its amplitude policy through save`, async ({page}) => {
  const result = await page.evaluate(({msw, flag}) => {
    const workspace = {waveformSettings: {waveformScale: 4, rowHeight: 120,
      followSourceGain: true, ...(flag === undefined ? {} : {waveformScaleAuto: flag})}};
    applyCanonicalProject({segments: [{id:'cue',start:0,end:1000,text:'Test'}],workspace,
      ...(msw ? {msw: {schema:'msw.editor.v1',project_id:'synthetic-msw'}} : {})}, 'test.mosp');
    waveformEditor.setLoudnessStats({schema:'moy.asr.loudness.v1',p95:0.3357});
    const saved = JSON.parse(buildJson());
    return {auto: waveformEditor.settings.waveformScaleAuto, scale: waveformEditor.settings.waveformScale,
      saved: saved.workspace.waveformSettings, follow: waveformEditor.settings.followSourceGain};
  }, {msw, flag});
  expect(result.auto).toBe(expectedAuto);
  expect(result.scale).toBeCloseTo(expectedAuto ? 1.56 : 4, 2);
  expect(result.saved.waveformScaleAuto).toBe(expectedAuto);
  expect(result.follow).toBe(true);
});

test('new project resets the old fitted scale and missing RMS does not invent a value', async ({page}) => {
  const result = await page.evaluate(() => {
    waveformEditor.settings.waveformScale = 8;
    waveformEditor.settings.waveformScaleAuto = false;
    applyCanonicalProject({segments: []}, 'new.mosp');
    const before = {...waveformEditor.settings};
    const fit = waveformEditor.fitWaveformScaleToLoudness();
    return {before: [before.waveformScale, before.waveformScaleAuto], fit, after: waveformEditor.settings.waveformScale};
  });
  expect(result).toEqual({before:[1,true],fit:false,after:1});
});

test('startup workspace reuse cannot overwrite the project amplitude decision', async ({page}) => {
  const result = await page.evaluate(() => {
    applyCanonicalProject({segments:[],msw:{schema:'msw.editor.v1',project_id:'legacy'},
      workspace:{preset:'wave-right',waveformSettings:{waveformScale:4}}}, 'old.mosp');
    SERVER_CONFIG.presetWorkspaces = {'wave-right':{preset:'wave-right',waveformSettings:{waveformScale:9,waveformScaleAuto:true}}};
    configureServerWorkspaceLibrary();
    return [waveformEditor.settings.waveformScale,waveformEditor.settings.waveformScaleAuto];
  });
  expect(result).toEqual([4,false]);
});

test('manual adjustment blocks later auto-fit and explicit fitting resumes it', async ({page}) => {
  const result = await page.evaluate(() => {
    const w = waveformEditor;
    w.setLoudnessStats({schema:'moy.asr.loudness.v1',p95:0.3357});
    w.changeWaveformScale(1);
    const manual = w.settings.waveformScale;
    w.setLoudnessStats({schema:'moy.asr.loudness.v1',p95:0.1});
    const unchanged = w.settings.waveformScale === manual && w.settings.waveformScaleAuto === false;
    const fitted = w.fitWaveformScaleToLoudness();
    return {unchanged,fitted,auto:w.settings.waveformScaleAuto,scale:w.settings.waveformScale,manual};
  });
  expect(result.unchanged).toBe(true);
  expect(result.fitted).toBe(true);
  expect(result.auto).toBe(true);
  expect(result.scale).not.toBe(result.manual);
});

test('deferred old-media loudness cannot overwrite a newly opened project', async ({page}) => {
  let release;
  await page.route('**/beta4-delayed-waveform', async route => {
    await new Promise(resolve => {release = resolve;});
    await route.fulfill({json:{ok:true,status:'ready',loudness:{schema:'moy.asr.loudness.v1',p95:0.1}}});
  });
  await page.evaluate(() => {SERVER_CONFIG.waveformUrl='/beta4-delayed-waveform'; window.pendingWave = loadDeferredReapeaks();});
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.evaluate(() => applyCanonicalProject({segments:[]}, 'new.mosp'));
  release();
  await page.evaluate(() => pendingWave);
  expect(await page.evaluate(() => [DATA.loudness, waveformEditor.loudnessStats, waveformEditor.settings.waveformScale])).toEqual([null,null,1]);
});

test('loudness stays out of saved and portable project payloads', async ({page}) => {
  const result = await page.evaluate(() => {
    DATA.loudness = {schema:'moy.asr.loudness.v1',p95:0.3};
    const saved = JSON.parse(buildJson());
    return [Object.hasOwn(saved,'loudness'),Object.hasOwn(window.AsrEditorUtils.stripInlineCaches(DATA),'loudness')];
  });
  expect(result).toEqual([false,false]);
});
