import { setLauncherLanguage } from './launcher-language.mjs';
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');

async function openLauncher(page) {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
}

test('tools page configures and runs file tools inline with a single-select rail', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => { localStorage.removeItem('MSW_TOOLS_PAGE_TOOL_V1'); });
  await page.evaluate(() => window.MSWNavigation.show('tools'));

  // S2/反馈1+2：右侧单选工具、左侧直接配置运行；不再有「打开工具」中间步骤。
  const rail = page.locator('#toolsRail [data-tools-select]');
  await expect(rail).toHaveCount(7);
  const ids = await rail.evaluateAll((nodes) => nodes.map((node) => node.dataset.toolsSelect));
  expect(ids).toEqual(['extractAudio', 'burnSubtitle', 'ffconcat', 'waveform', 'timestamps', 'compare', 'alignment']);
  await expect(page.locator('#toolsTitle')).toHaveText('实用工具');
  await expect(page.locator('[data-tool-entry]')).toHaveCount(0);
  // 单选导航不带复选框（区别于预制栏多选）。
  await expect(page.locator('#toolsRail input[type="checkbox"]')).toHaveCount(0);

  // 默认提取音频：面板可见、动作槽对应；切换保留草稿。
  await expect(page.locator('#toolboxExtractAudioPanel')).toBeVisible();
  await page.locator('#toolboxUtilityMediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('[data-tools-select="burnSubtitle"]').click();
  await expect(page.locator('#toolboxBurnSubtitlePanel')).toBeVisible();
  await expect(page.locator('#toolboxExtractAudioPanel')).toBeHidden();
  await page.locator('#toolboxBurnSubtitlePath').fill('D:\\Demo\\clip.srt');
  await page.locator('[data-tools-select="extractAudio"]').click();
  await expect(page.locator('#toolboxUtilityMediaPath')).toHaveValue('D:\\Demo\\clip.mp4');
  await page.locator('[data-tools-select="burnSubtitle"]').click();
  await expect(page.locator('#toolboxBurnSubtitlePath')).toHaveValue('D:\\Demo\\clip.srt');

  // 工具箱抽屉不再承载实用工具：无实用工具页签，抽屉保持关闭。
  await expect(page.locator('#toolboxDrawer')).toBeHidden();
  await expect(page.locator('#toolboxUtilitiesTabList')).toHaveCount(0);
  await expect(page.locator('#toolboxWaveformPanel')).toHaveCount(0);
});

test('settings page uses a right-side single-select group rail with deep links and memory', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => { localStorage.removeItem('MSW_SETTINGS_TAB_V1'); });
  await page.evaluate(() => window.MSWNavigation.show('settings'));

  // S2/反馈2：设置改为右侧单选分组（外观与语言/文件与输出/服务与连接/处理默认值/运行环境/缓存与诊断）。
  const tabs = page.locator('#settingsRail [data-settings-tab]');
  await expect(tabs).toHaveCount(6);
  const ids = await tabs.evaluateAll((nodes) => nodes.map((node) => node.dataset.settingsTab));
  expect(ids).toEqual(['appearance', 'files', 'connection', 'processing', 'runtime', 'cache']);
  await expect(page.locator('#settingsAppearancePanel')).toBeVisible();

  // 深链：LLM 配置锚点进入「服务与连接」分组。
  await page.evaluate(() => window.MSWLauncher.openSettings('llmSettingsSection'));
  await expect(page.locator('[data-settings-tab="connection"]')).toHaveClass(/active/);
  await expect(page.locator('#llmSettingsSection')).toBeVisible();
  // 深链：FFmpeg 锚点进入「运行环境」分组。
  await page.evaluate(() => window.MSWLauncher.openSettings('ffmpegSettingsSection'));
  await expect(page.locator('[data-settings-tab="runtime"]')).toHaveClass(/active/);
  await expect(page.locator('#ffmpegSettingsSection')).toBeVisible();

  // 分组记忆：切到「缓存与诊断」后离开再进入仍恢复。
  await page.locator('[data-settings-tab="cache"]').click();
  await expect(page.locator('#cacheSettingsSection')).toBeVisible();
  await page.evaluate(() => window.MSWNavigation.show('home'));
  await page.evaluate(() => window.MSWNavigation.show('settings'));
  await expect(page.locator('[data-settings-tab="cache"]')).toHaveClass(/active/);
  await expect(page.locator('#cacheSettingsSection')).toBeVisible();
});

test('language toggle saves only the language preference', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => {
    window.__saveCalls = [];
    const call = MSWLauncher.callBackend;
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'save_settings' || method === 'save_prefs') window.__saveCalls.push({ method, payload });
      return next(method, payload);
    };
  });

  // R5/F13：语言切换只保存语言，不携带识别表单/密钥（避免覆盖未确认草稿）。
  await setLauncherLanguage(page, 'en');
  await expect.poll(() => page.evaluate(() => window.__saveCalls.length)).toBe(1);
  const saves = await page.evaluate(() => window.__saveCalls);
  expect(saves[0].method).toBe('save_prefs');
  expect(saves[0].payload).toEqual({ guiLang: 'en' });
  await expect(page.locator('#interfaceLanguage')).toHaveValue('en');

  // 切回中文同样只保存语言。
  await setLauncherLanguage(page, 'zh');
  await expect.poll(() => page.evaluate(() => window.__saveCalls.length)).toBe(2);
  const second = await page.evaluate(() => window.__saveCalls[1]);
  expect(second.method).toBe('save_prefs');
  expect(second.payload).toEqual({ guiLang: 'zh' });
});

