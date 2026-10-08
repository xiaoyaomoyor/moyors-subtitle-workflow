import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { cleanupTempDir, generateBlankEditor, findFreePort, generateWaveformPayload, generateWav, makeTempDir, startStaticServer } from './helpers.mjs';

let tempDir, server;
test.beforeAll(async () => {
  tempDir = makeTempDir('subtitle-layers');
  if (process.env.MSW_LAYER_EVIDENCE) mkdirSync(process.env.MSW_LAYER_EVIDENCE, { recursive: true });
  server = await startStaticServer(generateBlankEditor(join(tempDir, 'blank.html')), await findFreePort());
});
test.afterAll(async () => { await server?.stop(); cleanupTempDir(tempDir); });
async function open(page, segments, extra = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('moy.asr.editor.onboarding.v1', 'skipped'));
  await page.goto(server.url + '?subtitle-layers=1');
  await page.evaluate(project => {
    applyCanonicalProject(project, 'layers.mosp');
    waveformEditor.settings.mode = 'multi'; waveformEditor.settings.secondsPerRow = 10;
    waveformEditor.settings.rowHeight = 140; waveformEditor.render();
  }, { segments, waveform: generateWaveformPayload(30000), ...extra });
  expect(errors).toEqual([]);
  return errors;
}
const cue = (id, start, end, text = id) => ({ id, start, end, text, items: [] });
async function times(page) { return page.evaluate(() => Object.fromEntries(DATA.segments.map(c => [c.id, [c.start, c.end]]))); }

