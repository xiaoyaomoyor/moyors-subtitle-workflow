import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');

async function openLauncher(page) {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
}

test('all five pages live inside the shared page host (V03)', async ({ page }) => {
  await openLauncher(page);
  const pages = await page.evaluate(() => {
    const host = document.querySelector('.page-host');
    return Array.from(document.querySelectorAll('.page')).map((node) => ({
      id: node.dataset.pageId,
      inHost: node.parentElement === host,
    }));
  });
  expect(pages.map((item) => item.id)).toEqual(['home', 'prefab', 'tools', 'guide', 'settings']);
  for (const item of pages) expect(item.inHost, `${item.id} in page-host`).toBe(true);
});

test('prefab footer belongs to the prefab page only (V01)', async ({ page }) => {
  await openLauncher(page);
  const footerInfo = await page.evaluate(() => {
    const footer = document.querySelector('footer.prefab-footer');
    return {
      inPrefab: footer.closest('.page')?.dataset.pageId === 'prefab',
      bodyDirectChild: footer.parentElement === document.querySelector('.app-body'),
      hostDirectChild: footer.parentElement === document.querySelector('.page-host'),
    };
  });
  expect(footerInfo.inPrefab).toBe(true);
  expect(footerInfo.bodyDirectChild).toBe(false);
  expect(footerInfo.hostDirectChild).toBe(false);

  // 其他页面激活时，预制操作栏按钮不可见。
  for (const id of ['home', 'tools', 'guide', 'settings']) {
    await page.evaluate((target) => window.MSWNavigation.show(target), id);
    await expect(page.locator('#start')).toBeHidden();
    await expect(page.locator('#startBatch')).toBeHidden();
  }
});

test('module rail sits inside prefab-wrap beside the config column (V02)', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  const info = await page.evaluate(() => {
    const rail = document.querySelector('.prefab-rail');
    const wrap = document.querySelector('.prefab-wrap');
    const main = document.querySelector('.prefab-main');
    const railBox = rail.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    return {
      inWrap: rail.parentElement === wrap,
      mainInWrap: main.parentElement === wrap,
      rightOfMain: railBox.left >= mainBox.right - 1,
      width: Math.round(railBox.width),
    };
  });
  expect(info.inWrap).toBe(true);
  expect(info.mainInWrap).toBe(true);
  expect(info.rightOfMain).toBe(true);
  expect(info.width).toBeGreaterThanOrEqual(200);
});

test('all pages share the same content origin and pinned footers', async ({ page }) => {
  await openLauncher(page);
  const rows = [];
  for (const id of ['home', 'prefab', 'tools', 'guide', 'settings']) {
    await page.evaluate((target) => { window.MSWNavigation.show(target); }, id);
    await page.waitForTimeout(80);
    rows.push(await page.evaluate((target) => {
      window.MSWNavigation.show(target);
      const section = document.querySelector(`.page[data-page-id="${target}"]`);
      const scroll = section.querySelector('.page-scroll');
      const footer = section.querySelector('.page-actions');
      return {
        id: target,
        left: scroll ? Math.round(scroll.getBoundingClientRect().left) : null,
        footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : null,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        viewport: window.innerHeight,
      };
    }, id));
  }
  const lefts = new Set(rows.map((row) => row.left));
  expect(lefts.size).toBe(1);
  for (const row of rows) expect(row.overflowX, `${row.id} no horizontal overflow`).toBe(false);
  for (const row of rows.filter((item) => item.footerBottom !== null)) {
    expect(Math.abs(row.footerBottom - row.viewport), `${row.id} footer pinned to viewport bottom`).toBeLessThan(2);
  }
});

test('960px compact layout keeps actions reachable and rail behind a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await openLauncher(page);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));

  // 主操作仍可见；无页面级横向溢出。
  await expect(page.locator('#start')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);

  // 模块栏默认收起为抽屉（移出视口），切换按钮可用。
  const railOffscreen = await page.evaluate(() => {
    const box = document.querySelector('.prefab-rail').getBoundingClientRect();
    return box.left >= window.innerWidth || box.width === 0 || getComputedStyle(document.querySelector('.prefab-rail')).transform !== 'none';
  });
  expect(railOffscreen).toBe(true);
  await expect(page.locator('#railToggle')).toBeVisible();

  // 打开抽屉 → 模块可见 → Esc 关闭。
  await page.locator('#railToggle').click();
  await expect(page.locator('#prefabRail .rail-item').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#railBackdrop')).toHaveClass(/hidden/);
});

