import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{},TextEncoder,TextDecoder,Uint8Array};
for(const file of ['gap-remove-core.js','editor-utils.js','msw-project-style.js'])vm.runInNewContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
const S=context.window.MSWProjectStyle,U=context.window.AsrEditorUtils;

test('new projects use zero pair spacing without rewriting existing or legacy geometry',()=>{
  const fresh={};S.migrate(fresh,{},{});
  assert.equal(fresh.preview.project_style.pairLayout.gap,0);
  assert.equal(fresh.preview.project_style.main.marginV,96);
  assert.equal(S.presets()[0].pairLayout.gap,0);
  assert.equal(S.presets()[1].main.marginV,108);
  assert.equal(S.presets()[1].pairLayout,undefined);
  const previous={preview:{project_style:{...S.defaults(),pairLayout:undefined,main:{...S.defaults().main,marginV:108}}}};
  const before=JSON.stringify(previous);S.migrate(previous,{});assert.equal(JSON.stringify(previous),before);
  assert.equal(S.fromBurn({}).pairLayout,undefined);assert.equal(S.fromPreview({}).main.marginV,108);
});
test('custom project snapshots survive preset selection, capture and restore',()=>{
  const project={preview:{}},custom=S.defaults();custom.main.primaryColor='#123456';
  S.edit(project,custom);const checkpoint=S.capture(project);
  S.edit(project,S.presets()[1],'large');
  assert.equal(project.preview.project_style_custom.main.primaryColor,'#123456');
  assert.equal(project.preview.project_style.main.fontSize,72);
  S.restore(project,checkpoint);assert.equal(project.preview.project_style_selection,'current');
  assert.equal(project.preview.project_style.main.primaryColor,'#123456');
  project.preview.project_style.main.fontSize=60;assert.equal(project.preview.project_style_custom.main.fontSize,48);
});
test('appearance swap preserves role geometry, pair order and shared animations',()=>{
  const before=S.arrangePair(S.defaults(),{order:'secondary-above',gap:22});
  before.main.fontName='Main Font';before.secondary.fontName='Secondary Font';
  before.main.marginL=100;before.secondary.marginL=200;before.main.alignment=1;before.secondary.alignment=3;
  const swapped=S.swapAppearance(before);
  for(const role of ['main','secondary'])for(const key of ['alignment','marginL','marginR','marginV'])assert.equal(swapped[role][key],before[role][key]);
  assert.equal(swapped.main.fontName,'Secondary Font');assert.equal(swapped.secondary.fontSize,before.main.fontSize);
  assert.equal(JSON.stringify(swapped.pairLayout),JSON.stringify(before.pairLayout));assert.equal(JSON.stringify(swapped.animations),JSON.stringify(before.animations));
  assert.equal(JSON.stringify(S.swapAppearance(swapped)),JSON.stringify(before));
  const legacy=S.fromBurn({main:{font_size:99,x:.2,width:.4,background_alpha:.5}}),result=S.swapAppearance(legacy);
  assert.equal(result.legacyBurn.main.font_size,40);assert.equal(result.legacyBurn.secondary.font_size,99);
  assert.equal(result.legacyBurn.main.x,.2);assert.equal(result.legacyBurn.main.width,.4);assert.equal(result.legacyBurn.secondary.y,.94);
});
test('pair controls preserve the group anchor and derive integer spacing',()=>{
  const base=S.presets()[1],pair=S.pairSettings(base);assert.ok(Number.isInteger(pair.gap));
  const next=S.arrangePair(base,{order:'secondary-above',gap:30});
  assert.equal(next.main.marginV,Math.min(base.main.marginV,base.secondary.marginV));
  assert.equal(next.secondary.marginV,Math.round(next.main.marginV+next.main.fontSize*1.2+30));
  for(const gap of [-241,241,1.5])assert.throws(()=>S.arrangePair(base,{order:'main-above',gap}));
  const close=S.arrangePair(base,{order:'secondary-above',gap:-12});
  assert.equal(close.pairLayout.gap,-12);assert.ok(close.secondary.marginV<next.secondary.marginV);
  const extreme=S.arrangePair(close,{order:'secondary-above',gap:-240});
  assert.equal(extreme.main.marginV,close.main.marginV);assert.ok(extreme.secondary.marginV>extreme.main.marginV);
});
test('preset copies isolate projects and proofreading',()=>{
  const preset=S.presets()[1],a={preview:{}},b={preview:{}};
  S.apply(a,preset);S.apply(b,preset);a.preview.project_style.main.fontSize=20;
  assert.equal(b.preview.project_style.main.fontSize,72);assert.equal(preset.main.fontSize,72);
});
test('legacy styles migrate once and retain independent source presets',()=>{
  const project={preview:{burn_subtitles:{main:{font_size:99,background_alpha:.5}},subtitle:{font_size:32,color:'#123456'}}};
  assert.equal(S.migrate(project,U.normalizeAssStyleLibrary({})),true);
  assert.equal(project.preview.project_style.legacyBurn.main.font_size,99);
  assert.equal(project.preview.style_migration.presets[0].main.primaryColor,'#123456');
  const before=JSON.stringify(project);assert.equal(S.migrate(project,{}),false);assert.equal(JSON.stringify(project),before);
});
test('ASS-enabled migration captures full profile independently',()=>{
  const library=U.normalizeAssStyleLibrary({styles:[{id:'custom',fontSize:90}],assProfiles:[{id:'profile',styleId:'custom'}],assignments:{assExportProfileId:'profile'}});
  const project={preview:{ass_library_exports:true}};S.migrate(project,library);
  assert.equal(project.preview.project_style.main.fontSize,90);
  library.styles.find(s=>s.id==='custom').fontSize=15;
  assert.equal(project.preview.project_style.main.fontSize,90);
  const restored=S.fromLibrary(S.toLibrary(project.preview.project_style));
  assert.equal(restored.main.fontSize,90);
});
test('editor-created geometry does not misidentify a fresh project as legacy',()=>{
  const project={preview:{subtitle:{font_size:18},ass_library_exports:false}};
  S.migrate(project,{},{});
  assert.equal(project.preview.project_style.main.fontSize,48);
  assert.equal(project.preview.project_style.legacyBurn,undefined);
  assert.equal(project.preview.style_migration,undefined);
});
test('future project style versions are not silently migrated',()=>{
  const project={preview:{project_style:{schema:'future',opaque:'preserve'}}},before=JSON.stringify(project);
  assert.throws(()=>S.migrate(project,{}),/版本不受支持/);
  assert.equal(JSON.stringify(project),before);
  for(const selection of [123,true,[],{},''])assert.throws(()=>S.migrate({preview:{project_style:S.defaults(),project_style_selection:selection}},{}),/选择无效/);
});

test('pair spacing includes vertical scale rather than treating scaled text as its unscaled size',()=>{
  const a=S.defaults(),b=S.defaults();
  a.main.fontSize=40;a.main.scaleY=200;b.main.fontSize=80;b.main.scaleY=100;
  for(const gap of [-46,0,24]){
    const x=S.arrangePair(a,{order:'secondary-above',gap}),y=S.arrangePair(b,{order:'secondary-above',gap});
    assert.equal(x.secondary.marginV,y.secondary.marginV);
    delete x.pairLayout;delete y.pairLayout;
    assert.deepEqual(S.pairSettings(x),S.pairSettings(y));
  }
});