test('nested overlaps render all layers across rows and light all active cards', async ({ page }) => {
  const errors = await open(page, [cue('long', 0, 22000), cue('b', 1000, 18000), cue('c', 2000, 16000), cue('d', 3000, 14000), cue('next', 22000, 24000)]);
  const row = page.locator('.waveform-row[data-start-ms="0"]');
  await expect(row.locator('.waveform-cue-block')).toHaveCount(4);
  const boxes = await row.locator('.waveform-cue-block').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.cueId, layer: node.dataset.subtitleLayer, y: node.getBoundingClientRect().y, h: node.getBoundingClientRect().height })));
  expect(new Set(boxes.map(b => b.layer)).size).toBe(4);
  expect(new Set(boxes.map(b => b.y)).size).toBe(4);
  const across = await page.locator('.waveform-cue-block[data-cue-id="long"]').evaluateAll(nodes => nodes.map(n => n.dataset.subtitleLayer));
  expect(new Set(across).size).toBe(1);
  await page.evaluate(() => { waveformEditor.currentTimeMs = () => 5000; updateCueListPlayback(5000); waveformEditor.updatePlayback(false); });
  await expect(page.locator('#cues-container > .cue.playhead-hit')).toHaveCount(4);
  await expect(row.locator('.waveform-cue-block.active')).toHaveCount(4);
  await page.screenshot({ path: join(process.env.MSW_LAYER_EVIDENCE || tempDir, 'four-layers.png') });
  await page.evaluate(() => updateCueListPlayback(22000));
  await expect(page.locator('#cues-container > .cue.playhead-hit')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('cross-row dragging preserves ID selection and unrelated overlap times, with one undo', async ({ page }) => {
  const errors = await open(page, [cue('a', 0, 6000), cue('b', 1000, 4000), cue('c', 5000, 9000)]);
  const block = await page.locator('.waveform-cue-block[data-cue-id="b"]').first().boundingBox();
  const nextRow = await page.locator('.waveform-row[data-start-ms="10000"]').boundingBox();
  await page.mouse.move(block.x + block.width / 2, block.y + block.height / 2);
  await page.mouse.down();
  await page.mouse.move(nextRow.x + nextRow.width * .25, nextRow.y + nextRow.height / 2, { steps: 10 });
  await page.mouse.up();
  const moved = await times(page);
  expect(moved.a).toEqual([0, 6000]); expect(moved.c).toEqual([5000, 9000]);
  expect(moved.b[0]).toBeGreaterThan(9000); expect(moved.b[1] - moved.b[0]).toBe(3000);
  expect(await page.evaluate(() => [...selectedIdxs].map(i => DATA.segments[i].id))).toEqual(['b']);
  await page.evaluate(() => performUndo());
  expect(await times(page)).toEqual({ a: [0, 6000], b: [1000, 4000], c: [5000, 9000] });
  expect(errors).toEqual([]);
});

test('shared edges join the same layer even with another cue between their array indexes', async ({ page }) => {
  await open(page, [cue('left', 0, 3000), cue('nested', 1000, 7000), cue('right', 3000, 6000)]);
  const left = page.locator('.waveform-cue-block[data-cue-id="left"]').first();
  const box = await left.boundingBox();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await expect(page.locator('.waveform-cue-handle.edge-hot')).toHaveCount(2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width + 30, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  const values = await times(page);
  expect(values.left[1]).toBeGreaterThan(3000); expect(values.left[1]).toBe(values.right[0]);
  expect(values.nested).toEqual([1000, 7000]);
  await page.evaluate(() => performUndo());
  const restored = await page.locator('.waveform-cue-block[data-cue-id="left"]').first().boundingBox();
  await page.mouse.move(restored.x + restored.width - 6, restored.y + restored.height / 2);
  await expect(page.locator('.waveform-cue-handle.edge-hot')).toHaveCount(1);
  await page.mouse.down(); await page.mouse.move(restored.x + restored.width + 20, restored.y + restored.height / 2, { steps: 5 }); await page.mouse.up();
  expect((await times(page)).right).toEqual([3000, 6000]);
});

test('merge directly combines only selected nonadjacent entries and paste preserves colors and identity', async ({ page }) => {
  await open(page, [{ ...cue('a', 0, 5000), color: { name: 'purple' } }, cue('other', 1000, 7000), cue('c', 2000, 4000)]);
  await page.evaluate(() => mergeSegments([0, 2]));
  await expect(page.locator('.msw-layer-merge')).toHaveCount(0);
  expect(await page.evaluate(() => DATA.segments.find(c => c.id !== 'other').text)).toMatch(/a\s*c/);
  const values = await times(page); expect(values.other).toEqual([1000, 7000]); expect(Object.keys(values)).toHaveLength(2);
  await page.evaluate(() => performUndo());
  await page.evaluate(() => { selectOnly(0); copySelectedCues(); pasteCuesFromClipboard(); });
  const selected = await page.evaluate(() => [...selectedIdxs].map(i => DATA.segments[i]));
  expect(selected).toHaveLength(1); expect(selected[0].id).not.toBe('a'); expect(selected[0].color.name).toBe('purple');
  expect(selected[0].start).toBe(0);
  await page.evaluate(() => performUndo());
  expect(await times(page)).toEqual({ a: [0, 5000], other: [1000, 7000], c: [2000, 4000] });
});

test('two simultaneous bilingual cards retain explicit sub edit target and all playhead feedback', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/subtitle-layers.json', import.meta.url))).find(f => f.name === 'bound-bilingual').project;
  const errors = await open(page, fixture.segments, fixture);
  await page.evaluate(() => { selectOnlyExtension(1, getActiveExtensionTrack()); setCurrentCuePanelExtensionIndex(1); updateCueListPlayback(2500); });
  await expect(page.locator('#cues-container > .cue.playhead-hit')).toHaveCount(2);
  const target = await page.evaluate(() => ({ role: currentCuePanelKind, id: getCurrentCuePanelTarget()?.segment.id, anchor: layerPlaybackElement(2500)?.dataset.extIdx }));
  expect(target).toEqual({ role: 'extension', id: 'b', anchor: '1' });
  const selectedCard = page.locator('#cues-container > .cue[data-ext-idx="1"]');
  await expect(selectedCard.locator('.multi-cue-column.selected')).toHaveCount(1);
  await expect(selectedCard.locator('.multi-cue-column.related-selected')).toHaveCount(1);
  expect(await selectedCard.locator('.multi-cue-column.selected').evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
  expect(await selectedCard.locator('.multi-cue-column.related-selected').evaluate(node => getComputedStyle(node).outlineStyle)).toBe('dashed');
  await page.locator('#cue-panel-text').fill('Edited B');
  await page.locator('#cue-panel-target').click();
  const text = await page.evaluate(() => getActiveExtensionTrack().segments.map(c => c.text));
  expect(text).toEqual(['A translation', 'Edited B']);
  expect(await page.evaluate(() => getMultiSubtitleState().bindings.length)).toBe(2);
  await page.evaluate(() => { updateCueListPlayback(2600); updateCueListPlayback(2900); });
  expect(await page.evaluate(() => getCurrentCuePanelTarget()?.segment.id)).toBe('b');
  expect(errors).toEqual([]);
});

test('creating inside another cue preserves neighbours and is one undo', async ({ page }) => {
  await open(page, [cue('long', 0, 16000), cue('other', 2000, 6000)]);
  await page.evaluate(() => addCueRangeFromWaveform(3000, 5000, 0, 0));
  expect(await times(page)).toMatchObject({ long: [0, 16000], other: [2000, 6000] });
  await expect(page.locator('#cues-container > .cue')).toHaveCount(3);
  await page.evaluate(() => performUndo());
  expect(await times(page)).toEqual({ long: [0, 16000], other: [2000, 6000] });
  await page.evaluate(() => performRedo());
  await expect(page.locator('#cues-container > .cue')).toHaveCount(3);
});

test('old hidden overlay stays hidden in production export and survives roundtrip', async ({ page }) => {
  await open(page, [cue('main', 0, 3000)], { overlay_track: { enabled: false, segments: [cue('hidden', 500, 2500)] } });
  expect(await page.evaluate(() => DATA.segments.length)).toBe(2);
  await expect(page.locator('#cues-container > .cue')).toHaveCount(1);
  expect(await page.evaluate(() => buildSrt())).not.toContain('hidden');
  const snapshot = await page.evaluate(() => JSON.parse(buildJson()));
  expect(snapshot.schema).toBe('msw.project.v2');
  expect(snapshot.subtitle_layers.legacy_overlay).toEqual({ visible: false, cue_ids: ['hidden'] });
  await page.evaluate(() => { DATA.subtitle_layers.legacy_overlay.visible = true; renderAll(); });
  await expect(page.locator('#cues-container > .cue')).toHaveCount(2);
});

test('ASS filtering resolves original color heads and aligns the first visible enabled cue',async({page})=>{
 await open(page,[{...cue('disabled',0,500),disabled:true},cue('head',2000,3000),cue('child',3000,4000)],
  {overlay_track:{enabled:false,segments:[{...cue('hidden',800,1500),disabled:true}]}});
 const result=await page.evaluate(()=>{
  const head=DATA.segments.findIndex(c=>c.id==='head'),child=DATA.segments.find(c=>c.id==='child');
  DATA.segments[head].color={name:'red',start:2000,end:3000};child.color_ref={headIdx:head};
  updateEditorSettings({assMode:true,exportStartAtZero:true});setSubtitleAppearance({ass_color_style:'text'});
  const before=JSON.stringify(DATA.segments),ass=buildAss();return {ass,before,after:JSON.stringify(DATA.segments)};
 });
 const events=result.ass.split('\n').filter(l=>l.startsWith('Dialogue:')).map(l=>l.split(','));
 expect(events).toHaveLength(2);expect(events[0][1]).toBe('0:00:00.00');expect(events.every(e=>e[3]==='RED')).toBe(true);
 expect(result.after).toBe(result.before);
});

test('splitting and deleting a nested cue preserve other layers and undo atomically', async ({ page }) => {
  const errors = await open(page, [cue('long', 0, 15000), cue('split', 2000, 6000, 'one two'), cue('other', 3000, 9000)]);
  await page.evaluate(() => {
    startEdit(container.querySelector('.cue[data-idx="1"]'), 1);
    setEditingCaretOffset(4); splitAtCursor();
  });
  expect(await page.evaluate(() => DATA.segments.length)).toBe(4);
  expect(await times(page)).toMatchObject({ long: [0, 15000], other: [3000, 9000] });
  await page.evaluate(() => performUndo());
  expect(await times(page)).toEqual({ long: [0, 15000], split: [2000, 6000], other: [3000, 9000] });
  await page.evaluate(() => deleteSegments([1]));
  expect(await times(page)).toEqual({ long: [0, 15000], other: [3000, 9000] });
  await page.evaluate(() => performUndo());
  expect(await times(page)).toEqual({ long: [0, 15000], split: [2000, 6000], other: [3000, 9000] });
  expect(errors).toEqual([]);
});

test('overlap preference blocks new keyboard/scale collisions, without hiding existing layers', async ({ page }) => {
  await open(page, [cue('a', 0, 3000), cue('nested', 1000, 2500), cue('b', 5000, 7000)]);
  await page.evaluate(() => {
    DATA.subtitle_layers.allow_overlap = false;
    renderAll(); selectOnly(2); waveformEditor.adjustSelectedByKeyboard(-3000);
  });
  expect((await times(page)).b).toEqual([5000, 7000]);
  await expect(page.locator('#cues-container > .cue')).toHaveCount(3);
  await page.evaluate(() => {
    DATA.subtitle_layers.allow_overlap = true;
    waveformEditor.adjustSelectedByKeyboard(-3000);
  });
  expect(await times(page)).toEqual({ a: [0, 3000], nested: [1000, 2500], b: [2000, 4000] });
  await page.evaluate(() => performUndo());
  expect((await times(page)).b).toEqual([5000, 7000]);
  await page.evaluate(() => { selectOnly(2); waveformEditor.adjustSelectedBoundaryByKeyboard(-4000, 'start'); });
  expect((await times(page)).b).toEqual([1000, 7000]);
  expect((await times(page)).nested).toEqual([1000, 2500]);
});

test('moving a bound main cue moves only its own translation and cancellation restores both', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/subtitle-layers.json', import.meta.url))).find(f => f.name === 'bound-bilingual').project;
  await open(page, fixture.segments, fixture);
  await page.evaluate(() => { selectOnly(1); waveformEditor.adjustSelectedByKeyboard(2000); });
  expect(await page.evaluate(() => getActiveExtensionTrack().segments.map(c => [c.id, c.start, c.end]))).toEqual([['a', 0, 5000], ['b', 4000, 6000]]);
  expect(await times(page)).toEqual({ a: [0, 5000], b: [4000, 6000] });
  await page.evaluate(() => performUndo());
  expect(await page.evaluate(() => getActiveExtensionTrack().segments.map(c => [c.id, c.start, c.end]))).toEqual([['a', 0, 5000], ['b', 2000, 4000]]);
  const history = await page.evaluate(() => [editorHistory.undoLength(), editorHistory.redoLength()]);
  const block = await page.locator('.waveform-cue-block[data-track="main"][data-cue-id="b"]').first().boundingBox();
  await page.mouse.move(block.x + block.width / 2, block.y + block.height / 2); await page.mouse.down();
  await page.mouse.move(block.x + block.width / 2 + 60, block.y + block.height / 2, { steps: 5 });
  await page.evaluate(() => waveformEditor.cancelCueDrag()); await page.mouse.up();
  expect(await times(page)).toEqual({ a: [0, 5000], b: [2000, 4000] });
  expect(await page.evaluate(() => getActiveExtensionTrack().segments.map(c => [c.id, c.start, c.end]))).toEqual([['a', 0, 5000], ['b', 2000, 4000]]);
  expect(await page.evaluate(() => [editorHistory.undoLength(), editorHistory.redoLength()])).toEqual(history);
});

test('context menu targets the hit layer above a time selection and exposes ordinary processing selection', async ({ page }) => {
  await open(page, [cue('a', 0, 8000), cue('b', 2000, 6000)]);
  await page.evaluate(() => MSWE.resolve('time-range').setRange({ start: 0, end: 10000 }));
  await page.locator('.waveform-cue-block[data-cue-id="b"]').first().click({ button: 'right' });
  const menu = page.locator('#ctxmenu.show');
  await expect(menu).toContainText('翻译所选字幕');
  await expect(menu).toContainText('配音所选字幕（TTS）');
  await expect(menu).toContainText('复制到素材库');
  await expect(menu).not.toContainText('转为叠加字幕');
  await expect(menu).not.toContainText('清除时间选区');
  const selection = await page.evaluate(() => {
    const host = MSWE.resolve('processing-host');
    return { tts: MSWTts.snapshot(DATA, host.selection(), 'main').entries.map(e => e.id),
      translation: MSWTranslation.snapshot(DATA, host.selection()).entries.map(e => e.source.id) };
  });
  expect(selection).toEqual({ tts: ['b'], translation: ['b'] });
  await menu.getByText('复制到素材库', { exact: true }).click();
  expect(await page.evaluate(() => DATA.msw.subtitle_assets.length)).toBe(1);
  expect(await page.evaluate(() => DATA.msw.subtitle_assets[0].text)).toBe('b');
});

test('full repaint and basic waveform keep all eight layers inside the row', async ({ page }) => {
  await open(page, Array.from({ length: 8 }, (_, i) => cue(`cue-${i}`, i * 100, 8000)));
  await page.evaluate(() => { waveformEditor.settings.mode = 'basic'; renderAll({ waveform: 'full' }); });
  await expect(page.locator('.waveform-cue-block')).toHaveCount(8);
  const fit = await page.locator('.waveform-row').evaluate(row => {
    const r = row.getBoundingClientRect();
    return [...row.querySelectorAll('.waveform-cue-block')].every(block => {
      const b = block.getBoundingClientRect(); return b.top >= r.top && b.bottom <= r.bottom + 1;
    });
  });
  expect(fit).toBe(true);
  await page.evaluate(() => { selectOnly(0); waveformEditor.adjustSelectedByKeyboard(1000); });
  await expect(page.locator('.waveform-cue-block')).toHaveCount(8);
});

test('dropping a v2 file preserves nested times and time scaling only touches selected IDs', async ({ page }) => {
  await open(page, []);
  await page.evaluate(() => {
    const project = MSWSubtitleLayers.migrate({ segments: [
      { id: 'long', start: 0, end: 12000, text: 'long' },
      { id: 'short', start: 2000, end: 4000, text: 'short' },
    ] });
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(project)], 'development.mosp', { type: 'application/json' }));
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await expect.poll(() => times(page)).toEqual({ long: [0, 12000], short: [2000, 4000] });
  await page.evaluate(() => {
    selectOnly(1); document.getElementById('subtitle-time-track').value = 'main';
    document.getElementById('subtitle-time-scope').value = 'selected';
    applySubtitleTimeEdit('扩大所选字幕', cue => ({ start: cue.start, end: cue.end + 2000 }));
  });
  expect(await times(page)).toEqual({ long: [0, 12000], short: [2000, 6000] });
  await page.evaluate(() => performUndo());
  expect(await times(page)).toEqual({ long: [0, 12000], short: [2000, 4000] });
});


