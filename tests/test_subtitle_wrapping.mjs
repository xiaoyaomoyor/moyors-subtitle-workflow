import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const c={window:{},TextEncoder,TextDecoder,Uint8Array};
for(const f of ['gap-remove-core','editor-utils','msw-project-style','msw-subtitle-presentation'])vm.runInNewContext(fs.readFileSync(new URL('../web/'+f+'.js',import.meta.url),'utf8'),c);
const S=c.window.MSWProjectStyle,U=c.window.AsrEditorUtils,P=c.window.MSWSubtitlePresentation;
const cases=JSON.parse(fs.readFileSync(new URL('fixtures/subtitle-wrapping.json',import.meta.url),'utf8'));
test('character wrapping keeps manual breaks, combining marks and common emoji intact',()=>{
  for(const {text,count,expected} of cases){
    assert.equal(S.wrapText(text,{wrapMode:'characters',charsPerLine:count}),expected);
    assert.equal(S.wrapText(text,{wrapMode:'auto',charsPerLine:count}),text);
  }
});
test('wrapping settings are validated and defaults preserve automatic rendering',()=>{
  assert.equal(S.defaults().main.wrapMode,'auto');assert.equal(S.defaults().secondary.charsPerLine,20);
  for(const count of [0,201,1.5,true,null,'20'])assert.throws(()=>S.normalize({main:{charsPerLine:count}}),/每行字数/);
  for(const wrapMode of [null,1,'words'])assert.throws(()=>S.normalize({main:{wrapMode}}),/换行方式/);
});
test('independent track wrapping changes ASS and layout without mutating source or SRT',()=>{
  const style=S.defaults();Object.assign(style.main,{wrapMode:'characters',charsPerLine:3});Object.assign(style.secondary,{wrapMode:'characters',charsPerLine:2});
  const p={schema:'msw.project.v2',segments:[{id:'m',start:0,end:1000,text:'ABCDEF'}],multi_subtitle:{enabled:true,tracks:[{id:'s',segments:[{id:'s1',start:0,end:1000,text:'甲乙丙丁'}]}]},preview:{project_style:style}};
  const before=JSON.stringify(p),srt=U.buildSrtPayload(p.segments);
  const rendered=S.renderProject(p);assert.equal(rendered.segments[0].text,'ABC\nDEF');assert.equal(rendered.multi_subtitle.tracks[0].segments[0].text,'甲乙\n丙丁');
  const result=U.buildAssPayload(p.segments,{projectStyle:style,extensionSegments:p.multi_subtitle.tracks[0].segments,assProfile:S.toLibrary(style).assProfiles[0],assStyle:style.main,assExtensionStyle:style.secondary});
  assert.ok(result.includes('ABC\\NDEF'));assert.ok(result.includes('甲乙\\N丙丁'));
  const layout=P.layout(p,{main:{font_size:48,width:.8,y:.86},secondary:{font_size:40,width:.8,y:.94}});
  assert.equal(layout.entries[0].cue.text,'ABC\nDEF');assert.equal(P.mergedSrtRows(p)[0].text,'ABCDEF\n甲乙丙丁');
  assert.equal(JSON.stringify(p),before);assert.equal(U.buildSrtPayload(p.segments),srt);
  const copy=JSON.parse(JSON.stringify(style));assert.equal(S.normalize(copy).secondary.charsPerLine,2);
});
