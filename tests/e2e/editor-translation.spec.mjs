import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openMenubarMenu, disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, startServer, startBlankServer, startStaticServer, openTtsEnvironment } from './helpers.mjs';

let mockProvider, providerUrl, server, tempDir, projectPath;
let held = [], requests = [], hold = false;
test.beforeAll(async () => {
  mockProvider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const input = body.messages.find(item => item.role === 'user').content;
    if (input === 'Reply with OK.') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {content: 'OK'}}]})); return;
    }
    const cues = JSON.parse(input);
    requests.push(cues);
    const respond = () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ groups: cues.map(cue => ({ source_ids: [cue.id], text: `Translated ${cue.text}` })) }) } }] }));
    };
    if (hold) held.push(respond); else respond();
  });
  await new Promise(resolve => mockProvider.listen(0, '127.0.0.1', resolve));
  providerUrl = `http://127.0.0.1:${mockProvider.address().port}/v1`;
});
test.afterAll(async () => { await new Promise(resolve => mockProvider.close(resolve)); });

function fixture(secondary = false) {
  return { msw: { schema: 'msw.editor.v1', project_id: `project-${randomUUID()}`, future: { preserved: true } },
    segments: [{ id: 'a', start: 0, end: 2000, text: 'Hello' }, { id: 'b', start: 3000, end: 5000, text: 'World' }],
    waveform: generateWaveformPayload(10000),
    ...(secondary ? { multi_subtitle: { schema: 'moy.asr.multi_subtitle.v1', enabled: true, display_mode: 'both',
      tracks: [{ id: 'ext', role: 'extension', name: 'Secondary', language: 'English', split_mode: 'word',
        segments: [{ id: 'x', start: 100, end: 1900, text: 'Old Hello' }, { id: 'y', start: 3100, end: 4900, text: 'Old World' }, { id: 'z', start: 8000, end: 9000, text: 'Unbound' }] }],
      bindings: [{ id: 'bind-a', track_id: 'ext', main_segment_ids: ['a'], extension_segment_ids: ['x'], start_offset_ms: 100, end_offset_ms: -100 },
        { id: 'bind-b', track_id: 'ext', main_segment_ids: ['b'], extension_segment_ids: ['y'], start_offset_ms: 100, end_offset_ms: -100 }] } } : {}),
  };
}
test.beforeEach(async ({ page }) => {
  requests = []; hold = false; held = [];
  tempDir = makeTempDir('editor-translation');
  process.env.MAW_ENV_FILE = join(tempDir, 'isolated.env');
  process.env.MSW_APP_DATA_ROOT = join(tempDir, 'app-data');
  await disableOnboarding(page);
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
});
test.afterEach(async () => {
  for (const respond of held.splice(0)) respond();
  await server?.stop(); server = null;
  // Synthetic fixtures and failure evidence remain in the OS temp directory.
});
async function open(page, secondary = false, blank = false) {
  const data = fixture(secondary);
  const media = generateWav(join(tempDir, 'synthetic.wav'), 10);
  projectPath = join(tempDir, 'test.mosp');
  writeFileSync(projectPath, JSON.stringify(data));
  server = blank ? await startBlankServer(await findFreePort(), join(tempDir, 'settings'))
    : await startServer(projectPath, media, await findFreePort());
  await page.goto(server.url);
  if (blank) {
    const transfer = await page.evaluateHandle(data => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(data)], 'test.mosp', { type: 'application/json' }));
      return transfer;
    }, data);
    await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });
    await transfer.dispose();
  }
  await expect.poll(() => page.evaluate(() => DATA.segments.length)).toBe(2);
  await expect(page.locator('#editor-loading')).not.toBeVisible();
}
async function openTranslationPanel(page) {
  await openMenubarMenu(page, '字幕');
  const toggle = page.locator('#batch-operations-group > .dropdown-submenu-toggle');
  await toggle.focus();
  await toggle.press('ArrowRight');
  await page.locator('#subtitle-translate-btn').click();
}
async function panel(page) {
  await openTranslationPanel(page);
  await expect(page.locator('#subtitle-translation-panel')).toBeVisible();
  await expect(page.locator('#translation-provider option')).toHaveCount(4);
  await page.locator('#translation-provider').selectOption('custom');
  await page.locator('#translation-environment-open').click();
  await expect(page.locator('#llm-provider')).toHaveValue('custom');
  await page.locator('#translation-base-url').fill(providerUrl);
  await page.locator('#translation-model').fill('test-model');
  await page.locator('#translation-api-key').fill('synthetic-test-key');
  await page.locator('#translation-save-settings').click();
  await expect(page.locator('#llm-message')).toContainText('配置已保存');
  await page.locator('#editor-settings-close').click();
  await openTranslationPanel(page);
}
const secondaryTexts = (page) => page.evaluate(() => DATA.multi_subtitle.tracks[0]?.segments.map(cue => cue.text) || []);
async function release() { hold = false; for (const respond of held.splice(0)) respond(); }

