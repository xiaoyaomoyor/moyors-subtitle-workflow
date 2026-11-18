import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startBlankServer} from './helpers.mjs';

let server,environment;
test.beforeAll(async()=>{
  const dir=makeTempDir('text-reliability');
  environment={MAW_ENV_FILE:process.env.MAW_ENV_FILE,MSW_APP_DATA_ROOT:process.env.MSW_APP_DATA_ROOT};
  process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');
  server=await startBlankServer(await findFreePort(),join(dir,'settings'));
});
test.afterAll(async()=>{
  await server?.stop();
  for(const [key,value] of Object.entries(environment||{})){
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
test.beforeEach(async({page})=>{
  await disableOnboarding(page);await page.goto(server.url);
  await page.evaluate(async waveform=>{
    await MSWConfig.ready;
    updateEditorSettings({autoSaveProject:false,cueEditorCancelOnEscape:true,selectBoundSubtitlePair:false,clickBehavior:'select-only'});
    applyCanonicalProject({segments:[{id:'main',start:0,end:3000,text:'Alpha beta',items:[]}],
      multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'secondary',role:'extension',segments:[{id:'sub',start:0,end:3000,text:'甲乙丙丁戊己',items:[]}]}],
        bindings:[{id:'pair',track_id:'secondary',main_segment_ids:['main'],extension_segment_ids:['sub']}]},waveform},'text-reliability.mosp');
  },generateWaveformPayload(4000));
});

async function selectPanel(page,kind){
  await page.evaluate(kind=>{
    if(kind==='main'){selectOnly(0);setCurrentCuePanelIndex(0);}
    else {selectOnlyExtension(0);setCurrentCuePanelExtensionIndex(0);}
  },kind);
}
const history=page=>page.evaluate(()=>({undo:editorHistory.undoLength(),redo:editorHistory.redoLength()}));
const subtitles=page=>page.evaluate(()=>JSON.parse(buildJson()).subtitles);
const textFor=(page,kind)=>page.evaluate(kind=>(kind==='main'?DATA.segments:getActiveExtensionTrack().segments)[0].text,kind);
const undo=page=>page.evaluate(()=>document.getElementById('undo-btn').click());
const redo=page=>page.evaluate(()=>document.getElementById('redo-btn').click());

test('reapplying language does not rewrite unchanged text or attributes',async({page})=>{
  const changes=await page.evaluate(()=>{
    const probe=document.createElement('button');probe.textContent='取消';probe.title='取消';document.body.append(probe);
    MSWE_I18N.applyLanguage('en',false);
    const observer=new MutationObserver(()=>{});observer.observe(probe,{characterData:true,attributes:true,subtree:true});
    MSWE_I18N.applyLanguage('en',false);
    const same=observer.takeRecords().length;
    MSWE_I18N.applyLanguage('zh',false);
    const switched=probe.textContent;observer.disconnect();probe.remove();return {same,switched};
  });
  expect(changes).toEqual({same:0,switched:'取消'});
});

for(const kind of ['main','extension']){
  test(`${kind}: cancelled panel text preserves redo and bound subtitle data`,async({page})=>{
    await selectPanel(page,kind);const panel=page.locator('#cue-panel-text');
    const original=await textFor(page,kind);
    await panel.fill('Saved edit');await panel.blur();await undo(page);await selectPanel(page,kind);
    const before=await subtitles(page),beforeHistory=await history(page);
    expect(beforeHistory.redo).toBe(1);
    await panel.fill('Temporary edit');await panel.press('Escape');
    expect(await textFor(page,kind)).toBe(original);
    expect(await subtitles(page)).toEqual(before);expect(await history(page)).toEqual(beforeHistory);
    await redo(page);expect(await textFor(page,kind)).toBe('Saved edit');
    await undo(page);expect(await textFor(page,kind)).toBe(original);
  });

  test(`${kind}: Escape without input preserves redo`,async({page})=>{
    await selectPanel(page,kind);const panel=page.locator('#cue-panel-text');
    await panel.fill('Saved edit');await panel.blur();await undo(page);await selectPanel(page,kind);
    const before=await history(page);await panel.focus();await panel.press('Escape');
    expect(await history(page)).toEqual(before);await redo(page);expect(await textFor(page,kind)).toBe('Saved edit');
  });

  test(`${kind}: committed panel edit still replaces redo`,async({page})=>{
    await selectPanel(page,kind);const panel=page.locator('#cue-panel-text');
    const original=await textFor(page,kind);
    await panel.fill('Old branch');await panel.blur();await undo(page);await selectPanel(page,kind);
    await page.evaluate(()=>updateEditorSettings({cueEditorCancelOnEscape:false}));
    await panel.fill('New branch');await panel.press('Escape');
    expect(await textFor(page,kind)).toBe('New branch');expect((await history(page)).redo).toBe(0);
    await undo(page);expect(await textFor(page,kind)).toBe(original);
    await redo(page);expect(await textFor(page,kind)).toBe('New branch');
  });
}

