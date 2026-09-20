import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');

async function openHome(page) {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('home'));
  await page.waitForFunction(() => document.querySelectorAll('.recent-card').length > 0);
  // 封面/统计为按需异步：等待首个图片封面就绪，避免与后续断言竞态。
  await page.waitForFunction(() => document.querySelectorAll('.recent-cover-image').length > 0);
}

function cardOf(page, name) {
  // S3：同一工程可在最近/全部两组各有一张卡——按组限定避免 strict 冲突。
  return page.locator(`#recentGrid .recent-card[data-path$="${name}"]`);
}

test('recent cards show distinct real covers, media names, and state placeholders', async ({ page }) => {
  await openHome(page);

  // H01：两个不同视频显示不同画面；媒体文件名随统计返回。
  const clipCover = cardOf(page, 'clip.mosp').locator('.recent-cover');
  const introCover = cardOf(page, 'intro.mosp').locator('.recent-cover');
  await expect(clipCover).toHaveAttribute('data-cover-state', 'image');
  await expect(introCover).toHaveAttribute('data-cover-state', 'image');
  const [clipSrc, introSrc] = await Promise.all([
    clipCover.locator('.recent-cover-image').getAttribute('src'),
    introCover.locator('.recent-cover-image').getAttribute('src'),
  ]);
  expect(clipSrc).not.toBe(introSrc);

  await expect(cardOf(page, 'clip.mosp').locator('.recent-media')).toHaveText('clip.mp4');
  await expect(cardOf(page, 'intro.mosp').locator('.recent-media')).toHaveText('intro.mp4');
  await expect(cardOf(page, 'clip.mosp').locator('.recent-stats')).toHaveText(/主 12 \/ 副 0 · 音频 2/);

  // 缺失工程不发起封面请求，直接显示工程缺失占位。
  await expect(cardOf(page, 'moved.mosp').locator('.recent-cover')).toHaveAttribute('data-cover-state', 'project_missing');
  await expect(cardOf(page, 'moved.mosp').locator('.recent-meta .missing')).toHaveText('文件已移动或不存在');
  const thumbTargets = await page.evaluate(() => window.__thumbRequests);
  expect(thumbTargets.some((item) => item.includes('moved.mosp'))).toBe(false);
});

test('stats and cover requests are cached and deduplicated across searches', async ({ page }) => {
  await openHome(page);
  await page.waitForFunction(() => (window.__statsRequests || []).length >= 2 && (window.__thumbRequests || []).length >= 2);

  // H05：搜索过滤与清除不重复请求统计/封面（按工程版本缓存 + 请求去重 + 输入防抖）。
  await page.locator('#recentSearch').fill('intro');
  await page.waitForTimeout(400);
  await page.locator('#recentSearch').fill('');
  await page.waitForTimeout(400);
  const counts = await page.evaluate(() => ({
    stats: window.__statsRequests.length,
    thumbs: window.__thumbRequests.length,
  }));
  // S3：全部工程组多一条登记项 old-take（同样按需请求一次）；搜索往返仍不重复请求。
  expect(counts.stats).toBe(3);
  expect(counts.thumbs).toBe(3);
});

test('selection survives reload with both style and accessibility state', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('.recent-card.selected')).toHaveCount(0);

  const clip = cardOf(page, 'clip.mosp');
  await clip.click();
  await expect(clip).toHaveClass(/selected/);
  await expect(clip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#homeTarget')).toHaveText('当前目标：clip.mosp');

  // H02：刷新后样式与 aria-pressed 同时恢复。
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.recent-card').length > 0);
  const restored = cardOf(page, 'clip.mosp');
  await expect(restored).toHaveClass(/selected/);
  await expect(restored).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#homeOpenSelected')).toBeVisible();
  await expect(page.locator('#homeTarget')).toHaveText('当前目标：clip.mosp');
});

test('search hiding the target clears it instead of opening a hidden project', async ({ page }) => {
  await openHome(page);
  await cardOf(page, 'clip.mosp').click();
  await expect(page.locator('#homeOpenSelected')).toBeVisible();

  // H03：筛选隐藏当前目标 → 清除选择，表单目标一并清空。
  await page.locator('#recentSearch').fill('moved');
  await page.waitForFunction(() => document.querySelectorAll('.recent-card').length === 1);
  await expect(page.locator('.recent-card.selected')).toHaveCount(0);
  await expect(page.locator('#homeOpenSelected')).toBeHidden();
  await expect(page.locator('#homeTarget')).toBeHidden();
  await expect(page.locator('#jsonPath')).toHaveValue('');
});

