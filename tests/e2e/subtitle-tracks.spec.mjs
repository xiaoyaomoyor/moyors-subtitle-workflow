import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { disableOnboarding, findFreePort, generateBlankEditor, makeTempDir, startStaticServer } from './helpers.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/subtitle-tracks.json', import.meta.url), 'utf8'));
let server;
test.beforeAll(async () => {
  const dir = makeTempDir('subtitle-tracks');
  server = await startStaticServer(generateBlankEditor(join(dir, 'editor.html')), await findFreePort());
});
test.afterAll(async () => { await server?.stop(); });
test.beforeEach(async ({ page }) => { await disableOnboarding(page); await page.goto(server.url); });

test('portable build includes fixed ownership codec and migration survives JSON roundtrip', async ({ page }) => {
  const result = await page.evaluate(projects => {
    const core = window.MSWSubtitleTracks;
    return projects.map(f => {
      const p = core.migrate(f.project), reopened = JSON.parse(JSON.stringify(p));
      core.validate(reopened);
      const before = JSON.stringify(reopened.subtitle_tracks.assignments);
      reopened.segments.reverse();
      const index = core.createIndex(reopened);
      return { schema: p.schema, same: before === JSON.stringify(reopened.subtitle_tracks.assignments),
        visible: index.records().map(r => r.cue_id), count: index.records({ includeHidden: true }).length,
        tracks: p.subtitle_tracks.tracks.length };
    });
  }, fixtures);
  expect(result[0]).toMatchObject({ schema: 'msw.project.v3', same: true, count: 5, tracks: 2 });
  expect(result[1].visible).toEqual(['translated']);
  expect(result[2].tracks).toBe(1);
});

test('normal editor saves v3 and rejects future input, drop and restore without changing current edits', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  const old = { segments: [{ id: 'keep', start: 0, end: 2000, text: '保留当前工程' }] };
  await page.locator('#open-project-file').setInputFiles({ name: 'original.mosp', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await expect(page.locator('#json-name')).toHaveText('original.mosp');
  await page.locator('.cue[data-idx="0"]').first().click();
  await page.locator('#cue-panel-text').fill('保留尚未保存的修改');
  const before = await page.evaluate(() => window.MSWE.resolve('persistence-host').snapshot());
  expect(before.schema).toBe('msw.project.v3');
  const future = {...before,schema:'msw.project.v4'};
  await page.locator('#open-project-file').setInputFiles({ name: 'v3.mosp', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(future)) });
  await expect(page.locator('#hint-stack')).toContainText('版本不受支持');
  expect(await page.evaluate(() => MSWE.resolve('persistence-host').snapshot())).toEqual(before);
  await expect(page.locator('#json-name')).toHaveText('original.mosp');
  await page.evaluate(p => {
    document.querySelector('#hint-stack').replaceChildren();
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(p)], 'v3-drop.mosp', { type: 'application/json' }));
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, future);
  await expect(page.locator('#hint-stack')).toContainText('版本不受支持');
  const result = await page.evaluate(p => {
    const host = MSWE.resolve('persistence-host'), errors = [];
    for (const action of [() => host.restore({ project: p }),
      () => host.adopt({ project: p }, { source: JSON.stringify(host.snapshot()), newProject: true })]) {
      try { action(); errors.push(null); } catch (error) { errors.push(error.message); }
    }
    return { errors, snapshot: host.snapshot() };
  }, future);
  for (const error of result.errors) expect(error).toContain('版本不受支持');
  expect(result.snapshot).toEqual(before);
  const download = page.waitForEvent('download');
  await page.evaluate(() => MSWE.resolve('persistence-host').downloadLocal(null, 'normal.mosp'));
  const saved = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  expect(saved.schema).toBe('msw.project.v3');
  expect(saved.segments).toEqual(before.segments);
  expect(saved.subtitle_tracks).toEqual(before.subtitle_tracks);
});

test('stale browser file handles cannot overwrite a newer fixed-track file from v1 or v2 mode', async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const previous = MSWSubtitleTracks.migrate({ segments: [] });
    const handle = { getFile: async () => new File([JSON.stringify(previous)], 'upgraded.mosp') };
    const errors = [];
    for (const schema of ['moy.asr.project.v1', 'msw.project.v2']) {
      try { await layerProtectHandle(handle, { schema, segments: [] }, true); errors.push(null); }
      catch (error) { errors.push(error.message); }
    }
    return errors;
  });
  expect(errors).toHaveLength(2);
  for (const error of errors) expect(error).toContain('目标工程版本不兼容，未覆盖');
});

test('flat codec is available without switching the editor default', async ({ page }) => {
  const result = await page.evaluate(project => {
    const core=MSWFlatSubtitles,flat=core.migrate(project),index=core.createIndex(flat);
    const translated=index.resolveLegacy({role:'extension',track_id:'zh',cue_id:'a'});
    const target={...flat.subtitles.tracks[0],id:'free',name:'独立字幕'};
    const moved=core.move(core.addTrack(flat,target),[translated.id],target.id);
    const reopened=core.migrate(JSON.parse(JSON.stringify(moved)));
    return {schema:flat.schema,valid:core.validate(reopened),moved:core.createIndex(reopened).trackFor(translated.id).id,
      source:core.createIndex(reopened).resolveSource({id:'a',track_id:'zh'}).id,sameId:translated.id,
      bindingPreserved:JSON.stringify(moved.subtitles.bindings)===JSON.stringify(flat.subtitles.bindings),
      current:MSWE.resolve('persistence-host').snapshot().schema};
  },fixtures[0].project);
  expect(result).toMatchObject({schema:'msw.project.v4',valid:true,moved:'free',bindingPreserved:true,current:'msw.project.v3'});
  expect(result.source).toBe(result.sameId);
});

test('real v4 content cannot replace active edits or be overwritten by a stale handle', async ({ page }) => {
  const before=await page.evaluate(()=>MSWE.resolve('persistence-host').snapshot());
  const flat=await page.evaluate(project=>MSWFlatSubtitles.migrate(project),fixtures[0].project);
  expect(flat.segments).toBeUndefined();
  await page.locator('#open-project-file').setInputFiles({name:'flat.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(flat))});
  await expect(page.locator('#hint-stack')).toContainText('版本不受支持');
  expect(await page.evaluate(()=>MSWE.resolve('persistence-host').snapshot())).toEqual(before);
  const errors=await page.evaluate(async project=>{
    const handle={getFile:async()=>new File([JSON.stringify(project)],'flat.mosp')};
    const errors=[];
    for(const schema of ['moy.asr.project.v1','msw.project.v2','msw.project.v3']) {
      const source=schema==='msw.project.v3'?MSWSubtitleTracks.migrate({segments:[]}):schema==='msw.project.v2'?MSWSubtitleLayers.migrate({segments:[]}):{schema,segments:[]};
      try {await layerProtectHandle(handle,source,true);errors.push(null);}
      catch(error){errors.push(error.message);}
    }
    return errors;
  },flat);
  expect(errors).toHaveLength(3);
  for(const error of errors)expect(error).toContain('目标工程版本不兼容，未覆盖');
});
