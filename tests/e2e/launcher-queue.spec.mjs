import { setLauncherLanguage } from './launcher-language.mjs';
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');
async function open(page) {
  await page.goto(`file://${launcher}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.providers?.length && window.MSWModules?.state.enabled.media);
  await page.evaluate(() => MSWNavigation.show('prefab'));
}
const add = (page, paths) => page.evaluate(paths => MSWQueue.addPaths(paths), paths);
const rail = (page, id) => page.locator(`#prefabRail [data-module-id="${id}"]`);
const card = (page, id) => page.locator(`[data-module-card="${id}"]`);

test('one input, no mode switches or duplicate enable controls; default collapsed modules', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page);
  await expect(page.locator('#mediaTitle')).toHaveText('输入媒体/工程/字幕');
  await expect(page.locator('#singleMode, #batchMode, #inputModeMedia, #inputModeProject, .auto-step-row')).toHaveCount(0);
  await expect(page.locator('#dropZone')).toBeVisible();
  await expect(page.locator('#start')).toBeDisabled();
  await expect(card(page, 'waveform')).toHaveClass(/collapsed/);
  await rail(page, 'asr').check();
  await expect(card(page, 'asr')).toHaveClass(/collapsed/);
  expect(errors).toEqual([]);
});

test('same-name pair requires confirmation and counts one task, then unlinks', async ({ page }) => {
  await open(page);
  await add(page, ['D:/Demo/lesson.mp4', 'D:/Demo/lesson.srt']);
  await expect(page.locator('.queue-candidate')).toHaveCount(1);
  await page.locator('#start').click();
  await expect(page.locator('#errorNotice')).toContainText('确认文件关联');
  expect(await page.evaluate(() => window.__queuePlanRuns || [])).toEqual([]);
  await page.getByRole('button', { name: '关联为一个任务', exact: true }).click();
  await expect(page.locator('#batchQueueCount')).toHaveText('2 个文件 · 1 个任务');
  await expect(page.locator('.queue-file')).toHaveCount(1);
  await page.locator('.queue-details summary').click();
  await page.getByRole('button', { name: '解除关联', exact: true }).click();
  await expect(page.locator('.queue-file')).toHaveCount(2);
  await expect(page.locator('.queue-candidate')).toHaveCount(0);
});

test('path deduplication and separate processing do not erase parameters', async ({ page }) => {
  await open(page);
  await add(page, ['D:/Demo/one.mp4', 'd:\\demo\\ONE.mp4', 'D:/Demo/one.srt']);
  await expect(page.locator('.queue-file')).toHaveCount(2);
  await page.getByRole('button', { name: '分别处理', exact: true }).click();
  await expect(page.locator('.queue-candidate')).toHaveCount(0);
  await rail(page, 'proofread').check();
  await expect(rail(page, 'proofread')).toBeChecked();
  await card(page, 'proofread').locator('.module-collapse').click();
  await page.locator('#postprocessPromptProofread').fill('保留术语');
  await rail(page, 'proofread').uncheck(); await rail(page, 'proofread').check();
  await expect(page.locator('#postprocessPromptProofread')).toHaveValue('保留术语');
  await expect(card(page, 'proofread').locator('.module-status')).toContainText('需要配置');
  expect(await page.evaluate(() => MSWPlan.build().postprocess.steps.find(s => s.id === 'proofread').enabled)).toBe(true);
});

test('queue details preserve selected audio track and per-task manuscript', async ({ page }) => {
  await open(page);
  await add(page, ['D:/Demo/first.mp4', 'D:/Demo/second.mp4']);
  await rail(page, 'match').check();
  const rows = page.locator('.queue-file');
  await rows.nth(0).locator('summary').click();
  await rows.nth(0).getByLabel('声音轨道', { exact: true }).selectOption('1');
  await rows.nth(0).getByLabel('本任务文稿', { exact: true }).fill('D:/Demo/first.md');
  await rows.nth(0).getByLabel('本任务文稿', { exact: true }).blur();
  await rows.nth(1).locator('summary').click();
  await rows.nth(1).getByLabel('本任务文稿', { exact: true }).fill('D:/Demo/second.md');
  await rows.nth(1).getByLabel('本任务文稿', { exact: true }).blur();
  const plan = await page.evaluate(() => MSWPlan.build());
  expect(plan.tasks[0].audioTrack).toBe(1);
  expect(plan.tasks.map(t => t.scriptPath)).toEqual(['D:/Demo/first.md', 'D:/Demo/second.md']);
  expect(plan.modules.postprocess).toContain('match');
});

test('mixed files use one frozen plan and provide project results', async ({ page }) => {
  await open(page);
  await add(page, ['D:/Demo/video.mp4', 'D:/Demo/subtitle.srt', 'D:/Demo/project.mosp']);
  await page.locator('#start').click();
  await expect(page.locator('#stop')).toBeVisible();
  await expect(rail(page, 'waveform')).toBeDisabled();
  await expect(page.locator('#openProjectResult')).toBeVisible();
  const runs = await page.evaluate(() => window.__queuePlanRuns);
  expect(runs).toHaveLength(1);
  expect(runs[0].version).toBe(2);
  expect(runs[0].tasks).toHaveLength(3);
  expect(runs[0].modules.asr).toBe(false);
  await expect(page.locator('.queue-status')).toHaveText(['已完成', '已完成', '已完成']);
  await expect(rail(page, 'waveform')).toBeEnabled();
});

