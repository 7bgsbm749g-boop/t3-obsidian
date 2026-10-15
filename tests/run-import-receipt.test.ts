import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findRunImport,runImportReceipt} from '../run-import-receipt';
const source={threadId:'thread',projectId:'project',environmentId:'environment'};
const receipt={version:1 as const,...source,bindingId:'b4d892bf-5100-4521-b65f-1837e115d091',messageId:'prompt',runId:'run'};
test('an import receipt identifies the exact source after final text replacement, reload and note rename',()=>{
 const document='Saved reply\n'+runImportReceipt(receipt)+'\nLater user edit';
 assert.deepEqual(findRunImport(document,source,'prompt'),receipt);
 for(const key of ['threadId','projectId','environmentId'])assert.equal(findRunImport(document,{...source,[key]:'different'},'prompt'),undefined);
 assert.equal(findRunImport(document,source,'other-prompt'),undefined);
 assert.equal(findRunImport('Saved reply',source,'prompt'),undefined,'prose is not a duplicate identity');
});
test('malformed import comments cannot create a duplicate identity',()=>{
 for(const document of ['<!-- t3-run-import:%zz -->','<!-- t3-run-import:'+encodeURIComponent(JSON.stringify({...receipt,bindingId:'wrong'}))+' -->','<!-- t3-run-import:'+encodeURIComponent(JSON.stringify({...receipt,version:2}))+' -->'])assert.equal(findRunImport(document,source,'prompt'),undefined);
});
