import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server;
let errors=[];
test.beforeAll(async()=>{const dir=makeTempDir('incremental-ui');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.afterEach(()=>expect(errors).toEqual([]));
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',error=>errors.push(error.message));await disableOnboarding(page);await page.goto(server.url);
  await page.evaluate(waveform=>{
    const segments=Array.from({length:5000},(_,i)=>({id:'cue-'+i,start:i*2000,end:i*2000+1400,text:'English subtitle '+i,items:[]}));
    const translated=segments.map((s,i)=>({...s,id:'translation-'+i,text:'译文 '+i}));
    const bindings=segments.map((s,i)=>({id:'pair-'+i,track_id:'zh',main_segment_ids:[s.id],extension_segment_ids:[translated[i].id],start_offset_ms:0,end_offset_ms:0}));
    applyCanonicalProject(MSWFlatSubtitles.migrate({segments,multi_subtitle:{enabled:true,tracks:[{id:'zh',role:'extension',segments:translated}],bindings},waveform}),'large.mosp');
    updateEditorSettings({autoSaveProject:false,clickBehavior:'select-only'});editorHistory.clear();
  },generateWaveformPayload(10000000));
  await expect.poll(()=>page.locator('.cue:not(.cue-virtual) .text').count()).toBeGreaterThan(0);
});
test('10000 cues retain addressable rows but bounded full cards and support remote editing',async({page})=>{
  console.log('List footprint',await page.evaluate(()=>({rows:container.querySelectorAll(':scope > .cue').length,fullCards:container.querySelectorAll(':scope > .cue:not(.cue-virtual)').length,documentNodes:document.querySelectorAll('*').length})));
  await page.locator('#cues-container').screenshot({path:'output/phase3-cue-list.png'});
  expect(await page.locator('#cues-container > .cue').count()).toBe(5000);
  expect(await page.locator('#cues-container .text').count()).toBeLessThan(100);
  await page.evaluate(()=>{const row=container.querySelector('.cue[data-idx="4000"]');scrollCueIntoViewIfNeeded(row);});
  await expect(page.locator('.cue[data-idx="4000"] .main .text')).toHaveText('English subtitle 4000');
  await page.evaluate(()=>{const row=container.querySelector('.cue[data-idx="4000"]');selectOnly(4000);startEdit(row,4000);});
  await page.locator('[contenteditable="plaintext-only"]').fill('Edited far away');
  await page.evaluate(()=>finishEdit(true));
  expect(await page.evaluate(()=>DATA.segments[4000].text)).toBe('Edited far away');
  await page.evaluate(()=>performUndo());
  expect(await page.evaluate(()=>DATA.segments[4000].text)).toBe('English subtitle 4000');
  expect(await page.locator('#cues-container .text').count()).toBeLessThan(100);
});
test('search and track filters also apply to unloaded rows and survive mounting',async({page})=>{
  await page.evaluate(()=>{searchEl.value='4999';applySearch(searchEl.value);});
  await expect(page.locator('#cues-container > .cue:not(.hidden)')).toHaveCount(1);
  await expect(page.locator('.cue[data-idx="4999"] .main .text')).toContainText('4999');
  await page.evaluate(()=>{fixedTrackFilter=new Set([fixedOwner(getActiveExtensionTrack().segments[4999],'extension',getActiveExtensionTrack().id)]);applySearch(searchEl.value);});
  await expect(page.locator('.cue[data-idx="4999"] .main')).toHaveClass(/track-filtered-out/);
  await page.evaluate(()=>{searchEl.value='';fixedTrackFilter.clear();applySearch('');});
  await expect(page.locator('#cues-container > .cue:not(.hidden)')).toHaveCount(5000);
});
test('local refresh retains unrelated cards and waveform rows, history remains reversible',async({page})=>{
  const result=await page.evaluate(()=>{
    const node=cueListVirtual.ensure(container.querySelector('.cue[data-idx="1"]'));
    const wave=waveformEditor.content.querySelector('.waveform-row');
    const firstId=DATA.segments[0].id;
    selectOnly(0);cutSelectedCues();performUndo();
    return {retained:container.querySelector('.cue[data-idx="1"]')===node,canvas:wave?.querySelector('canvas')===waveformEditor.content.querySelector('.waveform-row canvas'),restored:DATA.segments[0].id===firstId};
  });
  expect(result).toEqual({retained:true,canvas:true,restored:true});
});

