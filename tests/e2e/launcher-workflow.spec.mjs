import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

async function open(page, paths) {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(() => MSWLauncher.config?.postprocessProviders?.length);
  await page.evaluate(async paths => {
    MSWNavigation.show('prefab');
    await MSWQueue.addPaths(paths);
    window.__prefabCalls = [];
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      window.__prefabCalls.push(method);
      return next(method, payload);
    };
  }, paths);
}

for (const waveform of [true, false]) {
  test(`media-only plan sends waveform=${waveform} without ASR`, async ({ page }) => {
    await open(page, ['D:/Demo/clip.mp4']);
    await page.locator('#prefabRail [data-module-id="waveform"]').setChecked(waveform);
    await page.locator('#start').click();
    await expect(page.locator('#openProjectResult')).toBeVisible();
    const run = await page.evaluate(() => window.__queuePlanRuns.at(-1));
    expect(run.modules).toMatchObject({ waveform, asr: false });
    expect(await page.evaluate(() => window.__prefabCalls)).toContain('start_prefab_queue');
    expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_transcription');
  });
}

test('postprocessing requires a subtitle source instead of silently skipping', async ({ page }) => {
  await open(page, ['D:/Demo/clip.mp4']);
  await page.locator('#prefabRail [data-module-id="translate"]').check();
  await page.locator('#start').click();
  await expect(page.locator('#errorNotice')).toContainText('没有字幕');
  expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_prefab_queue');
});

test('project input uses its existing subtitles without implicit ASR', async ({ page }) => {
  await open(page, ['D:/Demo/existing.mosp']);
  await page.locator('#prefabRail [data-module-id="replace"]').check();
  await page.evaluate(() => {
    document.getElementById('postprocessReplacements').value = 'old => new';
    document.getElementById('postprocessReplacements').dispatchEvent(new Event('input'));
  });
  await page.locator('#start').click();
  await expect(page.locator('#openProjectResult')).toBeVisible();
  const plan = await page.evaluate(() => window.__queuePlanRuns.at(-1));
  expect(plan.tasks[0].path).toBe('D:/Demo/existing.mosp');
  expect(plan.modules.asr).toBe(false);
  expect(plan.postprocess.steps.find(s => s.id === 'replace').replacements).toEqual([{ source: 'old', target: 'new' }]);
});

test('SRT with OCR requires linked video; manual video satisfies the input dependency', async ({ page }) => {
  await open(page, ['D:/Demo/standalone.srt']);
  await page.locator('#prefabRail [data-module-id="ocr"]').check();
  await page.locator('#start').click();
  await expect(page.locator('#errorNotice')).toContainText('需要视频');
  await page.locator('#ocrVideoPath').fill('D:/Demo/clip.mp4');
  await page.locator('#start').click();
  await expect(page.locator('#openProjectResult')).toBeVisible();
  expect(await page.evaluate(() => window.__queuePlanRuns.at(-1).postprocess.steps.find(s => s.id === 'ocr').videoPath)).toBe('D:/Demo/clip.mp4');
});

test('explicit ASR keeps model and recognition parameters in the unified plan', async ({ page }) => {
  await open(page, ['D:/Demo/clip.mp4']);
  await page.locator('#prefabRail [data-module-id="asr"]').check();
  await page.evaluate(() => { document.getElementById('apiKey').value = 'test-demo-only'; });
  await page.locator('#start').click();
  await expect(page.locator('#openProjectResult')).toBeVisible();
  const plan = await page.evaluate(() => window.__queuePlanRuns.at(-1));
  expect(plan.modules.asr).toBe(true);
  expect(plan.recognition.providerId).toBeTruthy();
  expect(plan.asrPolicy).toBe('missing');
});

test('multiple inputs freeze one plan with per-task audio tracks and no single path override', async ({ page }) => {
  await open(page, ['D:/Demo/first.mp4', 'D:/Demo/second.mp4']);
  await page.locator('#start').click();
  await expect(page.locator('#openProjectResult')).toBeVisible();
  const plan = await page.evaluate(() => window.__queuePlanRuns.at(-1));
  expect(plan.tasks).toHaveLength(2);
  expect(plan.output.srtPath).toBe('');
  expect(plan.tasks.every(task => Number.isInteger(task.audioTrack))).toBe(true);
  expect(plan.modules.asr).toBe(false);
});