test('double-click opens the selected project and blank launch clears the target', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => { window.__mockServerIntents = []; });

  await cardOf(page, 'clip.mosp').dblclick();
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\clip.mosp');
  const openIntent = await page.evaluate(() => window.__mockServerIntents.at(-1));
  expect(openIntent).toMatchObject({ intent: 'project', jsonPath: 'D:\\Demo\\clip.mosp' });

  await page.locator('#homeBlank').click();
  await expect(page.locator('#jsonPath')).toHaveValue('');
  const blankIntent = await page.evaluate(() => window.__mockServerIntents.at(-1));
  expect(blankIntent).toMatchObject({ intent: 'blank', jsonPath: '' });
  // 空白启动后目标徽标回到隐藏，主按钮不再指向旧工程。
  await expect(page.locator('#homeOpenSelected')).toBeHidden();
});

test('browse sets the unified target; the port form stays collapsed until expanded', async ({ page }) => {
  await openHome(page);

  // H04：端口大表单默认收起，三个清晰操作常驻。
  const serverCard = page.locator('#serverCard');
  await expect(serverCard).toHaveClass(/collapsed/);
  await expect(page.locator('#jsonPath')).toBeHidden();
  await expect(page.locator('#homeBrowse')).toBeVisible();
  await expect(page.locator('#homeBlank')).toBeVisible();

  await page.locator('#homeBrowse').click();
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\project.json');
  // 浏览到的目标显示在徽标上；不在最近列表中 → 不伪造卡片选中。
  await expect(page.locator('#homeTarget')).toHaveText('当前目标：project.json');
  await expect(page.locator('.recent-card.selected')).toHaveCount(0);
  await expect(page.locator('#homeOpenSelected')).toBeVisible();

  await page.locator('#serverToggle').click();
  await expect(serverCard).not.toHaveClass(/collapsed/);
  await expect(page.locator('#jsonPath')).toBeVisible();
  await expect(page.locator('#port')).toBeVisible();
});

test('missing project offers relocation instead of silently opening something else', async ({ page }) => {
  await openHome(page);
  const missing = cardOf(page, 'moved.mosp');

  await missing.dblclick();
  await expect(page.locator('#batchConfirmModal')).toBeVisible();
  await expect(page.locator('#batchConfirmMessage')).toContainText('moved.mosp');
  await page.locator('#batchConfirmNo').click();
  await expect(page.locator('#batchConfirmModal')).toBeHidden();
  // 未确认时不改动工程目标。
  await expect(page.locator('#jsonPath')).toHaveValue('');
});

test('context menu exposes open, pin, folder, cover refresh, and remove actions', async ({ page }) => {
  await openHome(page);

  await cardOf(page, 'clip.mosp').click({ button: 'right' });
  const menu = page.locator('#recentContextMenu');
  await expect(menu).toBeVisible();
  const items = menu.locator('button[role="menuitem"]');
  await expect(items).toHaveCount(5);
  await expect(items.nth(0)).toHaveText('打开工程');
  await expect(items.nth(1)).toHaveText('取消固定');
  await expect(items.nth(2)).toHaveText('打开所在文件夹');
  await expect(items.nth(3)).toHaveText('刷新封面');
  await expect(items.nth(4)).toHaveText('从最近记录移除');

  // H01：刷新封面绕过缓存重新提取（mock 记录 refresh: 前缀）。
  await items.nth(3).click();
  await expect(menu).toBeHidden();
  await page.waitForFunction(() => (window.__thumbRequests || []).some((item) => item.startsWith('refresh:')));
});

