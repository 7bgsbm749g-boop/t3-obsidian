import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timingSummaries} from '../codebase-performance';

test('performance summaries bound each operation and contain finite numeric data only',()=>{
  const input=Array.from({length:150},(_,i)=>({operation:'render',milliseconds:i}));
  input.push({operation:'reveal',milliseconds:2},{operation:'render',milliseconds:NaN},{operation:'/private/path',milliseconds:123},{operation:'render',milliseconds:-1});
  const report=timingSummaries(input,['render','reveal']);
  assert.deepEqual(report,{render:{samples:100,medianMs:99,p95Ms:144,maxMs:149},reveal:{samples:1,medianMs:2,p95Ms:2,maxMs:2}});
  assert.equal(JSON.stringify(report).includes('/private/path'),false);
  assert.deepEqual(timingSummaries([],['render']),{render:{samples:0,medianMs:0,p95Ms:0,maxMs:0}});
});
