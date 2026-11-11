import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const core=createRequire(import.meta.url)('../web/msw-script-exchange.js');
const source='[[00:01.000~00:02.000 | Somebody]]\n⟦S1主 · English · #1⟧\nHe said, "Hi".\n⟦S1副 · 中文 · #1⟧\n他说：“你好”。\n第二行\n[[00:03.000~00:04.000 | 注释]]\n⟦S4 · #1⟧\n说明\nEnglish annotation';
const row=(id,trackId,start,extra={})=>({id,key:id,trackId,trackName:trackId,number:1,start,end:start+1000,text:'before',locked:false,...extra});
const rows=[row('a','S1主',1000,{partnerId:'b'}),row('b','S1副',1000,{partnerId:'a'}),row('note','S4',3000)];
test('existing bilingual scripts retain multiline annotation, literal punctuation and per-track identity',()=>{
 const p=core.parse('\uFEFF'+source.replaceAll('\n','\r\n'));assert.equal(p.rows.length,3);assert.deepEqual(p.tracks,['S1主','S1副','S4']);
 assert.equal(p.rows[1].text,'他说：“你好”。\n第二行');assert.equal(p.rows[2].text,'说明\nEnglish annotation');
 assert.deepEqual(core.plan(p,rows).entries.map(e=>[e.target.id,e.status]),[['a','update'],['b','update'],['note','update']]);
 assert.equal(core.parse(source.replace('00:01.000~00:02.000','00:01,000 ～ 00:02,000')).rows[0].start,1000);
});
test('track mapping and exact timing survive renumbering, names, language labels, ordering and grouping changes',()=>{
 const p=core.parse(source.replace('Somebody','Renamed').replace('English','任意语言'));
 const live=rows.map(r=>({...r,trackId:r.trackId+'-new',trackName:'renamed',number:r.number+5}));
 assert.ok(core.plan(p,live).entries.every(e=>!e.target));
 const plan=core.plan(p,live,{mapping:p.tracks.map(t=>[t,t+'-new'])});assert.ok(plan.entries.every(e=>e.reason==='time'&&e.status==='update'));
});
test('ambiguous or approximate matches remain suggestions, including bound partners',()=>{
 const p=core.parse(source.replace('00:01.000~00:02.000','00:01.010~00:02.010'));
 assert.ok(core.plan(p,rows).entries.slice(0,2).every(e=>e.status==='review'&&!e.checked&&!e.target));
 const plan=core.plan(core.parse(source),[rows[0],{...rows[1],start:1200,end:2200},rows[2]]);
 assert.equal(plan.entries[1].reason,'partner');assert.deepEqual(plan.entries[1].candidates[0],'b');assert.equal(plan.entries[1].status,'review');
});
test('locks, existing drafts and duplicate destinations cannot be silently overwritten',()=>{
 let plan=core.plan(core.parse(source),[{...rows[0],locked:true},{...rows[1],draftText:'pending'}, {...rows[2],blocked:true}]);
 assert.deepEqual(plan.entries.map(e=>e.status),['locked','conflict','blocked']);assert.ok(plan.entries.every(e=>!e.checked));
 const duplicate=core.parse(source+'\n[[00:01.000~00:02.000 | Other]]\n⟦S1主 · #2⟧\nSecond edit');
 plan=core.plan(duplicate,rows);assert.equal(plan.entries[0].status,'duplicate');assert.equal(plan.entries[3].status,'duplicate');
 plan=core.plan(duplicate,rows,{manual:[[3,'']]});assert.equal(plan.entries[0].status,'update');assert.equal(plan.entries[3].status,'skipped');
 const repeated=core.parse(source+'\n[[00:01.000~00:02.000 | Other]]\n⟦S1主 · #1⟧\nRepeated');
 assert.equal(core.plan(repeated,rows).entries[0].status,'review');
});
test('missing times need review; malformed input is rejected with a line and no partial result',()=>{
 assert.equal(core.plan(core.parse('⟦S1主 · #1⟧\nChanged'),rows).entries[0].status,'review');
 for(const s of ['plain text','[[00:01.000~00:02.000 | A]]\nmissing label','[[00:02.000~00:01.000 | A]]\n⟦S1 · #1⟧\na','[[00:00:61.000~00:02:00.000]]\n⟦S1 · #1⟧\na','⟦bad'])assert.throws(()=>core.parse(s));
 assert.equal(core.parse('⟦S1 · #1⟧\n').rows[0].text,'');
 assert.equal(core.parse('⟦S1 · #1⟧\n<script>alert(1)</script>').rows[0].text,'<script>alert(1)</script>');
});
test('worker and synchronous matching agree without interpreting imported text as code',()=>{
 let reply;const context={postMessage:value=>reply=value};vm.runInNewContext(core.workerSource(),context);
 context.onmessage({data:{text:source,rows}});assert.equal(reply.plan.counts.update,3);assert.equal(reply.parsed.rows.length,3);
});

