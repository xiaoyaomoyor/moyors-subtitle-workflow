import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
let server,projectFile;
test.setTimeout(120000);
test.beforeEach(async()=>{
  const folder=makeTempDir('review-markers'),media=join(folder,'synthetic.mp4');projectFile=join(folder,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(folder,'settings');process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=8','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(projectFile,JSON.stringify({media,segments:[{id:'a',start:0,end:6000,text:'Review subtitle'}],
    multi_subtitle:{enabled:true,tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:0,end:6000,text:'复核字幕'}]}]},
    waveform:generateWaveformPayload(8000,10)}));
  server=await startServer(projectFile,media,await findFreePort());
});
test.afterEach(async()=>server?.stop());
test.beforeEach(async({page})=>{
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url);await page.waitForFunction(()=>window.MSWE?.resolve('reviews'),null,{timeout:90000});
});
test('review notes edit, resolve, filter, undo and persist separately from subtitles',async({page},info)=>{
  await page.evaluate(()=>MSWE.resolve('reviews').open());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{MSWE.resolve('processing-host').seek(1,{pauseAfterSeek:true});});
  await page.locator('#review-add-point').click();await page.locator('#review-name').fill('检查人名');await page.locator('#review-note').fill('确认发音');expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  expect(JSON.parse(readFileSync(projectFile,'utf8')).review_markers.items[0].note).toBe('确认发音');
  await page.evaluate(()=>selectOnly(0));await page.locator('#review-link').click();
  await expect(page.locator('#review-links')).toContainText('关联 1 条字幕');
  await page.locator('#review-status').selectOption('resolved');
  await page.evaluate(()=>performUndo());await expect(page.locator('#review-status')).toHaveValue('pending');
  await page.evaluate(()=>performRedo());await expect(page.locator('#review-status')).toHaveValue('resolved');
  await page.locator('#review-filter').selectOption('pending');await expect(page.locator('.msw-review-row')).toHaveCount(0);
  await page.locator('#review-filter').selectOption('');
  await page.locator('#review-visible').uncheck();await expect(page.locator('.msw-review-flag')).toHaveCount(0);await page.locator('#review-visible').check();
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const disk=JSON.parse(readFileSync(projectFile,'utf8'));expect(disk.review_markers.items[0]).toMatchObject({name:'检查人名',note:'确认发音',status:'resolved'});expect(disk.subtitles.cues[0].content.text).toBe('Review subtitle');
  await page.reload();await page.waitForFunction(()=>window.MSWE?.resolve('reviews'));await page.evaluate(()=>MSWE.resolve('reviews').open());
  await page.locator('.msw-review-entry').first().click();await expect(page.locator('#review-note')).toHaveValue('确认发音');
  await page.locator('#review-delete').click();await expect(page.locator('.msw-review-row')).toHaveCount(0);await page.evaluate(()=>performUndo());await expect(page.locator('.msw-review-row')).toHaveCount(1);
  await page.locator('.msw-review-entry').first().click();await expect(page.locator('[data-tab-for=reviews]:visible .tab-name')).toBeVisible();
  await page.screenshot({path:info.outputPath('review-list.png')});
  await page.evaluate(()=>{updateEditorSettings({themePreset:'alice',colors:null});applyThemeAndColors();});
  await page.screenshot({path:info.outputPath('review-list-light.png')});expect(errors).toEqual([]);
});
test('time selections create ranges, dragging commits once, Escape cancels and points stay independent',async({page})=>{
  await page.evaluate(()=>MSWE.resolve('reviews').open());
  await page.evaluate(()=>{MSWE.resolve('processing-host').commitReviews(MSWReview.empty(),'清空测试');MSWE.resolve('time-range').setRange({start:2000,end:4000});});
  await page.locator('#review-add-range').click();await expect(page.locator('#review-end')).toHaveValue('00:00:04.000');
  const flag=page.locator('.msw-review-flag').first();await expect(flag).toBeVisible();
  const box=await flag.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+8);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+8,{steps:5});await page.mouse.up();
  expect(await page.evaluate(()=>DATA.review_markers.items[0].start_ms)).toBeGreaterThan(2000);
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.review_markers.items[0].start_ms)).toBe(2000);
  const back=await flag.boundingBox();await page.mouse.move(back.x+back.width/2,back.y+8);await page.mouse.down();await page.mouse.move(back.x+back.width/2+30,back.y+8);await page.keyboard.press('Escape');await page.mouse.up();
  expect(await page.evaluate(()=>DATA.review_markers.items[0].start_ms)).toBe(2000);
  await page.locator('#review-loop').click();await page.waitForTimeout(2600);
  const time=await page.evaluate(()=>waveformEditor.currentTimeMs());expect(time).toBeGreaterThanOrEqual(2000);expect(time).toBeLessThan(4000);
  await page.locator('#review-loop').click();
  await page.locator('#review-end').fill('');await page.locator('#review-end').press('Tab');await expect(page.locator('#review-loop')).toBeDisabled();
  expect(await page.evaluate(()=>DATA.segments[0].start)).toBe(0);
});

