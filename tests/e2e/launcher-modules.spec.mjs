import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');

async function openPrefab(page) {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => { localStorage.removeItem('MSW_LAUNCHER_MODULES_V1'); localStorage.removeItem('MSW_LAUNCHER_MODULE_COLLAPSE_V1'); });
  await page.reload();
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.waitForFunction(() => document.querySelectorAll('#prefabRail .rail-item').length > 0);
}

test('module rail groups modules and keeps media fixed', async ({ page }) => {
  await openPrefab(page);

  const groups = page.locator('#prefabRail .rail-group-title');
  await expect(groups).toHaveText(['输入与分析', '字幕整理', '语言处理', '高级', '运行反馈']);

  const mediaCheck = page.locator('#prefabRail input[data-module-id="media"]');
  await expect(mediaCheck).toBeChecked();
  await expect(mediaCheck).toBeDisabled();
});

test('toggling ASR hides its card, keeps drafts, and renumbers visible cards', async ({ page }) => {
  await openPrefab(page);

  const asrCheck = page.locator('#prefabRail input[data-module-id="asr"]');
  // R4/F09：全新方案默认仅媒体＋波形，识别按需开启。
  await expect(asrCheck).not.toBeChecked();
  await expect(page.locator('[data-module-card="asr"]')).toBeHidden();
  await asrCheck.check();
  await expect(page.locator('[data-module-card="asr"]')).toBeVisible();
  const providerBefore = await page.locator('#provider').inputValue();

  await asrCheck.uncheck();
  await expect(page.locator('[data-module-card="asr"]')).toBeHidden();
  // 后处理默认全关，卡也应隐藏；序号只剩媒体 01。
  await expect(page.locator('[data-module-card="postprocess"]')).toBeHidden();
  await expect(page.locator('[data-module-card="media"] .module-index')).toHaveText('01');
  await expect(page.locator('#prefabOrderChip')).toHaveText('处理顺序：0 个任务 → 波形');

  // 取消勾选不清空草稿：重新勾选后服务与参数保留。
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await expect(page.locator('[data-module-card="asr"]')).toBeVisible();
  await expect(page.locator('#provider')).toHaveValue(providerBefore);
  await expect(page.locator('#prefabOrderChip')).toHaveText('处理顺序：0 个任务 → 波形 → 识别');
});

test('upgrading keeps explicitly saved module choices (R6)', async ({ page }) => {
  // 旧配置升级：存储里已保存的 asr=true 保持用户选择；未存的模块按新默认补齐。
  await page.addInitScript(() => {
    localStorage.setItem('MSW_LAUNCHER_MODULES_V1', JSON.stringify({ version: 1, enabled: { media: true, waveform: false, asr: true } }));
  });
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.waitForFunction(() => document.querySelectorAll('#prefabRail .rail-item').length > 0);

  const asr = page.locator('#prefabRail input[data-module-id="asr"]');
  const waveform = page.locator('#prefabRail input[data-module-id="waveform"]');
  await expect(asr).toBeChecked();
  await expect(page.locator('[data-module-card="asr"]')).toBeVisible();
  await expect(waveform).not.toBeChecked();
  // 未存储的模块按新默认（后处理全关）补齐。
  await expect(page.locator('#prefabRail input[data-module-id="translate"]')).not.toBeChecked();
});

test('collapsing a module card hides its body without disabling it', async ({ page }) => {
  await openPrefab(page);

  const card = page.locator('[data-module-card="media"]');
  await expect(card.locator('.module-body .drop-zone')).toBeVisible();
  await card.locator('.module-collapse').click();
  await expect(card).toHaveClass(/collapsed/);
  await expect(card.locator('.module-collapse')).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.module-body .drop-zone')).toBeHidden();
  // 折叠只改显示：媒体模块仍启用。
  await expect(page.locator('#prefabRail input[data-module-id="media"]')).toBeChecked();
  await card.locator('.module-collapse').click();
  await expect(card.locator('.module-body .drop-zone')).toBeVisible();
});

test('postprocess modules own their enabled state and config badge', async ({ page }) => {
  await openPrefab(page);

  // R4/F11：未就绪的步骤不再打回取消——保留勾选并标记「待配置」，
  // 配置在本模块补齐；开始前由方案预检统一校验，也不自动跳转设置页。
  const proofread = page.locator('#prefabRail input[data-module-id="proofread"]');
  await proofread.click();
  await expect(proofread).toBeChecked();
  await expect.poll(() => page.evaluate(() => MSWModules.isEnabled('proofread'))).toBe(true);
  await expect(page.locator('[data-module-card="proofread"] .module-status')).toHaveClass(/invalid/);
  // S4：勾选即出现该模块的独立配置卡（LLM 卡内含提示词与服务摘要行）。
  await expect(page.locator('[data-module-card="proofread"]')).toBeVisible();
  await page.locator('[data-module-card="proofread"] .module-collapse').click();
  await expect(page.locator('#postprocessPromptProofread')).toBeVisible();
  await expect(page.locator('#llmSettingsSection')).toBeHidden();

  // 供应商就绪后行状态转为就绪，勾选与配置保留。
  await page.evaluate(() => {
    const provider = window.MSWLauncher.config.postprocessProviders.find((item) => item.id === 'deepseek');
    Object.assign(provider, { verified: true, hasApiKey: true, hasBaseUrl: true, hasModel: true });
    document.dispatchEvent(new CustomEvent('mswmodules'));
  });
  await expect(page.locator('[data-module-card="proofread"] .module-status')).not.toHaveClass(/invalid/);
  await expect(proofread).toBeChecked();
});

test('mixed input keeps one title and automatically counts tasks', async ({ page }) => {
  await openPrefab(page);
  await page.evaluate(() => MSWQueue.addPaths(['D:/Demo/source.mosp', 'D:/Demo/audio.mp3']));
  await expect(page.locator('#mediaTitle')).toHaveText('输入媒体/工程/字幕');
  await expect(page.locator('#batchQueueCount')).toHaveText('2 个文件 · 2 个任务');
  await expect(page.locator('#inputModeProject')).toHaveCount(0);
});

test('page switching keeps module drafts and collapse state', async ({ page }) => {
  await openPrefab(page);
  await page.locator('[data-module-card="media"] .module-collapse').click();
  await page.locator('#prefabRail input[data-module-id="asr"]').uncheck();

  await page.evaluate(() => window.MSWNavigation.show('tools'));
  await page.evaluate(() => window.MSWNavigation.show('prefab'));

  await expect(page.locator('[data-module-card="media"]')).toHaveClass(/collapsed/);
  await expect(page.locator('[data-module-card="asr"]')).toBeHidden();
});
