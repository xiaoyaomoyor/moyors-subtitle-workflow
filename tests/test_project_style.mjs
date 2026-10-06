import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{},TextEncoder,TextDecoder,Uint8Array};
for(const file of ['gap-remove-core.js','editor-utils.js','msw-project-style.js'])vm.runInNewContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
const S=context.window.MSWProjectStyle,U=context.window.AsrEditorUtils;
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
});
