import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer,toggleMediaSettings} from './helpers.mjs';
let server,folder,errors;
test.beforeEach(async({page})=>{
  folder=makeTempDir('subtitle-properties');
  process.env.MSW_APP_DATA_ROOT=join(folder,'settings');process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const video=join(folder,'video.mp4'),project=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media:video,segments:[{id:'a',start:0,end:2500,text:'First subtitle'},{id:'b',start:3000,end:6000,text:'Second subtitle'}],multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[{id:'c',start:0,end:2500,text:'Translation'}]}],bindings:[{id:'binding',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['c']}]},waveform:generateWaveformPayload(6000)}));
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,selectBoundSubtitlePair:false,subtitleAvoidControls:false})));
  errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(project,video,await findFreePort());await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready),{timeout:30000}).toBe(true);
  await page.evaluate(()=>{player.currentTime=1;overlayToggle.checked=true;extensionOverlayToggle.checked=true;selectOnly(0);MSWSubtitleStyle.open('cue');MSWSubtitleRenderer.invalidate();});
  await idle(page);
  await page.locator('#style-more').evaluate(el=>el.open=true);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();expect(errors).toEqual([]);});
async function idle(page){await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&MSWPreviewControls.settled),{timeout:30000}).toBe(true);}
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));

test('multiline text alignment keeps its anchor and matches preview, burn, undo and reopen',async({page},info)=>{
  test.setTimeout(120000);
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),c=p.subtitles.cues[0];
    c.content.text='MMMMMMMMMM\nMM';c.content.items=[];
    c.content.subtitle_position={x:.5,y:.55,alignment:2};
    c.content.subtitle_style={fontName:'Arial',latinFontName:'Arial',fontSize:96,primaryColor:'#ff0000'};
    productionCommitProject(p,'multiline fixture',[c.id]);MSWSubtitleStyle.open('cue');
  });await idle(page);
  await expect(page.locator('#style-field-textAlign')).toHaveValue('center');
  const position=(await snap(page)).subtitles.cues[0].content.subtitle_position,files=[];
  for(const align of ['left','center','right']){
    await page.locator('#style-field-textAlign').selectOption(align);await idle(page);
    expect((await snap(page)).subtitles.cues[0].content.subtitle_position).toEqual(position);
    const ass=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),target:'both',video:{width:640,height:360}}));
    writeFileSync(join(folder,'aligned.ass'),ass.ass);
    const preview=join(folder,align+'-preview.png'),burn=join(folder,align+'-burn.png');
    const canvas=page.locator('.JASSUB'),box=await canvas.boundingBox();await canvas.screenshot({path:preview});
    execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-i','video.mp4','-ss','1','-vf',`ass=aligned.ass,scale=${Math.round(box.width)}:${Math.round(box.height)}`,'-frames:v','1',burn],{cwd:folder,windowsHide:true});
    files.push(preview,burn);
  }
  const rows=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image
import json,sys
def lines(path):
 im=Image.open(path).convert('RGB');groups=[]
 for y in range(im.height):
  xs=[x for x in range(im.width) if (lambda c:c[0]>100 and c[0]>c[1]*2 and c[0]>c[2]*2)(im.getpixel((x,y)))]
  if xs:
   if not groups or y>groups[-1][2]+1: groups.append([min(xs),max(xs),y])
   else: groups[-1]=[min(groups[-1][0],min(xs)),max(groups[-1][1],max(xs)),y]
 return [g[:2] for g in groups]