async function openReviewFromMenu(page) {
  await page.locator('[data-menubar-item="window"] > button').click();
  await page.locator('#show-module-toggle').hover();
  await page.locator('#show-module-menu').getByRole('menuitem',{name:'复核列表',exact:true}).click();
}

test('solid review labels contain text and icons, with independent colors surviving undo and reload',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>{
    waveformEditor.settings.secondsPerRow=10;waveformEditor.setMode('multi');waveformEditor.render();
    MSWE.resolve('processing-host').commitReviews({schema:'msw.review.v1',items:[
      {id:'point',start_ms:2500,name:'核对人名',note:'',color:'#e7b35a',status:'pending'},
      {id:'range',start_ms:4200,end_ms:7000,name:'很长的区段名称：核对译文与专有名词 Ag jp '.repeat(3),note:'',color:'#e7b35a',status:'pending'},
      {id:'narrow',start_ms:7200,end_ms:7201,name:'不可溢出的极短区段',note:'',color:'#e7b35a',status:'pending'},
      {id:'unnamed',start_ms:7500,end_ms:7900,name:'',note:'',color:'#345678',text_color:'#fedcba',status:'resolved'}
    ]},'测试颜色');MSWE.resolve('reviews').open();
  });
  const range=page.locator('.msw-review-flag[data-review-id="range"]'),point=page.locator('.msw-review-flag[data-review-id="point"]');
  await page.locator('.msw-review-row[data-id="range"] .msw-review-entry').click();
  await expect(page.locator('#review-content').getByLabel('标签色',{exact:true})).toHaveValue('#e7b35a');
  await expect(page.locator('#review-content').getByLabel('文字色',{exact:true})).toHaveValue('#20242b');
  expect(await page.evaluate(()=>Object.hasOwn(DATA.review_markers.items[1],'text_color'))).toBe(false);
  // Drive the native color input's events without depending on an OS picker.
  const setColor=async(id,value)=>page.locator(id).evaluate((input,value)=>{
    input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
  await setColor('#review-color','#2a4f7a');await expect(page.locator('#review-text-color')).toHaveValue('#20242b');
  await setColor('#review-text-color','#ffeecc');
  const colors=locator=>locator.evaluate(button=>({background:getComputedStyle(button,'::before').backgroundColor,text:getComputedStyle(button.querySelector('.msw-review-label')).color}));
  expect(await colors(range)).toEqual({background:'rgb(42, 79, 122)',text:'rgb(255, 238, 204)'});
  await page.evaluate(()=>performUndo());expect(await colors(range)).toEqual({background:'rgb(42, 79, 122)',text:'rgb(32, 36, 43)'});
  await page.evaluate(()=>performRedo());await expect(page.locator('#review-text-color')).toHaveValue('#ffeecc');
  await page.locator('.msw-review-row[data-id="point"] .msw-review-entry').click();
  await setColor('#review-color','#204060');await setColor('#review-text-color','#ffdd88');
  expect(await point.locator('svg').evaluate(svg=>getComputedStyle(svg).fill)).toBe('rgb(255, 221, 136)');
  expect(await colors(range)).toEqual({background:'rgb(42, 79, 122)',text:'rgb(255, 238, 204)'});
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const saved=JSON.parse(readFileSync(projectFile,'utf8'));
  expect(saved.review_markers.items[0]).toMatchObject({color:'#204060',text_color:'#ffdd88'});
  expect(saved.review_markers.items[1]).toMatchObject({color:'#2a4f7a',text_color:'#ffeecc'});
  expect(Object.hasOwn(saved.review_markers.items[2],'text_color')).toBe(false);
  await page.reload();await page.waitForFunction(()=>window.MSWE?.resolve('reviews'));await page.evaluate(()=>MSWE.resolve('reviews').open());
  await page.locator('.msw-review-row[data-id="range"] .msw-review-entry').click();
  await expect(page.locator('#review-color')).toHaveValue('#2a4f7a');await expect(page.locator('#review-text-color')).toHaveValue('#ffeecc');
  for(const theme of ['default','alice']) {
    await page.evaluate(theme=>{updateEditorSettings({themePreset:theme,colors:null});applyThemeAndColors();},theme);
    expect(await colors(range)).toEqual({background:'rgb(42, 79, 122)',text:'rgb(255, 238, 204)'});
    expect(await point.locator('svg').evaluate(svg=>getComputedStyle(svg).fill)).toBe('rgb(255, 221, 136)');
    const layout=await page.locator('.msw-review-flag').evaluateAll(buttons=>buttons.map(button=>{
      const label=button.querySelector('.msw-review-label'),box=button.getBoundingClientRect(),body=getComputedStyle(button,'::before'),rect=label.getBoundingClientRect();
      const bodyHeight=parseFloat(getComputedStyle(button).getPropertyValue('--review-body-height'));
      return {contained:rect.left>=box.left-.5&&rect.right<=box.right+.5&&rect.top>=box.top-.5&&rect.bottom<=box.top+bodyHeight+.5,
        clipped:getComputedStyle(label).overflow==='hidden',solid:body.backgroundColor.startsWith('rgb(')&&getComputedStyle(button).opacity==='1'};
    }));
    expect(layout.every(value=>value.contained&&value.clipped&&value.solid)).toBe(true);
    const text=await range.locator('.msw-review-label').evaluate(label=>{
      const range=document.createRange();range.selectNodeContents(label);const glyph=range.getBoundingClientRect(),box=label.getBoundingClientRect();
      return {fits:glyph.top>=box.top&&glyph.bottom<=box.bottom,ellipsized:label.scrollWidth>label.clientWidth&&getComputedStyle(label).textOverflow==='ellipsis'};
    });
    expect(text).toEqual({fits:true,ellipsized:true});
    await page.locator('#waveform-pane').screenshot({path:info.outputPath('review-colors-'+theme+'.png')});
    await page.locator('#review-text-color').scrollIntoViewIfNeeded();
    await page.locator('#review-panel').screenshot({path:info.outputPath('review-color-controls-'+theme+'.png')});
  }
  const unnamed=page.locator('.msw-review-flag[data-review-id="unnamed"]');
  expect(await unnamed.locator('svg').evaluate(svg=>getComputedStyle(svg).fill)).toBe('rgb(254, 220, 186)');
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Review subtitle');expect(errors).toEqual([]);
});

