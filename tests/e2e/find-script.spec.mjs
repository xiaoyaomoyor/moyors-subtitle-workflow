import {test,expect} from '@playwright/test';
import {setup,snap,inputs,count,apply} from './find-unified-fixture.mjs';
setup();
const script=async page=>{await page.locator('#find-edit-group').selectOption('script');await expect(inputs(page)).toHaveCount(1);return inputs(page).first();};

test('script pairs bound cues, edits both texts in one undo step, shares drafts and preserves metadata',async({page},info)=>{
 const before=await snap(page),history=await page.evaluate(()=>editorHistory.undoLength());
 const input=await script(page),text=await input.inputValue();
 expect(text.match(/^\[\[/gm)).toHaveLength(4);expect(text).toContain('S1主 | #1 / S1副 | #1');expect(text).not.toContain('\n\n');
 await input.fill(text.replace('  Alpha Bravo  ','译文改为多行\n第二行').replace(' 中文 0','原文也修改'));
 await page.locator('#find-edit-group').selectOption('track');await expect(inputs(page).first()).toHaveValue(/译文改为多行/);
 await script(page);await apply(page);
 const after=await snap(page);expect(after.subtitles.cues.filter(c=>['译文改为多行\n第二行','原文也修改'].includes(c.content.text))).toHaveLength(2);
 expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
 for(const c of before.subtitles.cues){const a=after.subtitles.cues.find(x=>x.id===c.id);expect([a.track_id,a.content.start,a.content.end,a.content.color,a.content.subtitle_style]).toEqual([c.track_id,c.content.start,c.content.end,c.content.color,c.content.subtitle_style]);}
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await page.evaluate(()=>performRedo());expect((await snap(page)).subtitles).toEqual(after.subtitles);
 await expect(input).toHaveValue(/译文改为多行/);await page.screenshot({path:info.outputPath('script-editor.png')});
});

test('script respects filters, exclusions, locked tracks and single-track text',async({page})=>{
 await page.locator('#find-edit-rows input').first().uncheck();
 const input=await script(page);expect(await page.locator('#find-edit-rows input').evaluate(n=>n.indeterminate)).toBe(true);
 await page.locator('#find-edit-query').fill('Alpha');await count(page,4);
 expect(await input.inputValue()).not.toContain(' 中文');expect((await input.inputValue()).match(/^\[\[/gm)).toHaveLength(4);
 await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('X ');await apply(page);
 expect((await snap(page)).subtitles.cues.filter(c=>c.content.text.startsWith('X '))).toHaveLength(3);
 await page.locator('#find-edit-query').fill('');await count(page,6);await page.evaluate(()=>fixedUpdateTrack('third',{locked:true}));await expect(input).toHaveAttribute('readonly','');
 await page.evaluate(()=>{const p=JSON.parse(buildJson());MSWFindEdit.open({ids:p.subtitles.cues.filter(c=>c.track_id===p.subtitles.tracks[0].id).map(c=>c.id)});});await count(page,2);await expect(input).not.toHaveAttribute('readonly','');
 expect((await input.inputValue()).match(/^\[\[/gm)).toHaveLength(2);expect(await input.inputValue()).not.toContain('S1副');
});

test('damaged script cannot partially apply through another view and can be recovered',async({page})=>{
 const before=await snap(page),input=await script(page),text=await input.inputValue();
 await input.fill(text.replace('Alpha Bravo','valid draft'));await expect(page.locator('#find-edit-apply')).toBeEnabled();
 await input.fill((await input.inputValue()).replace('#1','#999'));await expect(page.locator('#find-edit-message')).toContainText('剧本信息行');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.locator('#find-edit-group').selectOption('rows');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.locator('#find-edit-close').click();await page.keyboard.press('Control+f');await page.locator('#find-edit-drafts').click();
 await expect(page.locator('#find-edit-group')).toHaveValue('script');await expect(inputs(page).first()).toHaveValue(/#999/);
 expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await page.locator('[data-reset]:visible').click();await expect(inputs(page).first()).not.toHaveValue(/#999/);expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(false);
});

test('script double-click locates the chosen partner and external edits block stale drafts',async({page})=>{
 const input=await script(page);
 await input.evaluate(n=>{n.setSelectionRange(n.value.indexOf(' 中文 1')+1,n.value.indexOf(' 中文 1')+1);n.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));});
 await expect.poll(()=>page.evaluate(()=>fixedActiveTrackId)).toBe((await snap(page)).subtitles.cues.find(c=>c.content.text===' 中文 1').track_id);
 await input.fill((await input.inputValue()).replace('Alpha Bravo','Pending'));
 await page.evaluate(()=>{DATA.segments[0].text='External';MSWFindEdit.changed();});
 await expect(page.locator('#find-edit-message')).toContainText('目标字幕已改变');await expect(page.locator('#find-edit-apply')).toBeDisabled();
});

test('long script keeps focus and the last cue editable without changing earlier cues',async({page})=>{
 await page.evaluate(()=>applyCanonicalProject({segments:Array.from({length:6000},(_,i)=>({id:'long'+i,start:i*1000,end:i*1000+900,text:'Line '+i,items:[]}))},'long.mosp'));await count(page,6000);
 const input=await script(page),text=await input.inputValue();expect(text.match(/^\[\[/gm)).toHaveLength(6000);
 await input.focus();await input.evaluate(n=>{const start=n.value.lastIndexOf('Line 5999');n.setSelectionRange(start,start+'Line 5999'.length);});
 await page.keyboard.insertText('Edited last line');await expect(page.locator('#find-edit-apply')).toBeEnabled();await expect(input).toBeFocused();await apply(page);
 const cues=(await snap(page)).subtitles.cues;expect(cues.find(c=>c.content.start===5999000).content.text).toBe('Edited last line');expect(cues.find(c=>c.content.start===0).content.text).toBe('Line 0');
 await page.evaluate(()=>performUndo());await expect(input).toHaveValue(/Line 5999/);
});

for(const width of [400,1280])test(`script layout fits ${width}px and keeps apply accessible`,async({page},info)=>{
 await page.setViewportSize({width,height:850});await script(page);
 await page.locator('#find-edit-panel').evaluate((n,width)=>{n.style.width=Math.min(width-24,680)+'px';n.style.height='760px';n.style.left='6px';n.style.top='6px';},width);
 expect(await page.locator('#find-edit-panel').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);await expect(page.locator('#find-edit-apply')).toBeInViewport();
 await page.locator('#find-edit-panel').screenshot({path:info.outputPath('script-layout.png')});
});
