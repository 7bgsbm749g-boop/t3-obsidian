import {test} from 'node:test';
import assert from 'node:assert/strict';
import {responseAnchor} from '../native-response-projection';
import {initialRegion} from '../inline-thread';
import type {ResponseRequest} from '../response-model';
import {contentHash} from '../completion';
import {coordinatedDeliveryLimitations} from '../coordinated-delivery-gates';
import {eventContent} from '../event-subscriptions';
import {historyFixture} from './fixtures/stream-history';
import {streamBlock} from '../stream-block';
import {nativeCommitMatches,readNativeCommitProof} from '../native-response-commit';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
function request(response=id,path='Arms.md'):ResponseRequest{return {version:2,id:response,initialOwner:id,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/test/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:path,threadId:'thread',messageId:id,projectId:'project',threadEnvironmentId:'host',initialHash:initialRegion(response).bodyHash,createdAt:'2026-10-02T20:00:00Z',independent:true};}
const staged=(text:string)=>text.replace('| Exercise | 20kg |','| Exercise | 20kg | 25kg |').replace('| --- | ---: |','| --- | ---: | ---: |').replace('| Barb | 20 |','| Barb | 20 | |');
test('delivery limitations describe the actual out-of-band boundary and waived platform coverage',()=>{
  assert.ok(coordinatedDeliveryLimitations.some(value=>value.includes('out-of-band')));assert.ok(coordinatedDeliveryLimitations.some(value=>value.includes('iPhone')));
});
