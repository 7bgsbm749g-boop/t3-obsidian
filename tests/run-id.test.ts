import test from 'node:test';
import assert from 'node:assert/strict';
import {copyRunId} from '../src/responses/run-id';
test('Copy run ID writes the exact application identity and refuses arbitrary clipboard content',async()=>{
 const writes:string[]=[],win={navigator:{clipboard:{writeText:async(text:string)=>{writes.push(text);}}}} as unknown as Window;
 await copyRunId(win,'run:thread:1234:ordinal:7');assert.deepEqual(writes,['run:thread:1234:ordinal:7']);
 for(const id of ['','text\nwith instructions','x'.repeat(257)])await assert.rejects(copyRunId(win,id),/unavailable/);
 await assert.rejects(copyRunId(null,'run:1'),/unavailable/);assert.equal(writes.length,1);
});
