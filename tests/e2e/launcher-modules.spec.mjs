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
  await expect(page.locator('.module-index').first()).toHaveText('01');
  await expect(page.locator('#prefabOrderChip')).toHaveText('处理顺序：媒体 → 波形');

  // 取消勾选不清空草稿：重新勾选后服务与参数保留。
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await expect(page.locator('[data-module-card="asr"]')).toBeVisible();
  await expect(page.locator('#provider')).toHaveValue(providerBefore);
  await expect(page.locator('#prefabOrderChip')).toHaveText('处理顺序：媒体 → 波形 → 识别');
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

test('postprocess module toggles sync with auto step checkboxes', async ({ page }) => {
  await openPrefab(page);

  // R4/F11：未就绪的步骤不再打回取消——保留勾选并标记「待配置」，
  // 配置在本模块补齐；开始前由方案预检统一校验，也不自动跳转设置页。
  const proofread = page.locator('#prefabRail input[data-module-id="proofread"]');
  await proofread.click();
  await expect(proofread).toBeChecked();
  await expect.poll(() => page.evaluate(() => MSWModules.isEnabled('proofread'))).toBe(true);
  await expect(page.locator('[data-auto-step-row="proofread"]')).toHaveClass(/needs-config/);
  await expect(page.locator('[data-module-card="postprocess"]')).toBeVisible();
  await expect(page.locator('#llmSettingsSection')).toBeHidden();

  // 供应商就绪后行状态转为就绪，勾选与配置保留。
  await page.evaluate(() => {
    const provider = window.MSWLauncher.config.postprocessProviders.find((item) => item.id === 'deepseek');
    Object.assign(provider, { verified: true, hasApiKey: true, hasBaseUrl: true, hasModel: true });
    document.getElementById('autoStepProofread').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('[data-auto-step-row="proofread"]')).not.toHaveClass(/needs-config/);
  await expect(proofread).toBeChecked();
});

test('input mode switches labels between media and project/subtitle', async ({ page }) => {
  await openPrefab(page);

  await expect(page.locator('#mediaTitle')).toHaveText('媒体与输出');
  await expect(page.locator('#dropZone')).toHaveText('拖入音频/视频文件，或点击选择。');

  await page.locator('#inputModeProject').click();
  await expect(page.locator('#mediaTitle')).toHaveText('输入工程／字幕');
  await expect(page.locator('#dropZone')).toContainText('.mosp');
  await expect(page.locator('label[for="mediaPath"]')).toHaveText('工程或字幕文件');

  // 切换保留表单草稿与模式记忆。
  await page.locator('#mediaPath').fill('D:\\Demo\\source.mosp');
  await page.locator('#inputModeMedia').click();
  await expect(page.locator('#mediaTitle')).toHaveText('媒体与输出');
  await expect(page.locator('#mediaPath')).toHaveValue('D:\\Demo\\source.mosp');
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
