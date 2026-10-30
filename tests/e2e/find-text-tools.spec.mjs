import {test,expect} from '@playwright/test';
import {setup,snap,inputs,count,apply} from './find-unified-fixture.mjs';
setup();
test('manual edit, replacement and cleanup form one transaction and respect exclusions',async({page})=>{
 const before=await snap(page),history=await page.evaluate(()=>editorHistory.undoLength());await page.locator('#find-edit-query').fill('Alpha');await count(page,4);
 await inputs(page).first().fill('  Alpha changed\nline  ');await page.locator('#find-edit-rows input').last().uncheck();
 await page.locator('#find-tidy-trim').check();await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('Note: ');
 await page.locator('#find-edit-replace-enabled').check();await page.locator('#find-edit-replacement').fill('Hello');await apply(page);
 const after=await snap(page);expect(after.subtitles.cues.some(c=>c.content.text==='Note: Hello changed\nline')).toBe(true);expect(after.subtitles.cues.filter(c=>c.content.text.startsWith('Note:'))).toHaveLength(3);
 expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);await page.evaluate(()=>performRedo());expect((await snap(page)).subtitles).toEqual(after.subtitles);
});
test('track and speaker group views share drafts and preserve multiline cue identities',async({page})=>{
 const before=await snap(page);await inputs(page).first().fill('First\nline');await page.locator('#find-edit-group').selectOption('track');await expect(inputs(page)).toHaveCount(3);
 expect(await inputs(page).first().inputValue()).toContain('First\nline');const text=await inputs(page).first().inputValue();await inputs(page).first().fill(text.replace('alpha Bravo','Second changed'));
 await page.locator('#find-edit-group').selectOption('speaker');await expect(inputs(page)).toHaveCount(2);expect((await inputs(page).allTextContents()).length).toBe(2);
 await apply(page);const after=await snap(page);expect(after.subtitles.cues).toHaveLength(6);expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
 for(const c of before.subtitles.cues){const a=after.subtitles.cues.find(x=>x.id===c.id);expect([a.track_id,a.content.start,a.content.end]).toEqual([c.track_id,c.content.start,c.content.end]);}
 expect(after.subtitles.cues.some(c=>c.content.text==='First\nline')).toBe(true);expect(after.subtitles.cues.some(c=>c.content.text==='Second changed')).toBe(true);
});
test('group checkboxes expose mixed selection and can exclude an entire speaker',async({page})=>{
 await page.locator('#find-edit-rows input').first().uncheck();await page.locator('#find-edit-group').selectOption('speaker');expect(await page.locator('#find-edit-rows input').first().evaluate(n=>n.indeterminate)).toBe(true);
 await page.locator('#find-edit-rows input').first().check();await page.locator('#find-edit-rows input').first().uncheck();await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('X ');await apply(page);
 expect((await snap(page)).subtitles.cues.filter(c=>c.content.text.startsWith('X '))).toHaveLength(3);
});
test('damaged group separators block application and survive close with recoverable drafts',async({page})=>{
 const before=await snap(page);await page.locator('#find-edit-group').selectOption('track');await inputs(page).first().fill('Lost boundary');await expect(page.locator('#find-edit-message')).toContainText('分隔行');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.locator('#find-edit-close').click();await page.keyboard.press('Control+f');await expect(inputs(page).first()).toHaveValue('Lost boundary');expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await page.locator('[data-reset]').first().click();await expect(inputs(page).first()).not.toHaveValue('Lost boundary');
});
test('external changes conflict, locked cues are skipped and disabled cues remain editable',async({page})=>{
 await inputs(page).first().fill('Pending');await page.evaluate(()=>{DATA.segments[0].text='External';MSWFindEdit.changed();});await expect(page.locator('#find-edit-message')).toContainText('目标字幕已改变');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.locator('[data-reset]').first().click();await page.evaluate(()=>fixedUpdateTrack('third',{locked:true}));await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('X ');await expect(page.locator('#find-edit-message')).toContainText('跳过 2 条');await apply(page);
 expect((await snap(page)).subtitles.cues.filter(c=>c.content.text.startsWith('X '))).toHaveLength(4);
});
test('new project clears prior scopes, selection, recipe and drafts',async({page})=>{
 await inputs(page).first().fill('Pending');await page.locator('#find-tidy-prefix').check();await page.evaluate(()=>applyCanonicalProject({segments:[{id:'new',start:0,end:1000,text:'New',items:[]}]},'new.mosp'));await count(page,1);
 expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(false);await expect(page.locator('#find-tidy-prefix')).not.toBeChecked();await expect(inputs(page).first()).toHaveValue('New');
});

test('draft from a deleted source can be recovered and discarded without restoring the cue',async({page})=>{
 await inputs(page).first().fill('Keep orphan draft');await page.evaluate(()=>{deleteSegments([0]);MSWFindEdit.changed();});await count(page,4);
 await page.locator('#find-edit-drafts').click();await expect(inputs(page).first()).toHaveValue('Keep orphan draft');await expect(inputs(page).first()).toHaveAttribute('readonly','');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.locator('[data-reset]:visible').first().click();expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(false);
 expect((await snap(page)).subtitles.cues).toHaveLength(4);
});
