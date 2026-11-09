import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {packScript,unpackScript,scriptEntries,scriptKeyAt,formatTime}=createRequire(import.meta.url)('../web/msw-find-text-tools.js');
const cue=(id,start,extra={})=>({id,key:id,trackId:'s1',trackName:'S1',order:0,number:1,start,end:start+1000,speakerId:'sp1',speakerName:'SP1',text:id,...extra});
const pair=[cue('main',1000,{partnerId:'sub',trackName:'S1主'}),cue('sub',1000,{partnerId:'main',trackName:'S1副',order:1,scriptSecondary:true})];

test('script sorts globally, pairs only explicit partners and has no blank separators',()=>{
 const rows=[cue('late',9000),pair[1],cue('overlap',1000,{order:2}),pair[0],cue('early',0)];
 const text=packScript(rows);
 assert.equal(text,'[[00:00.000~00:01.000 | SP1 | S1 | #1]]\n“early”\n[[00:01.000~00:02.000 | SP1 | S1主 | #1 / S1副 | #1]]\n“main”\n"sub"\n[[00:01.000~00:02.000 | SP1 | S1 | #1]]\n“overlap”\n[[00:09.000~00:10.000 | SP1 | S1 | #1]]\n“late”');
 assert.deepEqual(unpackScript(rows,text),rows.map(r=>r.text));
 assert.equal(rows[0].id,'late');
 assert.equal(scriptKeyAt(rows,text,text.indexOf('"sub"')+1),'sub');
 assert.equal(scriptKeyAt(rows,text,0),'early');
});
test('filtered partners, unbound overlaps and mismatching times/speakers remain separate',()=>{
 assert.equal(scriptEntries([pair[1]]).length,1);
 assert.equal(scriptEntries(pair.map(r=>({...r,partnerId:null}))).length,2);
 for(const patch of [{start:1001},{end:2001},{speakerId:'sp2'}])assert.equal(scriptEntries([pair[0],{...pair[1],...patch}]).length,2);
 assert.equal(formatTime(3600123),'01:00:00.123');
});
test('script round-trips multiline, empty, whitespace, literal headers, quotes and backslashes',()=>{
 const texts=['',' \n\n ','他说：“你好”\n"hello"\n”\n"','C:\\new\\title\n\\“quoted\\”','[[00:01.000~00:02.000 | SP1 | S1 | #1]]','<script>alert(1)</script> 😻\0'];
 for(const a of texts)for(const b of texts){
  const rows=[{...pair[0],text:a},{...pair[1],text:b}];
  assert.deepEqual(unpackScript(rows,packScript(rows)),[a,b]);
  assert.deepEqual(unpackScript(rows,packScript(rows).replaceAll('\n','\r\n')),[a,b]);
 }
});
test('script edits map to original identities; damaged or duplicate structure is rejected',()=>{
 const text=packScript(pair);
 assert.deepEqual(unpackScript(pair,text.replace('main','new\nline')),['new\nline','sub']);
 for(const invalid of [text.replace('#1','#99'),text.replace('SP1','SP2'),text.replace('“main”','main'),text.replace('\n"sub"',''),text+'\n'+text,text.replace('“main”','“main”\n“extra”'),text.replace('00:01.000','00:03.000')])assert.throws(()=>unpackScript(pair,invalid),/剧本信息行/);
});