for(const mode of ['basic','multi'])test(`top review markers align to time and yield to subtitle editing in ${mode} waveform`,async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(mode=>{
    waveformEditor.settings.secondsPerRow=10;waveformEditor.setMode(mode);waveformEditor.render();
    updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false});
    MSWE.resolve('processing-host').commitReviews({schema:'msw.review.v1',items:[
      {id:'point',start_ms:2500,name:'检查人名',note:'',color:'#e7b35a',status:'pending'},
      {id:'range',start_ms:4200,end_ms:5500,name:'核对译文',note:'',color:'#7aa2f7',status:'pending'}
    ]},'测试标记');
  },mode);
  const point=page.locator('.msw-review-flag[data-review-id="point"]');
  const range=page.locator('.msw-review-flag[data-review-id="range"]');
  await expect(page.locator('.msw-review-guide')).toHaveCount(0);
  const pointBox=await point.boundingBox();
  await page.mouse.move(pointBox.x+pointBox.width/2,pointBox.y+5);await page.mouse.down();
  await expect(point).toHaveAttribute('aria-pressed','true');
  expect(await point.evaluate(button=>{
    const box=button.getBoundingClientRect(),line=button.closest('.waveform-row').querySelector('.msw-review-guide').getBoundingClientRect();
    return Math.abs(box.x+box.width/2-line.x-.5)<1;
  })).toBe(true);
  await page.mouse.up();
  await expect(page.locator('.msw-review-guide')).toHaveCount(1);
  const geometry=await point.evaluate(button=>{
    const row=button.closest('.waveform-row'),cue=row.querySelector('.waveform-cue-block'),guide=row.querySelector('.msw-review-guide');
    const flagBox=button.getBoundingClientRect(),cueBox=cue.getBoundingClientRect(),lineBox=guide.getBoundingClientRect(),rowBox=row.getBoundingClientRect();
    const atCue=document.elementFromPoint(lineBox.x+.5,cueBox.y+cueBox.height/2);
    return {top:flagBox.y-rowBox.y,clear:flagBox.bottom<cueBox.y,
      aligned:Math.abs(flagBox.x+flagBox.width/2-(lineBox.x+.5))<1,
      color:getComputedStyle(guide).borderLeftColor,dash:getComputedStyle(guide).borderLeftStyle,
      behind:Number(getComputedStyle(guide.parentElement).zIndex)<Number(getComputedStyle(cue).zIndex),
      cueHit:atCue?.closest('.waveform-cue-block')===cue,x:lineBox.x+.5,y:cueBox.y+cueBox.height/2};
  });
  expect(geometry).toMatchObject({clear:true,aligned:true,color:'rgb(231, 179, 90)',dash:'dashed',behind:true,cueHit:true});
  expect(geometry.top).toBeLessThanOrEqual(4);
  // Clicking where the guide crosses the subtitle still selects the subtitle.
  await page.mouse.click(geometry.x,geometry.y);
  await expect(page.locator('.msw-review-guide')).toHaveCount(0);
  await expect(point).toHaveAttribute('aria-pressed','false');
  await page.locator('#review-link').click();await expect(page.locator('#review-links')).toContainText('关联 1 条字幕');
  await range.click();await expect(page.locator('.msw-review-guide')).toHaveCount(2);
  await expect(point).toHaveAttribute('aria-pressed','false');
  expect(await page.locator('.msw-review-guide').evaluateAll(lines=>lines.every(line=>getComputedStyle(line).borderLeftColor==='rgb(122, 162, 247)'))).toBe(true);
  for(const edge of ['start','end']) {
    const handle=range.locator('.msw-review-edge.'+edge),box=await handle.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+5);await page.mouse.down();await page.mouse.move(box.x+box.width/2+12,box.y+5,{steps:3});
    const aligned=await range.evaluate(button=>{
      const box=button.getBoundingClientRect(),lines=[...button.closest('.waveform-row').querySelectorAll('.msw-review-guide')];
      return Math.abs(lines[0].getBoundingClientRect().x+.5-box.x)<1&&Math.abs(lines[1].getBoundingClientRect().x+.5-box.right)<1;
    });
    expect(aligned).toBe(true);await page.mouse.up();
    expect(await page.evaluate(edge=>DATA.review_markers.items[1][edge+'_ms'],edge)).toBeGreaterThan(edge==='start'?4200:5500);
    await page.evaluate(()=>performUndo());
  }
  await page.mouse.move(0,0);
  await page.locator('#waveform-pane').screenshot({path:info.outputPath('review-markers-dark.png')});
  await page.evaluate(()=>{updateEditorSettings({themePreset:'alice',colors:null});applyThemeAndColors();});
  await page.locator('#waveform-pane').screenshot({path:info.outputPath('review-markers-light.png')});
  await page.keyboard.press('Escape');await expect(page.locator('.msw-review-guide')).toHaveCount(0);
  await point.focus();await page.keyboard.press('Enter');await expect(page.locator('.msw-review-guide')).toHaveCount(1);
  const rowBox=await point.locator('..').locator('..').boundingBox();
  await page.mouse.click(rowBox.x+rowBox.width*.8,rowBox.y+45);await expect(page.locator('.msw-review-guide')).toHaveCount(0);
  await point.click();await expect(page.locator('.msw-review-guide')).toHaveCount(1);
  await page.keyboard.down('Control');await page.keyboard.down('Shift');
  await page.mouse.move(rowBox.x+rowBox.width*.8,rowBox.y+45);await page.mouse.down();
  await page.mouse.move(rowBox.x+rowBox.width*.9,rowBox.y+45,{steps:4});
  await expect(page.locator('.msw-review-guide')).toHaveCount(0);
  await page.mouse.up();await page.keyboard.up('Shift');await page.keyboard.up('Control');
  await page.locator('#review-visible').uncheck();await expect(page.locator('.msw-review-guide')).toHaveCount(0);await expect(page.locator('.msw-review-flag')).toHaveCount(0);
  expect(await page.evaluate(()=>DATA.segments[0])).toMatchObject({start:0,end:6000,text:'Review subtitle'});
  expect(errors).toEqual([]);
});

