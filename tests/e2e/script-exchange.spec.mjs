import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {setup,snap,inputs,apply} from './find-unified-fixture.mjs';
setup();
const full=async page=>{await page.locator('#find-edit-group').selectOption('script');return inputs(page).inputValue();};
async function load(page,text,file=false){
 await page.locator('#script-exchange-open').click();
 if(file)await page.locator('#script-exchange-file').setInputFiles({name:'polish.txt',mimeType:'text/plain',buffer:Buffer.from('\uFEFF'+text.replaceAll('\n','\r\n'))});
 else{await page.locator('#script-exchange-text').fill(text);await page.locator('#script-exchange-analyze').click();}
 await expect(page.locator('#script-exchange-message')).toContainText('已完成匹配');
}
test('TXT import tolerates display metadata and numbering changes, stages only text and applies in one undo',async({page},info)=>{
 const before=await snap(page),history=await page.evaluate(()=>editorHistory.undoLength()),text=await full(page);
 await load(page,text.replace('  Alpha Bravo  ','Revised "English"').replace(' 中文 0','润色“中文”\n第二行').replaceAll('SP3','改名').replace('S1主 · #1','S1主 · English · #99'),true);
 await expect(page.locator('#script-exchange-counts')).toContainText('可更新 2');await expect(page.locator('#script-exchange-counts')).toContainText('未变化 4');
 await expect(page.locator('#script-exchange-source')).not.toHaveAttribute('open');await expect(page.locator('#script-exchange-settings')).not.toHaveAttribute('open');
 await expect(page.locator('.script-exchange-target-options').first()).not.toHaveAttribute('open');
 await page.locator('#script-exchange-modal .modal').screenshot({path:info.outputPath('script-import.png')});
 await page.locator('#script-exchange-stage').click();await expect(page.locator('#script-exchange-modal')).not.toHaveClass(/show/);
 expect((await snap(page)).subtitles).toEqual(before.subtitles);expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history);
 await apply(page);const after=await snap(page);expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
 expect(after.subtitles.cues.map(c=>c.content.text)).toContain('润色“中文”\n第二行');expect(after.subtitles.cues.map(c=>c.content.text)).toContain('Revised "English"');
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
});
test('manual track mapping can import only a selected secondary track and preserve other drafts',async({page})=>{
 const original=await full(page),before=await snap(page);
 await page.locator('#find-edit-group').selectOption('rows');await inputs(page).first().fill('Keep pending');await page.locator('#find-edit-group').selectOption('script');
 await load(page,original.replaceAll('S1副','中文校对').replace(' 中文 0','Reviewed Chinese'));
 const secondary=before.subtitles.tracks.find(t=>t.secondary_for).id;
 await page.locator('#script-exchange-mapping select[data-track="中文校对"]').selectOption(secondary);
 await expect(page.locator('#script-exchange-counts')).toContainText('可更新 1');
 await page.locator('#script-exchange-stage').click();await apply(page);
 expect((await snap(page)).subtitles.cues.map(c=>c.content.text)).toContain('Reviewed Chinese');
 expect((await snap(page)).subtitles.cues.find(c=>c.id===before.subtitles.cues[0].id).content.text).toBe(before.subtitles.cues[0].content.text);
 expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(true);
});
test('existing draft conflicts require explicit selection and stale preview cannot overwrite new edits',async({page})=>{
 const original=await full(page);await page.locator('#find-edit-group').selectOption('rows');await inputs(page).first().fill('Pending');await page.locator('#find-edit-group').selectOption('script');
 await load(page,original.replace('Alpha Bravo','External'));
 await expect(page.locator('#script-exchange-counts')).toContainText('正文冲突 1');await expect(page.locator('#script-exchange-stage')).toBeDisabled();
 await page.locator('#script-exchange-rows input[type=checkbox]').check();await expect(page.locator('#script-exchange-stage')).toBeEnabled();
 await page.evaluate(()=>{DATA.segments[0].text='Changed elsewhere';MSWFindEdit.changed();});await page.locator('#script-exchange-stage').click();
 await expect(page.locator('#script-exchange-message')).toContainText('工程或草稿已变化');
 expect((await snap(page)).subtitles.cues.map(c=>c.content.text)).toContain('Changed elsewhere');
 await page.evaluate(()=>applyCanonicalProject({segments:[]},'new.mosp'));await expect(page.locator('#script-exchange-modal')).not.toHaveClass(/show/);await expect(page.locator('#script-exchange-text')).toHaveValue('');
});
test('ambiguous timing needs a manual target and narrow preview stays usable',async({page},info)=>{
 await page.setViewportSize({width:480,height:850});const text=await full(page);
 await load(page,text.replace('00:01.000~00:02.000','00:01.050~00:02.050').replace('Alpha Bravo','Chosen'));
 const row=page.locator('#script-exchange-rows .script-exchange-row').first();await expect(row).toContainText('需要确认');await expect(row.locator('input[type=checkbox]')).toBeDisabled();
 const value=await row.locator('select option').nth(2).getAttribute('value');await row.locator('select').selectOption(value);
 await expect(page.locator('#script-exchange-stage')).toBeEnabled();await expect(page.locator('#script-exchange-stage')).toBeInViewport();
 expect(await page.locator('#script-exchange-modal .modal').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
 await page.locator('#script-exchange-modal .modal').screenshot({path:info.outputPath('script-import-narrow.png')});
});

async function exported(page){
 await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
 const downloading=page.waitForEvent('download');await page.locator('#script-exchange-export').click();const download=await downloading;
 await expect(page.locator('#find-edit-message')).toContainText('剧本已导出');return readFileSync(await download.path(),'utf8');
}

test('export records survive changed times and names, reveal three-way conflicts and preserve newer local text',async({page},info)=>{
 await full(page);const text=await exported(page),records=await page.evaluate(()=>MSWFindEdit.exportRecords());expect(text).toMatch(/^\[\[MSW-SCRIPT v1/);expect(records).toHaveLength(1);
 await page.evaluate(()=>{
  pushUndo('Before external changes');DATA.segments[0].text='Local first';DATA.segments[1].text='Local second';
  DATA.segments[0].start=1100;DATA.segments[0].end=2100;DATA.segments[0].color.start=1100;DATA.segments[0].color.end=2100;
  DATA.subtitle_tracks.tracks[0].name='Renamed main';syncProjectTimebaseAndBindingOffsets(DATA,{preferFrames:false});MSWFindEdit.changed();
 });
 await load(page,text.replace('  Alpha Bravo  ','External first').replace(' 中文 0','External secondary'));
 await expect(page.locator('#script-exchange-baseline')).toContainText('已使用工程中的导出记录');
 await expect(page.locator('#script-exchange-counts')).toContainText('正文冲突 1');await expect(page.locator('#script-exchange-counts')).toContainText('保留当前修改 1');
 const conflict=page.locator('.script-exchange-row').filter({hasText:'正文冲突'});await expect(conflict).toContainText('导出时正文');await expect(conflict.locator('input[type=checkbox]')).not.toBeChecked();
 await page.locator('#script-exchange-modal .modal').screenshot({path:info.outputPath('script-conflict.png')});
 await page.locator('#script-exchange-stage').click();await apply(page);
 let texts=(await snap(page)).subtitles.cues.map(c=>c.content.text);expect(texts).toContain('Local first');expect(texts).toContain('Local second');expect(texts).toContain('External secondary');
 await page.evaluate(()=>{performUndo();performUndo();});expect(await page.evaluate(()=>MSWFindEdit.exportRecords())).toEqual(records);
});

test('missing record uses explicit compatibility notice; markerless file can use a selected saved record',async({page})=>{
 await full(page);const text=await exported(page),id=await page.evaluate(()=>MSWFindEdit.exportRecords()[0].id);
 await load(page,text.replace(id,'script-missing').replace(' 中文 0','External'));
 await expect(page.locator('#script-exchange-baseline')).toContainText('工程中没有对应记录');await page.locator('#script-exchange-cancel').click();
 await load(page,text.slice(text.indexOf('\n')+1).replace(' 中文 0','External'));
 await page.locator('#script-exchange-settings > summary').click();
 await page.locator('#script-exchange-record').selectOption(id);await expect(page.locator('#script-exchange-baseline')).toContainText('已使用工程中的导出记录');
});

test('cancelled exports create no record and a pending save cannot attach records to another project',async({page})=>{
 await full(page);await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('cancelled','AbortError');};});
 await page.locator('#script-exchange-export').click();await expect(page.locator('#script-exchange-export')).toBeEnabled();expect(await page.evaluate(()=>MSWFindEdit.exportRecords())).toEqual([]);
 await page.evaluate(()=>{window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>new Promise(resolve=>window.finishExport=resolve),close:async()=>{}})});});
 await page.locator('#script-exchange-export').click();await expect.poll(()=>page.evaluate(()=>typeof window.finishExport)).toBe('function');
 await page.evaluate(()=>{applyCanonicalProject({segments:[]},'new.mosp');window.finishExport();});
 await expect(page.locator('#find-edit-message')).toContainText('已切换工程');expect(await page.evaluate(()=>MSWFindEdit.exportRecords())).toEqual([]);
});

