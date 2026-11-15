import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeSharedSettingsExcept} from '../src/storage/shared-settings';
test('preference merging does not serialize relation stores with independent merge protocols',()=>{
 const history={toJSON(){assert.fail('Large history must not be serialized by preference merging');}};
 const merged=mergeSharedSettingsExcept({theme:'old',smartSend:history},{theme:'remote',smartSend:history},{theme:'old',smartSend:history},['smartSend']);
 assert.equal(merged.theme,'remote');assert.equal(merged.smartSend,history);
});