test('LLM management stays global and unsaved edits do not change the call configuration', async ({page}) => {
  await open(page); await openTranslationPanel(page);
  await expect(page.locator('#translation-start')).toBeDisabled();
  await expect(page.locator('#translation-environment-open')).toBeVisible();
  await page.locator('#subtitle-translation-close').click(); await panel(page);
  await expect(page.locator('#subtitle-translation-panel #translation-settings')).toHaveCount(0);
  await page.locator('#subtitle-translation-close').click(); await openTtsEnvironment(page);
  await page.locator('.settings-nav-subitem').filter({hasText: /^LLM$/}).click();
  await page.locator('#translation-test').click();
  await expect(page.locator('#llm-test-jobs')).toContainText('处理完成');
  const width = await page.locator('#translation-base-url').evaluate(input => input.clientWidth / input.parentElement.clientWidth);
  expect(width).toBeGreaterThan(.95);
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'llm-environment-settings.png')});
  await expect(page.locator('#translation-jobs .msw-processing-job')).toHaveCount(0);
  await page.locator('#translation-model').fill('unsaved-model');
  await page.locator('#translation-base-url').fill('https://unconfigured.example.invalid/v1');
  await page.locator('#llm-provider').selectOption('deepseek');
  await page.locator('#editor-settings-close').click(); await openTranslationPanel(page);
  await expect(page.locator('#translation-provider')).toHaveValue('custom');
  const submitted = page.waitForRequest(request => request.url().endsWith('/api/msw/jobs') && request.method() === 'POST');
  await page.locator('#translation-start').click();
  expect((await submitted).postDataJSON().provider).toEqual({providerId: 'custom'});
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Translated World']);
});

test('translation history collapses, scrolls and retains opened results after an update', async ({page}) => {
  await open(page); await panel(page);
  for (let count = 1; count <= 3; count++) {
    await page.locator('#translation-start').click();
    await expect(page.locator('#translation-jobs .msw-processing-job')).toHaveCount(count);
    await expect(page.locator('#translation-jobs .msw-processing-job').first()).toContainText('结果已应用');
  }
  const history = page.locator('#translation-jobs');
  await history.getByRole('button', {name: '查看译文', exact: true}).first().click();
  await expect(history.locator('.msw-translation-results')).toHaveCount(1);
  await page.locator('#translation-history > summary').click(); await expect(history).toBeHidden();
  await page.locator('#translation-history > summary').click();
  await expect(history.locator('.msw-translation-results')).toHaveCount(1);
  expect(await history.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto')).toBe(true);
  await history.evaluate(el => el.scrollTop = 60);
  await page.locator('#translation-start').click();
  await expect(page.locator('#translation-history-count')).toHaveText('(4)');
  await expect(history.locator('.msw-translation-results')).toHaveCount(1);
  expect(await history.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});

test('an uncertain submission locks connection edits until its existing job is confirmed', async ({page}) => {
  await open(page); await panel(page); hold = true;
  let lost = false;
  await page.route('**/api/msw/jobs', async route => {
    if (route.request().method() === 'POST' && !lost) {
      lost = true; await route.fetch(); await route.abort('failed');
    } else await route.continue();
  });
  await page.locator('#translation-start').click();
  await expect(page.locator('#translation-message')).toContainText('不会重复创建任务');
  await expect(page.locator('#translation-save-settings')).toBeDisabled();
  await page.locator('#translation-start').click();
  await expect(page.locator('#translation-message')).toContainText('翻译已开始');
  await expect(page.locator('#translation-save-settings')).toBeEnabled();
  await release();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Translated World']);
  expect(requests).toHaveLength(1);
});

test('blank server imports, translates all, creates aligned secondary and undoes once', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, false, true);
  await panel(page);
  await expect(page.locator('#translation-scope')).toContainText('全部主字幕 · 2');
  await page.locator('#translation-start').click();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Translated World']);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toHaveLength(2);
  const state = await page.evaluate(() => ({ main: DATA.segments, multi: DATA.multi_subtitle }));
  expect(state.multi.tracks[0].segments.map(({ start, end }) => [start, end])).toEqual(state.main.map(({ start, end }) => [start, end]));
  expect(state.multi.bindings).toHaveLength(2);
  await page.locator('#subtitle-translation-close').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => secondaryTexts(page)).toEqual([]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Translated World']);
  expect(errors).toEqual([]);
});