test('opening a frame-based v2 file from ordinary mode preserves overlaps and multi-selection', async ({ page }) => {
  const errors = [];
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  await page.addInitScript(() => localStorage.setItem('moy.asr.editor.onboarding.v1', 'skipped'));
  await page.goto(server.url);
  const opened = await page.evaluate(async () => {
    const project = MSWSubtitleLayers.migrate({ timebase: { unit: 'frames', fps: 25 }, segments: [
      { id: 'long', start: 0, end: 12000, text: 'long', start_frame: 0, end_frame: 300 },
      { id: 'short', start: 2000, end: 4000, text: 'short', start_frame: 50, end_frame: 100 },
      { id: 'third', start: 3000, end: 5000, text: 'third', start_frame: 75, end_frame: 125 },
    ] });
    return openProjectFile(new File([JSON.stringify(project)], 'frames.mosp'));
  });
  expect(opened, errors.join('\n') || await page.locator('body').innerText()).toBe(true);
  expect(await times(page)).toEqual({ long: [0, 12000], short: [2000, 4000], third: [3000, 5000] });
  await page.evaluate(() => {
    selectOnly(1); selectedIdxs.add(2); waveformEditor.adjustSelectedByKeyboard(1000);
  });
  expect(await times(page)).toEqual({ long: [0, 12000], short: [3000, 5000], third: [4000, 6000] });
  await page.evaluate(() => performUndo());
  expect(await times(page)).toEqual({ long: [0, 12000], short: [2000, 4000], third: [3000, 5000] });
});

