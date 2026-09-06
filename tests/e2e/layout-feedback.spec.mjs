import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { disableOnboarding } from './helpers.mjs';



const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const launcherUrl = pathToFileURL(path.join(repoRoot, 'web', 'launcher', 'index.html')).href;
const blankEditorUrl = pathToFileURL(path.join(repoRoot, 'blank-editor.html')).href;


async function openLauncher(page) {
  await page.goto(launcherUrl);
  await page.waitForFunction(() => window.MAWLauncher?.config?.postprocessProviders?.length > 0);
}


test('keeps the Launcher action bar outside the scrolling content and highlights script drops', async ({ page }) => {
  await openLauncher(page);

  const layout = await page.evaluate(() => {
    const scroll = document.querySelector('.shell-scroll');
    const actions = document.querySelector('.actions');
    const style = actions ? getComputedStyle(actions) : null;
    const scrollStyle = scroll ? getComputedStyle(scroll) : null;
    const scrollRect = scroll?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      pageCanScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      scrollOverflowY: scroll ? getComputedStyle(scroll).overflowY : '',
      actionsPosition: style?.position || '',
      actionsBottom: style?.bottom || '',
      actionsInsideScroll: Boolean(scroll?.contains(actions)),
      scrollPaddingBottom: scrollStyle?.paddingBottom || '',
      scrollBottom: scrollRect?.bottom || 0,
      actionsTop: actionsRect?.top || 0,
      actionsBottomEdge: actionsRect?.bottom || 0,
    };
  });
  expect(layout.pageCanScroll).toBe(false);
  expect(layout.scrollOverflowY).toBe('auto');
  expect(layout.actionsPosition).toBe('static');
  expect(layout.actionsBottom).toBe('auto');
  expect(layout.actionsInsideScroll).toBe(false);
  expect(layout.scrollPaddingBottom).toBe('20px');
  expect(Math.abs(layout.scrollBottom - layout.actionsTop)).toBeLessThanOrEqual(1);
  expect(layout.actionsBottomEdge).toBeLessThanOrEqual(layout.viewportHeight + 1);

  const scrollbarState = await page.evaluate(() => {
    const preview = document.querySelector('#postprocessScriptPreviewText');
    const previewCard = preview?.closest('.script-preview');
    if (preview && previewCard) {
      previewCard.classList.remove('hidden');
      preview.textContent = 'preview line\n'.repeat(80);
    }
    const elements = [
      document.querySelector('.shell-scroll'),
      preview,
      document.querySelector('#log'),
      document.querySelector('textarea'),
    ];
    return elements.map((element) => ({
      scrollbarWidth: element ? getComputedStyle(element).scrollbarWidth : '',
      webkitWidth: element ? getComputedStyle(element, '::-webkit-scrollbar').width : '',
    }));
  });
  for (const state of scrollbarState) {
    expect(state.scrollbarWidth).toBe('thin');
    expect(state.webkitWidth).toBe('6px');
  }

  const dropState = await page.evaluate(() => {
    const input = document.getElementById('postprocessScriptPath');
    const mediaInput = document.getElementById('mediaPath');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['script'], 'script.txt', { type: 'text/plain' }));
    input.dispatchEvent(new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
    const scriptStyle = getComputedStyle(input);
    const mediaStyle = getComputedStyle(mediaInput);
    return {
      scriptHasHighlight: input.classList.contains('drag-over'),
      mediaHasHighlight: mediaInput.classList.contains('drag-over'),
      scriptBorder: scriptStyle.borderTopColor,
      mediaBorder: mediaStyle.borderTopColor,
      scriptBackground: scriptStyle.backgroundColor,
    };
  });
  expect(dropState.scriptHasHighlight).toBe(true);
  expect(dropState.mediaHasHighlight).toBe(false);
  expect(dropState.scriptBorder).not.toBe(dropState.mediaBorder);
  expect(dropState.scriptBackground).not.toBe('rgba(0, 0, 0, 0)');
});


