import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeSharedSettingsExcept} from '../src/storage/shared-settings';
test('preference merging does not serialize relation stores with independent merge protocols',()=>{
 const history={toJSON(){assert.fail('Large history must not be serialized by preference merging');}};
 const merged=mergeSharedSettingsExcept({theme:'old',smartSend:history},{theme:'remote',smartSend:history},{theme:'old',smartSend:history},['smartSend']);
 assert.equal(merged.theme,'remote');assert.equal(merged.smartSend,history);
});
test('preference exclusions preserve remote deletion during an unrelated local edit',()=>{
 const history={toJSON(){assert.fail('Excluded history must not be serialized');}};
 const merged=mergeSharedSettingsExcept<{theme:string;option?:boolean;smartSend:typeof history}>({theme:'old',option:true,smartSend:history},{theme:'old',smartSend:history},{theme:'new',option:true,smartSend:history},['smartSend']);
 assert.equal(merged.theme,'new');assert.equal(Object.hasOwn(merged,'option'),false);assert.equal(merged.smartSend,history);
});
test('preference exclusions preserve intended deletion while adopting a remote edit',()=>{
 const merged=mergeSharedSettingsExcept<{theme:string;option?:boolean;smartSend?:object}>({theme:'old',option:true},{theme:'remote',option:true,smartSend:{}},{theme:'old'},['smartSend']);
 assert.deepEqual(merged,{theme:'remote'});
});
