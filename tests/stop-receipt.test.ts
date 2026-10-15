import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {type ResponseStorageFiles,type ResponseRecord} from '../response-record';
import {initialRegion} from '../inline-thread';
import {responseRequestHash,type ResponseRequest} from '../response-model';
import {stoppedBodyReference,stoppedBodyPath,responseStopReceipt} from '../response-stop-receipt';
import {configureDiagnostics,EventJournal} from '../diagnostics';

test('a permanent final grant distinguishes completed run from pending note delivery',()=>{
  const id=randomUUID(),record={request:{id},epoch:1,revision:3,state:{status:'running',finalSaved:false},finalWriter:{phase:'complete'}} as ResponseRecord;
  assert.equal(responseStopReceipt(record).runTerminal,true);assert.equal(responseStopReceipt(record).finalSaved,false);
});