test('held keyboard nudges followed by pointer movement preserve the bound subtitle baseline', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/subtitle-layers.json', import.meta.url))).find(f => f.name === 'bound-bilingual').project;
  await open(page, fixture.segments, fixture);
  const block = await page.locator('.waveform-cue-block[data-track="main"][data-cue-id="b"]').first().boundingBox();
  const x = block.x + block.width / 2, y = block.y + block.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 25, y, { steps: 4 });
  await page.evaluate(() => waveformEditor.adjustActiveCueDragBy(500));
  await page.mouse.move(x + 50, y, { steps: 4 });
  const values = await times(page);
  expect(values.b[0]).toBeGreaterThan(2500);
  expect(await page.evaluate(() => getActiveExtensionTrack().segments.find(c => c.id === 'b').start)).toBe(values.b[0]);
  await page.mouse.up();
  await page.evaluate(() => performUndo());
  expect(await times(page)).toEqual({ a: [0, 5000], b: [2000, 4000] });
  expect(await page.evaluate(() => getActiveExtensionTrack().segments.find(c => c.id === 'b').start)).toBe(2000);
});


test('CSS and ASS previews show every bilingual layer with separate positions and half-open endpoints',async({page})=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/subtitle-layers.json',import.meta.url))).find(f=>f.name==='bound-bilingual').project;
 const errors=await open(page,fixture.segments,fixture);
 const wav=readFileSync(generateWav(join(tempDir,'preview.wav'),12));
 await page.evaluate(bytes=>{player.src=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));player.load();syncPlayerPlaceholder();},[...wav]);
 await expect.poll(()=>page.evaluate(()=>player.readyState)).toBeGreaterThan(0);
 await page.evaluate(()=>{player.currentTime=2.5;});
 await expect.poll(()=>page.evaluate(()=>player.seeking)).toBe(false);
 await page.evaluate(()=>{overlayToggle.checked=true;extensionOverlayToggle.checked=true;refreshSubtitlePreview(2500);});
 await expect(page.locator('#player-empty')).toBeHidden();
 const previews=page.locator('#msw-layer-preview > div');await expect(previews).toHaveCount(4);
 const css=await previews.evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.cueId,role:n.dataset.role,top:n.getBoundingClientRect().top})));
 expect(new Set(css.map(c=>c.top)).size).toBe(4);
 await page.screenshot({path:join(process.env.MSW_LAYER_EVIDENCE||tempDir,'bilingual-css-preview.png')});
 await page.evaluate(()=>{EDITOR_SETTINGS.assMode=true;refreshSubtitlePreview(2500);});
 await expect(previews).toHaveCount(4);
 const ass=await previews.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));expect(new Set(ass).size).toBe(4);
 await page.screenshot({path:join(process.env.MSW_LAYER_EVIDENCE||tempDir,'bilingual-ass-preview.png')});
 const labelStyle=await page.evaluate(()=>{
  DATA.segments[0].color={name:'red',start:DATA.segments[0].start,end:DATA.segments[0].end};
  setSubtitleAppearance({ass_color_style:'speaker',speaker_labels:{mapping_enabled:true,enabled:true,names:{red:'Alice'},separator:': '}});
  refreshSubtitlePreview(2500);
  const element=[...document.querySelectorAll('#msw-layer-preview > div')].find(n=>n.dataset.cueId===DATA.segments[0].id);
  return {label:element.firstElementChild.textContent,labelColor:getComputedStyle(element.firstElementChild).color,bodyColor:getComputedStyle(element).color,raw:DATA.segments[0].text};
 });
 expect(labelStyle.label).toBe('Alice: ');expect(labelStyle.labelColor).not.toBe(labelStyle.bodyColor);expect(labelStyle.raw).toBe('A');
 await page.evaluate(()=>refreshSubtitlePreview(10000));await expect(previews).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('production browser performance keeps drag indexes for 1k and 10k cues at 2, 4 and 8 layers',async({page})=>{
 test.setTimeout(180000);
 const measurements=[];
 for(const count of [1000,10000])for(const depth of [1,2,4,8]){
  const start=Date.now();
  await open(page,Array.from({length:count},(_,i)=>cue('p'+i,Math.floor(i/depth)*1000,Math.floor(i/depth)*1000+900,'示例 '+i)));
  const load=Date.now()-start;
  await page.evaluate(()=>{
   const w=waveformEditor,move=w.moveCueDrag.bind(w);window.__dragTimes=[];
   w.moveCueDrag=event=>{const t=performance.now();move(event);window.__dragTimes.push(performance.now()-t);};
   window.__dragTree=w.subtitleLayout('main').index.entries;
   window.__playbackTree=layerIndex(DATA.segments).entries;
  });
  const block=await page.locator('.waveform-cue-block[data-cue-id="p0"]').first().boundingBox();
  await page.mouse.move(block.x+block.width/2,block.y+block.height/2);await page.mouse.down();
  await page.mouse.move(block.x+block.width/2+28,block.y+block.height/2,{steps:20});
  const result=await page.evaluate(()=>({same:window.__dragTree===waveformEditor.subtitleLayout('main').index.entries&&window.__playbackTree===layerIndex(DATA.segments).entries,hit:layerActive(DATA.segments,DATA.segments[0].start+1).includes(0),times:window.__dragTimes}));
  expect(result.same).toBe(true);expect(result.times.length).toBeGreaterThan(10);
  expect(result.hit).toBe(true);
  await page.mouse.up();
  const first=result.times[0],sorted=result.times.slice(1).sort((a,b)=>a-b);
  measurements.push({count,depth,load_ms:load,drag_start_ms:first,drag_handler_p95_ms:sorted[Math.floor(sorted.length*.95)]});
 }
 console.log('browser-layer-performance',JSON.stringify(measurements));
});