test('English import preview translates controls without translating script content',async({page},info)=>{
 const text=await full(page);await page.evaluate(()=>MSWE_I18N.applyLanguage('en'));await page.locator('#script-exchange-open').click();
 await page.locator('#script-exchange-text').fill(text.replace(' 中文 0','显示信息'));await page.locator('#script-exchange-analyze').click();
 await expect(page.locator('#script-exchange-message')).toContainText('Matching complete');await expect(page.locator('#script-exchange-stage')).toHaveText('Stage drafts');
 await expect(page.locator('#script-exchange-rows pre').last()).toHaveText('显示信息');await page.locator('#script-exchange-modal .modal').screenshot({path:info.outputPath('script-import-en.png')});
});

test('large script import renders bounded pages and updates the last cue with one undo',async({page},info)=>{
 await page.evaluate(()=>applyCanonicalProject({segments:Array.from({length:6880},(_,i)=>({id:'long-'+i,start:i*1000,end:i*1000+900,text:'Line '+i,items:[]}))},'long.mosp'));
 await expect(page.locator('#find-edit-count')).toContainText('6880 条');const before=await snap(page),lastId=before.subtitles.cues.find(c=>c.content.start===6879000).id,firstId=before.subtitles.cues.find(c=>c.content.start===0).id;
 const text=await full(page),started=Date.now();
 await load(page,text.replace('Line 6879','Reviewed last line'));const matchedMs=Date.now()-started;
 await expect(page.locator('#script-exchange-counts')).toContainText('可更新 1');await expect(page.locator('#script-exchange-counts')).toContainText('未变化 6879');
 await page.locator('#script-exchange-filter').selectOption('all');await expect(page.locator('.script-exchange-row')).toHaveCount(20);
 await page.locator('#script-exchange-stage').click();await apply(page);let cues=(await snap(page)).subtitles.cues;
 expect(cues.find(c=>c.id===lastId).content.text).toBe('Reviewed last line');expect(cues.find(c=>c.id===firstId).content.text).toBe('Line 0');
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
 writeFileSync(info.outputPath('import-6880-timing.json'),JSON.stringify({matchedMs}));
});