print(json.dumps([lines(p) for p in sys.argv[1:]]))`,...files],{encoding:'utf8',windowsHide:true}));
  for(let i=0;i<rows.length;i++){
    expect(rows[i]).toHaveLength(2);
    const [long,short]=rows[i],mode=Math.floor(i/2),edge=b=>mode===0?b[0]:mode===1?(b[0]+b[1])/2:b[1];
    expect(Math.abs(edge(long)-edge(short))).toBeLessThan(3);
    if(i%2)for(let j=0;j<2;j++)for(let k=0;k<2;k++)expect(Math.abs(rows[i][j][k]-rows[i-1][j][k])).toBeLessThan(4);
  }
  await page.evaluate(()=>performUndo());await idle(page);await expect(page.locator('#style-field-textAlign')).toHaveValue('center');
  await page.evaluate(()=>performRedo());await idle(page);await expect(page.locator('#style-field-textAlign')).toHaveValue('right');
  await page.locator('#subtitle-properties').evaluate(el=>Object.assign(el.style,{position:'fixed',top:'40px',left:'40px',width:'640px',height:'760px',zIndex:'60'}));
  await page.locator('#style-field-textAlign').scrollIntoViewIfNeeded();
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('multiline-alignment.png')});
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);await page.reload();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style.textAlign).toBe('right');
});

test('Ctrl+D reserves the shortcut when empty, editing, or a context menu is open',async({page})=>{
  // A target listener can stop bubbling; capture must still block bookmarks.
  const dispatch=()=>page.evaluate(()=>{
    const e=new KeyboardEvent('keydown',{key:'d',code:'KeyD',ctrlKey:true,bubbles:true,cancelable:true});
    (document.activeElement||document.body).dispatchEvent(e);return e.defaultPrevented;
  });
  await page.evaluate(()=>{document.activeElement?.blur();selectOnly(0);addExtensionToSelection(0);});
  expect(await dispatch()).toBe(true);
  expect(await page.evaluate(()=>selectedIdxs.size+selectedExtensionIdxs.size)).toBe(0);
  expect(await dispatch()).toBe(true);
  await page.evaluate(()=>{selectOnly(0);ctxmenu.classList.add('show');document.activeElement?.blur();});
  await page.keyboard.press('Control+d');
  await expect(page.locator('#ctxmenu')).not.toHaveClass(/show/);
  expect(await page.evaluate(()=>selectedIdxs.size+selectedExtensionIdxs.size)).toBe(0);
  await page.evaluate(()=>{
    waveformEditor.activateModuleTab('panel');selectOnly(0);
  });
  await page.locator('#cue-panel-text').focus();
  await expect(page.locator('#cue-panel-text')).toBeFocused();
  await page.evaluate(()=>{
    cuePanelText.setSelectionRange(0,5);
    cuePanelText.addEventListener('keydown',e=>e.stopPropagation(),{once:true});
  });
  const before=await page.evaluate(()=>({value:cuePanelText.value,start:cuePanelText.selectionStart,end:cuePanelText.selectionEnd}));
  expect(await dispatch()).toBe(true);
  expect(await page.evaluate(()=>({value:cuePanelText.value,start:cuePanelText.selectionStart,end:cuePanelText.selectionEnd}))).toEqual(before);
  expect(await page.evaluate(()=>selectedIdxs.size)).toBe(1);
  await page.evaluate(()=>MSWSubtitleStyle.open('cue'));
  await page.locator('#style-field-fontSize').focus();await expect(page.locator('#style-field-fontSize')).toBeFocused();expect(await dispatch()).toBe(true);
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('Control+d');
  expect(await page.evaluate(()=>selectedIdxs.size)).toBe(0);
});
async function field(page,name,value){if(name.endsWith('FontName'))await page.locator('#style-font-script').selectOption(name.replace('FontName',''));await page.locator('#style-field-'+name).fill(String(value));await page.locator('#style-field-'+name).blur();await idle(page);}

test('single and cross-track edits preserve inheritance, binding, undo and reopen',async({page},info)=>{
  await expect(page.locator('#subtitle-properties')).toBeVisible();
  await expect(page.locator('#style-edit-scope')).toHaveValue('cue');
  const before=await snap(page);
  await field(page,'fontSize',80);
  let p=await snap(page);expect(p.subtitles.cues[0].content.subtitle_style).toEqual({fontSize:80});
  expect(p.subtitles.cues.slice(1)).toEqual(before.subtitles.cues.slice(1));expect(p.subtitles.bindings).toEqual(before.subtitles.bindings);
  await page.evaluate(()=>addExtensionToSelection(0));
  await expect(page.locator('#style-field-fontSize')).toHaveValue('');
  await page.locator('#style-more').evaluate(el=>el.open=true);await page.locator('#style-field-italic').check();await idle(page);
  p=await snap(page);expect(p.subtitles.cues[0].content.subtitle_style).toEqual({fontSize:80,italic:true});
  expect(p.subtitles.cues.find(c=>c.content.text==='Translation').content.subtitle_style).toEqual({italic:true});
  await page.evaluate(()=>performUndo());await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toEqual({fontSize:80});
  await page.evaluate(()=>performRedo());await idle(page);
  await page.screenshot({path:info.outputPath('multi-properties.png')});
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
  const saved=await snap(page);await page.reload();await idle(page);
  expect((await snap(page)).subtitles).toEqual(saved.subtitles);
  await expect(page.locator('#subtitle-properties')).toBeVisible();
});

test('resets are field-specific and never clear positioning; locked selection is atomic',async({page})=>{
  await field(page,'fontSize',72);
  await page.locator('#style-position-y').fill('45');await page.locator('#style-position-y').blur();await idle(page);
  const position=(await snap(page)).subtitles.cues[0].content.subtitle_position;
  await page.locator('[data-reset-style=fontSize]').click();await idle(page);
  const reset=(await snap(page)).subtitles.cues[0].content;
  expect(reset.subtitle_style).toBeUndefined();expect(reset.subtitle_position).toEqual(position);
  await field(page,'fontSize',70);await page.locator('#style-inherit-appearance').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_position).toEqual(position);
  await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks[0].locked=true;productionCommitProject(p,'lock',[p.subtitles.cues[0].id]);});
  await expect(page.locator('#style-field-fontSize')).toBeDisabled();
});

test('property dock uses engineering preview and restores proofreading when hidden',async({page},info)=>{
  await page.evaluate(()=>waveformEditor.activateModuleTab('panel'));
  await toggleMediaSettings(page);await page.locator('#style-preview-mode').selectOption('large');
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleStyle.currentPreview().scope)).toBe('proof');
  await page.locator('#subtitle-properties-open').click();await idle(page);
  await expect(page.locator('#media-settings-modal')).toBeHidden();
  await expect(page.locator('#style-edit-scope option:checked')).toHaveText('S1');
  expect(await page.evaluate(()=>MSWSubtitleStyle.currentPreview().scope)).toBe('project');
  await page.screenshot({path:info.outputPath('track-properties.png')});
  await page.evaluate(()=>waveformEditor.closeDockModule('properties'));await idle(page);
  expect(await page.evaluate(()=>MSWSubtitleStyle.currentPreview().scope)).toBe('proof');
  await page.evaluate(()=>MSWSubtitleStyle.open('cue'));await idle(page);
  await expect(page.locator('#style-field-fontSize')).toBeVisible();
});

test('cue preset changes only appearance and exact preview matches the burned frame',async({page},info)=>{
  await field(page,'latinFontName','Georgia');
  await field(page,'fontSize',96);await field(page,'primaryColor','#ff0000');
  await page.locator('#style-position-y').fill('45');await page.locator('#style-position-y').blur();await idle(page);
  const positioned=await snap(page),position=positioned.subtitles.cues[0].content.subtitle_position;
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('Selected appearance');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-message')).toContainText('预设已保存');
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toEqual({latinFontName:'Georgia',fontSize:96,primaryColor:'#ff0000'});
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('Selected appearance');
  const preset=await page.locator('#style-project-preset').inputValue();
  await field(page,'fontSize',88);await expect(page.locator('#style-project-preset option:checked')).toHaveText('Selected appearance · 已修改');
  await page.locator('#style-reset').click();await idle(page);await expect(page.locator('#style-field-fontSize')).toHaveValue('96');
  expect((await snap(page)).subtitles.cues[0].content.subtitle_position).toEqual(position);
  await page.evaluate(()=>waveformEditor.activateModuleTab('panel'));await idle(page);
  const payload=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),target:'both',video:{width:640,height:360}}));
  expect(payload.ass).toMatch(/Style: [^\r\n]*,96,&H000000FF/);
  writeFileSync(join(folder,'selected.ass'),payload.ass);
  await page.evaluate(()=>MSWSubtitleRenderer.repaint());
  const canvas=page.locator('.JASSUB'),box=await canvas.boundingBox(),preview=join(folder,'preview.png'),burn=join(folder,'burn.png');await canvas.screenshot({path:preview});
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-i','video.mp4','-ss','1','-vf',`ass=selected.ass,scale=${Math.round(box.width)}:${Math.round(box.height)}`,'-frames:v','1',burn],{cwd:folder,windowsHide:true});
  const boxes=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image
import json,sys
def bounds(path):
 im=Image.open(path).convert('RGB')
 points=[(x,y) for y in range(im.height) for x in range(im.width) if (lambda c:c[0]>80 and c[0]>c[1]*2 and c[0]>c[2]*2)(im.getpixel((x,y)))]
 return [len(points),min(x for x,y in points),max(x for x,y in points),min(y for x,y in points),max(y for x,y in points)]
print(json.dumps([bounds(p) for p in sys.argv[1:]]))`,preview,burn],{encoding:'utf8',windowsHide:true}));
  for(const b of boxes)expect(b[0]).toBeGreaterThan(50);
  for(let i=1;i<5;i++)expect(Math.abs(boxes[0][i]-boxes[1][i])).toBeLessThan(3);
  await page.screenshot({path:info.outputPath('cue-exact-preview.png')});
});

