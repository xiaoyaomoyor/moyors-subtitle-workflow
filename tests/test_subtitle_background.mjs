import {test} from 'node:test';
import assert from 'node:assert/strict';
import B from '../web/msw-subtitle-background.js';
import S from '../web/msw-cue-style.js';
import core from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';
import production from '../web/msw-production-project.js';

test('partial background fields inherit and reject unsafe or future parameters',()=>{
  const base={...B.defaults,backgroundShape:'rounded',backgroundColor:'#123456'};
  const style=S.apply(base,{subtitle_style:{backgroundPaddingX:40}});
  assert.equal(style.backgroundColor,'#123456');assert.equal(style.backgroundPaddingX,40);
  for(const patch of [{backgroundShape:'bubble'},{backgroundColor:'#fff'},{backgroundOpacity:Infinity},
    {backgroundPaddingX:true},{backgroundPaddingY:-1},{backgroundRadius:241}]){
    assert.equal(S.valid(patch),false);assert.throws(()=>B.normalize(patch),/无效/);
  }
  assert.deepEqual(B.normalize({}),B.defaults);
});

test('background edits preserve partners, lock atomicity, split/merge and project history',()=>{
  let p=core.migrate({segments:[{id:'a',start:0,end:2000,text:'hello world'}]});
  const id=p.subtitles.cues[0].id,track=p.subtitles.tracks[0].id;
  p=core.addTrack(p,{...p.subtitles.tracks[0],id:'other'});p=edit.addCue(p,'other','b',0,2000,'translation');p=core.bind(p,id,'b','pair');
  p=production.toProject(production.fromProject(p));
  const before=structuredClone(p),patch={backgroundShape:'rounded',backgroundColor:'#112233',backgroundRadius:18};
  p=edit.updateAppearance(p,[id],patch);
  assert.equal(edit.cue(p,'b').content.subtitle_style,undefined);
  assert.deepEqual(p.subtitles.bindings,before.subtitles.bindings);
  assert.deepEqual(production.toProject(production.fromProject(p)).subtitles,p.subtitles);
  const history=new edit.History(before);history.commit(p,'appearance',[id]);history.step('undo');assert.deepEqual(history.project,before);
  history.step('redo');assert.deepEqual(history.project,p);
  let seq=0;const makeId=()=>`cut-${++seq}`,split=edit.split(p,id,1000,{makeId});
  for(const cue of split.project.subtitles.cues.filter(c=>c.track_id===track))assert.deepEqual(cue.content.subtitle_style,patch);
  const merged=edit.merge(split.project,split.ids.slice(0,2),{makeId}).project;
  assert.deepEqual(merged.subtitles.cues.find(c=>c.track_id===track).content.subtitle_style,patch);
  const locked=edit.updateTrack(p,'other',{locked:true});
  assert.throws(()=>edit.updateAppearance(locked,[id,'b'],{backgroundShape:'rect'}),/锁定/);
  assert.deepEqual(edit.cue(edit.updateAppearance(p,[id],{},{reset:['backgroundColor']}),id).content.subtitle_style,
    {backgroundShape:'rounded',backgroundRadius:18});
});
