// ASS 导出 UI 回归：验证编辑器当前选中的字体、字号和颜色确实写进保存的文件。
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTempDir, clickMenubarItem, disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, startServer, toggleMediaSettings } from './helpers.mjs';

const DURATION_MS = 4_000;

function generateAssProjectJson(filePath) {
  const project = {
    media: 'synthetic.wav',
    segments: [
      { start: 1000, end: 2500, text: '第一行\nSecond, {literal}\\path' },
      { start: 3000, end: 3500, text: '不应导出', disabled: true },
    ],
    preview: {
      subtitle: {
        x: 0.1,
        y: 0.76,
        width: 0.8,
        height: 0.16,
        font_size: 32,
        font_family: 'yahei',
        color: '#123456',
      },
    },
    waveform: generateWaveformPayload(DURATION_MS),
  };
  writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
  return filePath;
}

async function stubSavePicker(page) {
  await page.addInitScript(() => {
    window.__exportSaves = [];
    window.showSaveFilePicker = async (options) => ({
      name: options.suggestedName,
      async createWritable() {
        return {
          async write(blob) {
            window.__exportSaves.push({
              suggestedName: options.suggestedName,
              content: await blob.text(),
            });
          },
          async close() {},
        };
      },
    });
  });
}

let tempDir;
let server;

test.beforeEach(async () => {
  tempDir = makeTempDir('ass-export');
  const mediaPath = join(tempDir, 'synthetic.wav');
  const projectPath = join(tempDir, 'project.json');
  generateWav(mediaPath, DURATION_MS / 1000);
  generateAssProjectJson(projectPath);
  server = await startServer(projectPath, mediaPath, await findFreePort());
});

test.afterEach(async () => {
  await server?.stop();
  cleanupTempDir(tempDir);
});

