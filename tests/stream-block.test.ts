import {test} from 'node:test';
import assert from 'node:assert/strict';
import {streamBlocks,streamBlock,removeStreamBlock,streamBlockCacheStatus} from '../stream-block';
import {initialRegion} from '../inline-thread';
import {contentHash} from '../completion';
import {validateResponseCommand} from '../response-command';
import {historyFixture,interruptedHistoryFixture} from './fixtures/stream-history';
test('saved interrupted history can close with its existing active fold identity',()=>{
  for(const title of ['New thread','A *marked* title · Interrupted','Title with \\ slashes']){
    const {body,key}=interruptedHistoryFixture(title),note='Before\n\n'+body+'\n\nAfter';
    assert.ok(key.endsWith(':active'));assert.equal(streamBlock(note,key)?.complete,true);
    assert.equal(streamBlock(note,key)?.tracked,false);
    const removed=removeStreamBlock(note,key,contentHash(streamBlock(note,key)!.text));
    assert.equal(removed.text,note.slice(0,removed.from)+note.slice(removed.to));
    assert.ok(removed.text.startsWith('Before\n\n'));assert.ok(removed.text.endsWith('\n\nAfter'));
    assert.ok(!removed.text.includes('Retained interrupted output.'));
  }
});
test('interrupted previews, duplicate identities and stale interrupted blocks stay protected',()=>{
  const {body,key}=interruptedHistoryFixture(),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const tracked=initialRegion(id).text.replace(/\*\*T3 · Working\*\*[\s\S]*?(?=<!-- t3-inline:end:)/,body);
  assert.equal(streamBlock(tracked,key)?.tracked,true);assert.throws(()=>removeStreamBlock(tracked,key),/changed/);
  assert.equal(streamBlock(body+'\n\n'+body,key),undefined);assert.throws(()=>removeStreamBlock(body+'\n\n'+body,key),/changed/);
  assert.throws(()=>removeStreamBlock(body,key,'0'.repeat(64)),/changed/);
  // A title or progress paragraph mentioning Interrupted is not terminal.
  const active=body.replace(' · Interrupted**',' · Working**').replace('Retained interrupted output.',' · Interrupted**');
  assert.equal(streamBlock(active,key)?.complete,false);assert.throws(()=>removeStreamBlock(active,key),/changed/);
});
test('exact Markdown history removal keeps the final answer and surrounding note bytes',()=>{
  const {body,key}=historyFixture(),note='Before\n\n'+body+'\n\nAfter';
  const block=streamBlock(note,key)!;assert.ok(block.complete);assert.ok(block.text.includes('Checking.'));assert.ok(!block.text.includes('Final answer stays.'));
  const removed=removeStreamBlock(note,key,contentHash(block.text));
  assert.equal(removed.text,note.slice(0,removed.from)+note.slice(removed.to));
  assert.ok(removed.text.includes('Final answer stays.'));assert.ok(removed.text.startsWith('Before\n\n'));assert.ok(removed.text.endsWith('\n\nAfter'));assert.ok(!removed.text.includes('Checking.'));
});
test('terminal preview, active output, duplicates and stale click checksums cannot be removed',()=>{
  const {body,key}=historyFixture(),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const tracked=initialRegion(id).text.replace(/\*\*T3 · Working\*\*[\s\S]*?(?=<!-- t3-inline:end:)/,body);
  assert.equal(streamBlock(tracked,key)?.tracked,true);assert.throws(()=>removeStreamBlock(tracked,key),/changed/);
  const active=historyFixture(true);assert.equal(streamBlock(active.body,active.key)?.complete,false);assert.throws(()=>removeStreamBlock(active.body,active.key),/changed/);
  assert.equal(streamBlock(body+'\n\n'+body,key),undefined);assert.throws(()=>removeStreamBlock(body+'\n\n'+body,key),/changed/);
  assert.throws(()=>removeStreamBlock(body,key,'0'.repeat(64)),/changed/);
});
test('fenced and nested history examples do not create a removable block',()=>{
  const {body}=historyFixture();assert.equal(streamBlocks('```md\n'+body+'\n```').length,0);
  assert.equal(streamBlocks('> [!note] Example\n'+body.split('\n').map(line=>'> '+line).join('\n')).length,0);
});
test('tracking marker examples in code do not mark a completed block as active',()=>{
  const {body,key}=historyFixture(),marker='<!-- t3-inline:start:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->';
  for(const example of ['```md\n'+marker+'\n```','`'+marker+'`']){
    const note=example+'\n\n'+body;
    assert.equal(streamBlock(note,key)?.tracked,false);
    assert.ok(removeStreamBlock(note,key).text.includes(example));
  }
});
test('close commands require a safe note, completed identity and reviewed block checksum',()=>{
  const {key,body}=historyFixture(),command={version:1,id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',kind:'close-stream-block',notePath:'Note.md',foldKey:key,hash:contentHash(streamBlock(body,key)!.text)};
  assert.deepEqual(validateResponseCommand(command),command);
  for(const change of [{notePath:'../Other.md'},{foldKey:key.replace(':complete',':active')},{hash:'bad'},{id:'bad'}])assert.throws(()=>validateResponseCommand({...command,...change}));
});

test('large notes retain their history index between repeated layout refreshes',()=>{
 const {body,key}=historyFixture(),note='A large ordinary paragraph '+ 'retained text '.repeat(160000)+'\n\n'+body;
 assert.ok(note.length>2_000_000);
 const first=streamBlock(note,key)!;assert.ok(first.complete);assert.ok(!first.tracked);
 const before=streamBlockCacheStatus();
 for(let i=0;i<30;i++)assert.deepEqual(streamBlock(note,key),first);
 const after=streamBlockCacheStatus();assert.equal(after.sourceParses,before.sourceParses);assert.equal(after.hits-before.hits,30);assert.ok(after.characters<=after.maxCharacters);
 assert.equal(streamBlock(note.replace(':complete',':active'),key),undefined);
});