test('settings roundtrip preserves the prefab draft and scroll position', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.evaluate(() => MSWWorkflow.setCollapsed('asr', false));
  await page.evaluate(path => MSWQueue.addPaths([path]), 'D:\\Demo\\draft-clip.mp4');
  await page.evaluate(() => { document.getElementById('apiKey').value = 'sk-draft-key'; });

  // R5/§5.3：进入设置再返回，草稿与滚动位置保留。
  const scroller = page.locator('[data-page-id="prefab"] .page-scroll');
  await scroller.evaluate((node) => { node.scrollTop = 180; });
  await page.locator('[data-nav-page="settings"]').click();
  await page.mouse.move(600, 400); // 移开悬停，让折叠导航收起（展开层覆盖左缘内容）
  await expect(page.locator('#launcherSettingsTitle')).toBeVisible();
  await expect(page.locator('#batchQueue')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(page.locator('#batchQueue')).toBeVisible();
  await expect(page.locator('#batchQueue')).toContainText('draft-clip.mp4');
  await expect(page.locator('#apiKey')).toHaveValue('sk-draft-key');
  await expect(scroller).toBeDefined();
  const scrollTop = await scroller.evaluate((node) => node.scrollTop);
  expect(scrollTop).toBe(180);
});

test('cover cache clearing lives in settings with feedback', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWLauncher.openSettings('cacheSettingsSection'));

  // R3 顺延项/R5：缓存与诊断组提供封面缓存清理入口（运行环境分组内）。
  await expect(page.locator('#cacheSettingsSection')).toBeVisible();
  await page.locator('#clearCoverCache').click();
  await expect(page.locator('#clearCoverCacheStatus')).toHaveText('已清理 3 个封面缓存文件。');
  await expect.poll(() => page.evaluate(() => (window.__coverCacheClears || []).length)).toBe(1);
});

test('registry cleanup group renders real line breaks in the confirm dialog (调整2/3)', async ({ page }) => {
  await openLauncher(page);
  // 演示登记里放一条临时目录失效记录，预览才会给出候选并放出执行按钮。
  await page.evaluate(() => {
    window.__demoRegistry = [
      { path: 'D:\\Tmp\\stale.mosp', name: 'stale.mosp', dir: 'D:\\Tmp', exists: false, pinned: false, lastOpenedAt: '', modifiedAt: '', registeredAt: '', updatedAt: '2026-09-01T00:00:00+00:00', source: 'created', mediaName: '' },
      { path: 'D:\\Keep\\keep.mosp', name: 'keep.mosp', dir: 'D:\\Keep', exists: true, pinned: false, lastOpenedAt: '', modifiedAt: '2026-09-02T00:00:00+00:00', registeredAt: '', updatedAt: '2026-09-02T00:00:00+00:00', source: 'created', mediaName: '' },
    ];
    window.__demoRegistryTmpPaths = ['D:\\Tmp\\stale.mosp'];
  });
  await page.evaluate(() => window.MSWLauncher.openSettings('cacheSettingsSection'));

  // 调整2：清理按钮独立成组，预览按钮文案去省略号。
  const group = page.locator('#cacheSettingsSection .cache-tools');
  await expect(group).toBeVisible();
  await expect(group.locator('#previewRegistryCleanup')).toHaveText('检查失效记录');
  await expect(group.locator('#clearCoverCache')).toHaveCount(0); // 封面清理不在同组重复出现

  // 预览给出候选数后放出执行入口。
  await page.locator('#previewRegistryCleanup').click();
  await expect(page.locator('#registryCleanupStatus')).toContainText('1 条失效记录');
  await page.locator('#applyRegistryCleanup').click();

  // 调整3：确认文案是真实换行（pre-line 呈现），不出现字面「\n」。
  const message = page.locator('#batchConfirmMessage');
  await expect(message).toBeVisible();
  await expect(message).toHaveCSS('white-space', 'pre-line');
  const text = await message.textContent();
  expect(text).toContain('\n·');
  expect(text).not.toContain('\\n');
  await page.locator('#batchConfirmNo').click();
  await expect(message).toBeHidden();
});

test('guide paths match the current UI and avoid implementation terms', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWNavigation.show('guide'));

  // R5/F13：指南不再使用「Server 版」实现术语；按钮名与实际 UI 一致。
  const guideText = await page.locator('[data-page-id="guide"]').innerText();
  expect(guideText).not.toContain('Server 版');
  expect(guideText).toContain('打开所选工程');
  expect(guideText).toContain('启动空白编辑器');

  await page.locator('[data-goto-page="home"]').click();
  await expect(page.locator('#homeTitle')).toBeVisible();
  await page.evaluate(() => window.MSWNavigation.show('guide'));
  await page.locator('[data-goto-page="prefab"]').click();
  await expect(page.locator('#prefabOrderChip')).toBeVisible();
});
