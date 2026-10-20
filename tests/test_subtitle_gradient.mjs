import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../web/msw-subtitle-gradient.js';
import C from '../web/msw-cue-style.js';
import core from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';
import production from '../web/msw-production-project.js';

test('gradient defaults, endpoints, midpoint and per-field inheritance remain portable',()=>{
  const style={gradientMode:'characters',gradientStart:'#ff0000',gradientEnd:'#00ff00'};
  assert.equal(G.color(style,0,3),'#ff0000');assert.equal(G.color(style,1,3),'#808000');
  assert.equal(G.color(style,2,3),'#00ff00');assert.equal(G.color(style,0,1),'#ff0000');
  assert.equal(G.enabled(G.normalize()),false);assert.equal(G.valid({gradientMode:'css'}),false);
  assert.equal(C.valid({gradientEnd:'#xyzxyz'}),false);
  assert.equal(C.apply(style,{subtitle_style:{gradientEnd:'#0000ff'}}).gradientStart,'#ff0000');
  let p=production.toProject(production.fromProject(core.migrate({segments:[{id:'a',start:0,end:2000,text:'Abc'}]})));
  const before=structuredClone(p),id=p.subtitles.cues[0].id;
  p=edit.updateAppearance(p,[id],style);
  assert.equal(p.subtitles.cues[0].content.subtitle_style.gradientEnd,'#00ff00');
  assert.deepEqual(production.toProject(production.fromProject(p)).subtitles,p.subtitles);
  const history=new edit.History(before);history.commit(p,'gradient',[id]);history.step('undo');assert.deepEqual(history.project,before);
  history.step('redo');assert.deepEqual(history.project,p);
  p=edit.updateTrack(p,p.subtitles.tracks[0].id,{locked:true});
  assert.throws(()=>edit.updateAppearance(p,[id],{gradientEnd:'#0000ff'}),/锁定/);
});
