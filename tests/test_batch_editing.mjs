import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import core from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';
import batch from '../web/msw-batch-editing.js';
const ctx={window:{},TextEncoder,TextDecoder,Uint8Array};
for(const file of ['gap-remove-core.js','editor-utils.js'])vm.runInNewContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),ctx);
const utils=ctx.window.AsrEditorUtils;
function fixture(){const p=core.migrate({segments:[0,1,2].map(i=>({id:'s'+i,start:1000+i*2000,end:2000+i*2000,text:'Alpha Bravo',items:[{text:'Alpha',start:1000+i*2000,end:1500+i*2000},{text:' Bravo',start:1500+i*2000,end:2000+i*2000}]}))});
 const first=p.subtitles.tracks[0];p.subtitles.tracks.push({...first,id:'other'});
 for(const c of [...p.subtitles.cues]){p.subtitles.cues.push({id:'paired-'+c.id,track_id:'other',content:{...structuredClone(c.content),start:c.content.start+50,end:c.content.end+50,items:[]}});p.subtitles.bindings.push({id:'b-'+c.id,source_id:c.id,target_id:'paired-'+c.id,start_offset_ms:50,end_offset_ms:50});}
 core.validate(p);return p;}
const firstIds=p=>batch.scope(p,p.subtitles.tracks[0].id).map(c=>c.id);

test('cleanup character thresholds count visible characters and include exact bounds',()=>{
 const rows=[' \n\t','Hello world!','中 文。','e\u0301👩‍💻'].map((text,i)=>({id:String(i),content:{text}}));
 assert.deepEqual(rows.map(c=>batch.visibleCharacterCount(c.content.text)),[0,11,3,2]);
 assert.deepEqual(batch.cleanupMatches(rows,{threshold:0}).map(c=>c.id),['0']);
 assert.deepEqual(batch.cleanupMatches(rows,{threshold:3,comparison:'gte'}).map(c=>c.id),['1','2']);
 assert.deepEqual(batch.cleanupMatches(rows,{threshold:3,comparison:'lte'}).map(c=>c.id),['0','2','3']);
 for(const threshold of ['',-1,1.5,'abc'])assert.throws(()=>batch.cleanupMatches(rows,{threshold}),/整数/);
});
test('cleanup keywords are literal and case insensitive, empty keyword never removes everything',()=>{
 const rows=['A [Tag]','tag','TAG'].map(text=>({content:{text}}));
 assert.equal(batch.cleanupMatches(rows,{mode:'keyword',keyword:'[tag]'}).length,1);
 assert.equal(batch.cleanupMatches(rows,{mode:'keyword',keyword:'tag'}).length,3);
 assert.throws(()=>batch.cleanupMatches(rows,{mode:'keyword',keyword:'  '}),/关键词/);
});
test('all-track cleanup scope includes disabled collapsed tracks without expanding an empty selection',()=>{
 const p=fixture();p.subtitles.tracks[1].enabled=false;p.subtitles.tracks[1].collapsed=true;
 assert.equal(batch.scope(p,'*',null,{allTracks:true}).length,6);
 assert.equal(batch.scope(p,'*',[],{allTracks:true}).length,0);
 assert.equal(batch.scope(p,'*',[p.subtitles.cues[3].id],{allTracks:true}).length,1);
 p.subtitles.tracks[1].locked=true;const before=structuredClone(p);
 assert.throws(()=>batch.cleanup(p,batch.scope(p,'*',null,{allTracks:true}).map(c=>c.id)),/锁定/);
 assert.deepEqual(p,before);
});
test('physical scope ignores display columns, preserves empty selection and explicit disabled rows',()=>{
 const p=fixture(),ids=firstIds(p);p.subtitle_view={secondary_cue_ids:[ids[1]]};p.subtitles.tracks[0].collapsed=true;p.subtitles.cues[1].content.disabled=true;
 assert.deepEqual(batch.scope(p,p.subtitles.tracks[0].id,[]),[]);
 assert.equal(batch.scope(p,p.subtitles.tracks[0].id,null).length,3);
 assert.deepEqual(batch.scope(p,p.subtitles.tracks[0].id,[ids[1]],{includeDisabled:false}),[]);
 assert.equal(batch.scope(p,'other',[...ids]).length,0);
});
test('time changes retime words and partners once, retain gaps, markers and frame projections',()=>{
 const p=fixture(),ids=firstIds(p),before=JSON.stringify(p);p.timebase={unit:'frames',fps:25};
 const result=batch.time(p,ids,c=>({start:c.start+100,end:c.end+100}),{utils});
 assert.equal(result.changed,3);assert.equal(result.linked,3);assert.equal(edit.cue(result.project,ids[0]).content.items[0].start,1100);
 assert.equal(edit.cue(result.project,ids[0]).content.start_frame,28);assert.ok(result.project.subtitles.bindings.every(b=>b.start_offset_ms===50));
 delete p.timebase;assert.equal(JSON.stringify(p),before);core.validate(result.project);
});
test('collision, negative time and locked followers reject the entire time operation',()=>{
 const p=fixture(),ids=firstIds(p),before=JSON.stringify(p);
 assert.throws(()=>batch.time(p,[ids[0]],c=>({start:c.start+2000,end:c.end+2000}),{utils}),/重叠/);
 assert.throws(()=>batch.time(p,ids,c=>({start:c.start-2000,end:c.end-2000}),{utils}),/有效范围/);
 assert.equal(JSON.stringify(p),before);p.subtitles.tracks[1].locked=true;
 assert.throws(()=>batch.time(p,ids,c=>({start:c.start+20,end:c.end+20}),{utils}),/锁定/);
 assert.throws(()=>batch.time(p,ids,c=>({start:c.start+20,end:c.end+20}),{utils,linked:false}),/锁定/);
 p.subtitles.tracks[1].locked=false;
 const independent=batch.time(p,ids,c=>({start:c.start+20,end:c.end+20}),{utils,linked:false});assert.equal(independent.project.subtitles.bindings[0].start_offset_ms,30);
});
test('text-only transformations retain identities, timestamps, reusable words and empty bound cues',()=>{
 const p=fixture(),ids=firstIds(p),other=structuredClone(batch.scope(p,'other'));
 const result=batch.texts(p,[{id:ids[0],text:'Alpha bravo'},{id:ids[1],text:''}],{utils});
 assert.equal(result.changed,2);assert.deepEqual(batch.scope(result.project,'other'),other);
 assert.equal(result.project.subtitles.bindings.length,3);assert.equal(edit.cue(result.project,ids[1]).content.text,'');
 assert.ok(edit.cue(result.project,ids[0]).content.items.length);assert.equal(edit.cue(result.project,ids[0]).content.start,1000);
});
function draft(p,texts,ids=firstIds(p)) {const track=p.subtitles.tracks[0].id,snapshot=batch.trackCues(p,track),source=batch.textSources(snapshot.filter(c=>ids.includes(c.id)),p);
 const report=utils.buildTimedTextEditReport(source,texts),segments=utils.applyTimedTextEdit(source,texts);
 return ()=>batch.draft(p,track,snapshot,ids,segments,report);}
