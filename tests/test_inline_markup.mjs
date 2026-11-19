import test from 'node:test';
import assert from 'node:assert/strict';
import markup from '../web/msw-inline-markup.js';
import flat from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';

test('only paired double markers, nesting and escapes; URLs and literal ASS remain data',()=>{
  assert.equal(markup.plain('**重 //斜体//** %%弱%% __线__ ~~删~~ ++大++ --小--'),'重 斜体 弱 线 删 大 小');
  assert.deepEqual(markup.parse('**a //b// c**').runs.map(r=>r.marks),[['**'],['**','//'],['**']]);
  for(const text of ['**孤儿','***三***','http://a https://b','C:\\video\\a','{\\pos(1,2)}','*a*'])assert.equal(markup.plain(text),text);
  assert.equal(markup.plain('\\**字\\** **重点**'),'**字** 重点');
  assert.equal(markup.plain('//旧弱化//',false),'//旧弱化//');
  assert.equal(markup.appearance({fontSize:40,italic:false},['//']).italic,true);
});

test('split closes nested styles and merge folds only proven adjacent pairs',()=>{
  for(const marker of markup.markers) {
    const text=marker+'甲乙'+marker,parts=markup.split(text,3);
    assert.equal(parts.left,marker+'甲'+marker);assert.equal(parts.right,marker+'乙'+marker);
    assert.equal(markup.join([parts.left,parts.right]),text);
    assert.equal(markup.plain(parts.left)+markup.plain(parts.right),'甲乙');
  }
  assert.deepEqual(markup.split('**甲//乙丙//丁**',6),{left:'**甲//乙//**',right:'**//丙//丁**',offset:6});
  assert.equal(markup.join(['**a //b//**','**//c// d**'],' '),'**a //b c// d**');
  assert.equal(markup.join(['孤**','**儿']),'孤****儿');
  assert.equal(markup.split('**甲乙**',2).left,'');
  assert.equal(markup.split('**甲乙**',4).right,'');
  assert.deepEqual(markup.split('**hello world**',8,{trim:true}),{left:'**hello**',right:'**world**',offset:8});
  assert.equal(markup.split('**甲， 乙**',5,{trim:(text,side)=>side==='left'?text.replace(/[，\s]+$/u,''):text.trimStart()}).left,'**甲**');
  for(const text of ['**//甲乙//**','甲**//乙丙//**丁','**甲**//乙//','\\**字\\**','++👩‍💻++'])for(let i=0;i<=text.length;i++) {
    const split=markup.split(text,i);assert.equal(markup.plain(split.left)+markup.plain(split.right),markup.plain(text),`${text} at ${i}`);
  }
});

test('explicit style clearing preserves literals and escapes and requires the project switch',()=>{
  const styled='**甲//乙//** %%弱%% __线__ ~~删~~ ++大++ --小--';
  assert.equal(markup.clearStyles(styled,true),'甲乙 弱 线 删 大 小');
  assert.equal(markup.clearStyles(styled,false),styled);
  assert.equal(markup.clearStyles(styled),styled);
  for(const text of ['https://example.test/a//b//c','C:/dir/**name**/a.txt','C:\\dir\\__name__\\a.txt',
    '\\\\server\\**name**\\a','./**name**/a','../__name__/a','/tmp/**name**/a','\\**literal\\**','*literal*','**orphan','***three***']) {
    assert.equal(markup.clearStyles(text,true),text,text);
  }
  assert.equal(markup.clearStyles('**https://example.test/a**',true),'https://example.test/a');
  assert.equal(markup.clearStyles('**C:/dir/**name**/a.txt**',true),'**C:/dir/**name**/a.txt**');
});

test('flat transactions preserve paired bodies and word times, disabled mode stays literal',()=>{
  let p=flat.migrate({segments:[{id:'a',start:0,end:2000,text:'**甲乙**',items:[{text:'**甲',start:0,end:1000},{text:'乙**',start:1000,end:2000}]}]});
  p.preview={inline_markup:true};const id=p.subtitles.cues[0].id;let n=0;
  const makeId=()=>`new-${++n}`,split=edit.split(p,id,1000,{positions:{[id]:3},makeId});
  assert.deepEqual(split.project.subtitles.cues.map(c=>c.content.text),['**甲**','**乙**']);
  for(const c of split.project.subtitles.cues)assert.equal(c.content.items.map(i=>i.text).join(''),c.content.text);
  const merged=edit.merge(split.project,split.ids,{makeId}).project;
  assert.equal(merged.subtitles.cues[0].content.text,'**甲乙**');
  assert.equal(merged.subtitles.cues[0].content.items.map(i=>i.text).join(''),'**甲乙**');
  assert.deepEqual(merged.subtitles.cues[0].content.items.map(i=>[i.start,i.end]),[[0,1000],[1000,2000]]);
  assert.equal(p.subtitles.cues[0].content.text,'**甲乙**');
  p.preview.inline_markup=false;
  assert.deepEqual(edit.split(p,id,1000,{positions:{[id]:3},makeId}).project.subtitles.cues.map(c=>c.content.text),['**甲','乙**']);
  p.preview.inline_markup='yes';assert.throws(()=>flat.validate(p),/句内样式/);
});
