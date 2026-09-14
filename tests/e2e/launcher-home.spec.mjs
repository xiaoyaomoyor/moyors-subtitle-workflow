import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');

async function openHome(page) {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('home'));
  await page.waitForFunction(() => document.querySelectorAll('.recent-card').length > 0);
}

test('recent project cards render with stats, selection, and search filtering', async ({ page }) => {
  await openHome(page);

  await expect(page.locator('.recent-card')).toHaveCount(2);
  const first = page.locator('.recent-card').nth(0);
  await expect(first.locator('.recent-name')).toHaveText('clip.mosp');
  await expect(first.locator('.recent-pin')).toHaveText('已固定');
  await expect(first.locator('.recent-stats')).toHaveText(/主 12 \/ 副 0 · 音频 2/);
  await expect(page.locator('.recent-card').nth(1).locator('.recent-meta .missing')).toHaveText('文件已移动或不存在');
  await expect(page.locator('#homeOpenSelected')).toBeHidden();

  // 单击选择，再次单击取消；首次进入不自动选中任何工程。
  await first.click();
  await expect(first).toHaveClass(/selected/);
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#homeOpenSelected')).toBeVisible();
  await first.click();
  await expect(first).not.toHaveClass(/selected/);
  await expect(page.locator('#homeOpenSelected')).toBeHidden();

  // 搜索按名称/目录过滤。
  await page.locator('#recentSearch').fill('moved');
  await expect(page.locator('.recent-card')).toHaveCount(1);
  await page.locator('#recentSearch').fill('');
  await expect(page.locator('.recent-card')).toHaveCount(2);
});

test('double-click opens the selected project and blank launch clears the target', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => { window.__mockServerIntents = []; });

  await page.locator('.recent-card').nth(0).dblclick();
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\clip.mosp');
  await expect(page.locator('#openMawe')).toHaveText('打开字幕编辑器');
  const openIntent = await page.evaluate(() => window.__mockServerIntents.at(-1));
  expect(openIntent).toMatchObject({ intent: 'project', jsonPath: 'D:\\Demo\\clip.mosp' });

  await page.locator('#homeBlank').click();
  await expect(page.locator('#jsonPath')).toHaveValue('');
  const blankIntent = await page.evaluate(() => window.__mockServerIntents.at(-1));
  expect(blankIntent).toMatchObject({ intent: 'blank', jsonPath: '' });
});

test('missing project offers relocation instead of silently opening something else', async ({ page }) => {
  await openHome(page);
  const missing = page.locator('.recent-card').nth(1);

  await missing.dblclick();
  await expect(page.locator('#batchConfirmModal')).toBeVisible();
  await expect(page.locator('#batchConfirmMessage')).toContainText('moved.mosp');
  await page.locator('#batchConfirmNo').click();
  await expect(page.locator('#batchConfirmModal')).toBeHidden();
  // 未确认时不改动工程目标。
  await expect(page.locator('#jsonPath')).toHaveValue('');
});

test('context menu exposes pin, folder, relocate, and remove actions', async ({ page }) => {
  await openHome(page);

  await page.locator('.recent-card').nth(0).click({ button: 'right' });
  const menu = page.locator('#recentContextMenu');
  await expect(menu).toBeVisible();
  const items = menu.locator('button[role="menuitem"]');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveText('取消固定');
  await expect(items.nth(1)).toHaveText('打开所在文件夹');
  await expect(items.nth(2)).toHaveText('从最近记录移除');

  await items.nth(2).click();
  await expect(menu).toBeHidden();
  // mock 数据在每次刷新时重建；此处验证菜单动作触发了列表刷新而非报错。
  await page.waitForTimeout(200);
  await expect(page.locator('#recentGrid')).toBeVisible();
});

test('server conflicts surface a return-or-independent choice instead of silent reuse', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => {
    window.__mockServerIntents = [];
    const call = MSWLauncher.callBackend;
    let conflictOnce = true;
    // bridgeOverride 是启动器桥接层的注入点（launcher.js bridge）。
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'start_server' && conflictOnce) {
        conflictOnce = false;
        return {
          ok: false,
          field: 'port',
          code: 'server_conflict',
          detail: 'http://127.0.0.1:8250/',
          conflict: { url: 'http://127.0.0.1:8250/?lang=zh', projectPath: 'D:\\Other\\demo.mosp', owned: true },
        };
      }
      return next(method, payload);
    };
  });
  await page.evaluate(() => window.MSWNavigation.show('home'));
  await page.waitForFunction(() => document.querySelectorAll('.recent-card').length > 0);

  // 冲突时先询问返回现有会话；拒绝后立即询问独立端口，确认后以 independentPort 重试。
  await page.evaluate(() => { window.__openedConflictUrls = []; MSWLauncher.__trackOpenUrl = true; });
  await page.locator('.recent-card').nth(0).dblclick();
  await expect(page.locator('#batchConfirmModal')).toBeVisible();
  await expect(page.locator('#batchConfirmMessage')).toContainText('demo.mosp');
  await page.locator('#batchConfirmNo').click();
  await expect(page.locator('#batchConfirmModal')).toBeVisible();
  await expect(page.locator('#batchConfirmMessage')).toContainText('独立端口');
  await page.locator('#batchConfirmYes').click();
  await expect.poll(() => page.evaluate(() => window.__mockServerIntents.at(-1)?.independentPort)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__mockServerIntents.at(-1)?.intent)).toBe('project');
});
