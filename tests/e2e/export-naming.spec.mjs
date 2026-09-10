import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { cleanupTempDir, clickMenubarItem, disableOnboarding, findFreePort, generateProjectJson, generateWav, makeTempDir, startServer } from './helpers.mjs';

let tempDir;
let server;
test.beforeAll(async () => {
  tempDir = makeTempDir('export-naming');
  const media = join(tempDir, 'synthetic.wav');
  const project = join(tempDir, 'project.mosp');
  generateWav(media, 10);
  generateProjectJson(project);
  server = await startServer(project, media, await findFreePort());
});
test.afterAll(async () => { await server?.stop(); cleanupTempDir(tempDir); });

for (const [language, suffix] of [['zh', '去空隙'], ['en', 'gap-removed']]) {
  test(`gap-removed SRT download uses ${language} and keeps protocol IDs`, async ({ page }) => {
    await disableOnboarding(page);
    await page.addInitScript((lang) => localStorage.setItem('mawe.language', lang), language);
    await page.goto(server.url);
    await page.waitForFunction(() => window.MSWE_I18N && typeof DATA !== 'undefined');
    await page.evaluate(() => {
      window.showSaveFilePicker = undefined;
      DATA.gap_remove = { schema: 'moy.asr.gap_remove.v1', detector: 'audio_gate', skip_playback: true, gaps: [{ start: 1500, end: 2000, removed: true }] };
      updateGapRemoveUi();
    });
    const download = page.waitForEvent('download');
    await clickMenubarItem(page, '文件', 'download-gap-removed-srt');
    expect((await download).suggestedFilename()).toBe(`project_${suffix}.srt`);
    expect(await page.evaluate(() => DATA.gap_remove.schema)).toBe('moy.asr.gap_remove.v1');
    expect(await page.evaluate(() => window.MSWE_I18N.exportTag('stickers'))).toBe(language === 'zh' ? '表情包' : 'stickers');
  });
}
