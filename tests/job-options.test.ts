import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveJobOptions,overrideCount} from '../job-options';
test('explicit false wins and legacy retention normalizes only new resolved jobs',()=>{
  const defaults={enabled:true,keepIntermediate:true};
  assert.deepEqual(resolveJobOptions(defaults,{inline:{enabled:false}}),{version:1,inline:{enabled:false,intermediateMode:'keep',finalAnswerFormat:'formatted'}});
  assert.equal(overrideCount({inline:{enabled:false,intermediateMode:undefined}}),1);
  assert.deepEqual(defaults,{enabled:true,keepIntermediate:true});
});