test('selected secondary translates its main only, preserves timing and saves extension metadata', async ({ page }) => {
  await open(page, true);
  await page.locator('.multi-dual-cue').first().locator('.multi-cue-column.extension .text').click();
  await panel(page);
  await expect(page.locator('#translation-scope')).toContainText('选中的主字幕 · 1');
  await page.locator('#translation-start').click();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Old World', 'Unbound']);
  expect(requests[0].map(cue => cue.text)).toEqual(['Hello']);
  await page.locator('#subtitle-translation-close').click();
  await page.keyboard.press('Control+s');
  await expect.poll(() => JSON.parse(readFileSync(projectPath, 'utf8')).multi_subtitle?.tracks[0]?.segments[0]?.text).toBe('Translated Hello');
  const saved = JSON.parse(readFileSync(projectPath, 'utf8'));
  expect(saved.multi_subtitle.tracks[0].segments.map(cue => [cue.id, cue.start, cue.end])).toEqual([['x', 100, 1900], ['y', 3100, 4900], ['z', 8000, 9000]]);
  expect(saved.msw.future).toEqual({ preserved: true });
  expect(saved.msw.applied_results).toHaveLength(1);
  await page.reload();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Old World', 'Unbound']);
});

test('selecting only an unbound secondary does not send any translation', async ({ page }) => {
  await open(page, true);
  await page.locator('.multi-cue-column.extension .text').filter({ hasText: /^Unbound$/ }).click();
  await panel(page);
  await expect(page.locator('#translation-start')).toBeDisabled();
  await expect(page.locator('#translation-message')).toContainText('没有可翻译的主字幕');
  expect(requests).toHaveLength(0);
});

test('editing during translation keeps changed text and applies other results', async ({ page }) => {
  await open(page, true); await panel(page);
  hold = true;
  await page.locator('#translation-start').click();
  await expect.poll(() => requests.length).toBe(1);
  await page.locator('#subtitle-translation-close').click();
  await page.locator('.multi-dual-cue').first().locator('.multi-cue-column.main .text').click();
  await page.locator('#cue-panel-text').fill('User edited Hello');
  await page.locator('#cue-panel-target').click();
  await release();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Old Hello', 'Translated World', 'Unbound']);
  await openTranslationPanel(page);
  await expect(page.locator('#translation-message')).toContainText('主字幕文本已修改');
  await page.getByRole('button', { name: '查看译文', exact: true }).click();
  await expect(page.locator('.msw-translation-results textarea').first()).toHaveValue('Translated Hello');
});

test('cancel discards a late provider response and leaves subtitles unchanged', async ({ page }) => {
  await open(page); await panel(page); hold = true;
  await page.locator('#translation-start').click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: '取消任务', exact: true }).click();
  await release();
  await expect(page.locator('#translation-jobs')).toContainText('已取消');
  expect(await secondaryTexts(page)).toEqual([]);
});

test('a completed translation waits for an active subtitle drag to finish', async ({ page }) => {
  await open(page, true); await panel(page); hold = true;
  await page.locator('#translation-start').click();
  await expect.poll(() => requests.length).toBe(1);
  await page.locator('#subtitle-translation-close').click();
  const block = page.locator('.waveform-cue-block').filter({ hasText: /^Hello$/ }).first();
  const box = await block.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 });
    await expect.poll(() => page.evaluate(() => waveformEditor.hasCueDrag())).toBe(true);
    await release();
    await expect(page.locator('#translation-jobs')).toContainText('处理完成');
    expect(await secondaryTexts(page)).toEqual(['Old Hello', 'Old World', 'Unbound']);
  } finally {
    await page.mouse.up();
  }
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Translated World', 'Unbound']);
});

