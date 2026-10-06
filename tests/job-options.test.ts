import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveJobOptions,overrideCount} from '../job-options';
test('explicit false wins and legacy retention normalizes only new resolved jobs',()=>{
  const defaults={enabled:true,keepIntermediate:true};
  assert.deepEqual(resolveJobOptions(defaults,{inline:{enabled:false}}),{version:1,inline:{enabled:false,intermediateMode:'collapse',finalAnswerFormat:'formatted'}});
  assert.equal(overrideCount({inline:{enabled:false,intermediateMode:undefined}}),1);
  assert.deepEqual(defaults,{enabled:true,keepIntermediate:true});
});

for(const mode of ['remove','keep','collapse'] as const)test(`new jobs use the progress box despite saved ${mode} preferences and overrides`,()=>{
  assert.equal(resolveJobOptions({enabled:true,intermediateMode:mode},{inline:{intermediateMode:mode}}).inline.intermediateMode,'collapse');
  assert.equal(overrideCount({inline:{intermediateMode:mode}}),0);
});
