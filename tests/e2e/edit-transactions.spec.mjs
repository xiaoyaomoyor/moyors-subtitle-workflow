import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let server;
test.beforeAll(async()=>{const dir=makeTempDir('edit-transactions');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{await disableOnboarding(page);await page.goto(server.url);
  await page.evaluate(waveform=>{
    const p=MSWFlatSubtitles.migrate({segments:[{id:'a',start:1000,end:3000,text:'one two',items:[]},{id:'b',start:4000,end:6000,text:'three four',items:[]}],waveform});
    applyCanonicalProject(p,'transaction.mosp');updateEditorSettings({autoSaveProject:false,clickBehavior:'select-only'});editorHistory.clear();
  },generateWaveformPayload(12000));
});
for(const operation of ['cut','split','merge'])test(`${operation} is one reversible edit`,async({page})=>{
  const result=await page.evaluate(operation=>{
    const before=JSON.parse(buildJson()).subtitles;selectOnly(0);
    if(operation==='cut')cutSelectedCues();else if(operation==='merge')mergeSegments([0,1]);
    else {splitFromContextMenu(0,0,0,2000);if(pendingLinkedSplit)confirmLinkedSplit();}
    const record=editorHistory.peekUndo();let error=null;
    try { MSWEditTransaction.apply(fixedCurrentContent(),record.patch,false); }catch(e){
      const mismatches=[];
      const walk=(current,patch,path)=>{
        if(patch.kind==='value'){if(!MSWEditTransaction.equal(current,patch.after))mismatches.push({path,current,expected:patch.after});return;}
        for(const [key,p] of patch.entries)walk(patch.kind==='rows'?current.find(v=>(v.id||JSON.stringify([v.role,v.track_id,v.cue_id]))===key):current?.[key],p,path+'.'+key);
      };walk(fixedCurrentContent(),record.patch,'');error=JSON.stringify(mismatches);
    }
    const after=JSON.parse(buildJson()).subtitles;performUndo();const undone=JSON.parse(buildJson()).subtitles;performRedo();
    return {before,after,undone,redone:JSON.parse(buildJson()).subtitles,kind:record.kind,error};
  },operation);
  expect(result.error).toBeNull();expect(result.kind).toBe('subtitle-edit');expect(result.after.cues).toHaveLength(operation==='split'?3:1);
  expect(result.undone).toEqual(result.before);expect(result.redone).toEqual(result.after);
});
test('no-op preserves redo; failed validation restores data and the history stack',async({page})=>{
  const result=await page.evaluate(()=>{
    selectOnly(0);cutSelectedCues();performUndo();
    const before=JSON.parse(buildJson()).subtitles, redo=editorHistory.redoLength();
    pushUndo('noop',{subtitleOnly:true});const noop=fixedAcceptEdit();
    const afterNoop=[editorHistory.undoLength(),editorHistory.redoLength()];
    pushUndo('invalid',{subtitleOnly:true});DATA.segments[1].start=1500;
    const accepted=fixedAcceptEdit();
    return {before,after:JSON.parse(buildJson()).subtitles,redo,noop,afterNoop,accepted,undo:editorHistory.undoLength(),redoAfter:editorHistory.redoLength()};
  });
  expect(result.noop).toBe(true);expect(result.afterNoop).toEqual([0,result.redo]);
  expect(result.accepted).toBe(false);expect(result.after).toEqual(result.before);expect(result.undo).toBe(0);expect(result.redoAfter).toBe(result.redo);
});
test('stale undo keeps its record and does not partly restore the project',async({page})=>{
  const result=await page.evaluate(()=>{
    selectOnly(0);cutSelectedCues();
    // Simulate an out-of-band structural writer, without going through history.
    DATA.segments.unshift({id:'outsider',start:0,end:500,text:'external',items:[]});
    const before=structuredClone(fixedCurrentContent()),length=editorHistory.undoLength();
    performUndo();return {unchanged:MSWEditTransaction.equal(before,fixedCurrentContent()),length,after:editorHistory.undoLength(),redo:editorHistory.redoLength()};
  });
  expect(result.unchanged).toBe(true);expect(result.after).toBe(result.length);expect(result.redo).toBe(0);
});

test('failed structural edits restore the original selection as well as data',async({page})=>{
  const result=await page.evaluate(()=>{
    selectOnly(0);const before=snapshotEditorSelection();
    pushUndo('invalid structure',{subtitleOnly:true,captureView:true});
    selectedIdxs.clear();selectedIdxs.add(1);lastClickedIdx=1;currentCuePanelIdx=1;
    DATA.segments[1].start=1500;
    const accepted=fixedAcceptEdit();
    return {accepted,before,after:snapshotEditorSelection(),undo:editorHistory.undoLength()};
  });
  expect(result.accepted).toBe(false);expect(result.after).toEqual(result.before);expect(result.undo).toBe(0);
});

test('timing checkpoints without dirty flags do not invalidate indexes on unchanged reads',async({page})=>{
  const result=await page.evaluate(()=>{
    fixedTimingCheckpoint(snapshotFixedTiming({label:'timing',cues:[{id:DATA.segments[0].id}]}));
    const index=fixedIndex(),before=editorHistory.undoLength();
    const changed=fixedContentChanged();
    for(let i=0;i<3;i++)if(!fixedAcceptEdit())throw Error('Unchanged read rejected');
    return {changed,indexRetained:fixedIndex()===index,historyRetained:editorHistory.undoLength()===before};
  });
  expect(result).toEqual({changed:false,indexRetained:true,historyRetained:true});
});

test('speaker reference indexes follow marker changes and history',async({page})=>{
  const result=await page.evaluate(()=>{
    updateEditorSettings({speakerAutoFollow:true});
    const previous=fixedIndex(),ref=fixedTrackCore.key({role:'main',track_id:null,cue_id:DATA.segments[0].id});
    const dependents=()=>fixedIndex().dependents.get(ref)?.size||0;
    assignLinkedSpeakerColor([0],Object.keys(COLOR_BY_NAME)[0]);
    const replaced=fixedIndex()!==previous,after=dependents();performUndo();const undone=dependents();performRedo();
    return {replaced,after,undone,redone:dependents()};
  });
  expect(result).toEqual({replaced:true,after:1,undone:0,redone:1});
});