test('pure text rejects bound row deletion and splitting but permits changed wording',()=>{
 const p=fixture();assert.throws(draft(p,['','Alpha Bravo','Alpha Bravo']),/已绑定/);
 assert.throws(draft(p,['Alpha','Bravo','Alpha Bravo','Alpha Bravo']),/已绑定/);
 const result=draft(p,['alpha Bravo','Alpha Bravo','Alpha Bravo'])();assert.equal(result.project.subtitles.bindings.length,3);
 assert.equal(edit.cue(result.project,firstIds(p)[0]).content.text,'alpha Bravo');
});
test('unbound row structures keep ownership, display side and untouched unselected content',()=>{
 const p=fixture();p.subtitles.bindings=[];const ids=firstIds(p);p.subtitle_view={secondary_cue_ids:[ids[0]]};
 const result=draft(p,['Alpha','Bravo'],[ids[0]])();core.validate(result.project);
 assert.equal(batch.scope(result.project,p.subtitles.tracks[0].id).length,4);
 assert.equal(result.ids.length,2);assert.ok(result.ids.every(id=>result.project.subtitle_view.secondary_cue_ids.includes(id)));
 assert.deepEqual(edit.cue(result.project,ids[1]),edit.cue(p,ids[1]));
});
test('stale text draft never overwrites a later marker or timing change',()=>{
 const p=fixture(),id=firstIds(p)[0],track=p.subtitles.tracks[0].id,snapshot=structuredClone(batch.trackCues(p,track));
 const source=batch.textSources(snapshot,p),texts=source.map(c=>c.text.toLowerCase()),report=utils.buildTimedTextEditReport(source,texts);
 edit.cue(p,id).content.color={name:'red',start:1000,end:2000};
 assert.throws(()=>batch.draft(p,track,snapshot,firstIds(p),utils.applyTimedTextEdit(source,texts),report),/编辑期间/);
});