test('repeated right-clicks replace the menu without stale listeners', async ({ page }) => {
  await openHome(page);
  const cards = page.locator('.recent-card');
  const total = await cards.count();

  // S1/§3.1：旧实现的 once dismiss 监听会误关后续菜单（1、0、0…）；
  // 现在同卡/跨卡连续右键 20 次每次恰好一个菜单。
  for (let i = 0; i < 20; i++) {
    await cards.nth(i < 10 ? 0 : (i % Math.min(3, total))).click({ button: 'right' });
    await expect(page.locator('#recentContextMenu')).toHaveCount(1);
  }

  // Esc 关闭并把焦点还给卡片；菜单自身上再次右键只关闭不重开。
  await cards.first().focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#recentContextMenu')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.classList?.contains('recent-card'))).toBe(true);

  await cards.first().click({ button: 'right' });
  const box = await page.locator('#recentContextMenu').boundingBox();
  await page.mouse.click(box.x + 8, box.y + 6, { button: 'right' });
  await expect(page.locator('#recentContextMenu')).toHaveCount(0);

  // 键盘唤起（Shift+F10）聚焦首项，方向键可导航，Enter 执行打开。
  await cards.first().focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('#recentContextMenu')).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('menuitem');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#recentContextMenu')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#recentContextMenu')).toHaveCount(0);

  // 小视口（缩放/窄窗场景）下菜单元素收敛在可视区域内。
  await page.setViewportSize({ width: 900, height: 600 });
  await cards.first().click({ button: 'right', position: { x: 6, y: 6 } });
  const small = await page.locator('#recentContextMenu').boundingBox();
  expect(small.x).toBeGreaterThanOrEqual(0);
  expect(small.y).toBeGreaterThanOrEqual(0);
  expect(small.x + small.width).toBeLessThanOrEqual(900);
  expect(small.y + small.height).toBeLessThanOrEqual(600);
  await page.keyboard.press('Escape');
});

test('all-projects group registers beyond the recent list and stays in sync', async ({ page }) => {
  await openHome(page);
  await page.waitForFunction(() => document.querySelectorAll('#allGrid .recent-card').length > 0);

  // S3/§5.1：两组独立折叠；全部工程包含最近视图之外的登记项（old-take.mosp）。
  const names = await page.evaluate(() => ({
    recent: Array.from(document.querySelectorAll('#recentGrid .recent-name')).map((n) => n.textContent),
    all: Array.from(document.querySelectorAll('#allGrid .recent-name')).map((n) => n.textContent),
  }));
  expect(names.all).toEqual(expect.arrayContaining(['clip.mosp', 'intro.mosp', 'old-take.mosp']));
  expect(names.recent).not.toContain('old-take.mosp');
  expect(await page.locator('#allGroupTitle .home-group-label').textContent()).toContain('（3）');

  // 同一工程两组出现：选择状态同步到两张卡（选择/图钉/封面按路径同步）。
  await page.locator('#allGrid .recent-card').first().click();
  expect(await page.locator('.recent-card.selected').count()).toBe(2);

  // 图钉在封面固定角落（不在信息区显示文字徽标）。
  const pin = await page.evaluate(() => {
    const card = document.querySelector('#allGrid .recent-card.pinned');
    const pinNode = card?.querySelector('.recent-cover .recent-pin');
    return { inCover: Boolean(pinNode), label: pinNode?.getAttribute('aria-label') };
  });
  expect(pin.inCover).toBe(true);
  expect(pin.label).toBe('已固定');
});

test('home survives non-overlapping sets and an all-stale catalog (T5)', async ({ page }) => {
  await openHome(page);

  // T5/§10：非重叠集合——最近 {A,B}、全部 {C,D}（全失效）；封面与选择互不串扰。
  await page.evaluate(() => {
    window.__demoRegistry = [
      { path: 'D:\\Stale\\gone-1.mosp', name: 'gone-1.mosp', dir: 'D:\\Stale', exists: false, pinned: false, lastOpenedAt: '', modifiedAt: '', registeredAt: '', updatedAt: '2026-09-01T00:00:00+00:00', source: 'created', mediaName: '' },
      { path: 'D:\\Stale\\gone-2.mosp', name: 'gone-2.mosp', dir: 'D:\\Stale', exists: false, pinned: false, lastOpenedAt: '', modifiedAt: '', registeredAt: '', updatedAt: '2026-09-02T00:00:00+00:00', source: 'created', mediaName: '' },
    ];
    MSWProjectHome.refresh();
  });
  await page.waitForFunction(() => document.querySelectorAll('#allGrid .recent-card').length === 2);
  // 最近组仍有自己的有效卡（clip/intro），全部组全失效互不影响。
  await expect(page.locator('#recentGrid .recent-card').first()).toBeVisible();
  await expect(page.locator('#allGrid .recent-cover[data-cover-state="project_missing"]')).toHaveCount(2);
  // 非重叠：全部组不含最近组的工程。
  const overlap = await page.evaluate(() => {
    const recent = new Set(Array.from(document.querySelectorAll('#recentGrid .recent-card')).map((c) => c.dataset.path));
    return Array.from(document.querySelectorAll('#allGrid .recent-card')).some((c) => recent.has(c.dataset.path));
  });
  expect(overlap).toBe(false);
  // 失效卡的封面不进入观察请求。
  const thumbCalls = await page.evaluate(async () => {
    window.__t5Thumbs = [];
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'get_recent_project_thumbnail') window.__t5Thumbs.push(payload.path);
      return next(method, payload);
    };
    MSWProjectHome.refresh();
    await new Promise((r) => setTimeout(r, 500));
    MSWLauncher.bridgeOverride = null;
    return window.__t5Thumbs;
  });
  expect(thumbCalls.every((p) => !p.includes('gone-'))).toBe(true);
});

