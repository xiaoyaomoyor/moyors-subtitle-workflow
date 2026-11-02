import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../web/msw-config.js', import.meta.url), 'utf8');
const key = 'moy.asr.editor.settings.v1';
const registry = {[key]: {path:['browser',key],encoding:'json'}, 'mawe.language': {path:['browser','mawe.language'],encoding:'text'}};
function client(initial = {}) {
  const local = new Map(Object.entries(initial)), events = [];
  const global = {localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)},
    addEventListener(){},dispatchEvent:e=>events.push(e),setInterval(){}};
  vm.runInNewContext(source, {window:global, setTimeout:()=>1,clearTimeout(){},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}});
  return {config:global.MSWConfig,local,events};
}
const snapshot = settings=>({registry,sections:{browser:{[key]:settings}},migrations:[]});
test('legacy migration preserves central values, collects only registered preferences',async()=>{
  const {config,local}=client({[key]:JSON.stringify({theme:'light',seekStepMs:1000}), 'secret-key':'do not migrate', 'msw.processing.drafts.project':'project'});
  const calls=[];
  await config.connect(snapshot({theme:'dark'}),async payload=>{calls.push(payload);return {};});
  assert.deepEqual(JSON.parse(config.storage.getItem(key)),{theme:'dark',seekStepMs:1000});
  assert.equal(calls[0].sections.browser['secret-key'],undefined);
  assert.equal(config.storage.getItem('msw.processing.drafts.project'),'project');
  assert.ok(local.has('msw.config.legacy.v1'));
});
test('only edited fields are submitted; save is awaited and stable operation IDs survive retry',async()=>{
  const {config}=client();let fail=true;const calls=[];
  await config.connect(snapshot({theme:'dark',seekStepMs:1000}),async p=>{
    if(p.action==='patch'){calls.push(p);if(fail)throw Error('offline');}return {};
  });
  config.storage.setItem(key,JSON.stringify({theme:'light',seekStepMs:1000}));
  await assert.rejects(config.flush());
  fail=false;await config.flush();
  assert.equal(calls[0].changes.length,1);
  assert.equal(calls[0].changes[0].path.at(-1),'theme');
  assert.equal(calls[0].changes[0].id,calls[1].changes[0].id);
});
test('project restore is an observed baseline, not a user-default write',async()=>{
  const {config}=client();const calls=[];
  await config.connect(snapshot({theme:'dark',seekStepMs:1000}),async p=>{calls.push(p);return {};});
  config.observe(key,JSON.stringify({theme:'light',seekStepMs:1000}));
  config.storage.setItem(key,JSON.stringify({theme:'light',seekStepMs:500}));
  await config.flush();
  const patch=calls.find(p=>p.action==='patch');
  assert.equal(patch.changes.length,1);
  assert.equal(patch.changes[0].path.at(-1),'seekStepMs');
  assert.equal(JSON.parse(config.storage.getItem(key)).theme,'dark');
});
test('conflict keeps recovery copy and does not repeatedly overwrite on refresh',async()=>{
  const {config,local}=client();
  await config.connect(snapshot({theme:'dark'}),async p=>{if(p.action==='patch')throw Object.assign(Error('conflict'),{conflict:true});return {};});
  config.storage.setItem(key,JSON.stringify({theme:'light'}));
  await assert.rejects(config.flush());
  assert.ok([...local.keys()].some(k=>k.startsWith('msw.config.conflict.')));
  assert.equal(local.get('msw.config.pending.v1'),'[]');
});
test('editing a project-restored field compares against the persisted preference',async()=>{
  const {config}=client();const calls=[];
  await config.connect(snapshot({layout:'default',theme:'dark'}),async p=>{calls.push(p);return {};});
  config.observe(key,JSON.stringify({layout:'project',theme:'dark'}));
  config.storage.setItem(key,JSON.stringify({layout:'custom',theme:'dark'}));
  await config.flush();
  const change=calls.find(p=>p.action==='patch').changes[0];
  assert.equal(change.before,'default');assert.equal(change.value,'custom');
});
test('offline portable storage stays usable and does not expose project keys to config',async()=>{
  const {config}=client({[key]:'{"theme":"light"}'});
  await config.connect({registry,sections:{}},null);
  config.storage.setItem(key,'{"theme":"dark"}');
  config.storage.setItem('project-draft','private content');
  assert.equal(JSON.parse(config.storage.getItem(key)).theme,'dark');
  assert.equal(config.storage.getItem('project-draft'),'private content');
  await config.flush();
});

test('imported defaults survive subsequent one-field edits in the still-open UI',async()=>{
  const {config}=client(),calls=[];
  await config.connect(snapshot({theme:'dark',seekStepMs:1000}),async p=>{calls.push(p);return {};});
  config.adopt(snapshot({theme:'light',seekStepMs:2750}));
  config.storage.setItem(key,JSON.stringify({theme:'dark',seekStepMs:1000,cueListShowTime:false}));
  await config.flush();
  const batch=calls.find(p=>p.action==='patch');
  assert.equal(batch.changes.length,1);assert.equal(batch.changes[0].path.at(-1),'cueListShowTime');
  assert.equal(JSON.parse(config.storage.getItem(key)).seekStepMs,2750);
});

for (const online of [false, true]) test(`scoped preferences isolate project defaults and imports (${online ? 'server' : 'portable'})`, async()=>{
  const {config}=client(), calls=[];
  await config.connect(snapshot({theme:'dark',cueListShowTime:true}), online ? async p=>{calls.push(p);return {};} : null);
  const normalize=value=>({theme:'dark',cueListShowTime:true,mediaSeekStepMs:3000,...value});
  const prefs=config.createPreferences(key,normalize,['cueListShowTime']);
  prefs.restoreWorkspace({cueListShowTime:false});
  prefs.update({mediaSeekStepMs:2500});
  assert.deepEqual(JSON.parse(config.storage.getItem(key)),{theme:'dark',cueListShowTime:true,mediaSeekStepMs:2500});
  assert.equal(prefs.value.cueListShowTime,false);
  prefs.restoreWorkspace(null);
  assert.equal(prefs.value.cueListShowTime,true);
  config.adopt(snapshot({theme:'light',cueListShowTime:false,mediaSeekStepMs:1500}));
  prefs.update({mediaSeekStepMs:1000});
  assert.deepEqual(JSON.parse(config.storage.getItem(key)),{theme:'light',cueListShowTime:false,mediaSeekStepMs:1000});
  prefs.update({project_style:{},splitAutoSubmit:true});
  assert.equal(JSON.parse(config.storage.getItem(key)).project_style,undefined);
  assert.equal(JSON.parse(config.storage.getItem(key)).splitAutoSubmit,undefined);
  await config.flush();
  if(online)assert.deepEqual(calls.filter(p=>p.action==='patch').flatMap(p=>p.changes.map(c=>c.path.at(-1))),['mediaSeekStepMs','mediaSeekStepMs']);
});

test('automatic amplitude and session layout flags are never saved with an unrelated change',async()=>{
  const {config}=client(); await config.connect(snapshot({waveformScale:2,hoverDetails:false}),null);
  const prefs=config.createPreferences(key,v=>({waveformScale:1,hoverDetails:false,layoutEditing:false,...v}),[],['layoutEditing']);
  prefs.value.waveformScale=7;prefs.observe(['waveformScale']);
  prefs.value.layoutEditing=true;prefs.value.hoverDetails=true;prefs.save();
  assert.deepEqual(JSON.parse(config.storage.getItem(key)),{waveformScale:2,hoverDetails:true});
});
