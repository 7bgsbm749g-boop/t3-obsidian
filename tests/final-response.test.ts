import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkFinalResponse,finalResponseKey} from '../src/responses/final-response';
import type {InlineThreadState} from '../src/conversations/inline-thread';
import {t3Api} from '../src/connection/t3-api';
import {settingsSocket} from './rpc-fixture';

const at='2026-10-11T12:00:00.000Z';
function state():InlineThreadState{return {protocolVersion:2,sequence:5,activities:[],turns:{run:{turnId:'run',state:'completed',completedAt:at,assistantMessageId:'answer'}},messages:[{id:'answer',itemId:'opaque-item',role:'assistant',turnId:'run',streaming:false,text:'Final reply',updatedAt:at}]};}
function item(){return {id:'opaque-item',threadId:'thread',runId:'run',messageId:'answer',type:'assistant_message',status:'completed',streaming:false,text:'Final reply',updatedAt:at};}
test('final verification requests only the exact item and does not depend on unrelated sequence advances',async()=>{
 const current=state(),calls:any[]=[];
 const checked=await checkFinalResponse({origin:'',api:async(path,payload)=>{calls.push({path,payload});return item();}},'thread',current,'run');
 assert.equal(checked.verified,true);assert.deepEqual(calls,[{path:'/api/orchestration/turn-item',payload:{threadId:'thread',itemId:'opaque-item',revision:at}}]);
 assert.equal(finalResponseKey(current,'run'),finalResponseKey({...current,sequence:500},'run'));
});
test('a ready session, a streaming reply and a different run cannot prove completion',async()=>{
 for(const change of ['running','streaming','missing-item'] as const){const current=state();if(change==='running')current.turns!.run.state='running';if(change==='streaming')current.messages[0].streaming=true;if(change==='missing-item')delete current.messages[0].itemId;current.session={status:'ready',activeTurnId:null};
 const checked=await checkFinalResponse({origin:'',api:async()=>{assert.fail('Cannot read without exact completion evidence');}},'thread',current,'run');assert.equal(checked.verified,false);}
 for(const override of [{runId:'another-run'},{threadId:'another-thread'},{messageId:'another-message'},{id:'another-item'},{status:'running'},{streaming:true},{updatedAt:'2026-10-10T12:00:00.000Z'}])await assert.rejects(checkFinalResponse({origin:'',api:async()=>({...item(),...override})},'thread',state(),'run'));
});
test('different authoritative final text corrects only that message and is ready to save after one read',async()=>{
 const current=state();current.messages.push({id:'other',role:'assistant',turnId:'other-run',text:'Keep me',streaming:false});
 const access={origin:'',api:async()=>({...item(),text:'Canonical final reply'})};
 const changed=await checkFinalResponse(access,'thread',current,'run');assert.equal(changed.verified,true);assert.equal(changed.state.messages[0].text,'Canonical final reply');assert.equal(changed.state.messages[1].text,'Keep me');assert.equal(current.messages[0].text,'Final reply');
 assert.equal((await checkFinalResponse(access,'thread',changed.state,'run')).verified,true);
});
test('completion handles the real RPC item envelope from authentication through final comparison',async()=>{
 const calls:any[]=[],Socket=settingsSocket(undefined,undefined,(tag,payload)=>{calls.push({tag,payload});return {item:item()};});
 const api=t3Api(async path=>{assert.equal(path,'/api/auth/websocket-ticket');return {ticket:'ticket'};},'https://fixture',url=>new Socket(url) as any);
 const checked=await checkFinalResponse({origin:'https://fixture',api},'thread',state(),'run');assert.equal(checked.verified,true);assert.equal(calls[0].tag,'orchestration.getTurnItem');assert.equal(calls[0].payload.itemId,'opaque-item');
});

function historical():InlineThreadState{
 const current=state();delete current.turns!.run.completedAt;current.turns!.run.messageId='root';
 current.historyComplete=true;current.latestTurn={turnId:'next',state:'completed',messageId:'next-root',requestedAt:'2026-10-11T13:00:00.000Z'};
 current.messages=[{id:'root',role:'user',turnId:'run',text:'Exact source prompt',streaming:false,createdAt:'2026-10-11T11:00:00.000Z'},{...current.messages[0],createdAt:at},{id:'next-root',role:'user',turnId:'next',text:'Later prompt',streaming:false,createdAt:current.latestTurn.requestedAt}];
 return current;
}
test('an explicit historical import can verify a closed canonical boundary without inventing a run timestamp',async()=>{
 const current=historical(),calls:unknown[]=[],access={origin:'',api:async(_path:string,payload?:unknown)=>{calls.push(payload);return item();}};
 assert.equal(finalResponseKey(current,'run'),undefined,'live completion keeps the persisted timestamp requirement');
 assert.equal((await checkFinalResponse(access,'thread',current,'run')).verified,false);assert.equal(calls.length,0);
 assert.ok(finalResponseKey(current,'run',{historicalImport:true}));
 assert.equal((await checkFinalResponse(access,'thread',current,'run',{historicalImport:true})).verified,true);assert.equal(calls.length,1);assert.equal(current.turns!.run.completedAt,undefined);
});
test('partial, unbound, active, late and failed history cannot authorize a historical import save',async()=>{
 const changes:Array<(current:InlineThreadState)=>void>=[
  current=>{current.historyComplete=false;},current=>{current.latestTurn=undefined;},
  current=>{current.messages=current.messages.filter(m=>m.id!=='root');},current=>{current.messages=current.messages.filter(m=>m.id!=='next-root');},
  current=>{current.session={status:'running',activeTurnId:'run'};},current=>{current.messages[1].streaming=true;},
  current=>{current.messages[1].createdAt=current.latestTurn!.requestedAt;},current=>{current.messages[1].updatedAt=undefined;},
  current=>{current.activities=[{id:'error',kind:'runtime.error',summary:'Failure',turnId:'run',createdAt:'2026-10-11T12:30:00.000Z'}];},
 ];
 for(const change of changes){const current=historical();change(current);assert.equal(finalResponseKey(current,'run',{historicalImport:true}),undefined);}
 await assert.rejects(checkFinalResponse({origin:'',api:async()=>({...item(),runId:'unrelated'})},'thread',historical(),'run',{historicalImport:true}));
});