test('module cards keep real DOM order and computed styles under theme switch (T5)', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => { MSWModules.setEnabled('asr', true); MSWModules.setEnabled('match', true); });
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.waitForTimeout(250);

  const check = () => page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-module-card]:not(.module-hidden)'));
    return {
      order: cards.map((c) => c.dataset.moduleCard),
      domMonotonic: cards.every((c, i) => i === 0
        || Array.from(document.querySelectorAll('[data-module-card]')).indexOf(cards[i - 1])
          < Array.from(document.querySelectorAll('[data-module-card]')).indexOf(c)),
      indexContiguous: cards.every((c, i) => c.querySelector('.module-index')?.textContent === String(i + 1).padStart(2, '0')),
      pinStroke: (() => {
        const pin = document.querySelector('.recent-pin svg');
        return pin ? Array.from(pin.querySelectorAll('path')).every((p) => getComputedStyle(p).stroke !== 'none') : null;
      })(),
    };
  });
  const dark = await check();
  expect(dark.order.slice(0, 4)).toEqual(['media', 'waveform', 'asr', 'match']);
  expect(dark.domMonotonic).toBe(true);
  expect(dark.indexContiguous).toBe(true);
  // 主题切换后 DOM 与序号保持（T5：不以字样存在代替真实结构）。
  await page.evaluate(() => { window.MSWNavigation.show('settings'); });
  await page.locator('#themeLight').click();
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.MSWNavigation.show('prefab'); });
  await page.waitForTimeout(150);
  const light = await check();
  expect(light.order).toEqual(dark.order);
  expect(light.indexContiguous).toBe(true);
  await page.evaluate(() => { window.MSWNavigation.show('settings'); });
  await page.locator('#themeDark').click();
  await page.evaluate(() => { window.MSWNavigation.show('prefab'); });
});

test('all-projects pagination serves real pages with server-side search (T2)', async ({ page }) => {
  await openHome(page);

  // 30 个登记 → 3 页；服务端按 page/pageSize 返回当前页。
  await page.evaluate(() => {
    const registry = [];
    for (let i = 1; i <= 30; i += 1) {
      const name = `bulk-${String(i).padStart(2, '0')}.mosp`;
      registry.push({ path: `D:\\Bulk\\${name}`, name, dir: 'D:\\Bulk', exists: true, pinned: false, lastOpenedAt: '', modifiedAt: '', registeredAt: '', updatedAt: `2026-09-${String(i % 28 + 1).padStart(2, '0')}T00:00:00+00:00`, source: 'created', mediaName: '' });
    }
    window.__demoRegistry = registry.reverse();
    MSWProjectHome.refresh();
  });
  await page.waitForFunction(() => document.querySelectorAll('#allGrid .recent-card').length === 12);
  await expect(page.locator('#allPager .pager-info')).toContainText('1/3');
  await expect(page.locator('#allPager button').first()).toBeDisabled(); // 上一页禁用

  // 翻页：DOM 只保留当前页，激活页码移动。
  await page.locator('#allPager .pager-page', { hasText: '3' }).click();
  await page.waitForFunction(() => MSWProjectHome.state.allPage === 3);
  await expect(page.locator('#allGrid .recent-card')).toHaveCount(6); // 30 = 12+12+6
  await expect(page.locator('#allPager .pager-page.active')).toHaveText('3');

  // 搜索回第一页 + 命中/总数计数。
  await page.locator('#recentSearch').fill('bulk-1');
  await page.waitForTimeout(500);
  await expect(page.locator('#allPager .pager-page.active')).toHaveText('1');
  await expect(page.locator('#allCount')).toContainText('/');
  await page.locator('#recentSearch').fill('');
  await page.waitForTimeout(500);
});

