import {expect, test} from '@playwright/test';
import {join} from 'node:path';
import {DURATION_MS, cleanupTempDir, disableOnboarding, findFreePort, generateProjectJson, generateWav, makeTempDir, startServer, startStaticServer, toggleWaveSettings} from './helpers.mjs';

let root, server;
test.beforeAll(async () => {
  root = makeTempDir('wave-settings');
  const media = join(root, 'synthetic.wav'), project = join(root, 'project.json');
  generateWav(media, DURATION_MS / 1000); generateProjectJson(project);
  server = await startServer(project, media, await findFreePort());
});
test.afterAll(async () => { await server?.stop(); cleanupTempDir(root); });
test.beforeEach(async ({page}) => {
  await disableOnboarding(page);
  await page.addInitScript(() => localStorage.setItem('moy.asr.editor.settings.v1', JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url);
  await toggleWaveSettings(page);
});

const help = (page, control) => page.locator(control).locator('xpath=ancestor::label').locator('.msw-help-button');

test('mode, amplitude and visibility controls still affect the waveform and survive reopening', async ({page}) => {
  await expect(page.locator('#waveform-settings-panel > section h4')).toHaveText(['显示与布局', '波形与音量', '编辑与试听']);
  await expect(page.locator('#msw-analysis-settings')).not.toHaveAttribute('open');
  await page.locator('#waveform-seconds-per-row').selectOption('5');
  await page.locator('#waveform-row-height').selectOption('168');
  expect(await page.evaluate(() => [waveformEditor.settings.secondsPerRow, waveformEditor.settings.rowHeight])).toEqual([5,168]);
  await page.locator('#waveform-display-mode').selectOption('basic');
  await expect(page.locator('#waveform-seconds-per-row-setting')).toBeHidden();
  await expect(page.locator('#waveform-row-height-setting')).toBeHidden();
  await expect(page.locator('#waveform-window-setting')).toBeVisible();
  const seconds = await page.evaluate(() => waveformEditor.settings.visibleSeconds);
  await page.locator('#waveform-zoom-in').click();
  expect(await page.evaluate(() => waveformEditor.settings.visibleSeconds)).toBeLessThan(seconds);
  await page.locator('#waveform-display-mode').selectOption('multi');
  await expect(page.locator('#waveform-window-setting')).toBeHidden();
  await expect(page.locator('#waveform-seconds-per-row')).toHaveValue('5');
  const scale = await page.evaluate(() => waveformEditor.settings.waveformScale);
  await page.locator('#waveform-scale-up').click();
  expect(await page.evaluate(() => waveformEditor.settings.waveformScale)).toBeGreaterThan(scale);
  await page.locator('#waveform-follow-source-gain').check();
  await expect(page.locator('#waveform-source-gain-setting')).toBeVisible();
  await page.locator('#waveform-hover-details').check();
  await page.evaluate(() => {DATA.segments[0].disabled=true; renderAll({waveform:'full'});});
  const block = page.locator('.waveform-cue-block[data-idx="0"]').first();
  await expect(block).toHaveClass(/disabled/);
  await page.locator('#waveform-disabled-display').selectOption('hidden');
  await expect(block).toBeHidden();
  await page.locator('#waveform-disabled-display').selectOption('dim');
  await expect(block).toBeVisible();
  expect(await page.evaluate(() => DATA.segments[0].disabled)).toBe(true);
  await toggleWaveSettings(page); await toggleWaveSettings(page);
  await expect(page.locator('#waveform-follow-source-gain')).toBeChecked();
  await expect(page.locator('#waveform-hover-details')).toBeChecked();
  await expect(page.locator('#waveform-row-height')).toHaveValue('168');
});

test('shared help supports click, keyboard dismissal and changing shortcut reference without toggling settings', async ({page}) => {
  await help(page, '#waveform-hover-details').click();
  await expect(page.locator('#msw-option-help')).toContainText('起止时间和时长');
  await expect(page.locator('#waveform-hover-details')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('#msw-option-help')).toBeHidden();
  await expect(page.locator('#wave-settings-modal')).toBeVisible();
  await help(page, '#keyboard-operation-reference').focus();
  await expect(page.locator('#msw-option-help')).toContainText('鼠标所在波形位置');
  await page.keyboard.press('Escape');
  await page.locator('#keyboard-operation-reference').selectOption('playhead');
  await help(page, '#keyboard-operation-reference').click();
  await expect(page.locator('#msw-option-help')).toContainText('当前播放头位置');
  await expect(page.locator('#keyboard-operation-reference-hint')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('#cue-move-step').fill('80'); await page.locator('#cue-move-step').press('Tab');
  expect(await page.evaluate(() => EDITOR_SETTINGS.cueMoveStepMs)).toBe(80);
  await page.locator('#keyboard-settings-help').click();
  await expect(page.locator('#wave-settings-modal')).not.toHaveClass(/show/);
  await expect(page.locator('#help-tab-fine-tuning')).toHaveAttribute('aria-selected', 'true');
});

test('layout fits narrow panels in both languages and light/dark themes, including expanded media tools', async ({page}, info) => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await expect.poll(() => page.evaluate(() => Boolean(MSWE.resolve('media').current))).toBe(true);
  for (const [width,theme,language] of [[560,'default','zh'],[360,'alice','zh'],[360,'default','en'],[560,'alice','en']]) {
    await page.locator('#wave-settings-modal').evaluate((el,w) => el.style.width=w+'px', width);
    await page.evaluate(({theme,language}) => {
      updateEditorSettings({themePreset:theme,theme:THEME_PRESETS[theme].theme,accent:THEME_PRESETS[theme].accent,colors:{}});
      applyThemeAndColors(); MSWE_I18N.applyLanguage(language);
    }, {theme,language});
    const wide = await page.locator('#waveform-display-mode').boundingBox(), next = await page.locator('#waveform-disabled-display').boundingBox();
    if (width === 560) expect(Math.abs(wide.y-next.y)).toBeLessThan(1);
    else expect(next.y).toBeGreaterThan(wide.y+wide.height);
    await page.locator('#msw-analysis-settings').evaluate(el => el.open=true);
    const issues = await page.locator('#waveform-settings-panel').evaluate(body => {
      const issues=[];
      if (body.scrollWidth > body.clientWidth+1) issues.push('body horizontal overflow');
      for (const el of body.querySelectorAll('.wave-settings-field, .wave-settings-checks, .wave-settings-amplitude, .settings-panel-title-row')) {
        if (!el.checkVisibility()) continue;
        if (el.scrollWidth>el.clientWidth+1) issues.push(el.className+' overflow');
      }
      for (const el of body.querySelectorAll('.wave-settings-field > select, .wave-settings-field > .gap-remove-number-control')) {
        if (!el.checkVisibility()) continue;
        const caption=el.parentElement.querySelector('.msw-option-label').getBoundingClientRect(), box=el.getBoundingClientRect();
        if (box.top<caption.bottom) issues.push(el.id+' overlaps caption');
      }
      return issues;
    });
    expect(issues).toEqual([]);
    await page.locator('#msw-tools-open').scrollIntoViewIfNeeded();
    await expect(page.locator('#msw-tools-open')).toBeInViewport();
    await page.screenshot({path:info.outputPath(`media-${width}-${language}.png`)});
    await page.locator('#msw-analysis-settings').evaluate(el => el.open=false);
    await page.locator('#waveform-settings-panel').evaluate(el => el.scrollTop=0);
    await page.screenshot({path:info.outputPath(`overview-${width}-${language}.png`)});
    if (language==='en') {
      expect(await page.locator('#waveform-settings-panel').innerText()).not.toMatch(/[\u3400-\u9fff]/u);
      await help(page, '#waveform-display-mode').click();
      await expect(page.locator('#msw-option-help')).toContainText('Single-row mode');
      await page.keyboard.press('Escape');
    }
  }
  expect(errors).toEqual([]);
});

test('portable editor keeps the draggable panel usable and explains unavailable media analysis', async ({page}) => {
  const portable = await startStaticServer(join(process.cwd(), 'blank-editor.html'), await findFreePort());
  try {
    await page.goto(portable.url); await toggleWaveSettings(page);
    const header=await page.locator('#wave-settings-drag-handle').boundingBox();
    const before=await page.locator('#wave-settings-modal').boundingBox();
    await page.mouse.move(header.x+80, header.y+25);
    await page.mouse.down(); await page.mouse.move(header.x-40, header.y-15,{steps:5}); await page.mouse.up();
    const after=await page.locator('#wave-settings-modal').boundingBox();
    expect(after.x).toBeLessThan(before.x-80);
    await page.locator('#msw-analysis-settings > summary').click();
    await expect(page.locator('#msw-analysis-unavailable')).toHaveText('媒体分析需要本机编辑器服务。');
    await expect(page.locator('#msw-analysis-controls')).toBeHidden();
    await page.locator('#waveform-display-mode').selectOption('basic');
    await expect(page.locator('#waveform-window-setting')).toBeVisible();
    await page.locator('#wave-settings-close').click();
    await expect(page.locator('#wave-settings-modal')).not.toHaveClass(/show/);
  } finally { await portable.stop(); }
});
