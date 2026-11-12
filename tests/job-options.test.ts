import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveJobOptions,overrideCount} from '../src/conversations/job-options';
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

test('model overrides are copied per send without changing output defaults',()=>{
 const draft={modelSelection:{instanceId:'provider',model:'chosen',options:[{id:'reasoningEffort',value:'high'}]}};
 const result=resolveJobOptions({enabled:true},draft);
 assert.deepEqual(result.modelSelection,draft.modelSelection);result.modelSelection!.options![0].value='low';
 assert.equal(draft.modelSelection.options[0].value,'high');
 assert.equal(result.inline.enabled,true);assert.equal(resolveJobOptions({enabled:true}).modelSelection,undefined);
});