test('unseen projects are findable by media name via the media index (T2)', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => {
    window.__demoMediaIndex = { 'D:\\Demo\\intro.mosp': 'special-movie.mp4' };
  });
  await page.locator('#recentSearch').fill('special-movie');
  await page.waitForTimeout(500);
  // 未打开/未看过统计的工程经媒体名索引命中（A6）。
  await expect(page.locator('#allGrid .recent-card')).toHaveCount(1);
  await expect(page.locator('#allGrid .recent-name')).toHaveText('intro.mosp');
  await page.locator('#recentSearch').fill('');
});

test('recent covers load independently when the all-projects list is empty (T1)', async ({ page }) => {
  await openHome(page);
  await page.reload();
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);

  // T1/U2：全部工程接口返回空——最近组的封面不依赖全部组的观察顺带加载。
  // （override 必须在 reload 之后安装——reload 会清空页面状态。）
  await page.evaluate(() => {
    window.__coverRequests = [];
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'get_recent_project_thumbnail') window.__coverRequests.push(payload.path);
      if (method === 'get_all_projects') return { ok: true, projects: [], total: 0, matched: 0, query: '' };
      return next(method, payload);
    };
    // 覆写后清空已缓存的封面，强制按新拦截路径重新走观察加载。
    const st = MSWProjectHome.state;
    st.covers = {};
    st.coversPending = {};
    MSWProjectHome.refresh();
  });
  await page.waitForFunction(() => document.querySelectorAll('#recentGrid .recent-card').length >= 1);
  await page.waitForFunction(() => (window.__coverRequests || []).length >= 1);
  await expect(page.locator('#recentGrid .recent-cover[data-cover-state="image"]').first()).toBeVisible();
  // 全部组显示空态，最近组不受影响。
  await expect(page.locator('#allEmpty')).toBeVisible();
  await page.evaluate(() => { MSWLauncher.bridgeOverride = null; });
});

test('cover failures enter a retryable placeholder instead of loading forever (T1)', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => {
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'get_recent_project_thumbnail') return { ok: false, error: 'mock failure' };
      return next(method, payload);
    };
    const first = MSWProjectHome.state.projects.find((p) => p.exists);
    delete MSWProjectHome.state.covers[first.path];
    delete MSWProjectHome.state.coversPending[first.path];
    MSWProjectHome.requestCover(first);
  });
  await expect(page.locator('#recentGrid .recent-cover[data-cover-state="failed"]').first()).toBeVisible();
  await page.evaluate(() => { MSWLauncher.bridgeOverride = null; });
});

test('pinned badge needle renders with stroke inherited from the svg root (T1)', async ({ page }) => {
  await openHome(page);
  await page.waitForTimeout(400);
  const pin = await page.evaluate(() => {
    const svg = document.querySelector('.recent-card.pinned .recent-pin svg');
    if (!svg) return null;
    return Array.from(svg.querySelectorAll('path')).map((p) => {
      const cs = getComputedStyle(p);
      return { stroke: cs.stroke, width: parseFloat(cs.strokeWidth) };
    });
  });
  expect(pin).not.toBeNull();
  expect(pin).toHaveLength(2);
  // U1：针杆与轮廓两条路径都有描边与宽度（此前针杆 stroke:none 不可见）。
  for (const path of pin) {
    expect(path.stroke).not.toBe('none');
    expect(path.width).toBeGreaterThan(0);
  }
});