test('collapsed nav keeps icons on a fixed slot across hover expansion (S1)', async ({ page }) => {
  await openLauncher(page);
  await page.mouse.move(640, 400); // 移开悬停，确保折叠态
  await page.waitForTimeout(240);
  const collapsed = await page.evaluate(() => {
    const icon = document.querySelector('.nav-item .nav-item-icon');
    const rect = icon.getBoundingClientRect();
    return {
      iconCenter: rect.left + rect.width / 2,
      pageLeft: document.querySelector('.page-host').getBoundingClientRect().left,
      footerCenter: (() => {
        const node = document.querySelector('.nav-footer-short');
        const box = node.getBoundingClientRect();
        return box.left + box.width / 2;
      })(),
    };
  });
  await page.mouse.move(24, 400); // 悬停展开
  await page.waitForTimeout(240);
  const expanded = await page.evaluate(() => {
    const icon = document.querySelector('.nav-item .nav-item-icon');
    const rect = icon.getBoundingClientRect();
    return {
      iconCenter: rect.left + rect.width / 2,
      pageLeft: document.querySelector('.page-host').getBoundingClientRect().left,
    };
  });
  await page.mouse.move(640, 400);

  // 图标中心对齐 64px 栏中心（32px），折叠/展开一致；展开不推动正文。
  expect(Math.abs(collapsed.iconCenter - 32)).toBeLessThan(1.5);
  expect(Math.abs(expanded.iconCenter - 32)).toBeLessThan(1.5);
  expect(Math.abs(collapsed.iconCenter - expanded.iconCenter)).toBeLessThan(1);
  expect(Math.abs(collapsed.pageLeft - expanded.pageLeft)).toBeLessThan(0.5);
  // 折叠态「MSW」底标与图标同一栅格（近似居中）。
  expect(Math.abs(collapsed.footerCenter - 32)).toBeLessThan(8);
});

test('module card head uses left arrow, index, title order and collapses on head click (S1)', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => { localStorage.removeItem('MSW_LAUNCHER_MODULES_V1'); });
  await page.reload();
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.waitForFunction(() => document.querySelectorAll('[data-module-card="media"]').length > 0);

  const order = await page.evaluate(() => {
    const head = document.querySelector('[data-module-card="media"] .module-head');
    return Array.from(head.children).map((node) => node.className.split(' ')[0]);
  });
  expect(order[0]).toBe('module-collapse');
  expect(order[1]).toBe('module-index');

  const button = page.locator('[data-module-card="media"] .module-collapse');
  await expect(button).toHaveCSS('width', '28px');
  await expect(button).toHaveCSS('height', '28px');

  // 标题空白区点击同样折叠；折叠箭头按钮仍是键盘焦点控件。
  const wasCollapsed = await page.evaluate(() => document.querySelector('[data-module-card="media"]').classList.contains('collapsed'));
  await page.locator('[data-module-card="media"] .module-head h2').click({ position: { x: 40, y: 8 } });
  await expect(page.locator('[data-module-card="media"]')).toHaveClass(new RegExp(wasCollapsed ? '(?!collapsed)' : 'collapsed'));
  await page.locator('[data-module-card="media"] .module-collapse').focus();
  await expect(page.locator('[data-module-card="media"] .module-collapse')).toBeFocused();
});

test('pinned recent card shows an SVG pin with accessible label; idle status is collapsed (S1)', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWNavigation.show('home'));
  await page.waitForFunction(() => document.querySelectorAll('.recent-card').length > 0);

  const pin = await page.evaluate(() => {
    const node = document.querySelector('.recent-card.pinned .recent-pin');
    if (!node) return null;
    return { hasSvg: Boolean(node.querySelector('svg')), label: node.getAttribute('aria-label') };
  });
  expect(pin).not.toBeNull();
  expect(pin.hasSvg).toBe(true);
  expect(pin.label).toBe('已固定');

  // 闲置状态不再常驻「就绪」：空消息收起，仍保留 aria-live 语义。
  const status = await page.evaluate(() => {
    const node = document.getElementById('status');
    return { text: node.textContent, display: getComputedStyle(node).display, role: node.getAttribute('role') };
  });
  expect(status.text).toBe('');
  expect(status.display).toBe('none');
  expect(status.role).toBe('status');
});
