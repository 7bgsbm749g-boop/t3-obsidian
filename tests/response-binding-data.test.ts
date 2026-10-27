import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {compactResponseBinding,loadResponseBindingData,mergeResponseBindingData,updateResponseBindingData,responseBindingRequests} from '../response-binding-data';
import type {ResponseRequest} from '../response-model';
import {selectionAnchor} from '../inline-thread';

const request=():ResponseRequest=>({version:4,localOnly:true,nativeProjection:true,responseContainer:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:'vault',notePath:'A.md',host:{environmentId:'env',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},threadId:randomUUID(),messageId:randomUUID(),projectId:randomUUID(),threadEnvironmentId:'env',initialHash:'0'.repeat(64),createdAt:'2026-10-15T00:00:00Z'});
test('multiple steering source anchors and their originating response survive settings recovery',()=>{
  const a=request(),source='One steer. Two steer.',selections=[selectionAnchor(source,'One steer.',0,10),selectionAnchor(source,'Two steer.',11,21)];
  a.localSteering=[{messageId:randomUUID(),text:source,before:[],selections,sourceResponseId:a.id}];
  const saved=loadResponseBindingData(JSON.parse(JSON.stringify(updateResponseBindingData({},a,'A',1))));
  assert.deepEqual(saved[a.id].request.localSteering,a.localSteering);
});
test('independent settings records merge in either arrival order and survive stale whole-file replacement',()=>{
  const a=request(),b=request(),left=updateResponseBindingData({},a,'A',1),right=updateResponseBindingData({},b,'B',1);
  const merged=mergeResponseBindingData(left,right);assert.deepEqual(merged,mergeResponseBindingData(right,left));assert.equal(Object.keys(merged).length,2);
  assert.deepEqual(mergeResponseBindingData(merged,right),merged);assert.equal(responseBindingRequests(merged),responseBindingRequests(merged));
});
test('record changes have monotonic revisions and deterministic concurrent selection',()=>{
  const a=request(),base=updateResponseBindingData({},a,'A',10),same=updateResponseBindingData(base,a,'A',10);assert.equal(same,base);
  const left=updateResponseBindingData(base,{...a,threadTitle:'Left'},'A',0),right=updateResponseBindingData(base,{...a,threadTitle:'Right'},'B',0);
  assert.equal(left[a.id].clock,11);assert.deepEqual(mergeResponseBindingData(left,right),mergeResponseBindingData(right,left));assert.equal(mergeResponseBindingData(left,right)[a.id].request.threadTitle,'Right');
});
test('shared records exclude stream checkpoints, generated prose and unrecognised fields',()=>{
  const a=request();a.localResume={incoming:[{messageId:randomUUID(),text:'input',before:[{id:'a',role:'assistant',turnId:'turn',streaming:false,text:'PRIVATE STREAM'}]}]};
  a.localSteering=[{messageId:randomUUID(),text:'User steering',before:[{id:'b',role:'assistant',turnId:'turn',streaming:false,text:'PRIVATE STREAM'}]}];
  const compact=compactResponseBinding({...a,body:'PRIVATE FINAL',credential:'SECRET'} as any);
  assert.equal(compact.localResume,undefined);assert.equal(compact.localSteering![0].text,'User steering');assert.deepEqual(compact.localSteering![0].before,[]);
  assert.doesNotMatch(JSON.stringify(compact),/PRIVATE|SECRET|credential/);
});
test('invalid settings entries cannot route a response',()=>{
  const a=request(),valid=updateResponseBindingData({},a,'A',1);
  assert.equal(Object.keys(loadResponseBindingData(valid)).length,1);
  for(const value of [{...valid[a.id],clock:-1},{...valid[a.id],request:{...a,localOnly:false}},{...valid[a.id],request:{...a,notePath:'../Outside.md'}}])assert.deepEqual(loadResponseBindingData({[a.id]:value}),{});
  assert.deepEqual(loadResponseBindingData({[randomUUID()]:valid[a.id]}),{});
});