test('delete project file flow confirms scope, recycles, and reports; registry removal is separate', async ({ page }) => {
  await openHome(page);
  await page.waitForFunction(() => document.querySelectorAll('#allGrid .recent-card').length >= 3);

  // 全部工程右键菜单区分三种移除语义；删除项为红色危险项并带垃圾桶图标。
  const oldTake = page.locator('#allGrid .recent-card').nth(2);
  expect(await oldTake.locator('.recent-name').textContent()).toBe('old-take.mosp');
  await oldTake.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await oldTake.click({ button: 'right' });
  const menu = page.locator('#recentContextMenu');
  const items = menu.locator('button[role="menuitem"]');
  const labels = await items.evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(labels).toEqual(['打开工程', '固定到列表顶部', '打开所在文件夹', '刷新封面', '从全部工程记录移除', '删除工程文件…']);
  const danger = menu.locator('button.danger');
  await expect(danger).toHaveCount(1);
  expect(await danger.locator('svg').count()).toBe(1);

  // 确认对话框展示工程名、实际路径与删除范围；取消保留卡片。
  await danger.click();
  const message = await page.locator('#batchConfirmMessage').textContent();
  expect(message).toContain('old-take.mosp');
  expect(message).toContain('.assets');
  await page.locator('#batchConfirmNo').click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => Array.from(document.querySelectorAll('#allGrid .recent-name')).some((n) => n.textContent === 'old-take.mosp'))).toBe(true);

  // 确认后删除：请求指向该工程文件，卡片消失并给出回收站反馈。
  await oldTake.click({ button: 'right' });
  await menu.locator('button.danger').click();
  await page.locator('#batchConfirmYes').click();
  await page.waitForFunction(() => (window.__deleteRequests || []).length > 0);
  const deleted = await page.evaluate(() => ({
    gone: !Array.from(document.querySelectorAll('#allGrid .recent-name')).some((n) => n.textContent === 'old-take.mosp'),
    notice: document.getElementById('homeNotice').textContent,
    request: (window.__deleteRequests || [])[0],
  }));
  expect(deleted.gone).toBe(true);
  expect(deleted.notice).toContain('已移入回收站');
  expect(deleted.request).toContain('old-take.mosp');

  // 「从全部工程记录移除」只移除登记：同工程保留在最近组。
  const first = page.locator('#allGrid .recent-card').first();
  const firstName = await first.locator('.recent-name').textContent();
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await first.click({ button: 'right' });
  await menu.locator('button').filter({ hasText: '从全部工程记录移除' }).click();
  await page.waitForFunction(() => (window.__registryRemovals || []).length > 0);
  await page.waitForTimeout(400);
  const after = await page.evaluate((name) => ({
    allGone: !Array.from(document.querySelectorAll('#allGrid .recent-name')).some((n) => n.textContent === name),
    recentKept: Array.from(document.querySelectorAll('#recentGrid .recent-name')).some((n) => n.textContent === name),
  }), firstName);
  expect(after.allGone).toBe(true);
  expect(after.recentKept).toBe(true);
});

test('home groups collapse independently with memory and search counts both lists', async ({ page }) => {
  await openHome(page);
  await page.waitForFunction(() => document.querySelectorAll('#allGrid .recent-card').length > 0);

  // 折叠全部工程：正文收起、底部显示将打开的目标、标题箭头态切换。
  await page.locator('#allGrid .recent-card').first().click();
  await page.locator('#allGroupTitle').click();
  await expect(page.locator('#allGroupBody')).toBeHidden();
  await expect(page.locator('#allGroupTitle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#allGroupTarget')).not.toHaveClass(/hidden/);
  await expect(page.locator('#recentGroupBody')).toBeVisible();

  // 折叠状态记忆：切页返回后保持。
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.evaluate(() => window.MSWNavigation.show('home'));
  await page.waitForFunction(() => document.querySelectorAll('#allGrid .recent-card, #allGroupTarget:not(.hidden)').length >= 0);
  await expect(page.locator('#allGroupBody')).toBeHidden();

  // 搜索作用于两组并显示命中/总数；最近组默认 6 条起步。
  // （用 intro.mosp 而非 intro：演示 mock 给 old-take 的媒体名是 intro.mp4，会按媒体名命中。）
  await page.locator('#allGroupTitle').click();
  await page.locator('#recentSearch').fill('intro.mosp');
  await expect(page.locator('#recentGrid .recent-card')).toHaveCount(1);
  await expect(page.locator('#allGrid .recent-card')).toHaveCount(1);
  await expect(page.locator('#allCount')).toContainText('/');
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
  await cardOf(page, 'clip.mosp').dblclick();
  await expect(page.locator('#batchConfirmModal')).toBeVisible();
  await expect(page.locator('#batchConfirmMessage')).toContainText('demo.mosp');
  await page.locator('#batchConfirmNo').click();
  await expect(page.locator('#batchConfirmModal')).toBeVisible();
  await expect(page.locator('#batchConfirmMessage')).toContainText('独立端口');
  await page.locator('#batchConfirmYes').click();
  await expect.poll(() => page.evaluate(() => window.__mockServerIntents.at(-1)?.independentPort)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__mockServerIntents.at(-1)?.intent)).toBe('project');
});