test('whole draft permits unrelated changes but cannot merge over a newly inserted excluded cue',()=>{
 const p=fixture();p.subtitles.bindings=[];const ids=firstIds(p),track=p.subtitles.tracks[0].id,snapshot=structuredClone(batch.trackCues(p,track));
 const source=batch.textSources(snapshot.slice(0,2),p),texts=['Alpha Bravo Alpha Bravo'];
 const report=utils.buildTimedTextEditReport(source,texts),segments=utils.applyTimedTextEdit(source,texts);
 edit.cue(p,ids[2]).content.text='Other edit';edit.cue(p,ids[2]).content.items=[];
 assert.equal(edit.cue(batch.draft(p,track,snapshot,ids.slice(0,2),segments,report).project,ids[2]).content.text,'Other edit');
 p.subtitles.cues.push({id:'inserted',track_id:track,content:{start:2100,end:2200,text:'New',items:[]}});
 assert.throws(()=>batch.draft(p,track,snapshot,ids.slice(0,2),segments,report),/范围外/);
});
test('whole split converts marker references to stable IDs and preserves external followers',()=>{
 const p=fixture();p.subtitles.bindings=[];const ids=firstIds(p),head=edit.cue(p,ids[0]).content;
 head.color={name:'red',start:1000,end:4000};head.sticker={name:'icon',start:1000,end:4000};head.speaker='2';
 edit.cue(p,ids[1]).content.color_ref={cue_id:ids[0]};
 const result=draft(p,['Alpha','Bravo'],[ids[0]])();core.validate(result.project);
 const tail=edit.cue(result.project,result.ids[1]).content;
 assert.deepEqual(tail.color_ref,{cue_id:ids[0]});assert.deepEqual(tail.sticker_ref,{cue_id:ids[0]});assert.equal(tail.speaker,'2');
 assert.deepEqual(edit.cue(result.project,ids[1]).content.color_ref,{cue_id:ids[0]});
});

test('pure text cannot transfer a bound boundary or merge across excluded rows',()=>{
 const p=fixture(),ids=firstIds(p);
 const track=p.subtitles.tracks[0].id,snapshot=batch.trackCues(p,track),source=batch.textSources(snapshot,p);
 const segments=structuredClone(source);segments[0].end-=100;segments[1].start-=100;
 assert.throws(()=>batch.draft(p,track,snapshot,ids,segments,{stats:{changedSegments:2}}),/已绑定/);
 p.subtitles.bindings=[];
 assert.throws(draft(p,['Alpha Bravo Alpha Bravo'],[ids[0],ids[2]]),/范围外|重叠/);
});

test('wording edits retain stable marker references, excluded cues and disabled state',()=>{
 const p=fixture(),ids=firstIds(p);p.subtitles.bindings=[];
 edit.cue(p,ids[0]).content.color={name:'red',start:1000,end:4000};
 edit.cue(p,ids[1]).content.color_ref={cue_id:ids[0]};edit.cue(p,ids[1]).content.disabled=true;
 const result=draft(p,['Alpha Bravo','alpha Bravo','Alpha Bravo'])();
 assert.deepEqual(edit.cue(result.project,ids[1]).content.color_ref,{cue_id:ids[0]});
 assert.equal(edit.cue(result.project,ids[1]).content.disabled,true);
 assert.deepEqual(edit.cue(result.project,ids[0]),edit.cue(p,ids[0]));
});

test('cleanup rejects locked bindings and locked marker dependents without mutating input',()=>{
 const p=fixture(),ids=firstIds(p);p.subtitles.tracks[1].locked=true;
 assert.throws(()=>batch.cleanup(p,[ids[0]]),/锁定/);
 p.subtitles.bindings=[];
 edit.cue(p,ids[0]).content.color={name:'red',start:1000,end:2000};
 edit.cue(p,'paired-'+ids[0]).content.color_ref={cue_id:ids[0]};const before=JSON.stringify(p);
 assert.throws(()=>batch.cleanup(p,[ids[0]]),/锁定/);assert.equal(JSON.stringify(p),before);
});
