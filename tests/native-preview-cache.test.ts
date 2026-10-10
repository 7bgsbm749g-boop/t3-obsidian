import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedNativePreview,loadNativePreviews,sameNativePreview,type NativePreviewEntry} from '../native-preview-cache';
import {responseAnchor} from '../native-response-projection';
import {markdownCodeRanges,markdownCodeCacheStatus} from '../reply-html';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const entry:NativePreviewEntry={id,vaultId:'vault',notePath:'Note.md',threadId:'thread',projectId:'project',threadEnvironmentId:'environment',messageId:'message',epoch:1,revision:2,sequence:3,body:'> Reply with `code`'};

test('preview equality notices every recovery identity, cursor and body change',()=>{
  assert.equal(sameNativePreview(entry,{...entry}),true);
  for(const key of Object.keys(entry) as Array<keyof NativePreviewEntry>){
    const changed={...entry,[key]:typeof entry[key]==='number'?(entry[key] as number)+1:entry[key]+' changed'};
    assert.equal(sameNativePreview(entry,changed),false,key);
  }
});

test('a trusted unchanged preview body survives Markdown cache eviction without a new parse',()=>{
  const previous=checkedNativePreview({...entry,body:'Unique preview '.repeat(500)+'`retained code`'},'vault');assert.ok(previous);
  for(let n=0;n<140;n++)markdownCodeRanges(`Unrelated cache entry ${n}`);
  const parses=markdownCodeCacheStatus().sourceParses;
  const next=checkedNativePreview({...previous,revision:previous.revision+1,sequence:previous.sequence+1},'vault',previous);
  assert.ok(next);assert.equal(next.body,previous.body);assert.equal(next.revision,previous.revision+1);assert.equal(markdownCodeCacheStatus().sourceParses,parses);
  for(const change of [{notePath:'../unsafe.md'},{vaultId:'different'},{revision:-1},{sequence:1.5},{messageId:''}])assert.equal(checkedNativePreview({...next,...change},'vault',previous),undefined);
});

test('changed bodies and persisted previews always receive full boundary validation',()=>{
  const previous=checkedNativePreview(entry,'vault');assert.ok(previous);
  const nested={...entry,body:'New reply\n'+responseAnchor(other)};
  assert.equal(checkedNativePreview(nested,'vault',previous),undefined);
  const changed=checkedNativePreview({...entry,body:'> New checked reply'},'vault',previous);assert.equal(changed?.body,'> New checked reply');
  assert.deepEqual(loadNativePreviews({version:1,vaultId:'vault',entries:[nested]},'vault'),[]);
  const loaded=loadNativePreviews({version:1,vaultId:'vault',entries:[{...changed,unknown:'ignored'}]},'vault');assert.deepEqual(loaded,[changed]);
});