test('multi-cue presets use each role; overwriting one cue preserves the other preset slot',async({page})=>{
  await page.evaluate(()=>addExtensionToSelection(0));
  await page.locator('#style-project-preset').selectOption('large');await idle(page);
  const applied=await snap(page),expected=await page.evaluate(()=>MSWProjectStyle.presets().find(p=>p.id==='large'));
  for(const c of applied.subtitles.cues.filter(c=>c.content.subtitle_style)){
    const slot=applied.subtitles.tracks.find(t=>t.id===c.track_id).style.slot;
    expect(c.content.subtitle_style.fontSize).toBe(expected[slot].fontSize);
  }
  await page.evaluate(()=>selectOnly(0));await idle(page);
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('One role');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-message')).toContainText('预设已保存');
  const previous=(await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-presets'))).presets.find(p=>p.name==='One role');
  await field(page,'fontSize',95);await page.locator('#style-overwrite').click();await expect(page.locator('#style-message')).toContainText('预设已更新');
  const updated=(await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-presets'))).presets.find(p=>p.name==='One role');
  expect(updated.main.fontSize).toBe(95);expect(updated.secondary).toEqual(previous.secondary);expect(updated.animations).toEqual(previous.animations);
});

test('annotation cue preset captures its effective appearance without using the track dropdown target',async({page})=>{
  await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks[0].style.base='annotation';productionCommitProject(p,'annotation',[p.subtitles.cues[0].id]);});
  await field(page,'fontSize',83);
  await page.locator('#style-save-as').click();await page.locator('#style-preset-name').fill('Annotation cue');await page.locator('#style-save-preset').click();
  await expect(page.locator('#style-message')).toContainText('预设已保存');
  await expect(page.locator('#style-project-preset option:checked')).toHaveText('Annotation cue');
  await field(page,'fontSize',70);await page.locator('#style-reset').click();await idle(page);
  await expect(page.locator('#style-field-fontSize')).toHaveValue('83');
});

