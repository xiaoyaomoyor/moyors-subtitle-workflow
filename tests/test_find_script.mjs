import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {packScript,unpackScript,scriptEntries,scriptDocument,scriptEdit,scriptRange,scriptFields,formatTime}=createRequire(import.meta.url)('../web/msw-find-text-tools.js');
const cue=(id,start,extra={})=>({id,key:id,trackId:'s1',trackName:'S1',order:0,number:1,start,end:start+1000,speakerId:'sp1',speakerName:'SP1',text:id,...extra});
const pair=[cue('main',1000,{partnerId:'sub',trackName:'S1主'}),cue('sub',1000,{partnerId:'main',trackName:'S1副',order:1,scriptSecondary:true})];

test('script sorts globally, pairs only explicit partners and has no blank separators',()=>{
 const rows=[cue('late',9000),pair[1],cue('overlap',1000,{order:2}),pair[0],cue('early',0)];
 const text=packScript(rows);
 assert.equal(text,'[[00:00.000~00:01.000 | SP1]]\n⟦S1 · #1⟧\nearly\n[[00:01.000~00:02.000 | SP1]]\n⟦S1主 · #1⟧\nmain\n⟦S1副 · #1⟧\nsub\n[[00:01.000~00:02.000 | SP1]]\n⟦S1 · #1⟧\noverlap\n[[00:09.000~00:10.000 | SP1]]\n⟦S1 · #1⟧\nlate');
 assert.deepEqual(unpackScript(rows,text),rows.map(r=>r.text));
 assert.equal(rows[0].id,'late');
 assert.equal(scriptDocument(rows).ranges.find(r=>r.key==='sub').text,'sub');
});
test('filtered partners, unbound overlaps and mismatching times/speakers remain separate',()=>{
 assert.equal(scriptEntries([pair[1]]).length,1);
 assert.equal(scriptEntries(pair.map(r=>({...r,partnerId:null}))).length,2);
 for(const patch of [{start:1001},{end:2001},{speakerId:'sp2'}])assert.equal(scriptEntries([pair[0],{...pair[1],...patch}]).length,2);
 assert.equal(formatTime(3600123),'01:00:00.123');
});
test('script projection preserves literal quotes, slashes, headers, whitespace and empty text without escaping',()=>{
 const texts=['',' \n\n ','他说：“你好”\n"hello"\n”\n"','C:\\new\\title\n\\“quoted\\”','[[00:01.000~00:02.000 | SP1 | S1 | #1]]','<script>alert(1)</script> 😻\0'];
 for(const a of texts)for(const b of texts){
  const rows=[{...pair[0],text:a},{...pair[1],text:b}];
  const doc=scriptDocument(rows);assert.deepEqual(doc.ranges.map(r=>doc.text.slice(r.start,r.end)),[a,b]);
  for(const r of doc.ranges){
   assert.equal(scriptRange(doc,r.start,r.end).key,r.key);
   assert.deepEqual(scriptEdit(doc,doc.text.slice(0,r.start)+'new\n"“\\”"'+doc.text.slice(r.end)),{key:r.key,text:'new\n"“\\”"'});
  }
 }
});
test('external script paste maps identities and rejects damaged, reordered, duplicated or ambiguous metadata',()=>{
 const text=packScript(pair);
 assert.deepEqual(unpackScript(pair,text.replace('main','new\nline')),['new\nline','sub']);
 assert.deepEqual(unpackScript(pair,text.replaceAll('\n','\r\n')),['main','sub']);
 for(const invalid of [text.replace('#1','#99'),text.replace('SP1','SP2'),text.replace('S1主','S1副'),text.replace('\n⟦S1副 · #1⟧\nsub',''),text+'\n'+text,text.replace('main','main\n⟦S1副 · #1⟧\nextra'),text.replace('00:01.000','00:03.000')])assert.throws(()=>unpackScript(pair,invalid),/完整信息行/);
});

test('visibility changes projection only; hidden metadata never becomes editable body',()=>{
 const rows=pair.map((r,i)=>({...r,language:i?'zh-hans':'en',languageName:i?'简体中文':'英文'}));
 const full=scriptDocument(rows);assert.match(full.text,/S1主 · 英文 · #1/);
 for(const field of scriptFields){const doc=scriptDocument(rows,undefined,{[field]:false});assert.deepEqual(doc.ranges.map(r=>r.text),['main','sub']);assert.notEqual(doc.text,full.text);}
 const bare=scriptDocument(rows,undefined,Object.fromEntries(scriptFields.map(k=>[k,false])));
 assert.equal(bare.text,'main\nsub');assert.equal(scriptRange(bare,4,5),undefined);
 assert.throws(()=>scriptEdit(bare,'mainsub'),/只读/);
 assert.throws(()=>scriptEdit(full,full.text.replace('SP1','SP2')),/只读/);
 assert.deepEqual(scriptEdit(bare,'main\nnext'),{key:'sub',text:'next'});
 assert.equal(scriptEdit(bare,bare.text),null);
 const empty=scriptDocument([{...pair[0],text:''},pair[1]]),at=empty.ranges[0].start;
 assert.deepEqual(scriptEdit(empty,empty.text.slice(0,at)+'\n'+empty.text.slice(at),[at,at]),{key:'main',text:'\n'});
});