test('cross-row review ranges only mark real endpoints and boundary points stay at their timestamp',async({page},info)=>{
  await page.evaluate(()=>{
    waveformEditor.settings.secondsPerRow=5;waveformEditor.setMode('multi');waveformEditor.render();
    MSWE.resolve('processing-host').commitReviews({schema:'msw.review.v1',items:[
      {id:'start',start_ms:0,name:'片头',note:'',color:'#e7b35a',status:'pending'},
      {id:'boundary',start_ms:5000,name:'行首',note:'',color:'#8ac99b',status:'pending'},
      {id:'finish',start_ms:8000,name:'片尾',note:'',color:'#e7b35a',status:'resolved'},
      {id:'span',start_ms:3000,end_ms:7000,name:'跨行复核',note:'',color:'#7aa2f7',status:'pending'}
    ]},'测试跨行');MSWE.resolve('reviews').open();
  });
  const rows=page.locator('.waveform-row');
  await expect(page.locator('.msw-review-flag[data-review-id="span"]')).toHaveCount(2);
  await expect(rows.nth(0).locator('.msw-review-edge.start')).toHaveCount(1);await expect(rows.nth(0).locator('.msw-review-edge.end')).toHaveCount(0);
  await expect(rows.nth(1).locator('.msw-review-edge.start')).toHaveCount(0);await expect(rows.nth(1).locator('.msw-review-edge.end')).toHaveCount(1);
  await page.locator('.msw-review-row[data-id="span"] .msw-review-entry').click();
  await expect(rows.nth(0).locator('.msw-review-guide')).toHaveCount(1);await expect(rows.nth(1).locator('.msw-review-guide')).toHaveCount(1);
  for(const id of ['start','boundary','finish']) {
    await page.locator(`.msw-review-row[data-id="${id}"] .msw-review-entry`).click();
    const flag=page.locator(`.msw-review-flag[data-review-id="${id}"]`);await expect(flag).toHaveCount(1);
    await expect(page.locator('.msw-review-guide')).toHaveCount(1);
    expect(await flag.evaluate(button=>{
      const box=button.getBoundingClientRect(),line=button.closest('.waveform-row').querySelector('.msw-review-guide').getBoundingClientRect();
      return Math.abs(box.x+box.width/2-line.x-.5)<1;
    })).toBe(true);
  }
  await page.locator('.msw-review-row[data-id="span"] .msw-review-entry').click();
  await page.locator('#waveform-pane').screenshot({path:info.outputPath('review-markers-cross-row.png')});
});

