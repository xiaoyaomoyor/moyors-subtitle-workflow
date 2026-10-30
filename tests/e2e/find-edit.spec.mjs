import {test,expect} from '@playwright/test';
import {setup,snap,inputs,count,apply} from './find-unified-fixture.mjs';
setup();
test('one unified view starts with editable checked results and collapsible sections',async({page})=>{
 await expect(page.locator('[data-find-view],#find-edit-scope,#find-tidy-matched,#find-edit-prev')).toHaveCount(0);
 await expect(inputs(page)).toHaveCount(6);expect(await page.locator('#find-edit-rows input:checked').count()).toBe(6);
 await page.locator('#find-edit-result-section summary').click();await expect(inputs(page).first()).toBeHidden();await page.locator('#find-edit-result-section summary').click();await expect(inputs(page).first()).toBeVisible();
});
test('selected snapshot, tracks and speakers intersect and empty filters never widen',async({page})=>{
 await page.evaluate(()=>selectOnly(0));await page.locator('#find-edit-only-selected').check();await count(page,1);
 await page.locator('#find-edit-all-tracks').uncheck();await page.locator('#find-edit-tracks input').first().uncheck();await count(page,0);
 await page.locator('#find-edit-only-selected').uncheck();await count(page,4);
 await page.locator('#find-edit-all-speakers').uncheck();for(const c of await page.locator('#find-edit-speakers input').all())await c.setChecked(await c.inputValue()==='red');await count(page,2);
 await page.locator('#find-edit-speakers input[value="red"]').uncheck();await count(page,0);
 await page.locator('#find-edit-all-speakers').check();await count(page,4);
});
test('search, case, regex, waveform marks and location share the filtered result set',async({page})=>{
 await page.locator('#find-edit-query').fill('Alpha');await count(page,4);await page.locator('#find-edit-case').check();await count(page,2);
 await expect(page.locator('.msw-search-hit').first()).toBeVisible();await page.locator('[data-locate]').first().click();await expect(page.locator('.msw-search-current').first()).toBeVisible();
 await page.locator('#find-edit-regex').check();await page.locator('#find-edit-query').fill('[');await expect(page.locator('#find-edit-message')).toContainText('正则表达式无效');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.locator('#find-edit-query').fill('Alpha|中文');await count(page,4);
 await page.locator('#find-edit-close').click();await expect(page.locator('.msw-search-hit')).toHaveCount(0);await page.keyboard.press('Control+f');await count(page,4);
});
test('search alone cannot delete text; explicit empty replacement previews and applies once',async({page})=>{
 await page.locator('#find-edit-query').fill('Alpha');await count(page,4);await expect(page.locator('#find-edit-apply')).toBeDisabled();await expect(page.locator('#find-edit-replacement')).toBeDisabled();
 await page.locator('#find-edit-replace-enabled').check();await expect(page.locator('.find-result-after').first()).toContainText('Bravo');await apply(page);
 expect((await snap(page)).subtitles.cues.filter(c=>/alpha/i.test(c.content.text))).toHaveLength(0);await expect(page.locator('#find-edit-replace-enabled')).not.toBeChecked();
});
test('row exclusions survive searching and select all only affects current results',async({page})=>{
 await page.locator('#find-edit-rows input').first().uncheck();await page.locator('#find-edit-query').fill('Alpha');await count(page,4);await expect(page.locator('#find-edit-count')).toContainText('已选 3');
 await page.locator('#find-edit-select-all').click();await expect(page.locator('#find-edit-count')).toContainText('已选 4');
});
test('regex replacement keeps captures and user text is never interpreted as HTML',async({page})=>{
 await page.locator('#find-edit-regex').check();await page.locator('#find-edit-query').fill('(Alpha)');await page.locator('#find-edit-replace-enabled').check();await page.locator('#find-edit-replacement').fill('$1 <img src=x onerror=alert(1)>');await apply(page);
 expect((await snap(page)).subtitles.cues.filter(c=>c.content.text.includes('<img'))).toHaveLength(4);await expect(page.locator('#find-edit-rows img')).toHaveCount(0);
});
for(const width of [1280,400])for(const theme of ['dark','light'])test(`unified layout at ${width}px in ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:850});await page.evaluate(theme=>{updateEditorSettings({theme,themePreset:theme==='light'?'alice':'renko',colors:{}});applyThemeAndColors();},theme);
 await page.locator('#find-edit-panel').evaluate((n,width)=>{n.style.width=Math.min(width-24,680)+'px';n.style.height='760px';n.style.left='6px';n.style.top='6px';},width);
 expect(await page.locator('#find-edit-panel').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);await expect(page.locator('#find-edit-apply')).toBeInViewport();
 await page.locator('#find-edit-panel').screenshot({path:info.outputPath('unified.png')});
});
test('six thousand cues remain virtual and typing preserves focus, drafts, cancellation and undo',async({page})=>{
 await page.evaluate(()=>{applyCanonicalProject({segments:Array.from({length:6000},(_,i)=>({id:'long'+i,start:i*1000,end:i*1000+900,text:'Long subtitle '+i,items:[]}))},'long.mosp');});await count(page,6000);
 expect(await inputs(page).count()).toBeLessThan(20);await inputs(page).first().fill('Long draft');await page.waitForTimeout(250);await expect(inputs(page).first()).toBeFocused();
 await page.locator('#find-edit-close').click();await page.keyboard.press('Control+f');await expect(inputs(page).first()).toHaveValue('Long draft');await apply(page);
 await page.evaluate(()=>performUndo());await expect(inputs(page).first()).toHaveValue('Long subtitle 0');
 await page.locator('#find-edit-query').fill('subtitle');await page.locator('#find-edit-query').fill('missing');await count(page,0);await expect(page.locator('.msw-search-hit')).toHaveCount(0);
});
