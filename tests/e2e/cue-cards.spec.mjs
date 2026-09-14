import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTempDir, disableOnboarding, findFreePort, generateWav, makeTempDir, startServer, toggleCueListSettings, clickMenubarItem } from './helpers.mjs';

let directory, server;
test.beforeAll(async () => {
  directory = makeTempDir('cue-cards');
  const project = JSON.parse(readFileSync(new URL('../fixtures/msw_beta1_legacy_project.json', import.meta.url), 'utf8'));
  delete project.msw;
  project.segments[0].text = '这是一段较长的主字幕，用来检查窄面板中的三行摘要与完整编辑。'.repeat(5);
  project.segments[0].color = { name: 'purple', value: '#a855f7' };
  project.segments.push({ id: 'main-002', start: 1500, end: 2500, text: '独立主字幕' });
  project.multi_subtitle.tracks[0].segments[0].color = { name: 'green', value: '#22c55e' };
  project.multi_subtitle.tracks[0].segments.push({ id: 'ext-002', start: 3000, end: 4000, text: 'Independent secondary' });
  const source = join(directory, 'project.mosp');
  writeFileSync(source, JSON.stringify(project));
  server = await startServer(source, generateWav(join(directory, 'synthetic.wav'), 5), await findFreePort());
});
test.afterAll(async () => { await server?.stop(); cleanupTempDir(directory); });
test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await page.goto(server.url);
  await expect(page.locator('#editor-loading')).toBeHidden();
  await page.waitForFunction(() => !appearanceBootPending);
  const initialAppearance = page.waitForResponse(r => r.url().endsWith('/api/settings/appearance')
    && r.request().method() === 'POST' && r.ok());
  await page.evaluate(() => {
    updateEditorSettings({ selectBoundSubtitlePair: false, cueListAutoScrollOnClick: false,
      themePreset: 'default', theme: 'dark', accent: 'blue', colors: null });
    applyThemeAndColors();
  });
  await initialAppearance;
});
const first = page => page.locator('#cues-container > .cue').first();
const main = page => first(page).locator('.main');
const secondary = page => first(page).locator('.extension');

test('preset cards and feedback colors stay distinct and retain custom overrides', async ({ page }, info) => {
  for (const name of ['default', 'aster', 'kosuzu', 'renko', 'reimu', 'alice', 'koishi']) {
    const colors = await page.evaluate(name => {
      updateEditorSettings({ themePreset: name, colors: null });
      applyThemeAndColors();
      const pixel = document.createElement('span'); document.body.appendChild(pixel);
      const resolve = token => { pixel.style.color = `var(${token})`; return getComputedStyle(pixel).color; };
      const values = ['--card-bg', '--gap-accent', '--wave-playhead'].map(resolve);
      pixel.remove(); return values;
    }, name);
    expect(new Set(colors).size).toBe(3);
    if (name === 'default') expect(colors.slice(1)).toEqual(['rgb(212, 154, 74)', 'rgb(255, 93, 103)']);
    if (name === 'aster') expect(colors.slice(1)).toEqual(['rgb(255, 220, 0)', 'rgb(248, 114, 124)']);
    await secondary(page).locator('.text').click();
    await page.screenshot({ path: info.outputPath(`theme-${name}.png`) });
  }
  await page.evaluate(() => {
    updateEditorSettings({ colors: { card: '#123456', gap: '#abcdef', hit: '#fedcba' } });
    applyThemeAndColors();
  });
  expect(await page.evaluate(() => resolvedInterfaceColors().card)).toBe('#123456');
  expect(await page.evaluate(() => resolvedInterfaceColors().gap)).toBe('#abcdef');
  expect(await page.evaluate(() => resolvedInterfaceColors().hit)).toBe('#fedcba');
});