test('partial results can finish on the track they created without duplicating earlier results', async ({ page }) => {
  await open(page); await panel(page); hold = true;
  await page.locator('#translation-start').click();
  await expect.poll(() => requests.length).toBe(1);
  await page.locator('#subtitle-translation-close').click();
  await page.locator('#cues-container > .cue').first().click();
  await page.locator('#cue-panel-text').fill('Changed Hello');
  await page.locator('#cue-panel-target').click();
  await release();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated World']);
  const createdTrack = await page.evaluate(() => DATA.multi_subtitle.tracks[0].id);
  await page.locator('#cue-panel-text').fill('Hello');
  await page.locator('#cue-panel-target').click();
  await openTranslationPanel(page);
  await page.getByRole('button', { name: '检查并应用', exact: true }).click();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Translated World']);
  expect(await page.evaluate(() => DATA.multi_subtitle.tracks[0].id)).toBe(createdTrack);
  expect(requests).toHaveLength(1);
});

test('English translation panel uses translated labels and shared saved provider settings', async ({ page }) => {
  await open(page); await panel(page);
  await page.locator('#subtitle-translation-close').click();
  await openTtsEnvironment(page);
  await page.locator('.settings-nav-subitem').filter({hasText: /^LLM$/}).click();
  await page.locator('#translation-save-settings').click();
  await expect(page.locator('#llm-message')).toContainText('配置已保存');
  await expect(page.locator('#translation-api-key')).toHaveValue('');
  await expect(page.locator('#translation-key-state')).toContainText('已配置本机密钥');
  await page.locator('#editor-settings-close').click(); await openTranslationPanel(page);
  await page.evaluate(() => MSWE_I18N.applyLanguage('en'));
  await expect(page.locator('#subtitle-translation-title')).toHaveText('Translate subtitles');
  await expect(page.locator('#translation-scope')).toContainText('Scope: all main subtitles');
  expect(await page.locator('#subtitle-translation-panel').innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  await page.locator('#translation-start').click();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Translated World']);
});

test('reload recovers completed results for explicit review without repeating requests', async ({ page }) => {
  await open(page); await panel(page); hold = true;
  await page.locator('#translation-start').click();
  await expect.poll(() => requests.length).toBe(1);
  await page.reload();
  await release();
  await openTranslationPanel(page);
  await expect(page.getByRole('button', { name: '检查并应用', exact: true })).toBeVisible();
  expect(await secondaryTexts(page)).toEqual([]);
  await page.getByRole('button', { name: '检查并应用', exact: true }).click();
  await expect.poll(() => secondaryTexts(page)).toEqual(['Translated Hello', 'Translated World']);
  expect(requests).toHaveLength(1);
});

test('old project results never apply after switching projects and panel fits narrow screen', async ({ page }) => {
  await open(page); await panel(page); hold = true;
  await page.locator('#translation-start').click();
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(data => applyCanonicalProject(data, 'other.mosp'), fixture());
  await release();
  await expect(page.locator('#translation-jobs .msw-processing-job')).toHaveCount(0);
  expect(await secondaryTexts(page)).toEqual([]);
  await page.setViewportSize({ width: 560, height: 650 });
  const box = await page.locator('#subtitle-translation-panel').boundingBox();
  expect(box.width).toBeLessThan(560);
  expect(box.y + box.height).toBeLessThanOrEqual(650);
  const overflow = await page.locator('#subtitle-translation-panel .gap-remove-panel-body').evaluate(node => node.scrollWidth > node.clientWidth);
  expect(overflow).toBe(false);
  if (process.env.MSW_TRANSLATION_SCREENSHOT) await page.screenshot({ path: process.env.MSW_TRANSLATION_SCREENSHOT });
});

test('generated portable editor explains the server requirement without sending jobs', async ({ page }) => {
  server = await startStaticServer(join(process.cwd(), 'blank-editor.html'), await findFreePort());
  await page.goto(server.url);
  await openTranslationPanel(page);
  await expect(page.locator('#translation-unavailable')).toBeVisible();
  await expect(page.locator('#translation-controls')).not.toBeVisible();
  expect(requests).toHaveLength(0);
});