test('overlapping ASR chooses explicit targets; cancel leaves all original layers intact',async({page})=>{
 await open(page,[cue('a',1000,7000,'Original A'),cue('b',2000,6000,'Original B')]);
 await page.evaluate(()=>{
  selectOnly(0);window.__media={id:'media',revision:'a'.repeat(64),audio_index:0,metadata:{duration_ms:10000,audio_tracks:[{}]}};
  window.__job={kind:'asr',id:'job-test',project_id:DATA.msw.project_id,status:'succeeded',created_at:1,snapshot:MSWAsr.snapshot(DATA,__media,'range',{start:3000,end:5000}),result:{segments:[{id:'raw',start:3000,end:5000,text:'Recognized'}]}};
  MSWResults.register(DATA.msw,[__job]);window.__choice=layerChooseAsrTargets([__job],'main');
 });
 await expect(page.locator('.msw-layer-targets input')).toHaveCount(2);
 await page.locator('.msw-layer-merge button').filter({hasText:'取消'}).click();expect(await page.evaluate(()=>__choice)).toBeNull();
 expect((await times(page)).a).toEqual([1000,7000]);
 await page.evaluate(()=>{window.__choice=layerChooseAsrTargets([__job],'main');});
 await page.locator('.msw-layer-merge button').filter({hasText:'确认目标'}).click();
 const result=await page.evaluate(async()=>{
  const options=await __choice,plan=MSWResultApply.plan(DATA,__media,[__job],'main','trim',options);
  applyCanonicalProject(plan.project,'asr.mosp');return DATA.segments.map(c=>({id:c.id,text:c.text,review:!!c.review_required}));
 });
 expect(result.find(c=>c.id==='b').text).toBe('Original B');expect(result.filter(c=>c.review)).toHaveLength(2);
 expect(result.filter(c=>c.text==='Recognized')).toHaveLength(1);
});