test('large clipboard paste stays literal and can be parsed without native insertion delays',async({page,context})=>{
 const text=(await full(page)).replace(' 中文 0','长稿正文\n'.repeat(500)+'Literal "quotes" \\ path');
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.evaluate(text=>navigator.clipboard.writeText(text),text);
 await page.locator('#script-exchange-open').click();await page.locator('#script-exchange-text').focus();await page.keyboard.press('Control+v');
 await expect(page.locator('#script-exchange-text')).toHaveValue(text);await page.locator('#script-exchange-analyze').click();
 await expect(page.locator('#script-exchange-counts')).toContainText('可更新 1');await expect(page.locator('#script-exchange-rows pre').last()).toContainText('Literal "quotes" \\ path');
});

test('compact import supports file selection, empty results, source correction and keyboard return in light theme',async({page},info)=>{
 const text=await full(page);await page.evaluate(()=>document.documentElement.dataset.theme='light');
 await page.locator('#script-exchange-open').click();await expect(page.locator('#script-exchange-analyze')).toBeDisabled();
 await expect(page.locator('#script-exchange-pick-file')).toBeFocused();
 await page.locator('#script-exchange-modal .modal').screenshot({path:info.outputPath('script-import-source-light.png')});
 const choosing=page.waitForEvent('filechooser');await page.locator('#script-exchange-pick-file').click();
 await (await choosing).setFiles({name:'reviewed.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
 await expect(page.locator('#script-exchange-empty')).toBeVisible();await expect(page.locator('#script-exchange-stage')).toBeDisabled();
 await expect(page.locator('#script-exchange-source-name')).toHaveText('reviewed.txt');await expect(page.locator('#script-exchange-review-title')).toBeFocused();
 await page.locator('#script-exchange-filter').selectOption('all');await expect(page.locator('.script-exchange-row')).toHaveCount(6);
 await page.locator('#script-exchange-source > summary').click();await page.locator('#script-exchange-text').fill('invalid');
 await expect(page.locator('#script-exchange-preview')).toBeHidden();await page.locator('#script-exchange-analyze').click();
 await expect(page.locator('#script-exchange-message')).toHaveClass('is-error');await expect(page.locator('#script-exchange-source')).toHaveAttribute('open');
 await page.locator('#script-exchange-text').fill(text.replace(' 中文 0','Corrected text'));await page.locator('#script-exchange-analyze').click();
 await expect(page.locator('#script-exchange-stage')).toBeEnabled();await page.locator('#script-exchange-filter').selectOption('changes');
 await expect(page.locator('.script-exchange-row')).toHaveCount(1);await page.locator('.script-exchange-target-options > summary').click();
 await expect(page.locator('.script-exchange-target select')).toBeVisible();
 await page.locator('#script-exchange-modal .modal').screenshot({path:info.outputPath('script-import-review-light.png')});
 await page.locator('#script-exchange-stage').focus();await page.keyboard.press('Tab');await expect(page.locator('#script-exchange-close')).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(page.locator('#script-exchange-stage')).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.locator('#script-exchange-modal')).not.toHaveClass(/show/);await expect(page.locator('#script-exchange-open')).toBeFocused();
});