test('exports ASS with the current font, size, color and enabled subtitle text', async ({ page }) => {
  await disableOnboarding(page);
  await stubSavePicker(page);
  await page.goto(server.url);
  await expect.poll(() => page.evaluate(() => window.MSWSubtitleStyle?.ready)).toBe(true);

  await toggleMediaSettings(page);
  await expect(page.locator('#subtitle-preview-settings-panel')).toBeVisible();
  await page.locator('#style-field-fontName').fill('SimHei');
  await page.locator('#style-field-fontName').dispatchEvent('change');
  await page.locator('#style-field-fontSize').fill('40');
  await page.locator('#style-field-fontSize').dispatchEvent('change');
  await page.locator('#style-field-primaryColor').evaluate((input) => {
    input.value = '#12abef';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await clickMenubarItem(page, '文件', 'subtitle-export-btn');
  await expect(page.locator('#download-full-ass')).toHaveText('主字幕（ASS）');
  await clickMenubarItem(page, '文件', 'download-full-ass');

  await expect.poll(() => page.evaluate(() => window.__exportSaves.length)).toBe(1);
  const save = await page.evaluate(() => window.__exportSaves[0]);
  expect(save.suggestedName).toMatch(/\.ass$/);
  expect(save.content).toContain(
    'Style: main,SimHei,40,&H00EFAB12,',
  );
  expect(save.content).toContain(
    'Dialogue: 1,0:00:01.00,0:00:02.50,main,,0,0,151,,第一行\\NSecond, \\{literal\\}\\\\path',
  );
  expect(save.content).not.toContain('不应导出');
});

test('writes the project title, source resolution, palette styles and speaker names to ASS', async ({ page }) => {
  await disableOnboarding(page);
  await stubSavePicker(page);
  await page.goto(server.url);
  await expect.poll(() => page.evaluate(() => window.MSWSubtitleStyle?.ready)).toBe(true);
  await page.evaluate(() => {
    DATA.media_metadata = { video_width: 3840, video_height: 2160 };
    window.MSWProjectStyle.apply(DATA, {...window.MSWProjectStyle.defaults(), main:{...window.MSWProjectStyle.defaults().main,fontName:'Arial',fontSize:128}});
    DATA.segments = [
      { start: 0, end: 1000, text: 'red line', items: [], color: { name: 'red', value: '#f07f6f' } },
      { start: 1200, end: 2200, text: 'plain line', items: [] },
    ];
    DATA.preview.subtitle = {
      ...DATA.preview.subtitle,
      font_size: 32,
      font_family: 'sans',
      color: '#ffffff',
      speaker_labels: {
        mapping_enabled: true,
        enabled: true,
        separator: '：',
        names: { yellow: '主持', green: '嘉宾', red: '旁白', purple: '现场', blue: '字幕' },
      },
    };
    EDITOR_SETTINGS.exportSpeakerLabels = true;
    renderAll();
  });

  await clickMenubarItem(page, '文件', 'download-full-ass');

  await expect.poll(() => page.evaluate(() => window.__exportSaves.length)).toBe(1);
  const save = await page.evaluate(() => window.__exportSaves[0]);
  expect(save.content).toContain('Title: project');
  expect(save.content).toContain('PlayResX: 1920');
  expect(save.content).toContain('PlayResY: 1080');
  expect(save.content).toContain('Style: Default,Arial,128,');
  expect(save.content).toContain('Style: YELLOW,Arial,128,&H0019A0C4,&H0019A0C4,');
  expect(save.content).toContain('Style: GREEN,Arial,128,&H006ABB66,&H006ABB66,');
  expect(save.content).toContain('Style: RED,Arial,128,&H006F7FF0,&H006F7FF0,');
  expect(save.content).toContain('Style: PURPLE,Arial,128,&H00E689BF,&H00E689BF,');
  expect(save.content).toContain('Style: BLUE,Arial,128,&H00FAA761,&H00FAA761,');
  expect(save.content.replace(/\{\\[^}]*\}/g, '')).toContain('Dialogue: 0,0:00:00.00,0:00:01.00,RED,旁白,0,0,96,,旁白：red line');
});

test('keeps MSW main and secondary export organization with color splitting', async ({ page }) => {
  await disableOnboarding(page);
  await page.goto(server.url);
  await expect.poll(() => page.evaluate(() => window.MSWSubtitleStyle?.ready)).toBe(true);
  await page.evaluate(() => {
    DATA.segments[0].color = { name: 'red', value: '#e74c3c', start: 1000, end: 2500 };
    renderAll();
  });

  await clickMenubarItem(page, '文件', 'subtitle-export-btn');
  await expect(page.locator('#subtitle-export-menu > .dropdown-item:visible').allTextContents())
    .resolves.toEqual(['主字幕（SRT）', 'SRT（合并同时显示文本）', '主字幕（ASS）', '按颜色导出字幕']);
});

test('exports a gap-removed styled ASS subtitle with shifted timing', async ({ page }) => {
  await disableOnboarding(page);
  await stubSavePicker(page);
  await page.goto(server.url);
  await expect.poll(() => page.evaluate(() => window.MSWSubtitleStyle?.ready)).toBe(true);
  await page.evaluate(() => {
    window.MSWProjectStyle.apply(DATA, window.MSWProjectStyle.defaults());
    DATA.segments.length = 0;
    DATA.segments.push(
      { id: 'before-gap', start: 1000, end: 2000, text: 'before gap', items: [], color: { name: 'red', value: '#e74c3c', start: 1000, end: 2000 } },
      { id: 'after-gap', start: 4000, end: 5000, text: 'after gap', items: [] },
    );
    DATA.gap_remove = {
      schema: 'moy.asr.gap_remove.v1',
      detector: 'audio_gate',
      minimum_ms: 500,
      threshold_db: -24,
      hysteresis_db: 2,
      lead_in_ms: 40,
      lead_out_ms: 80,
      skip_playback: true,
      operation_mode: 'boundary_drag',
      manual_corrections: false,
      gaps: [{ start: 2000, end: 3000, removed: true }],
    };
    updateGapRemoveUi();
    renderAll();
  });

  await clickMenubarItem(page, '文件', 'gap-removed-export-btn');
  await expect(page.locator('#gap-removed-export-menu > .dropdown-item:visible').allTextContents())
    .resolves.toEqual(['字幕 SRT', '带样式的 ASS 字幕', '按颜色导出字幕']);

  await page.locator('#download-gap-removed-ass').click();
  await expect.poll(() => page.evaluate(() => window.__exportSaves.length)).toBe(1);
  const save = await page.evaluate(() => window.__exportSaves[0]);
  expect(save.suggestedName).toBe('project_去空隙.ass');
  expect(save.content).toContain(
    'Dialogue: 0,0:00:01.00,0:00:02.00,RED,,0,0,96,,before gap',
  );
  expect(save.content).toContain(
    'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,96,,after gap',
  );
});

test('project style snapshots survive library edits and freeze each video job', async ({ page }, testInfo) => {
  await disableOnboarding(page);
  await page.goto(server.url+'?subtitle-layers=0');
  await expect.poll(() => page.evaluate(() => window.MSWSubtitleStyle?.ready)).toBe(true);
  const result = await page.evaluate(() => {
    const host = window.MSWE.resolve('processing-host');
    const library = window.AsrEditorUtils.normalizeAssStyleLibrary({
      styles: [{ id: 'test-style', fontName: 'Snapshot Font', fontSize: 42 }],
      assProfiles: [{ id: 'test-profile', styleId: 'test-style' }],
      assignments: { assExportProfileId: 'test-profile' },
    });
    ASS_STYLE_LIBRARY = library;
    DATA.schema = 'moy.asr.project.v1';
    delete DATA.subtitle_layers;
    window.MSWProjectStyle.apply(DATA, window.MSWProjectStyle.defaults());
    DATA.overlay_track = { enabled: true, segments: [{ id: 'overlay', start: 1000, end: 2000, text: 'overlay' }] };
    DATA.multi_subtitle = { enabled: true, tracks: [{ id: 'secondary', segments: [{ id: 'second', start: 1000, end: 2000, text: 'second' }] }] };
    const legacy = buildAss();
    window.MSWProjectStyle.apply(DATA, window.MSWProjectStyle.fromLibrary(library));
    const explicit = buildAss();
    const job = host.exportProject();
    const persisted = JSON.parse(buildJson());
    ASS_STYLE_LIBRARY.styles.find(style => style.id === 'test-style').fontName = 'Changed Later';
    host.openMediaSettings();
    return { legacy, explicit, job, persisted };
  });
  expect(result.legacy).not.toContain('Snapshot Font');
  expect(result.legacy).toContain('Extension,,0,0,0,,second');
  expect(result.explicit).toContain('Style: Default,Snapshot Font,');
  expect(result.explicit).toContain('Overlay,,0,0,0,,overlay');
  expect(result.job.preview.project_style.main.fontName).toBe('Snapshot Font');
  expect(result.persisted.preview.project_style.main.fontName).toBe('Snapshot Font');
  expect(result.persisted.preview.burn_ass_library).toBeUndefined();
  await page.locator('#style-save-as').click();
  await expect(page.locator('#style-save-form')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('ass-library.png'), fullPage: true });
});