test('export records match stable IDs after project renumbering, retiming and track renaming',()=>{
 const parsed=core.parse(source),record={id:'script-1',created_at:1,rows:rows.map((r,i)=>({...r,text:parsed.rows[i].text}))};
 const live=rows.map(r=>({...r,number:99,start:r.start+8000,end:r.end+8000,trackName:'renamed'}));
 const plan=core.plan(parsed,live,{record});assert.ok(plan.entries.every(e=>e.target&&e.reason==='record'));
 const replaced=live.map(r=>r.id==='a'?{...r,id:'new-cue',key:'new-cue',start:1000,end:2000}:r);
 assert.equal(core.plan(parsed,replaced,{record}).entries[0].target,null);
});

test('three-way text comparison preserves local changes and requires explicit conflict selection',()=>{
 const parsed=core.parse(source),record={id:'script-1',created_at:1,rows:rows.map((r,i)=>({...r,text:parsed.rows[i].text}))};
 let live=record.rows.map(r=>({...r}));live[0].text='Local change';
 assert.equal(core.plan(parsed,live,{record}).entries[0].status,'preserved');
 const changed=core.parse(source.replace('He said','She said'));let result=core.plan(changed,live,{record}).entries[0];assert.equal(result.status,'conflict');assert.equal(result.checked,false);
 result=core.plan(changed,record.rows,{record}).entries[0];assert.equal(result.status,'update');assert.equal(result.checked,true);
 live[0].text=changed.rows[0].text;assert.equal(core.plan(changed,live,{record}).entries[0].status,'same');
 live[0]={...record.rows[0],text:'Before draft',draftText:record.rows[0].text};assert.equal(core.plan(changed,live,{record}).entries[0].status,'update');
});

test('export record contract rejects duplicate identities, invalid values and oversized history',()=>{
 const record={id:'script-1',created_at:1,rows};assert.equal(core.validateRecords([record])[0],record);
 for(const bad of [null,{},[...Array(6)].map((_,i)=>({...record,id:'script-'+i})),[record,record],[{...record,id:1}],[{...record,created_at:true}],[{...record,rows:[rows[0],rows[0]]}],[{...record,rows:[{...rows[0],start:-1}]}],[{...record,rows:[{...rows[0],text:'a'.repeat(8*1024*1024)}]}]])assert.throws(()=>core.validateRecords(bad));
});

test('extreme numbering remains bounded and invalid times identify the source line',()=>{
 const parsed=core.parse('⟦S1主 · #9007199254740991⟧\nUnmatched');assert.equal(core.plan(parsed,rows).entries[0].status,'missing');
 assert.throws(()=>core.parse(source.replace('00:01.000','99999999999999999999:01.000')),/第 1 行/);
 assert.throws(()=>core.parse(source.replace('00:01.000','00:61.000')),/第 1 行/);
});