for(const entry of ['window menu','tab plus'])test(`closed review panel initializes after restoring a custom workspace via ${entry}`,async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const withMarker=entry==='tab plus';
  await openReviewFromMenu(page);
  if(withMarker) {
    await page.getByRole('button',{name:'＋时间点',exact:true}).click();
    await page.locator('#review-name').fill('核对人名');
    await page.locator('#review-note').fill('确认译名');
    await page.locator('#review-note').press('Tab');
  }
  await page.locator('[data-tab-for="reviews"]:visible .tab-close').click();
  await expect(page.locator('#review-panel')).toHaveCount(0);
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const saved=JSON.parse(readFileSync(projectFile,'utf8'));
  expect(saved.workspace.preset).toBe('custom');
  expect(saved.workspace.hiddenModules).toContain('reviews');
  await page.reload();
  await page.waitForFunction(()=>window.MSWE?.has('processing-host'),null,{timeout:90000});
  await expect(page.locator('#review-panel')).toHaveCount(0);
  if(entry==='window menu')await openReviewFromMenu(page);
  else {
    await page.locator('[data-dock-module="cues"] .module-tab-add').click();
    await page.getByRole('menu',{name:'添加窗口到此标签组'}).getByRole('button',{name:'把复核列表加入此标签组'}).click();
  }
  await expect(page.getByRole('button',{name:'＋时间点',exact:true})).toBeVisible();
  if(withMarker) {
    await expect(page.locator('.msw-review-entry')).toContainText('核对人名');
    await page.locator('.msw-review-entry').click();
    await expect(page.locator('#review-note')).toHaveValue('确认译名');
  } else await expect(page.locator('#review-list')).toContainText('在播放头添加时间点');
  await page.getByRole('button',{name:'＋时间点',exact:true}).click();
  await expect(page.locator('.msw-review-row')).toHaveCount(withMarker?2:1);
  await page.evaluate(()=>performUndo());
  await expect(page.locator('.msw-review-row')).toHaveCount(withMarker?1:0);
  expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('restored-review-panel.png')});
});