test('dynamic exports use source canvas size and reject invalid custom sizes', async ({ page }) => {
  await disableOnboarding(page);
  await page.goto(server.url);
  await expect.poll(() => page.evaluate(() => window.MSWSubtitleStyle?.ready)).toBe(true);
  const result = await page.evaluate(() => {
    DATA.media_metadata = { video_width: 1440, video_height: 1080 };
    openLottieExportModal();
    const source = lottieExportCanvasSize();
    lottieExportCustomWidth.value = '15';
    let message = '';
    try { lottieExportCanvasSize(); } catch (error) { message = error.message; }
    return { source, message };
  });
  expect(result.source).toEqual({ width: 1440, height: 1080 });
  expect(result.message).toContain('16–7680');
});

for(const legacy of [false,true])test(`character wrapping reaches full, gap-removed and secondary ASS without changing SRT (${legacy?'legacy':'modern'})`,async({page})=>{
  await disableOnboarding(page);await stubSavePicker(page);await page.goto(server.url);await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle.ready)).toBe(true);
  const data=await page.evaluate(legacy=>{
    const S=window.MSWProjectStyle,h=window.MSWE.resolve('processing-host'),p=h.data,style=legacy?S.fromBurn({}):S.defaults();
    style.main.wrapMode='characters';style.main.charsPerLine=3;style.secondary.wrapMode='characters';style.secondary.charsPerLine=2;
    p.segments=[{id:'m',start:0,end:1000,text:'ABCDEF',items:[]}];p.multi_subtitle={schema:'moy.asr.multi_subtitle.v1',enabled:true,tracks:[{id:'s',role:'extension',segments:[{id:'s1',start:0,end:1000,text:'甲乙丙丁',items:[]}]}],bindings:[]};
    p.gap_remove={schema:'moy.asr.gap_remove.v1',gaps:[{start:2000,end:3000,removed:true}],skip_playback:true};
    h.commitProjectStyle(style);dispatchEvent(new Event('msw:subtitles-changed'));updateGapRemoveUi();renderAll();
    return {ass:buildAss(),gapAss:buildGapRemovedAss(),srt:buildExtensionSrt(),source:JSON.parse(buildJson()).segments};
  },legacy);
  for(const ass of [data.ass,data.gapAss]){expect(ass).toContain('ABC\\NDEF');expect(ass).toContain('甲乙\\N丙丁');}
  expect(data.srt).toContain('甲乙丙丁');expect(data.source[0].text).toBe('ABCDEF');
  await clickMenubarItem(page,'文件','download-ext-ass');await expect.poll(()=>page.evaluate(()=>window.__exportSaves.length)).toBe(1);
  const saved=await page.evaluate(()=>window.__exportSaves[0]);expect(saved.content).toContain('甲乙\\N丙丁');expect(saved.content).not.toContain('ABC');
});