test('properties fit narrow light and dark docks without overlapping field labels',async({page},info)=>{
  await page.evaluate(()=>MSWSubtitleStyle.open('track'));
  for(const [width,theme] of [[320,'default'],[260,'koishi']]){
    await page.evaluate(({width,theme})=>{
      updateEditorSettings({themePreset:theme,theme:THEME_PRESETS[theme].theme,accent:THEME_PRESETS[theme].accent,colors:{}});applyThemeAndColors();
      Object.assign(document.getElementById('subtitle-properties').style,{position:'fixed',left:'10px',top:'40px',width:width+'px',height:'700px',zIndex:'60'});
      document.getElementById('subtitle-properties-content').scrollTop=0;
    },{width,theme});
    const issues=await page.locator('#subtitle-properties-content').evaluate(body=>{
      const problems=[];if(body.scrollWidth>body.clientWidth+1)problems.push('horizontal overflow');
      for(const label of body.querySelectorAll('.msw-style-field,.media-settings-field')){
        if(!label.checkVisibility())continue;
        const title=label.querySelector('.msw-option-label'),input=label.querySelector('input,select');if(!title||!input||input.type==='checkbox')continue;
        if(title.getBoundingClientRect().bottom>input.getBoundingClientRect().top+1)problems.push(input.id+' overlaps label');
        if(input.getBoundingClientRect().right>body.getBoundingClientRect().right)problems.push(input.id+' overflows');
      }
      return problems;
    });expect(issues).toEqual([]);
    await page.locator('#subtitle-properties').screenshot({path:info.outputPath(`properties-${width}-${theme}.png`)});
  }
});

