import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {setup,snap,inputs,count,apply,editScriptText} from './find-unified-fixture.mjs';
setup();
const script=async page=>{await page.locator('#find-edit-group').selectOption('script');await expect(inputs(page)).toHaveCount(1);return inputs(page).first();};
const clipboard=page=>page.evaluate(async()=>(await navigator.clipboard.readText()).replace(/\r\n?/g,'\n'));

test('script pairs bound cues, edits both texts in one undo step, shares drafts and preserves metadata',async({page},info)=>{
 const before=await snap(page),history=await page.evaluate(()=>editorHistory.undoLength());
 const input=await script(page),text=await input.inputValue();
 expect(text.match(/^\[\[/gm)).toHaveLength(4);expect(text).toContain('⟦S1主 · #1⟧');expect(text).toContain('⟦S1副 · #1⟧');expect(text).not.toContain('\n\n');
 await editScriptText(page,input,'  Alpha Bravo  ','译文改为多行\n第二行');await editScriptText(page,input,' 中文 0','原文也修改');
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

test('script metadata and cross-cue boundaries resist typing, deletion and cut without losing drafts',async({page})=>{
 const before=await snap(page),input=await script(page),text=await input.inputValue();
 await editScriptText(page,input,'Alpha Bravo','valid draft');await expect(page.locator('#find-edit-apply')).toBeEnabled();
 const valid=await input.inputValue();await editScriptText(page,input,'#1','#999');await expect(input).toHaveValue(valid);
 await expect(page.locator('#find-edit-message')).toContainText('只读');
 await input.evaluate(n=>{const start=n.value.indexOf('  valid draft');n.setSelectionRange(start,start);});await page.keyboard.press('Backspace');await expect(input).toHaveValue(valid);
 await input.press('Control+a');await input.press('Delete');await expect(input).toHaveValue(valid);
 await input.evaluate(n=>{const event=new ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});n.dispatchEvent(event);});await expect(input).toHaveValue(valid);
 await page.locator('#find-edit-group').selectOption('rows');await expect(page.locator('#find-edit-apply')).toBeEnabled();
 await script(page);await expect(input).toHaveValue(valid);
 expect((await snap(page)).subtitles).toEqual(before.subtitles);
 await page.locator('[data-reset]:visible').click();await expect(input).toHaveValue(text);expect(await page.evaluate(()=>MSWFindEdit.hasDraft())).toBe(false);
});

test('script double-click locates the chosen partner and external edits block stale drafts',async({page})=>{
 const input=await script(page);
 await input.evaluate(n=>{n.setSelectionRange(n.value.indexOf(' 中文 1')+1,n.value.indexOf(' 中文 1')+1);n.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));});
 await expect.poll(()=>page.evaluate(()=>fixedActiveTrackId)).toBe((await snap(page)).subtitles.cues.find(c=>c.content.text===' 中文 1').track_id);
 await editScriptText(page,input,'Alpha Bravo','Pending');
 await page.evaluate(()=>{DATA.segments[0].text='External';MSWFindEdit.changed();});
 await expect(page.locator('#find-edit-message')).toContainText('目标字幕已改变');await expect(page.locator('#find-edit-apply')).toBeDisabled();
});

