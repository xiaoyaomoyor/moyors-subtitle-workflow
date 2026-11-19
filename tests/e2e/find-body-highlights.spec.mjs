import {test,expect} from '@playwright/test';
import {setup,snap,inputs,count,editScriptText} from './find-unified-fixture.mjs';
setup();
const marks=page=>page.locator('.find-script-ink .find-search-match');

test('all views highlight body matches and follow drafts without changing the project',async({page},info)=>{
 const before=await snap(page);await page.locator('#find-edit-query').fill('Alpha');await count(page,4);
 for(const mode of ['rows','track','speaker','script']){
   await page.locator('#find-edit-group').selectOption(mode);await expect(marks(page)).toHaveCount(4);
   expect((await marks(page).allTextContents()).sort()).toEqual(['Alpha','Alpha','alpha','alpha']);
 }
 const input=inputs(page).first();await editScriptText(page,input,'  Alpha Bravo  ','甲 Alpha\nAlpha 乙');
 await expect(marks(page)).toHaveCount(5);await expect(input).toBeFocused();
 expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await page.screenshot({path:info.outputPath('script-body-highlights.png')});
 await page.locator('#find-edit-regex').check();await page.locator('#find-edit-query').fill('[');
 await expect(page.locator('#find-edit-message')).toContainText('正则表达式无效');await expect(marks(page)).toHaveCount(0);
});

test('script metadata is not highlighted and copy, IME and local undo stay literal',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.locator('#find-edit-group').selectOption('script');await page.locator('#find-edit-query').fill('中文');await count(page,2);
 await expect(marks(page)).toHaveCount(2);expect(await page.locator('.find-script-info mark').count()).toBe(0);
 const input=inputs(page).first(),before=await input.inputValue();
 await input.focus();await input.evaluate(n=>{const pos=n.value.indexOf('中文');n.setSelectionRange(pos,pos+2);n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
 await expect(marks(page)).toHaveCount(0);
 await input.evaluate(n=>{
   n.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));
   n.setRangeText('测试',n.selectionStart,n.selectionEnd,'end');
   n.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));
   n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'测试'}));
 });
 await expect(marks(page)).toHaveCount(1);await expect(input).toHaveValue(/测试/);
 await input.press('Control+z');await expect(input).toHaveValue(before);await expect(marks(page)).toHaveCount(2);
 await input.press('Control+a');await input.press('Control+c');
 expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n?/g,'\n')).toBe(before);
 await page.locator('#find-edit-script-time').uncheck();await expect(marks(page)).toHaveCount(2);
});