test('shared handles stay on their own subtitle track and continuation edges have no handle', async ({ page }) => {
  await page.evaluate(() => {
    DATA.segments[0].end = 1000; DATA.segments[1].start = 1000;
    DATA.multi_subtitle.tracks[0].segments[0].end = 1000;
    DATA.multi_subtitle.tracks[0].segments[1].start = 1000;
    renderAll({ waveform: 'full' });
  });
  for (const track of ['main', 'extension']) {
    const block = page.locator(`.waveform-cue-block[data-track="${track}"]`).first();
    const box = await block.boundingBox();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await expect(page.locator(`.waveform-cue-block[data-track="${track}"] .edge-hot`)).toHaveCount(2);
    await expect(page.locator(`.waveform-cue-block[data-track="${track === 'main' ? 'extension' : 'main'}"] .edge-hot`)).toHaveCount(0);
  }
  await page.evaluate(() => {
    waveformEditor.settings.mode = 'multi'; waveformEditor.settings.secondsPerRow = 1;
    waveformEditor.render();
  });
  const parts = await page.locator('.waveform-cue-block').evaluateAll(blocks => blocks.map(block => {
    const row = block.closest('.waveform-row');
    return { start: Number(block.dataset.start), end: Number(block.dataset.end),
      from: Number(row.dataset.startMs), to: Number(row.dataset.endMs),
      left: !!block.querySelector('.waveform-cue-handle.left'), right: !!block.querySelector('.waveform-cue-handle.right') };
  }));
  expect(parts.some(p => p.start < p.from || p.end > p.to)).toBe(true);
  for (const p of parts) {
    expect(p.left).toBe(p.start >= p.from); expect(p.right).toBe(p.end <= p.to);
  }
});

test('asset search visibility restores on reload and synchronizes its checkbox', async ({ page }) => {
  await page.evaluate(() => {
    updateEditorSettings({ assetLibraryShowSearch: false }); applyAssetSearchVisibility();
  });
  await page.reload();
  await expect(page.locator('#editor-loading')).toBeHidden();
  await expect(page.locator('#asset-show-search')).not.toBeChecked();
  await expect(page.locator('.msw-asset-toolbar')).toHaveAttribute('hidden', '');
});

test('paired cards show actual and related selection without changing either background', async ({ page }, info) => {
  await page.evaluate(() => {
    updateEditorSettings({ clickBehavior: 'select-only' });
    seekFromWaveform(4.5);
  });
  await page.waitForFunction(() => player.currentTime >= 4.5);
  await expect(first(page)).not.toHaveClass(/active/);
  await expect(page.locator('#cues-container > .cue')).toHaveCount(3);
  await expect(page.locator('.single-sided')).toHaveCount(2);
  await expect(page.locator('.multi-cue-empty')).toHaveCount(0);
  const bgMain = await main(page).evaluate(el => getComputedStyle(el).backgroundColor);
  const bgSecondary = await secondary(page).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bgMain).not.toEqual(bgSecondary);
  await secondary(page).locator('.text').click();
  await expect(secondary(page)).toHaveCSS('outline-style', 'solid');
  await expect(main(page)).toHaveCSS('outline-style', 'dashed');
  expect(await page.evaluate(() => [Array.from(selectedIdxs), Array.from(selectedExtensionIdxs)])).toEqual([[], [0]]);
  await expect(secondary(page)).toHaveClass(/current-target/);
  await expect(main(page)).toHaveCSS('background-color', bgMain);
  await expect(secondary(page)).toHaveCSS('background-color', bgSecondary);
  await main(page).locator('.text').click({ modifiers: ['Control'] });
  await expect(main(page)).toHaveCSS('outline-style', 'solid');
  await expect(secondary(page)).toHaveCSS('outline-style', 'solid');
  await expect(main(page)).toHaveClass(/current-target/);
  await page.screenshot({ path: info.outputPath('cards-columns-dark.png') });
  await page.evaluate(() => clearSelection());
  await expect(page.locator('.related-selected')).toHaveCount(0);
  await expect(main(page)).not.toHaveClass(/selected/);
});

