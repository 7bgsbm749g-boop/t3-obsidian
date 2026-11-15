import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {savedResponseProof} from '../src/responses/saved-response-proof';
import {contentHash} from '../src/responses/completion';
import {loadSmartSend,rememberResponse} from '../src/notes/smart-send';
import {completeResponseBinding,updateResponseBindingData} from '../src/responses/response-binding-data';
import {responseAnchor} from '../src/responses/native-response-projection';
import type {ResponseRequest} from '../src/responses/response-model';

async function fixture(){
 const request:ResponseRequest={version:4,localOnly:true,id:randomUUID(),vaultId:'synthetic',initialOwner:randomUUID(),notePath:'Test.md',threadId:randomUUID(),messageId:randomUUID(),projectId:randomUUID(),threadEnvironmentId:'env',host:{environmentId:'env',workspaceRoot:'/synthetic',directory:'.responses'},initialHash:contentHash(''),createdAt:'2026-11-12T00:00:00Z'};
 const body='A complete synthetic saved response.\n',document='Edited prefix\n'+body+'Later user content',data=loadSmartSend(undefined);
 await rememberResponse(data,request.notePath,request.id,body,'Original prefix\n','',16);
 const bindings=completeResponseBinding(updateResponseBindingData({},request,'test'),request,'exact-turn',contentHash(body),'peer');
 return {request,body,document,data,bindings,proof:()=>savedResponseProof(request,document,bindings,data)};
}
test('exact peer receipt and unique saved bytes prove completion with compatible surrounding edits',async()=>{
 const h=await fixture();assert.equal(await h.proof(),true);
});
test('a completion hint or remembered preparation alone cannot prove a local save',async()=>{
 const h=await fixture();assert.equal(await savedResponseProof(h.request,'Only user text',h.bindings,h.data),false);
 delete h.bindings[h.request.id].completion;assert.equal(await h.proof(),false);
});
test('identity, route, live anchor, duplicate output, and deleted note identities refuse proof',async()=>{
 for(const fault of ['identity','route','anchor','duplicate','deleted','missing-body','wrong-hash','staged-edit'] as const){
  const h=await fixture();
  if(fault==='staged-edit')h.request.localStage={originalHash:contentHash('old'),stagedHash:contentHash('new')};
  if(fault==='identity')h.bindings[h.request.id].completion!.identity='0'.repeat(64);
  if(fault==='route')h.bindings[h.request.id].request={...h.request,notePath:'Other.md'};
  if(fault==='anchor')h.document+=responseAnchor(h.request.id);
  if(fault==='duplicate')h.document+=h.body;
  if(fault==='deleted')Object.values(h.data.notes)[0].deleted=true;
  if(fault==='missing-body')delete h.data.bodies[contentHash(h.body)];
  if(fault==='wrong-hash')h.data.responses[`${h.request.id}:${contentHash(h.body)}`].body='0'.repeat(64);
  assert.equal(await savedResponseProof(h.request,h.document,h.bindings,h.data),false,fault);
 }
});

test('corrupt text and gzip bodies refuse proof without throwing or accepting unverified bytes',async()=>{
 for(const encoding of ['text','gzip'] as const){
  const h=await fixture(),hash=contentHash('Uncached valid body '+randomUUID()),old=h.data.responses[`${h.request.id}:${contentHash(h.body)}`];
  h.bindings[h.request.id].completion!.outputHash=hash;h.data.responses[`${h.request.id}:${hash}`]={...old,body:hash};h.data.bodies[hash]={hash,encoding,data:encoding==='text'?'Corrupt body':Buffer.from('Invalid gzip').toString('base64')};
  assert.equal(await savedResponseProof(h.request,h.document,h.bindings,h.data),false);
 }
});