test('three property categories reflow to wide columns and use one target selector',async({page},info)=>{
  await page.setViewportSize({width:1600,height:1000});
  await page.evaluate(()=>{
    Object.assign(document.getElementById('subtitle-properties').style,{position:'fixed',left:'20px',top:'30px',width:'1450px',height:'850px',zIndex:'60'});
    document.getElementById('style-more').open=true;
  });
  await expect(page.locator('#project-subtitle-style > details > summary')).toHaveText(['基础','进阶',/动画/]);
  await expect(page.locator('#style-edit-scope option')).toHaveText(['所选字幕','说话人','S1']);
  await expect(page.locator('#style-track-target')).toBeHidden();
  const row=await page.locator('#style-field-fontSize,#style-field-wrapMode,#style-field-primaryColor').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
  expect(Math.max(...row)-Math.min(...row)).toBeLessThan(2);
  await page.locator('#style-edit-scope').selectOption({label:'S1'});
  await expect(page.locator('#style-main')).toBeVisible();
  await expect(page.locator('#style-position-y')).toBeVisible();
  await expect(page.locator('#style-field-marginV')).toBeVisible();
  await page.locator('#style-position-y').fill('40');await page.locator('#style-position-y').blur();await idle(page);
  await expect(page.locator('#style-position-y')).toBeVisible();await expect(page.locator('#style-field-marginV')).toBeHidden();
  await page.evaluate(()=>selectOnly(1));
  await expect(page.locator('#style-edit-scope')).toHaveValue('cue');await expect(page.locator('#style-main')).toBeHidden();
  await page.locator('#style-position-y').fill('42.5');await page.locator('#style-position-y').blur();await idle(page);
  expect((await snap(page)).subtitles.cues.find(c=>c.content.text==='Second subtitle').content.subtitle_position.y).toBe(.425);
  await page.locator('#style-position-y-name').click();await idle(page);
  expect((await snap(page)).subtitles.cues.find(c=>c.content.text==='Second subtitle').content.subtitle_position).toBeUndefined();
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('properties-wide.png')});
});

test('object row aligns, roles stay visible and field names restore overrides without extra icons',async({page},info)=>{
  await page.evaluate(()=>Object.assign(document.getElementById('subtitle-properties').style,{position:'fixed',left:'20px',top:'30px',width:'800px',height:'850px',zIndex:'60'}));
  await page.locator('#style-edit-scope').selectOption({label:'S1'});
  await expect(page.locator('#style-selection-label')).toBeEmpty();
  for(const role of ['main','secondary']){
    await page.locator('#style-'+role).click();await expect(page.locator('#style-'+role)).toHaveAttribute('aria-pressed','true');
    const alignment=await page.locator('#style-edit-scope,#style-main,#style-secondary,#style-swap').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.top,r.bottom];}));
    expect(Math.max(...alignment.map(r=>r[0]))-Math.min(...alignment.map(r=>r[0]))).toBeLessThan(1);
    expect(Math.max(...alignment.map(r=>r[1]))-Math.min(...alignment.map(r=>r[1]))).toBeLessThan(1);
    const colors=await page.locator('#style-main,#style-secondary').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).color));
    expect(colors[0]).not.toBe(colors[1]);
  }
  await page.locator('#style-edit-scope').selectOption('cue');
  const centers=await page.locator('#style-edit-scope,#style-selection-label').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return r.top+r.height/2;}));
  expect(Math.abs(centers[0]-centers[1])).toBeLessThan(1);
  await expect(page.locator('#style-position-reset,#style-track-placement,.msw-style-field-reset')).toHaveCount(0);
  await field(page,'fontSize',77);const name=page.locator('[data-reset-style=fontSize]');
  await expect(name).toBeEnabled();await expect(name).toHaveClass(/is-overridden/);
  const size=(await snap(page)).subtitles.cues[0].content.subtitle_style.fontSize;expect(size).toBe(77);
  await page.locator('#style-general .msw-help-button').first().click();
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style.fontSize).toBe(77);
  await page.keyboard.press('Escape');await name.focus();await name.press('Enter');await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toBeUndefined();await expect(name).toBeDisabled();await expect(name).not.toHaveClass(/is-overridden/);
  await page.evaluate(()=>performUndo());await idle(page);await expect(name).toHaveClass(/is-overridden/);
  await page.locator('#style-field-bold').uncheck();await idle(page);
  await page.locator('[data-reset-style=bold]').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toEqual({fontSize:77});
  const y=await page.locator('#style-position-y').boundingBox(),decoration=await page.locator('#style-decoration-fields').boundingBox();
  expect(decoration.y).toBeGreaterThan(y.y+y.height);
  const x=await page.locator('#style-position-x').boundingBox(),button=await page.locator('#style-position-drag').boundingBox();
  expect(x.y).toBeLessThanOrEqual(y.y);expect(button.y).toBeGreaterThanOrEqual(y.y);
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('properties-polished.png')});
});