test('display content and paired layout are independent, persist, and fit narrow panels', async ({ page }, info) => {
  const state = await page.evaluate(() => JSON.stringify(DATA.multi_subtitle.bindings));
  await toggleCueListSettings(page);
  await expect(page.locator('#multi-subtitle-settings-menu #multi-subtitle-display-mode')).toHaveCount(0);
  await expect(page.locator('#cue-list-pair-layout')).toHaveValue('columns');
  await page.locator('#cue-list-pair-layout').selectOption('rows');
  await toggleCueListSettings(page);
  const a = await main(page).boundingBox(), b = await secondary(page).boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  await page.reload();
  await expect(page.locator('#cues-container')).toHaveAttribute('data-pair-layout', 'rows');
  await page.waitForFunction(() => !appearanceBootPending);
  expect(await page.evaluate(() => EDITOR_SETTINGS.theme)).toBe('dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
  await toggleCueListSettings(page);
  await page.locator('#multi-subtitle-display-mode').selectOption('extension');
  await expect(page.locator('#cue-list-pair-layout')).toBeDisabled();
  await expect(page.locator('#cues-container > .multi-extension-cue')).toHaveCount(2);
  await page.locator('#multi-subtitle-display-mode').selectOption('main');
  await expect(page.locator('#cues-container > .cue[data-idx]')).toHaveCount(2);
  await page.locator('#multi-subtitle-display-mode').selectOption('both');
  await page.locator('#cue-list-pair-layout').selectOption('columns');
  await toggleCueListSettings(page);
  await page.evaluate(() => { container.style.width = '340px'; container.style.maxWidth = '340px'; });
  for (const layout of ['columns', 'rows']) {
    await toggleCueListSettings(page);
    await page.locator('#cue-list-pair-layout').selectOption(layout);
    await toggleCueListSettings(page);
    expect(await main(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await secondary(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`cards-narrow-${layout}.png`) });
  }
  expect(await page.evaluate(() => JSON.stringify(DATA.multi_subtitle.bindings))).toEqual(state);
});

test('full inline text edits retain tint, search finds secondary, and undo restores content', async ({ page }) => {
  const before = await main(page).locator('.text').textContent();
  const bg = await main(page).evaluate(el => getComputedStyle(el).backgroundColor);
  await main(page).locator('.text').dblclick();
  await expect(main(page).locator('.text')).toHaveAttribute('contenteditable', 'plaintext-only');
  await expect(main(page).locator('.text')).toHaveCSS('-webkit-line-clamp', 'none');
  await main(page).locator('.text').fill('更新的主字幕');
  await page.keyboard.press('Control+Enter');
  await expect(main(page)).toHaveCSS('background-color', bg);
  expect(await page.evaluate(() => DATA.segments[0].text)).toBe('更新的主字幕');
  await clickMenubarItem(page, '编辑', 'undo-btn');
  await expect(main(page).locator('.text')).toHaveText(before);
  await page.evaluate(() => applySearch('Independent secondary'));
  await expect(page.locator('#cues-container > .cue:not(.hidden)')).toHaveCount(1);
  await expect(page.locator('#cues-container > .cue:not(.hidden)')).toContainText('Independent secondary');
});

test('card color survives appearance sync and reload and restores theme defaults', async ({ page }, info) => {
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await page.locator('.settings-nav-item[data-settings-category="appearance"]').click();
  await page.waitForFunction(() => !appearanceBootPending);
  const persisted = page.waitForResponse(r => r.url().endsWith('/api/settings/appearance') && r.request().method() === 'POST' && r.ok());
  await page.locator('#interface-color-card').evaluate(input => {
    input.value = '#243546';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await persisted;
  await page.locator('#editor-settings-close').click();
  await page.reload();
  await expect(page.locator('.single-sided .main')).toHaveCSS('background-color', 'rgb(36, 53, 70)');
  expect(await page.evaluate(() => EDITOR_SETTINGS.colors.card)).toBe('#243546');
  await clickMenubarItem(page, '编辑', 'editor-settings-toggle');
  await page.locator('.settings-nav-item[data-settings-category="appearance"]').click();
  await page.locator('[data-theme-preset="alice"]').click();
  await page.locator('#interface-colors-reset').click();
  await page.locator('#editor-settings-close').click();
  await expect(page.locator('.single-sided .main')).not.toHaveCSS('background-color', 'rgb(36, 53, 70)');
  await secondary(page).locator('.text').click();
  await page.screenshot({ path: info.outputPath('cards-light.png') });
});

test('hidden disabled sides leave no empty half and color references refresh in place', async ({ page }) => {
  const original = await main(page).elementHandle();
  await page.evaluate(() => {
    DATA.segments[1].color = { name: 'custom', value: '#dd6699' };
    DATA.segments[0].color = null;
    DATA.segments[0].color_ref = { name: 'custom', headIdx: 1 };
    refreshColorAssignmentUi();
  });
  expect(await main(page).evaluate((el, before) => el === before, original)).toBe(true);
  const referenceColor = await main(page).evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator('.single-sided .main')).toHaveCSS('background-color', referenceColor);
  await main(page).locator('.color-bar').click();
  expect(await page.evaluate(() => Array.from(selectedIdxs))).toEqual([1]);
  await page.evaluate(() => {
    getActiveExtensionTrack().segments[0].disabled = true;
    updateEditorSettings({ cueListHideDisabled: true });
    renderAll();
  });
  await expect(secondary(page)).toBeHidden();
  const card = await first(page).boundingBox(), side = await main(page).boundingBox();
  expect(side.width).toBeGreaterThan(card.width - 4);
  await page.evaluate(() => { DATA.segments[0].disabled = true; renderAll(); });
  await expect(first(page)).toBeHidden();
  await page.evaluate(() => { updateEditorSettings({ cueListHideDisabled: false }); applyCueListDisplaySettings(); });
  await expect(main(page)).toBeVisible();
  await expect(secondary(page)).toBeVisible();
});

test('playhead hits outline the whole unselected card and yield to selection on either side', async ({ page }, info) => {
  await page.evaluate(() => {
    const cue = getActiveExtensionTrack().segments[0];
    cue.start = 200; cue.end = 1300;
    updateEditorSettings({ clickBehavior: 'select-only' });
    renderAll();
  });
  const seek = async ms => {
    await page.evaluate(time => seekFromWaveform(time / 1000), ms);
    await expect.poll(() => page.evaluate(() => Math.round(player.currentTime * 1000))).toBe(ms);
    await page.evaluate(() => update());
  };
  for (const ms of [0, 500, 1100]) {
    await seek(ms);
    await expect(first(page)).toHaveClass(/playhead-hit/);
    await expect(first(page)).toHaveCSS('outline-style', 'solid');
    await expect(main(page)).toHaveCSS('outline-style', 'none');
    await expect(secondary(page)).toHaveCSS('outline-style', 'none');
  }
  await page.screenshot({ path: info.outputPath('secondary-hit-whole-card.png') });
  for (const side of ['main', 'extension']) {
    const selected = side === 'main' ? main(page) : secondary(page);
    const related = side === 'main' ? secondary(page) : main(page);
    await selected.locator('.text').click();
    await expect(first(page)).toHaveCSS('outline-style', 'none');
    await expect(selected).toHaveCSS('outline-style', 'solid');
    await expect(related).toHaveCSS('outline-style', 'dashed');
    await seek(500);
    await expect(related).toHaveCSS('outline-style', 'dashed');
  }
  await page.screenshot({ path: info.outputPath('secondary-selected-main-dashed.png') });
  await page.evaluate(() => clearSelection());
  await expect(first(page)).toHaveCSS('outline-style', 'solid');
  await seek(1400);
  await expect(page.locator('.cue.playhead-hit')).toHaveCount(0);
  await seek(3500);
  await expect(page.locator('.cue.playhead-hit')).toHaveCount(1);
  await expect(page.locator('.cue.playhead-hit')).toContainText('Independent secondary');
  await page.evaluate(() => renderAll());
  await expect(page.locator('.cue.playhead-hit')).toHaveCount(1);
  await toggleCueListSettings(page);
  await page.locator('#multi-subtitle-display-mode').selectOption('main');
  await expect(page.locator('.cue.playhead-hit')).toHaveCount(0);
  await page.locator('#multi-subtitle-display-mode').selectOption('extension');
  await expect(page.locator('.cue.playhead-hit')).toContainText('Independent secondary');
  await toggleCueListSettings(page);
  await seek(4000);
  await expect(page.locator('.cue.playhead-hit')).toHaveCount(0);
});

test('playback clears the card at its actual end while paused selection stays symmetric in rows', async ({ page }) => {
  await toggleCueListSettings(page);
  await page.locator('#cue-list-pair-layout').selectOption('rows');
  await toggleCueListSettings(page);
  await page.evaluate(async () => { seekFromWaveform(.85); await player.play(); });
  await expect(first(page)).toHaveClass(/playhead-hit/);
  await expect.poll(() => page.evaluate(() => player.currentTime)).toBeGreaterThan(1.1);
  await page.evaluate(() => player.pause());
  await expect(first(page)).not.toHaveClass(/playhead-hit/);
  await secondary(page).locator('.text').click();
  await expect(main(page)).toHaveCSS('outline-style', 'dashed');
  await expect(first(page)).toHaveCSS('outline-style', 'none');
});