test('long script keeps focus and the last cue editable without changing earlier cues',async({page},info)=>{
 const started=Date.now(),timing={};
 await page.evaluate(()=>applyCanonicalProject({segments:Array.from({length:6000},(_,i)=>({id:'long'+i,start:i*1000,end:i*1000+900,text:'Line '+i,items:[]}))},'long.mosp'));await count(page,6000);
 timing.fixture=Date.now()-started;const opened=Date.now();
 const input=await script(page),text=await input.inputValue();expect(text.match(/^\[\[/gm)).toHaveLength(6000);
 timing.open=Date.now()-opened;const editing=Date.now();
 await input.focus();timing.focus=Date.now()-editing;
 const selecting=Date.now();await input.evaluate(n=>{const start=n.value.lastIndexOf('Line 5999');n.setSelectionRange(start,start+'Line 5999'.length);});timing.select=Date.now()-selecting;
 const typing=Date.now();await page.keyboard.insertText('Edited last line');timing.input=Date.now()-typing;
 await expect(page.locator('#find-edit-apply')).toBeEnabled();await expect(input).toBeFocused();timing.edit=Date.now()-editing;
 const applying=Date.now();await apply(page);
 timing.apply=Date.now()-applying;
 const cues=(await snap(page)).subtitles.cues;expect(cues.find(c=>c.content.start===5999000).content.text).toBe('Edited last line');expect(cues.find(c=>c.content.start===0).content.text).toBe('Line 0');
 await page.evaluate(()=>performUndo());await expect(input).toHaveValue(/Line 5999/);
 const path=info.outputPath('script-6000-timings.json');writeFileSync(path,JSON.stringify(timing));
 await info.attach('script-6000-timings-ms',{path,contentType:'application/json'});
});

test('script bodies accept literal punctuation, multiline paste and empty text with local undo and keyboard navigation',async({page,context})=>{
 const input=await script(page),literal='他说：“Hello, "world".”\nC:\\new\\title\n[[正文中的信息行]]';
 await editScriptText(page,input,'  Alpha Bravo  ',literal);await expect(input).toHaveValue(new RegExp('C:\\\\new\\\\title'));
 await input.press('Control+z');await expect(input).toHaveValue(/  Alpha Bravo  /);
 await input.press('Control+y');expect(await input.inputValue()).toContain(literal);
 await input.press('Tab');expect(await input.evaluate(n=>n.value.slice(n.selectionStart,n.selectionStart+5))).toBe(' 中文 0');
 await editScriptText(page,input,' 中文 0','');await page.keyboard.press('Enter');
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'你',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.imeSetComposition',{text:'你好',selectionStart:2,selectionEnd:2});
 await cdp.send('Input.insertText',{text:'你好'});expect(await input.inputValue()).toContain('\n你好');
 await input.press('Control+z');expect(await input.inputValue()).not.toContain('你好');
 await page.keyboard.insertText('👩‍💻');await input.press('Backspace');expect(await input.inputValue()).not.toContain('👩');
 await apply(page);const texts=(await snap(page)).subtitles.cues.map(c=>c.content.text);expect(texts).toContain(literal);expect(texts).toContain('\n');
});

test('information checkboxes, selection copy and full copy support safe external round-trips',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.evaluate(()=>{const [main,sub]=testTracks;fixedUpdateTrack(main,{language:'en'});fixedUpdateTrack(sub,{language:'zh-hans'});});
 const input=await script(page);await expect(input).toHaveValue(/S1主 · 英文 · #1/);
 const original=await input.inputValue();await input.focus();await input.press('Control+a');await input.press('Control+c');
 expect(await clipboard(page)).toBe(original);
 await input.press('Control+x');await expect(input).toHaveValue(original);expect(await clipboard(page)).toBe(original);
 for(const field of ['time','speaker','track','language','number'])await page.locator('#find-edit-script-'+field).uncheck();
 const bare=await input.inputValue();expect(bare).not.toContain('[[');expect(bare).not.toContain('⟦');
 await page.locator('#find-edit-script-copy').click();await expect.poll(()=>clipboard(page)).toBe(bare);
 await page.locator('#find-edit-script-copy-full').click();await expect.poll(()=>clipboard(page)).toBe(original);
 await page.evaluate(text=>navigator.clipboard.writeText(text.replace('Alpha Bravo','External "edit"').replace(' 中文 0','外部“修改”\n第二行')),original);
 await input.focus();await input.press('Control+a');await input.press('Control+v');await expect(input).toHaveValue(/External "edit"/);
 await expect(input).toHaveValue(/外部“修改”\n第二行/);expect(await input.inputValue()).not.toContain('⟦');
 const valid=await input.inputValue();await page.evaluate(text=>navigator.clipboard.writeText(text.replace('#1','#999')),original);
 await input.press('Control+a');await input.press('Control+v');await expect(input).toHaveValue(valid);await expect(page.locator('#find-edit-message')).toContainText('完整信息行');
 await page.locator('#find-edit-script-time').check();await expect(input).toHaveValue(/\[\[00:01.000~00:02.000\]\]/);
 await page.locator('#find-edit-script-speaker').check();await expect(input).toHaveValue(/SP3/);
 await apply(page);const texts=(await snap(page)).subtitles.cues.map(c=>c.content.text);expect(texts).toContain('  External "edit"  ');expect(texts).toContain('外部“修改”\n第二行');
 await page.locator('#find-edit-close').click();await page.keyboard.press('Control+f');await expect(page.locator('#find-edit-script-track')).not.toBeChecked();
 await page.evaluate(()=>MSWFindEdit.open({ids:[JSON.parse(buildJson()).subtitles.cues[0].id]}));await count(page,1);
 for(const field of ['time','speaker'])await page.locator('#find-edit-script-'+field).uncheck();
 await page.locator('#find-edit-script-copy-full').click();const single=await clipboard(page);
 await page.evaluate(text=>navigator.clipboard.writeText(text.replace('External "edit"','Single pasted')),single);
 await input.focus();await input.press('Control+a');await input.press('Control+v');await expect(input).toHaveValue('  Single pasted  ');
});

for(const width of [400,1280])test(`script layout fits ${width}px and keeps apply accessible`,async({page},info)=>{
 await page.setViewportSize({width,height:850});await script(page);
 await page.locator('#find-edit-panel').evaluate((n,width)=>{n.style.width=Math.min(width-24,680)+'px';n.style.height='760px';n.style.left='6px';n.style.top='6px';},width);
 expect(await page.locator('#find-edit-panel').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);await expect(page.locator('#find-edit-apply')).toBeInViewport();
 await page.locator('#find-edit-panel').screenshot({path:info.outputPath('script-layout.png')});
});

test('script information and text stay aligned in a narrow light English interface',async({page},info)=>{
 await page.evaluate(()=>{MSWE_I18N.applyLanguage('en');updateEditorSettings({theme:'light',themePreset:'alice',colors:{}});applyThemeAndColors();});
 await page.setViewportSize({width:480,height:850});const input=await script(page);
 await page.locator('#find-edit-panel').evaluate(n=>{n.style.width='456px';n.style.height='760px';n.style.left='6px';n.style.top='6px';});
 await expect(page.locator('#find-edit-script-copy-full')).toHaveText('Copy complete script');
 await expect(page.locator('#find-edit-script-time').locator('..')).toHaveText('Time');
 await expect(page.locator('.find-tools-location')).toContainText('6 cues');
 const wrapped='A long body with quotes "Hello" and 中文“你好”. '.repeat(12)+'\nSecond line';
 await editScriptText(page,input,'  Alpha Bravo  ',wrapped);await input.evaluate(n=>{n.scrollTop=80;n.dispatchEvent(new Event('scroll'));});
 const metrics=await input.evaluate(n=>{const ink=n.parentElement.querySelector('pre'),a=getComputedStyle(n),b=getComputedStyle(ink);return {input:[a.fontFamily,a.fontSize,a.lineHeight,a.padding],ink:[b.fontFamily,b.fontSize,b.lineHeight,b.padding],scroll:n.scrollTop,transform:ink.style.transform,width:ink.offsetWidth,client:n.clientWidth};});
 expect(metrics.input).toEqual(metrics.ink);expect(metrics.width).toBe(metrics.client);expect(metrics.transform).toBe(`translateY(${-metrics.scroll}px)`);
 expect(await page.locator('#find-edit-panel').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);await expect(page.locator('#find-edit-apply')).toBeInViewport();
 await page.locator('#find-edit-panel').screenshot({path:info.outputPath('script-light-english.png')});
});