test('automatic bilingual font picker filters Chinese, previews families, saves and restores overrides',async({page},info)=>{
  await expect(page.locator('#style-scan-fonts')).toHaveCount(0);
  const cn=page.locator('#style-field-fontName'),en=page.locator('#style-field-latinFontName');
  await cn.click();
  await expect(page.locator('#style-local-fonts [role=option]')).not.toHaveCount(0,{timeout:30000});
  await expect(page.locator('#style-local-fonts input')).toHaveCount(0);
  const options=page.locator('#style-local-fonts [role=option]');
  await expect(options.filter({hasText:/^Arial$/})).toHaveCount(0);
  await cn.fill('微软雅黑');
  await expect(options.filter({hasText:/^微软雅黑$/})).toHaveCount(1);
  await cn.dispatchEvent('keydown',{key:'Enter',isComposing:true});
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toBeUndefined();
  await expect(page.locator('#style-local-fonts')).toBeVisible();
  await page.screenshot({path:info.outputPath('chinese-font-picker.png')});
  const item=options.filter({hasText:/^微软雅黑$/});
  expect(await item.evaluate(n=>n.style.fontFamily)).toContain('Microsoft YaHei');
  await item.click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style.fontName).toBe('Microsoft YaHei');
  await expect(cn).toHaveValue('微软雅黑');
  await page.locator('#style-font-script').selectOption('latin');
  await en.fill('Georgia');
  await expect(options).toHaveCount(1);
  await expect(page.locator('#style-local-fonts')).toBeVisible();
  await en.press('ArrowDown');await en.press('Enter');await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style.latinFontName).toBe('Georgia');
  await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.cues[0].content.text='中文 English 123';productionCommitProject(p,'mixed font fixture',[p.subtitles.cues[0].id]);});await idle(page);
  const preview=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),target:'both',video:{width:640,height:360}}));
  expect(preview.ass).toContain('\\fnGeorgia');
  await page.screenshot({path:info.outputPath('bilingual-fonts.png')});
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
  await page.reload();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toEqual({fontName:'Microsoft YaHei',latinFontName:'Georgia'});
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});
  await page.locator('#style-font-script').selectOption('latin');
  await page.locator('[data-reset-style=latinFontName]').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toEqual({fontName:'Microsoft YaHei'});
});

test('language category shares one visible font input, filters glyph coverage and preserves mappings',async({page},info)=>{
  test.setTimeout(120000); // Multiple font switches each wait for native ASS rendering.
  const language=page.locator('#style-font-script');
  const catalog=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-fonts'));
  const state=await snap(page);
  for(const script of ['kana','hangul','cyrillic','arabic']) {
    await language.selectOption(script);
    await expect(page.locator('.msw-property-font input:visible')).toHaveCount(1);
    const input=page.locator(`[data-font-script=${script}]`);await input.click();
    const actual=await page.locator('#style-local-fonts [role=option]').evaluateAll(nodes=>nodes.map(n=>n.title).sort());
    expect(actual).toEqual(catalog.families.filter(f=>f.scripts.includes(script)).map(f=>f.family).sort());
    await input.press('Escape');
  }
  expect((await snap(page)).subtitles).toEqual(state.subtitles);
  const face=catalog.families.find(f=>f.scripts.includes('kana'));
  expect(face).toBeTruthy();
  await field(page,'kanaFontName',face.family);await field(page,'latinFontName','Georgia');
  await language.selectOption('kana');
  await expect(page.locator('[data-reset-style=kanaFontName]')).toHaveClass(/is-overridden/);
  await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.cues[0].content.text='漢字かなカナ Latin';productionCommitProject(p,'scripts fixture',[p.subtitles.cues[0].id]);});await idle(page);
  const preview=await page.evaluate(()=>MSWSubtitleStyle.request('subtitle-preview',{project:JSON.parse(buildJson()),video:{width:640,height:360},target:'both'}));
  expect(preview.ass).toContain('\\fn'+face.family);expect(preview.ass).toContain('\\fnGeorgia');
  await page.locator('#subtitle-properties').screenshot({path:info.outputPath('font-language.png')});
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);await page.reload();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toEqual({kanaFontName:face.family,latinFontName:'Georgia'});
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});await language.selectOption('kana');
  await page.locator('[data-reset-style=kanaFontName]').click();await idle(page);
  expect((await snap(page)).subtitles.cues[0].content.subtitle_style).toEqual({latinFontName:'Georgia'});
});