test('cancelled panel edit preserves the oldest entry at the history limit',async({page})=>{
  await selectPanel(page,'main');
  await page.evaluate(()=>{
    for(let i=0;i<100;i++){
      cuePanelText.focus();cuePanelText.value=`Edit ${i}`;
      cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));cuePanelText.blur();
    }
    window.historyBeforeCancel=editorHistory.checkpoint();
  });
  expect((await history(page)).undo).toBe(100);
  const panel=page.locator('#cue-panel-text');await panel.fill('Cancelled');await panel.press('Escape');
  expect(await page.evaluate(()=>{
    const now=editorHistory.checkpoint(),before=window.historyBeforeCancel;
    return now.undo.length===before.undo.length&&now.undo.every((record,i)=>record===before.undo[i]);
  })).toBe(true);
});

// Hold the zero-delay correction within one browser turn. This makes the
// double-click race deterministic without depending on machine input speed.
async function holdCaretCorrection(page,kind){
  return page.evaluate(kind=>{
    if(editingState)finishEdit(false);if(extensionEditingState)finishExtensionEdit(false);
    const row=document.querySelector('.cue[data-idx="0"]');
    const el=kind==='main'?row:row.querySelector('.multi-cue-column.extension');
    const original=window.setTimeout,pending=[];
    window.setTimeout=(fn,delay,...args)=>{
      if(delay===0){pending.push(()=>fn(...args));return -pending.length;}
      return original(fn,delay,...args);
    };
    try{
      if(kind==='main')startEdit(el,0,undefined,undefined,{deferCaret:true});
      else startExtensionEdit(el,0,getActiveExtensionTrack(),undefined,undefined,{deferCaret:true});
    }finally{window.setTimeout=original;}
    window.releaseTextTimers=()=>pending.splice(0).forEach(fn=>fn());
    return pending.length;
  },kind);
}

for(const kind of ['main','extension']){
  test(`${kind}: new input, keys, pointer and IME take precedence over delayed caret`,async({page})=>{
    for(const action of ['beforeinput','keydown','pointerdown','compositionstart']){
      expect(await holdCaretCorrection(page,kind)).toBeGreaterThan(0);
      const selection=await page.evaluate(({kind,action})=>{
        const state=kind==='main'?editingState:extensionEditingState,text=state.textEl;
        const event=action==='keydown'?new KeyboardEvent(action,{key:'ArrowRight',bubbles:true})
          :action==='pointerdown'?new PointerEvent(action,{bubbles:true})
          :action==='beforeinput'?new InputEvent(action,{inputType:'insertText',data:'x',bubbles:true})
          :new CompositionEvent(action,{data:'字',bubbles:true});
        text.dispatchEvent(event);
        window.getSelection().collapse(text.firstChild,2);
        window.releaseTextTimers();
        const s=window.getSelection();return {inside:s.anchorNode===text.firstChild,offset:s.anchorOffset,collapsed:s.isCollapsed};
      },{kind,action});
      expect(selection,action).toEqual({inside:true,offset:2,collapsed:true});
    }
  });

  test(`${kind}: delayed caret belongs to its original editing session`,async({page})=>{
    await holdCaretCorrection(page,kind);
    const selection=await page.evaluate(kind=>{
      const state=kind==='main'?editingState:extensionEditingState,el=state.el;
      if(kind==='main'){finishEdit(false);startEdit(el,0);}
      else {finishExtensionEdit(false);startExtensionEdit(el,0);}
      const text=(kind==='main'?editingState:extensionEditingState).textEl;
      window.getSelection().collapse(text.firstChild,2);window.releaseTextTimers();
      return {offset:window.getSelection().anchorOffset,collapsed:window.getSelection().isCollapsed};
    },kind);
    expect(selection).toEqual({offset:2,collapsed:true});
  });

  test(`${kind}: delayed caret does not reclaim focus from another field`,async({page})=>{
    await selectPanel(page,kind);
    await holdCaretCorrection(page,kind);
    expect(await page.evaluate(()=>{
      cuePanelText.focus();cuePanelText.setSelectionRange(1,1);window.releaseTextTimers();
      return {focused:document.activeElement===cuePanelText,start:cuePanelText.selectionStart,end:cuePanelText.selectionEnd};
    })).toEqual({focused:true,start:1,end:1});
  });

  test(`${kind}: ordinary double-click places a caret and the edit remains undoable`,async({page})=>{
    const original=await textFor(page,kind),text=page.locator(`.multi-cue-column.${kind} .text`).first();
    const box=await text.boundingBox();expect(box).not.toBeNull();
    await page.mouse.dblclick(box.x+8,box.y+box.height/2);
    await expect(text).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>window.getSelection().isCollapsed)).toBe(true);
    await page.keyboard.insertText('X');await page.locator('#cue-panel-text').click();
    expect(await textFor(page,kind)).toContain('X');expect((await textFor(page,kind)).length).toBe(original.length+1);
    await undo(page);expect(await textFor(page,kind)).toBe(original);
  });
}
