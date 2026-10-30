import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanupTempDir,
  findFreePort,
  generateWav,
  generateWaveformPayload,
  makeTempDir,
  startServer
} from './helpers.mjs';

let tempDir;
let server;

test.beforeAll(async () => {
  tempDir = makeTempDir('timed-text-edit');
  process.env.MAW_ENV_FILE=join(tempDir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(tempDir,'app-data');
  const mediaPath = join(tempDir, 'synthetic.wav');
  const projectPath = join(tempDir, 'timed-text.json');
  generateWav(mediaPath, 3);
  writeFileSync(projectPath, JSON.stringify({
    media: 'synthetic.wav',
    waveform: generateWaveformPayload(3000),
    segments: [
      {
        id: 'cue-1', start: 0, end: 1000, text: '就是这颗',
        items: [
          { start: 0, end: 400, text: '就是' },
          { start: 400, end: 1000, text: '这颗' },
        ],
      },
      {
        id: 'cue-2', start: 1200, end: 2200, text: 'abc',
        items: [
          { start: 1200, end: 1500, text: 'a' },
          { start: 1500, end: 1800, text: 'b' },
          { start: 1800, end: 2200, text: 'c' },
        ],
      },
      {
        id: 'cue-3', start: 2300, end: 2800, text: 'disabled', disabled: true,
        items: [{ start: 2300, end: 2800, text: 'disabled' }],
      },
    ],
  }, null, 2), 'utf8');
  server = await startServer(projectPath, mediaPath, await findFreePort());
});

test.afterAll(async () => {
  await server?.stop();
  cleanupTempDir(tempDir);
});

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.onboarding.v1','completed'));await page.goto(server.url);await page.evaluate(()=>MSWFindEdit.open({view:'edit'}));});
test('keeps unchanged text inert without a redundant toast',async({page})=>{
 await expect(page.locator('#find-edit-apply')).toBeDisabled();await expect(page.locator('#find-edit-panel')).toBeVisible();
 await expect(page.locator('#hint-stack .hint-card.hint-invalid')).toHaveCount(0);
});
test('continuous text retains drafts and applies the original item-timing mapping',async({page})=>{
 const rows=page.locator('#find-edit-rows textarea');await expect(rows).toHaveCount(3);
 await rows.nth(0).fill('就是那颗');await rows.nth(1).fill('abXc');
 await expect(page.locator('#find-edit-message')).toContainText('修改 2 条');await page.locator('#find-edit-close').click();
 await page.evaluate(()=>MSWFindEdit.open({view:'edit'}));await expect(rows.nth(0)).toHaveValue('就是那颗');await expect(rows.nth(1)).toHaveValue('abXc');
 await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();
 const state=await page.evaluate(()=>({texts:DATA.segments.map(c=>c.text),items:DATA.segments.map(c=>c.items?.map(({start,end,text})=>({start,end,text}))),ranges:DATA.segments.map(c=>[c.start,c.end]),dirty:DATA.segments.map(c=>!!c._dirty)}));
 expect(state.texts).toEqual(['就是那颗','abXc','disabled']);expect(state.ranges).toEqual([[0,1000],[1200,2200],[2300,2800]]);expect(state.dirty).toEqual([true,true,false]);
 expect(state.items[0]).toEqual([{start:0,end:400,text:'就是'},{start:400,end:1000,text:'那颗'}]);
 expect(state.items[1]).toEqual([{start:1200,end:1500,text:'a'},{start:1500,end:1800,text:'bX'},{start:1800,end:2200,text:'c'}]);
});
test('shows disabled subtitles without changing their state or untouched text',async({page})=>{
 const rows=page.locator('#find-edit-rows textarea');await expect(rows).toHaveCount(3);await expect(page.locator('.find-result-status').nth(2)).toHaveText('已禁用');
 await rows.nth(0).fill('就是那颗！');await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();
 const state=await page.evaluate(()=>({texts:DATA.segments.map(c=>c.text),disabled:DATA.segments.map(c=>!!c.disabled)}));expect(state.texts).toEqual(['就是那颗！','abc','disabled']);expect(state.disabled).toEqual([false,false,true]);
});
test('group text retains multiline cue boundaries and original word timing',async({page})=>{
 await page.locator('#find-edit-group').selectOption('track');
 const input=page.locator('#find-edit-rows textarea').first();
 await input.fill((await input.inputValue()).replace('就是这颗','就是那颗').replace('abc','abXc'));
 await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();
 expect(await page.evaluate(()=>DATA.segments.map(c=>c.text))).toEqual(['就是那颗','abXc','disabled']);
 expect(await page.evaluate(()=>DATA.segments[1].items.map(({start,end,text})=>({start,end,text})))).toEqual([{start:1200,end:1500,text:'a'},{start:1500,end:1800,text:'bX'},{start:1800,end:2200,text:'c'}]);
});
