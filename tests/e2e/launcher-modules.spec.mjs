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
  // 演示模式已保存过后处理计划：先以控件状态初始化模块勾选。

  // 后处理步骤由 postprocess.js 在未就绪时打回（例如缺少文稿路径的文稿匹配），
  // 打回后「转写后自动处理」卡显示并展开以承载配置引导，模块保持未启用。
  // 未就绪的 LLM 步骤被 postprocess.js 打回：checkbox 回到未勾选并跳转
  // 「更多设置」页的 LLM 连接配置（旧版为弹窗，横向工作台为页面导航）。
  const proofread = page.locator('#prefabRail input[data-module-id="proofread"]');
  await proofread.click();
  await expect(proofread).not.toBeChecked();
  await expect(page.locator('#llmSettingsSection')).toBeVisible();
  // 返回预制页：打回的引导状态保留——「转写后自动处理」卡显示并展开。
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await expect(page.locator('[data-module-card="postprocess"]')).toBeVisible();
  await expect(page.locator('[data-module-card="postprocess"]')).not.toHaveClass(/collapsed/);
  await expect.poll(() => page.evaluate(() => MSWModules.isEnabled('proofread'))).toBe(false);
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
