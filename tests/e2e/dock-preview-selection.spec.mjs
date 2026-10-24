import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer,toggleMediaSettings} from './helpers.mjs';
let server,errors;
test.beforeEach(async({page})=>{
  const folder=makeTempDir('dock-preview-selection'),video=join(folder,'video.mp4'),project=join(folder,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(folder,'settings');process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media:video,segments:[{id:'a',start:0,end:2000,text:'First'},{id:'b',start:3000,end:6000,text:'Second'}],multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[{id:'c',start:0,end:2000,text:'Translation'}]}]},waveform:generateWaveformPayload(6000)}));
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,selectBoundSubtitlePair:false,subtitleAvoidControls:false})));
  errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(project,video,await findFreePort());await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready),{timeout:30000}).toBe(true);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();expect(errors).toEqual([]);});

test('first plus menu preserves the workspace, anchors to the button and adds a tab',async({page})=>{
  const add=page.locator('[data-dock-module="player"] .module-tab-add'),menu=page.getByRole('menu',{name:'添加窗口到此标签组'});
  expect(await page.evaluate(()=>waveformEditor.isCustomLayout())).toBe(false);
  const before=await add.boundingBox();
  await add.click();await expect(menu).toBeVisible();
  expect(await page.evaluate(()=>waveformEditor.isCustomLayout())).toBe(false);
  expect(await add.boundingBox()).toEqual(before);
  const anchor=await add.boundingBox(),box=await menu.boundingBox();
  expect(Math.abs(box.x-anchor.x)).toBeLessThan(2);expect(Math.abs(box.y-anchor.y-anchor.height-4)).toBeLessThan(2);
  await menu.hover();await page.waitForTimeout(300);await expect(menu).toBeVisible();
  await page.mouse.move(1,1);await expect(menu).toBeHidden();
  await add.click();await menu.getByRole('button',{name:'把属性列表加入此标签组'}).click();
  await expect(page.locator('#subtitle-properties')).toBeVisible();
  await expect(page.locator('[data-dock-module="properties"] .module-tab')).toHaveCount(2);
  // Also exercise the shared dismissal for the existing module-switch menu.
  await page.locator('[data-dock-module="wave"] .module-tab').click();
  const convert=page.getByRole('menu',{name:'把此窗口变成其他模块'});await expect(convert).toBeVisible();
  await convert.hover();await page.waitForTimeout(300);await expect(convert).toBeVisible();
  await page.mouse.move(1,1);await expect(convert).toBeHidden();
  // A menu near the viewport bottom stays inside the viewport.
  const bottom=page.locator('[data-dock-module="cues"] .module-tab-add');await bottom.click();
  const bottomBox=await menu.boundingBox();expect(bottomBox.y).toBeGreaterThanOrEqual(8);
  expect(bottomBox.y+bottomBox.height).toBeLessThanOrEqual(800);
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();
});

test('all docking intents follow the active theme instead of separate yellow and green colors',async({page})=>{
  for(const theme of ['default','koishi']){
    await page.evaluate(theme=>{updateEditorSettings({themePreset:theme,theme:THEME_PRESETS[theme].theme,accent:'#b33d69',colors:{}});applyThemeAndColors();},theme);
    const source=page.locator('[data-dock-module="panel"] .module-tab'),transfer=await page.evaluateHandle(()=>new DataTransfer());
    await source.dispatchEvent('dragstart',{dataTransfer:transfer});
    for(const kind of ['tab','insert','root']){
      const target=page.locator(kind==='root'?'#editor-workspace':'[data-dock-module="wave"]');
      const r=await target.boundingBox();
      await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:kind==='root'?r.x+2:r.x+r.width/2,clientY:kind==='tab'?r.y+15:kind==='insert'?r.y+40:r.y+r.height/2});
      await expect(page.locator('#layout-drop-preview')).toBeVisible();
      const style=await page.locator('#layout-drop-preview').evaluate(el=>{
        const probe=document.createElement('span');probe.style.color='var(--accent)';document.body.append(probe);
        const color=getComputedStyle(probe).color;probe.remove();
        return {border:getComputedStyle(el).borderTopColor,color};
      });
      expect(style.border).toBe(style.color);
    }
    await page.locator('[data-dock-module="panel"] .module-tab').dispatchEvent('dragend',{dataTransfer:transfer});
  }
});

test('waveform clicks, playhead drags and player seeks preserve the subtitle editing selection',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);addExtensionToSelection(0);waveformEditor.settings.dragPlayhead=true;});
  const selected=()=>page.evaluate(()=>({main:[...selectedIdxs],secondary:[...selectedExtensionIdxs],current:currentCuePanelIdx}));
  const before=await selected(),row=page.locator('.waveform-row').first(),box=await row.boundingBox();
  await row.click({position:{x:box.width*.45,y:55}});
  await expect.poll(()=>page.evaluate(()=>player.currentTime)).toBeGreaterThan(1);
  expect(await selected()).toEqual(before);
  await page.mouse.move(box.x+box.width*.2,box.y+55);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.6,box.y+55,{steps:10});await page.mouse.up();
  expect(await selected()).toEqual(before);
  await page.locator('#media-seek').evaluate(el=>{el.value='4.2';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(await selected()).toEqual(before);
  const second=page.locator('.waveform-cue-block').filter({hasText:'Second'}).first();await second.click();
  expect((await selected()).main).toEqual([1]);
});

test('player preview preset and properties entry share a compact aligned row',async({page},info)=>{
  await toggleMediaSettings(page);
  for(const width of [560,360]){
    await page.locator('#media-settings-modal').evaluate((el,w)=>el.style.width=w+'px',width);
    const preset=page.locator('#style-preview-mode'),button=page.locator('#subtitle-properties-open');
    await preset.scrollIntoViewIfNeeded();const a=await preset.boundingBox(),b=await button.boundingBox();
    expect(Math.abs(a.y+a.height-b.y-b.height)).toBeLessThan(2);expect(b.x).toBeGreaterThanOrEqual(a.x+a.width);
    expect(await page.locator('.media-settings-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  }
  await page.locator('#media-settings-modal').screenshot({path:info.outputPath('preview-row.png')});
  await page.locator('#subtitle-properties-open').click();await expect(page.locator('#subtitle-properties')).toBeVisible();
});