test('scroll eviction keeps selection and filtering, focused editing is pinned, small projects reset the view',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);startEdit(container.querySelector('.cue[data-idx="0"]'),0);container.scrollTop=container.scrollHeight;});
  await expect(page.locator('.cue[data-idx="0"] [contenteditable]')).toHaveCount(1);
  await page.evaluate(()=>finishEdit(false));
  await page.evaluate(()=>{container.scrollTop=0;});
  await expect(page.locator('.cue[data-idx="0"] .text').first()).toContainText('English');
  await page.evaluate(()=>{container.scrollTop=container.scrollHeight;});
  await expect(page.locator('.cue[data-idx="0"]')).toHaveClass(/cue-virtual/);
  await expect(page.locator('.cue[data-idx="0"]')).toHaveClass(/selected/);
  await page.setViewportSize({width:900,height:700});
  await page.evaluate(()=>{searchEl.value='4999';applySearch(searchEl.value);});
  await expect(page.locator('.cue[data-idx="4999"] .text').first()).toContainText('4999');
  await page.evaluate(()=>{searchEl.value='';applyCanonicalProject(MSWFlatSubtitles.migrate({segments:[{start:0,end:1000,text:'Small',items:[]}]}),'small.mosp');});
  await expect(page.locator('#cues-container > .cue')).toHaveCount(1);
  await expect(page.locator('#cues-container .text')).toHaveText('Small');
  expect(await page.evaluate(()=>cueListVirtual===null)).toBe(true);
});

test('waveform delta keeps a nonintersecting row and refreshes edited text',async({page})=>{
  const result=await page.evaluate(()=>{
    const rows=[...waveformEditor.content.querySelectorAll('.waveform-row')];
    const far=rows.find(row=>Number(row.dataset.startMs)>DATA.segments[0].end);
    const block=far?.querySelector('.waveform-cue-block');
    DATA.segments[0].text='Changed label';
    waveformEditor.refreshCueOverlay({changedCueIds:new Set([DATA.segments[0].id])});
    return {retained:!!block&&block===far.querySelector('.waveform-cue-block'),label:waveformEditor.content.querySelector('.waveform-cue-block .waveform-cue-label')?.textContent};
  });
  expect(result.retained).toBe(true);expect(result.label).toContain('Changed label');
});

test('explicit changed IDs refresh auxiliary content while dirty-only rows retain their nodes',async({page})=>{
  const result=await page.evaluate(()=>{
    const first=cueListVirtual.ensure(container.querySelector('.cue[data-idx="0"]'));
    const second=cueListVirtual.ensure(container.querySelector('.cue[data-idx="1"]'));
    DATA.segments[1]._dirty=true;
    renderAll({changedCueIds:new Set([DATA.segments[0].id])});
    cueListVirtual.ensure(container.querySelector('.cue[data-idx="0"]'));
    return {firstRebuilt:container.querySelector('.cue[data-idx="0"]')!==first,secondRetained:container.querySelector('.cue[data-idx="1"]')===second,dirty:second.querySelector('.main').classList.contains('dirty')};
  });
  expect(result).toEqual({firstRebuilt:true,secondRetained:true,dirty:true});
});

test('browser text selection survives scrolling and its card can be released after selection clears',async({page})=>{
  const initial=await page.evaluate(()=>{
    const row=cueListVirtual.ensure(container.querySelector('.cue[data-idx="0"]'));
    // Exercise text-selection protection independently of the editor-focus
    // guard; ordinary nonediting card labels intentionally disable selection.
    const text=row.querySelector('.main .text');text.style.userSelect='text';
    const range=document.createRange();range.selectNodeContents(text);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    return selection.toString();
  });
  expect(initial).toBe('English subtitle 0');
  await page.evaluate(()=>{container.scrollTop=container.scrollHeight;});
  await expect(page.locator('.cue[data-idx="4999"] .text').first()).toContainText('4999');
  await expect(page.locator('.cue[data-idx="0"]')).not.toHaveClass(/cue-virtual/);
  expect(await page.evaluate(()=>window.getSelection().toString())).toBe('English subtitle 0');
  await page.evaluate(()=>{window.getSelection().removeAllRanges();container.scrollTop-=10;});
  await expect(page.locator('.cue[data-idx="0"]')).toHaveClass(/cue-virtual/);
});
