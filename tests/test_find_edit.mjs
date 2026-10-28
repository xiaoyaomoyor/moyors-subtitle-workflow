import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createEngine,workerSource}=createRequire(import.meta.url)('../web/msw-find-core.js');
const rows=[
 {key:'a',id:'a',trackId:'S1',start:2000,order:0,number:1,text:'Alpha alpha (a+b) 中文字幕'},
 {key:'b',id:'b',trackId:'S2',start:1000,order:1,number:1,text:'alpha\n字幕 Alpha'},
 {key:'c',id:'c',trackId:'S3',start:1000,order:2,number:1,text:'emoji 😻 <script>'},
];
const make=()=>{const e=createEngine();e.update({rows});return e;};
test('search counts occurrences, sorts by time and track, preserves exact offsets',()=>{
 const e=make(),r=e.search({query:'alpha'});assert.equal(r.count,4);assert.deepEqual(r.rows.map(x=>x.key),['b','a']);
 assert.deepEqual(r.rows[1].matches,[[0,5],[6,11]]);assert.equal(e.search({query:'Alpha',caseSensitive:true}).count,2);
 assert.equal(e.search({query:'(a+b)'}).count,1);assert.equal(e.search({query:'字幕'}).count,2);
});
test('all, selected IDs and multiple tracks are independent and empty scope stays empty',()=>{
 const e=make();assert.equal(e.search({query:'alpha',scope:'tracks',tracks:['S2']}).count,2);
 assert.equal(e.search({query:'alpha',scope:'tracks',tracks:['S1','S2']}).count,4);
 assert.equal(e.search({query:'alpha',scope:'selected',selected:['a']}).count,2);
 assert.equal(e.search({query:'alpha',scope:'selected',selected:[]}).count,0);
 assert.equal(e.search({query:'alpha',scope:'tracks',tracks:[]}).count,0);
});
test('incremental update/removal tracks text and identities without mutating inputs',()=>{
 const e=make(),before=JSON.stringify(rows);e.update({rows:[{...rows[0],text:'Beta',start:0}],removed:['b']});
 assert.equal(e.search({query:'alpha'}).count,0);assert.equal(e.search({query:'Beta'}).rows[0].key,'a');assert.equal(JSON.stringify(rows),before);
 e.update({reset:true});assert.equal(e.search({query:'Beta'}).count,0);
});
test('regex errors and zero-width Unicode matches do not loop',()=>{
 const e=make();assert.equal(e.search({query:'[',regex:true}).error,'invalid-regex');
 assert.equal(e.search({query:'(?=.)',regex:true}).zeroWidth,true);
 assert.equal(e.search({query:'(?=😻)|😻',regex:true}).count,0);
 assert.equal(e.search({query:'a[a-z]+',regex:true}).count,4);
 assert.equal(e.search({query:''}).count,0);
});
test('match ceiling is explicit and worker protocol shares the engine',()=>{
 assert.equal(make().search({query:'alpha',limit:2}).limited,true);
 const replies=[],worker=new Function('postMessage',workerSource()+';return onmessage;')(x=>replies.push(x));
 worker({data:{type:'update',patch:{rows}}});worker({data:{type:'search',version:9,query:{query:'字幕'}}});
 assert.equal(replies[0].version,9);assert.equal(replies[0].result.count,2);
});
