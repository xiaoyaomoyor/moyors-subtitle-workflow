import {expect,test} from '@playwright/test';
import {disableOnboarding,findFreePort,makeTempDir,startBlankServer,toggleMediaSettings} from './helpers.mjs';

let server;
test.beforeAll(async()=>{server=await startBlankServer(await findFreePort(),makeTempDir('media-settings-layout'));});
test.afterAll(async()=>{await server?.stop();});
test.beforeEach(async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await toggleMediaSettings(page);
});

async function edit(page,id,value){await page.locator(id).fill(value);await page.locator(id).dispatchEvent('change');}
const project=page=>page.evaluate(()=>window.MSWE.resolve('processing-host').data.preview.project_style);

test('compact layout keeps labels and controls separate in narrow panels and both languages',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{
    window.MSWE.resolve('processing-host').data.multi_subtitle={enabled:true,tracks:[{id:'secondary',segments:[]}]};
    dispatchEvent(new Event('msw:subtitles-changed'));
  });
  await expect(page.locator('#style-secondary')).toBeVisible();
  await expect(page.locator('#style-manage,#style-scope,#style-editor-title')).toHaveCount(0);
  await expect(page.locator('#style-animation summary .msw-help-button')).toHaveCount(1);
  await expect(page.locator('#subtitle-layer-presentation-settings legend')).toHaveText('重叠字幕');
  await expect(page.locator('#sticker-overlay-toggle').locator('..').locator('.msw-help-button')).toHaveCount(0);
  await expect(page.locator('#media-seek-step').locator('xpath=ancestor::label').locator('.msw-help-button')).toHaveCount(0);
  await expect(page.locator('#style-pair-order').locator('..').locator('.msw-help-button')).toHaveCount(0);
  await page.locator('#subtitle-layer-gap').locator('..').locator('.msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('此项不调整组内主副字幕的间距');await page.keyboard.press('Escape');
  await expect(page.locator('#jkl-playback-mode-hint')).toBeHidden();
  await page.locator('#jkl-playback-mode').locator('..').locator('.msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('K 播放／停止');
  await page.keyboard.press('Escape');
  await page.locator('#jkl-playback-mode').selectOption('speed');
  await page.locator('#jkl-playback-mode').locator('..').locator('.msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('J 慢放');
  await page.keyboard.press('Escape');
  for(const [width,theme,language] of [[560,'default','zh'],[360,'koishi','zh'],[360,'default','en']]){
    await page.locator('#media-settings-modal').evaluate((el,w)=>el.style.width=w+'px',width);
    await page.evaluate(({theme,language})=>{updateEditorSettings({themePreset:theme,theme:THEME_PRESETS[theme].theme,accent:THEME_PRESETS[theme].accent,colors:{}});applyThemeAndColors();window.MSWE_I18N.applyLanguage(language);},{theme,language});
    await page.locator('.media-settings-body').evaluate(el=>el.scrollTop=0);
    const preview=await page.locator('#style-preview-mode').boundingBox(),output=await page.locator('#style-project-preset').boundingBox();
    expect(Math.abs(preview.y-output.y)).toBeLessThan(1);expect(output.x).toBeGreaterThan(preview.x+preview.width);
    const bounds=await page.locator('.media-settings-body').evaluate(body=>{
      const issues=[];
      if(body.scrollWidth>body.clientWidth+1)issues.push('horizontal overflow');
      const toolbar=body.querySelector('.msw-style-toolbar').getBoundingClientRect();
      for(const button of body.querySelectorAll('.msw-style-toolbar button')){
        if(!button.checkVisibility())continue;
        const rect=button.getBoundingClientRect();
        if(rect.left<toolbar.left-1||rect.right>toolbar.right+1)issues.push(button.id+' overflows the toolbar');
      }
      for(const label of body.querySelectorAll('.media-settings-field,.msw-style-field')){
        if(!label.checkVisibility())continue;
        const caption=label.querySelector('.msw-option-label'),control=label.querySelector('input,select');if(!caption||!control||control.type==='checkbox')continue;
        if(caption.getBoundingClientRect().bottom>control.getBoundingClientRect().top+1)issues.push(control.id+' overlaps its label');
        const rect=label.getBoundingClientRect(),input=control.getBoundingClientRect();
        if(input.right>rect.right+1||input.left<rect.left-1)issues.push(control.id+' overflows its label');
      }
      return issues;
    });
    expect(bounds).toEqual([]);
    await page.locator('#media-settings-modal').screenshot({path:info.outputPath(`settings-${width}-${language}.png`)});
    await page.locator('#style-field-alignment').scrollIntoViewIfNeeded();
    await page.locator('#media-settings-modal').screenshot({path:info.outputPath(`style-${width}-${language}.png`)});
  }
  expect(errors).toEqual([]);
});

test('preset preview remains independent and current custom restores the project draft',async({page})=>{
  await expect(page.locator('#style-preview-mode option[value="custom"]')).toHaveCount(0);
  await expect(page.locator('#style-edit-proof,#style-edit-project')).toHaveCount(0);
  await page.locator('#style-project-preset').selectOption('current');
  await expect(page.locator('#style-project-preset')).toHaveValue('current');
  await page.locator('#style-preview-mode').selectOption('contrast');
  await page.locator('#style-project-preset').selectOption('large');
  await expect(page.locator('#style-preview-mode')).toHaveValue('contrast');
  await edit(page,'#style-field-fontSize','64');
  expect((await project(page)).main.fontSize).toBe(64);
  expect(await page.evaluate(()=>window.MSWSubtitleStyle.currentPreview().style.main.borderStyle)).toBe(3);
  await page.locator('#style-project-preset').selectOption('bilingual');
  await page.locator('#style-project-preset').selectOption('current');
  await expect(page.locator('#style-field-fontSize')).toHaveValue('64');
  await page.evaluate(()=>performUndo());await expect(page.locator('#style-project-preset')).toHaveValue('bilingual');
  await page.evaluate(()=>performRedo());await expect(page.locator('#style-project-preset')).toHaveValue('current');
  const saved=await page.evaluate(()=>JSON.parse(buildJson()));expect(saved.preview.project_style_custom.main.fontSize).toBe(64);
  await page.evaluate(()=>applyCanonicalProject({segments:[],preview:{project_style:window.MSWProjectStyle.presets()[1]}},'other.mosp'));
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await page.locator('#style-project-preset').selectOption('current');await expect(page.locator('#style-field-fontSize')).toHaveValue('72');
  await page.evaluate(p=>applyCanonicalProject(p,'restored.mosp'),saved);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await expect(page.locator('#style-field-fontSize')).toHaveValue('64');
  await expect(page.locator('#style-preview-mode')).toHaveValue('contrast');
});

test('removed custom preview is migrated once into an ordinary preset',async({page})=>{
  await page.evaluate(()=>{const style=window.MSWProjectStyle.defaults();style.main.fontSize=91;localStorage.setItem('msw.subtitle-proof.v1',JSON.stringify({mode:'custom',style,customStyle:style}));});
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await toggleMediaSettings(page);const id=await page.locator('#style-preview-mode').inputValue();
  expect(id).not.toBe('custom');expect(id).not.toBe('project');
  expect(await page.evaluate(()=>window.MSWSubtitleStyle.currentPreview().style.main.fontSize)).toBe(91);
  expect((await project(page)).main.fontSize).not.toBe(91);
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await toggleMediaSettings(page);await expect(page.locator('#style-preview-mode')).toHaveValue(id);
  const saved=await page.evaluate(()=>window.MSWSubtitleStyle.request('subtitle-presets'));expect(saved.presets.filter(s=>s.main.fontSize===91)).toHaveLength(1);
});

test('paired arrangement and appearance-only swap survive undo and project serialization',async({page})=>{
  await page.evaluate(()=>{const h=window.MSWE.resolve('processing-host');h.data.multi_subtitle={enabled:true,tracks:[{id:'secondary',segments:[]}]};dispatchEvent(new Event('msw:subtitles-changed'));});
  await page.locator('#style-project-preset').selectOption('default');
  await expect(page.locator('#style-pair-gap')).toHaveValue('0');
  await page.locator('#style-pair-order').selectOption('secondary-above');await edit(page,'#style-pair-gap','-12');
  const before=await project(page);expect(before.pairLayout).toEqual({order:'secondary-above',gap:-12});
  await page.locator('#style-swap').click();const swapped=await project(page);
  expect(swapped.main.fontSize).toBe(before.secondary.fontSize);expect(swapped.secondary.primaryColor).toBe(before.main.primaryColor);
  for(const role of ['main','secondary'])for(const key of ['alignment','marginL','marginR','marginV'])expect(swapped[role][key]).toBe(before[role][key]);
  expect(swapped.pairLayout).toEqual(before.pairLayout);
  await page.evaluate(()=>performUndo());expect(await project(page)).toEqual(before);
  await page.evaluate(()=>performRedo());expect(await project(page)).toEqual(swapped);
  const saved=await page.evaluate(()=>JSON.parse(buildJson()));
  await page.evaluate(p=>applyCanonicalProject(p,'arranged.mosp'),saved);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await expect(page.locator('#style-pair-order')).toHaveValue('secondary-above');await expect(page.locator('#style-pair-gap')).toHaveValue('-12');
});

test('animation groups show only enabled parameters and preserve edits across track and fold changes',async({page},info)=>{
  await page.evaluate(()=>{
    window.MSWE.resolve('processing-host').data.multi_subtitle={enabled:true,tracks:[{id:'secondary',segments:[]}]};dispatchEvent(new Event('msw:subtitles-changed'));
  });
  await page.locator('#style-more summary').click();
  await page.locator('#style-field-bold').check();
  await page.locator('#style-field-angle').scrollIntoViewIfNeeded();
  await page.locator('#media-settings-modal').screenshot({path:info.outputPath('advanced-settings.png')});
  await page.locator('#style-secondary').click();await edit(page,'#style-field-fontSize','36');
  await page.locator('#style-main').click();expect((await project(page)).secondary.fontSize).toBe(36);
  await page.locator('#style-animation summary').click();
  await expect(page.locator('#style-effect-fad-fields')).toBeHidden();
  await page.locator('#style-field-fad-enabled').check();await edit(page,'#style-field-fad-inMs','400');
  await page.locator('#style-field-fade-enabled').check();
  await expect(page.locator('#style-field-fad-enabled')).not.toBeChecked();await expect(page.locator('#style-effect-fad-fields')).toBeHidden();
  await page.locator('#style-field-fad-enabled').check();await expect(page.locator('#style-field-fad-inMs')).toHaveValue('400');
  await page.locator('#style-field-move-enabled').check();await edit(page,'#style-field-move-x2','320');
  await page.locator('#style-field-t-enabled').check();await page.locator('#style-transform-preset').selectOption('\\fscx120\\fscy120');
  await expect(page.locator('#style-field-t-tags')).toBeHidden();
  const style=await project(page);expect(style.animations.t.tags).toBe('\\fscx120\\fscy120');expect(style.animations.fade.enabled).toBe(false);
  await page.locator('#style-animation summary').click();await page.locator('#style-animation summary').click();
  expect(await project(page)).toEqual(style);
  await page.locator('#media-settings-modal').evaluate(el=>el.style.width='360px');
  await page.locator('#style-effect-t-toggle').scrollIntoViewIfNeeded();
  await page.locator('#media-settings-modal').screenshot({path:info.outputPath('animation-narrow.png')});
  expect(await page.locator('.media-settings-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

test('failed preset save can be retried without mutating the project or duplicating presets',async({page})=>{
  let before=await project(page);
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('可重试预设');
  await page.route('**/subtitle-presets',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'测试保存失败'})}));
  await page.locator('#style-save-preset').click();await expect(page.locator('#style-message')).toHaveText('测试保存失败');
  await expect(page.locator('#style-save-form')).toBeVisible();expect(await project(page)).toEqual(before);
  // The save captures the current fields at submission, including edits made
  // while the naming form is open, without overwriting the project on success.
  await edit(page,'#style-field-fontSize','53');before=await project(page);
  await page.unroute('**/subtitle-presets');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-save-form')).toBeHidden();expect(await project(page)).toEqual(before);
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('可重试预设');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-message')).toContainText('已有同名预设');
  await page.locator('#style-save-cancel').click();await page.locator('#style-delete-preset').click();await page.locator('#style-delete-cancel').click();
  await expect(page.locator('#style-delete-preset')).toBeEnabled();
  const saved=await page.evaluate(()=>window.MSWSubtitleStyle.request('subtitle-presets'));
  expect(saved.presets.filter(s=>s.name==='可重试预设')).toHaveLength(1);
  expect(saved.presets.find(s=>s.name==='可重试预设').main.fontSize).toBe(53);
});