test('three-plus overlapping SRT imports and unbound ambiguous translations survive serialization',async({page})=>{
 await open(page,[]);
 const value=await page.evaluate(()=>{
  const srt=Array.from({length:4},(_,i)=>`${i+1}\n00:00:01,000 --> 00:00:04,000\nText ${i}`).join('\n\n');
  const segments=parseSrtSegments(srt);replaceMainTrack(segments,'four.srt');
  const match=layerMatchImportedSubtitles(DATA.segments,[{start:1000,end:4000,text:'Ambiguous'}],100);
  const saved=JSON.parse(buildJson());applyCanonicalProject(saved,'roundtrip.mosp');return {count:DATA.segments.length,schema:DATA.schema,bound:match.matches.length,ass:buildAss()};
 });
 expect(value.count).toBe(4);expect(value.schema).toBe('msw.project.v2');expect(value.bound).toBe(0);
 expect(value.ass.split('\n').filter(r=>r.startsWith('Dialogue:'))).toHaveLength(4);
});

test('file handle upgrades back up first, cancellation never writes the original',async({page})=>{
 await open(page,[]);
 const result=await page.evaluate(async()=>{
  const original=new File(['{"segments":[]}'],'old.mosp'),writes=[];
  const handle={name:'old.mosp',getFile:async()=>original};
  window.showSaveFilePicker=async()=>({getFile:async()=>new File([],'backup.mosp'),createWritable:async()=>({write:async value=>writes.push(await value.text()),close:async()=>{}})});
  await layerProtectHandle(handle,DATA);
  window.showSaveFilePicker=async()=>{throw new DOMException('cancel','AbortError');};
  let cancelled=false;try{await layerProtectHandle(handle,DATA);}catch(e){cancelled=e.name==='AbortError';}
  return {writes,cancelled};
 });expect(result).toEqual({writes:['{"segments":[]}'],cancelled:true});
});


test('cue colors, review flags and opaque provenance survive main and secondary disk snapshots',async({page})=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/subtitle-layers.json',import.meta.url))).find(f=>f.name==='bound-bilingual').project;
 await open(page,fixture.segments,fixture);
 const value=await page.evaluate(()=>{
  for(const cue of [DATA.segments[0],getActiveExtensionTrack().segments[0]]){cue.color={name:'purple',value:'#a855f7',start:cue.start,end:cue.end};cue.review_required=true;cue.source_ref={id:'original-cue'};}
  const saved=JSON.parse(buildJson());applyCanonicalProject(saved,'saved.mosp');
  return [DATA.segments[0],getActiveExtensionTrack().segments[0]].map(c=>({color:c.color.name,review:c.review_required,source:c.source_ref.id}));
 });expect(value).toEqual([{color:'purple',review:true,source:'original-cue'},{color:'purple',review:true,source:'original-cue'}]);
});
