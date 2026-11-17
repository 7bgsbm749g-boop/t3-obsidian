import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composerFeedback} from '../src/conversations/composer-feedback';

test('Codex feedback uses its upload API with the selected thread, not message dispatch',async()=>{
  const calls:{method:string;input:unknown}[]=[];
  const call=async(method:string,input:unknown)=>{calls.push({method,input});return method==='server.getConfig'?{providers:[{instanceId:'selected',driver:'codex'}]}:{feedbackId:'confirmed'};};
  assert.equal(await composerFeedback(call,'selected','thread','/feedback A test report'),'confirmed');
  assert.deepEqual(calls[1],{method:'provider.uploadFeedback',input:{threadId:'thread',reason:'A test report'}});
});
test('another provider does not upload feedback and an unconfirmed upload is not called success',async()=>{
  let uploads=0;
  const call=async(method:string)=>{if(method==='server.getConfig')return {providers:[{instanceId:'selected',driver:'claudeAgent'},{instanceId:'other',driver:'codex'}]};uploads++;return {};};
  assert.equal(await composerFeedback(call,'selected','thread','/feedback'),undefined);assert.equal(uploads,0);
  await assert.rejects(composerFeedback(async method=>method==='server.getConfig'?{providers:[{instanceId:'selected',driver:'codex'}]}:{},'selected','thread','/feedback'),/did not confirm/);
});
