import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {makeTempDir,cleanupTempDir,findFreePort,startBlankServer} from './helpers.mjs';

test.beforeEach(()=>{delete process.env.MSW_APP_DATA_ROOT;delete process.env.MAW_APP_DATA_ROOT;});

for (const portable of [false,true]) test(`workspace restoration and undo keep personal settings isolated (${portable?'portable':'server'})`,async({page})=>{
  const root=portable?null:makeTempDir('settings-ownership');
  const server=portable?null:await startBlankServer(await findFreePort(),root);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.addInitScript(()=>{
      if(localStorage.getItem('scope-fixture'))return;
      localStorage.setItem('scope-fixture','1');
      localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({flatTrackSettingsMigrated:true,
        cueListShowTime:true,cueEditorShowSticker:false,autoSaveProject:false}));
      localStorage.setItem('moy.asr.waveform.settings.v1',JSON.stringify({rowHeight:144,hoverDetails:false,hiddenModules:['assets','properties']}));
    });
    await page.goto(portable?pathToFileURL(resolve('blank-editor.html')).href:server.url);
    await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&waveformEditor);
    expect(await page.evaluate(()=>{
      const registry=MSWConfig.snapshot.registry;
      return [
        ...Object.keys(EDITOR_SETTINGS).filter(k=>!registry['moy.asr.editor.settings.v1'].fields[k]),
        ...Object.keys(waveformEditor.settings).filter(k=>!registry['moy.asr.waveform.settings.v1'].fields[k]),
      ];
    })).toEqual([]);
    await page.evaluate(()=>MSWConfig.flush());
    const result=await page.evaluate(async()=>{
      const read=()=>JSON.parse(MSWConfig.storage.getItem('moy.asr.editor.settings.v1'));
      const wave=()=>JSON.parse(MSWConfig.storage.getItem('moy.asr.waveform.settings.v1'));
      const workspace=waveformEditor.getLayoutData();
      workspace.waveformSettings.rowHeight=240;
      workspace.hiddenModules=['assets'];
      workspace.editorDisplay={cueListShowTime:false,cueEditorShowSticker:true};
      applyCanonicalProject({segments:[{id:'a',start:0,end:3000,text:'Project A',items:[]}],workspace},'A.mosp');
      const projectState=JSON.stringify({style:DATA.preview.project_style,speakers:DATA.preview.speaker_palette,timebase:DATA.timebase});
      const restored={rowHeight:waveformEditor.settings.rowHeight,time:EDITOR_SETTINGS.cueListShowTime,sticker:EDITOR_SETTINGS.cueEditorShowSticker};
      updateEditorSettings({mediaSeekStepMs:2750});
      // Real control path; changes this field only, not the restored workspace.
      const hover=document.querySelector('#waveform-hover-details');
      if(!hover)throw Error('Missing hover details control');
      hover.checked=true;hover.dispatchEvent(new Event('change',{bubbles:true}));
      await MSWConfig.flush();
      const saved={editor:read(),wave:wave()};
      const serialized=JSON.parse(buildJson());
      const before=waveformEditor.getLayoutHistorySnapshot();
      pushLayoutUndo('fixture workspace change',before);
      applyEditorDisplaySettings({cueListShowTime:true,cueEditorShowSticker:false});
      waveformEditor.setLayoutData({...workspace,waveformSettings:{...workspace.waveformSettings,rowHeight:96}});
      performUndo();
      const undone={rowHeight:waveformEditor.settings.rowHeight,time:EDITOR_SETTINGS.cueListShowTime,sticker:EDITOR_SETTINGS.cueEditorShowSticker};
      performRedo();
      const redone={rowHeight:waveformEditor.settings.rowHeight,time:EDITOR_SETTINGS.cueListShowTime};
      // Import preferences while an existing project is open, then edit one field.
      const request={package:{format:'msw-config',version:1,kind:'preferences',categories:['interface'],
        sections:{browser:{'moy.asr.editor.settings.v1':{cueListShowTime:true,mediaSeekStepMs:500,autoSaveProject:false}}}},
        categories:['interface'],policy:'replace'};
      const preview=await MSWConfig.request({...request,action:'preview'});
      await MSWConfig.request({...request,action:'import',token:preview.token,revision:preview.revision});
      updateEditorSettings({cueListFollowPlayback:false});await MSWConfig.flush();
      const imported=read();
      const unchanged=JSON.stringify({style:DATA.preview.project_style,speakers:DATA.preview.speaker_palette,timebase:DATA.timebase})===projectState;
      // New project without a workspace must start from user defaults, not A.
      applyCanonicalProject({segments:[{id:'b',start:0,end:3000,text:'Project B',items:[]}]},'B.mosp');
      const next={rowHeight:waveformEditor.settings.rowHeight,time:EDITOR_SETTINGS.cueListShowTime,sticker:EDITOR_SETTINGS.cueEditorShowSticker};
      // Reopening saved A restores its actual workspace again.
      applyCanonicalProject(serialized,'A.mosp');
      const reopened={rowHeight:waveformEditor.settings.rowHeight,time:EDITOR_SETTINGS.cueListShowTime};
      await MSWConfig.flush();
      return {restored,saved,undone,redone,imported,unchanged,next,reopened,serialized:serialized.workspace};
    });
    expect(result.restored).toEqual({rowHeight:240,time:false,sticker:true});
    expect(result.saved.editor.cueListShowTime).toBe(true);
    expect(result.saved.editor.cueEditorShowSticker).toBe(false);
    expect(result.saved.editor.mediaSeekStepMs).toBe(2750);
    expect(result.saved.wave.rowHeight).toBe(144);
    expect(result.saved.wave.hoverDetails).toBe(true);
    expect(result.saved.wave.hiddenModules).toEqual(['assets','properties']);
    expect(result.undone).toEqual(result.restored);
    expect(result.redone).toEqual({rowHeight:96,time:true});
    expect(result.imported.mediaSeekStepMs).toBe(500);
    expect(result.imported.cueListFollowPlayback).toBe(false);
    expect(result.unchanged).toBe(true);
    expect(result.next).toEqual({rowHeight:144,time:true,sticker:false});
    expect(result.reopened).toEqual({rowHeight:240,time:false});
    expect(result.serialized.editorDisplay.cueEditorShowSticker).toBe(true);
    expect(errors).toEqual([]);
  } finally {if(server)await server.stop();if(root)cleanupTempDir(root);}
});

test('project appearance undo does not undo personal preview or export defaults',async({page})=>{
  await page.goto(pathToFileURL(resolve('blank-editor.html')).href);
  await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
  const result=await page.evaluate(()=>{
    applyCanonicalProject({segments:[{id:'a',start:0,end:3000,text:'Example',items:[]}]},'fixture.mosp');
    const name=DATA.preview.speaker_palette.rows[0].name;
    pushPreviewUndo('speaker change',snapshotPreviewState());
    DATA.preview.speaker_palette.rows[0].name='Changed speaker';
    updateEditorSettings({overlayEnabled:false,extensionOverlayEnabled:false,exportSpeakerLabels:true});
    performUndo();
    return {name:DATA.preview.speaker_palette.rows[0].name,expected:name,
      main:EDITOR_SETTINGS.overlayEnabled,sub:EDITOR_SETTINGS.extensionOverlayEnabled,exportNames:EDITOR_SETTINGS.exportSpeakerLabels};
  });
  expect(result.name).toBe(result.expected);
  expect([result.main,result.sub,result.exportNames]).toEqual([false,false,true]);
});
