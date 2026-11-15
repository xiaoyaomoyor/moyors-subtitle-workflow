import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SubtitleGlyphDiagnostics} from '../web/subtitle-glyph-diagnostics.mjs';

const cases=JSON.parse(readFileSync(new URL('./fixtures/subtitle-glyph-diagnostics.json',import.meta.url)));
test('preview and export recognize only final missing-glyph failures',()=>{
  for(const {log,parts} of cases){
    const diagnostics=new SubtitleGlyphDiagnostics();diagnostics.record(log);
    const message=diagnostics.summary();assert.equal(!!message,!!parts.length);
    for(const part of parts)assert.ok(message.includes(part),message);
  }
});
test('preview diagnostics are bounded, deduplicated and reset after track/font changes',()=>{
  const diagnostics=new SubtitleGlyphDiagnostics(),warning=cases[3].log;
  for(let i=0;i<1000;i++)diagnostics.record(warning);
  assert.equal(diagnostics.entries.size,1);
  for(let i=100;i<200;i++)diagnostics.record(warning.replace('4E2D',i.toString(16)));
  assert.equal(diagnostics.entries.size,8);assert.match(diagnostics.summary(),/另有其他缺字/);
  diagnostics.reset();assert.equal(diagnostics.summary(),'');
  diagnostics.record(warning.replace('Arial','\u202eArial'));
  assert.ok(!diagnostics.summary().includes('\u202e'));
});
