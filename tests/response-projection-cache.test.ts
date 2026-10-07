import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResponseProjectionCache} from '../response-projection-cache';
import {responseAnchor,savedProjection} from '../native-response-projection';
import {markdownCodeCacheStatus} from '../reply-html';

const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const saved='Ordinary before\n'+responseAnchor(id)+'\nBetween\n'+responseAnchor(other)+'\nOrdinary after';
test('exact repeated host projections avoid parsing and never share mutable ranges',()=>{
 const cache=new ResponseProjectionCache(),responses=[{id,body:'> Large reply '.repeat(10000)},{id:other,body:'> Independent'}];
 const first=cache.project('note',saved,responses),before=markdownCodeCacheStatus();first.ranges[0].anchor='Corrupted by caller';responses[0].body='> Changed caller body';
 const original=[{id,body:'> Large reply '.repeat(10000)},{id:other,body:'> Independent'}];
 for(let i=0;i<50;i++){const warm=cache.project('note',saved,original);assert.equal(warm.ranges[0].anchor,responseAnchor(id));assert.equal(warm.saved,saved);}
 const after=markdownCodeCacheStatus();assert.equal(after.sourceParses,before.sourceParses);assert.equal(after.hits,before.hits);assert.equal(cache.status().projections,1);assert.equal(cache.status().hits,50);
 const changed=cache.project('note',saved.replace('Between','New ordinary text'),responses);assert.ok(changed.display.includes('New ordinary text'));assert.ok(changed.display.includes('Changed caller body'));assert.equal(savedProjection(changed.display,changed),saved.replace('Between','New ordinary text'));
});
test('changed or damaged boundaries and nested output cannot reuse a valid host snapshot',()=>{
 const cache=new ResponseProjectionCache(),responses=[{id,body:'> Reply'}];cache.project('note',saved,responses);
 assert.throws(()=>cache.project('note',saved.replace(`<!-- t3-inline:end:${id} -->`,''),responses),/boundaries/);
 assert.throws(()=>cache.project('note',saved,[{id,body:responseAnchor(other)}]),/Nested/);
 const changed=saved.replace('Ordinary after','New suffix');assert.equal(cache.project('note',changed,responses).saved,changed);
});
test('host projection entry and character budgets discard old snapshots and clear on shutdown',()=>{
 const cache=new ResponseProjectionCache(1000,2),responses=[{id,body:'> Reply'}],document=responseAnchor(id);
 cache.project('one',document,responses);cache.project('two',document,responses);cache.project('three',document,responses);assert.equal(cache.status().entries,2);assert.ok(cache.status().characters<=1000);
 const before=cache.status().projections;cache.project('one',document,responses);assert.equal(cache.status().projections,before+1);
 cache.project('huge',document+'x'.repeat(1000),responses);assert.ok(cache.status().characters<=1000);assert.ok(cache.status().entries<=2);
 const byteBound=new ResponseProjectionCache(500,8);byteBound.project('one',document,responses);byteBound.project('two',document,responses);assert.equal(byteBound.status().entries,1);assert.ok(byteBound.status().characters<=500);
 cache.clear();assert.equal(cache.status().entries,0);assert.equal(cache.status().characters,0);
});