test('cancel stops queue; events from another run cannot mutate it', async ({ page }) => {
  await open(page);
  await add(page, ['D:/Demo/one.mp4', 'D:/Demo/two.mp4', 'D:/Demo/three.mp4']);
  await page.locator('#start').click();
  await page.waitForFunction(() => MSWQueue.state.runId);
  await page.evaluate(() => MSWLauncher.onBackendEvent({ type: 'queueDone', runId: 'stale', results: [] }));
  expect(await page.evaluate(() => MSWQueue.state.running)).toBe(true);
  await page.locator('#stop').click();
  await page.waitForFunction(() => !MSWQueue.state.running);
  await expect(page.locator('.queue-status').last()).toHaveText('已取消');
  await expect(page.locator('#status')).toContainText('队列已取消');
});

test('draft restores pairing without persisting credentials or old expanded state', async ({ page }) => {
  await open(page);
  await add(page, ['D:/Demo/one.mp4', 'D:/Demo/one.srt']);
  await page.getByRole('button', { name: '关联为一个任务', exact: true }).click();
  await card(page, 'waveform').locator('.module-collapse').click();
  const draft = await page.evaluate(() => localStorage.getItem('MSW_LAUNCHER_INPUT_QUEUE_V2'));
  expect(draft).not.toMatch(/apiKey|recognition|workspaceId/);
  await open(page);
  await expect(page.locator('#batchQueueCount')).toHaveText('2 个文件 · 1 个任务');
  await expect(card(page, 'waveform')).toHaveClass(/collapsed/);
});

test('language and page changes preserve queue and selected modules', async ({ page }) => {
  await open(page);
  await add(page, ['D:/Demo/subtitle.srt']);
  await rail(page, 'replace').check();
  await setLauncherLanguage(page, 'en');
  await expect(page.locator('#mediaTitle')).toHaveText('Input media / projects / subtitles');
  await expect(page.locator('#batchQueueCount')).toHaveText('1 files · 1 tasks');
  await page.evaluate(() => { MSWNavigation.show('tools'); MSWNavigation.show('prefab'); });
  await expect(rail(page, 'replace')).toBeChecked();
  await expect(page.locator('.queue-file')).toHaveCount(1);
});

test('preflight errors expand the first relevant card and keep queue', async ({ page }) => {
  await open(page); await add(page, ['D:/Demo/subtitle.srt']);
  await rail(page, 'proofread').check();
  await page.evaluate(() => {
    const old = MSWLauncher.callBackend;
    MSWLauncher.callBackend = (name, payload) => name === 'start_prefab_queue' ? Promise.resolve({ ok: false, errors: [{ module: 'proofread', taskId: payload.plan.tasks[0].id, message: '测试：缺少模型' }] }) : old(name, payload);
  });
  await page.locator('#start').click();
  await expect(card(page, 'proofread')).not.toHaveClass(/collapsed/);
  await expect(page.locator('.queue-file')).toContainText('测试：缺少模型');
  await expect(page.locator('#start')).toBeEnabled();
});

test('narrow layout and keyboard drop-zone access', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 700 });
  await open(page); await add(page, ['D:/Demo/long subtitle name 中文测试.srt']);
  const viewport = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.client + 1);
  await page.locator('#dropZone').focus();
  await expect(page.locator('#dropZone')).toBeFocused();
  expect(await page.locator('#dropZone').evaluate(el => el.tagName)).toBe('BUTTON');
});

test('typed media binding probes tracks, recovers from errors and survives reload', async ({ page }) => {
  await open(page); await add(page, ['D:/Demo/subtitle.srt']);
  await page.locator('.queue-details summary').click();
  const input = page.locator('input[id$="-mediaPath"]');
  await input.fill('D:/Demo/invalid.txt'); await input.press('Tab');
  await expect(page.locator('.queue-file .field-error')).toBeVisible();
  await input.fill('D:/Demo/voice.mp4'); await input.press('Tab');
  await expect(page.locator('.queue-file .field-error')).toHaveCount(0);
  await page.locator('.queue-details select').selectOption('1');
  await open(page);
  await page.locator('.queue-details summary').click();
  await expect(page.locator('.queue-details select')).toHaveValue('1');
  expect(await page.evaluate(() => MSWPlan.build().tasks[0].mediaPath)).toBe('D:/Demo/voice.mp4');
});

test('completed tasks can be skipped on retry; restored status never replays silently', async ({ page }) => {
  await open(page); await add(page, ['D:/Demo/one.srt']);
  await page.locator('#start').click();
  await expect(page.locator('.queue-status')).toHaveText('已完成');
  await page.waitForFunction(() => !MSWQueue.state.running);
  await add(page, ['D:/Demo/two.srt']);
  await page.locator('#start').click();
  await expect(page.locator('#batchConfirmMessage')).toContainText('跳过已完成');
  await page.locator('#batchConfirmYes').click();
  await expect.poll(() => page.evaluate(() => window.__queuePlanRuns?.length)).toBe(2);
  expect(await page.evaluate(() => window.__queuePlanRuns[1].tasks.map(task => task.path))).toEqual(['D:/Demo/two.srt']);
  await page.waitForFunction(() => !MSWQueue.state.running);
  await open(page);
  await expect(page.locator('.queue-status').first()).toHaveText('已完成');
  await expect(page.getByRole('button', { name: '打开所在文件夹', exact: true })).toHaveCount(2);
});