test('shows the installed OCR settings hint and highlights video drops', async ({ page }) => {
  await openLauncher(page);

  const state = await page.evaluate(() => {
    const config = window.MAWLauncher.config;
    config.ocrRuntime = {
      ...(config.ocrRuntime || {}),
      status: 'ready',
      ready: true,
      path: 'D:\\Demo\\ocr-runtime',
      detail: 'OCR 模型已安装，可以在工具箱中使用。',
    };
    config.ocrModels = (config.ocrModels || []).map((model) => ({ ...model, installed: true, status: 'installed' }));
    window.MAWLauncher.onBackendEvent({ type: 'ocrRuntimeReady', runtime: config.ocrRuntime, models: config.ocrModels });

    const field = document.getElementById('ocrVideoPathField');
    const before = {
      borderTopColor: getComputedStyle(field).borderTopColor,
      backgroundColor: getComputedStyle(field).backgroundColor,
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File(['video'], 'video.mp4', { type: 'video/mp4' }));
    field.dispatchEvent(new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
    const after = getComputedStyle(field);
    const hint = document.getElementById('ocrRuntimeHint');
    const hintText = Array.from(hint?.childNodes || []).map((node) => node.nodeName === 'BR' ? '\n' : node.textContent || '').join('');
    const pathLink = hint?.querySelector('.runtime-path-link');
    return {
      settingsHint: document.getElementById('openOcrSettings')?.textContent || '',
      status: document.getElementById('ocrModelStatus')?.textContent || '',
      runtimeHint: hintText,
      runtimePath: pathLink?.textContent || '',
      hasHighlight: field.classList.contains('drag-over'),
      borderChanged: before.borderTopColor !== after.borderTopColor,
      backgroundChanged: before.backgroundColor !== after.backgroundColor,
    };
  });

  expect(state.settingsHint).toBe('在 ⚙️ 设置中查看');
  expect(state.status).toBe('已安装，可直接使用');
  expect(state.runtimeHint).toBe('OCR 模型已安装，可以在工具箱中使用。\nOCR 运行环境目录: D:\\Demo\\ocr-runtime');
  expect(state.runtimePath).toBe('D:\\Demo\\ocr-runtime');
  expect(state.hasHighlight).toBe(true);
  expect(state.borderChanged).toBe(true);
  expect(state.backgroundChanged).toBe(true);

  await page.locator('#settingsButton').click();
  // OCR 运行环境位于「运行环境」分页；设置弹窗默认打开「通用」分页。
  await page.locator('#settingsRuntimeTab').click();
  await expect(page.locator('#settingsRuntimeTab')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#ocrRuntimeHint .runtime-path-link').click();
  await expect.poll(() => page.evaluate(() => window.__openedRuntimeFolder)).toEqual({ kind: 'ocr-runtime' });
});


test('keeps the menubar and waveform tools visible while content shrinks', async ({ page }) => {
  await disableOnboarding(page);
  await page.goto(blankEditorUrl);
  await page.waitForSelector('#editor-workspace');

  for (const width of [620, 480, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.waitForSelector('#editor-workspace');
    const controls = await page.evaluate(() => {
      const menubar = document.getElementById('menubar');
      const barRect = menubar.getBoundingClientRect();
      const tabs = [...document.querySelectorAll('.menubar-tab')];
      const tools = [...document.querySelectorAll('.waveform-toolbar .waveform-tool-switch button')];
      return {
        tabCount: tabs.length,
        tabsInside: tabs.every((tab) => {
          const rect = tab.getBoundingClientRect();
          return rect.width > 0 && rect.right <= barRect.right + 1 && rect.left >= barRect.left - 1;
        }),
        toolCount: tools.length,
        toolsVisible: tools.every((tool) => tool.getBoundingClientRect().width > 0),
      };
    });
    expect(controls.tabCount).toBe(6);
    expect(controls.tabsInside).toBe(true);
    expect(controls.toolCount).toBe(2);
    expect(controls.toolsVisible).toBe(true);
  }

  const editorScrollbarState = await page.evaluate(() => [
    '.cues-container',
    '.waveform-scroll',
    '.subtitle-preview-settings-panel',
    '.multi-subtitle-import-preview',
  ].map((selector) => {
    const element = document.querySelector(selector);
    return {
      selector,
      scrollbarWidth: element ? getComputedStyle(element).scrollbarWidth : '',
      webkitWidth: element ? getComputedStyle(element, '::-webkit-scrollbar').width : '',
    };
  }));
  for (const state of editorScrollbarState) {
    expect(state.scrollbarWidth, state.selector).toBe('thin');
    expect(state.webkitWidth, state.selector).toBe('6px');
  }
});

test('module tabs close a module from a preset layout and restore it afterwards', async ({ page }) => {
  await disableOnboarding(page);
  await page.goto(blankEditorUrl);
  await page.waitForSelector('#editor-workspace');

  const moduleIds = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-dock-module]')].map((el) => el.dataset.dockModule).sort());

  // 初始为预设布局、四个窗口齐全，各带单标签 + 行尾「+」。
  expect(await moduleIds()).toEqual(['cues', 'panel', 'player', 'wave']);
  const stripState = await page.evaluate(() => {
    const strip = document.querySelector('[data-dock-module="player"] .module-tab-strip');
    return {
      tabs: [...strip.querySelectorAll('.module-tab')].map((tab) => tab.dataset.tabFor),
      hasAdd: !!strip.querySelector('.module-tab-add'),
    };
  });
  expect(stripState.tabs).toEqual(['player']);
  expect(stripState.hasAdd).toBe(true);

  // Windows 文件夹式标签：点击标签上的 × 关闭该窗口。
  await page.locator('[data-dock-module="player"] .module-tab[data-tab-for="player"] .tab-close').click();
  await page.waitForTimeout(250);
  expect(await moduleIds()).toEqual(['cues', 'panel', 'wave']);
  const layoutClass = await page.evaluate(() => document.getElementById('editor-workspace').className);
  expect(layoutClass).toContain('layout-custom');

  // 「窗口 → 显示窗口 → 视频」找回被关闭的窗口。
  await page.locator('.menubar-tab', { hasText: '窗口' }).click();
  await page.locator('#show-module-submenu .dropdown-submenu-toggle').hover();
  await page.waitForTimeout(300);
  await page.locator('#show-module-submenu .dropdown-item', { hasText: '视频' }).first().click();
  await page.waitForTimeout(250);
  expect(await moduleIds()).toEqual(['cues', 'panel', 'player', 'wave']);
  const restoredVisible = await page.evaluate(() => {
    const rect = document.querySelector('[data-dock-module="player"]').getBoundingClientRect();
    return rect.width > 10 && rect.height > 10;
  });
  expect(restoredVisible).toBe(true);

  // 切回内置预设后恢复直接布局，四个窗口全部在场。
  await page.evaluate(() => {
    const select = document.getElementById('workspace-preset');
    select.value = 'wave-right';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  expect(await moduleIds()).toEqual(['cues', 'panel', 'player', 'wave']);
  const presetClass = await page.evaluate(() => document.getElementById('editor-workspace').className);
  expect(presetClass).toContain('layout-wave-right');
});
