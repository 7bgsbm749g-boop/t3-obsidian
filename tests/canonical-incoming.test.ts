import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,renderInlineTurn,type InlineThreadState,type InlineMessage} from '../src/conversations/inline-thread';
import {observeIncoming,incomingLabel,steeringSegments,type InlineSteering} from '../src/conversations/inline-steering';
const at=(n:number)=>`2026-10-02T20:00:${String(n).padStart(2,'0')}.000Z`;
const assistant=(text:string):InlineMessage=>({id:'answer',role:'assistant',text,turnId:'turn',streaming:true,createdAt:at(0)});
const sender={version:1,records:[{version:1,kind:'fleet-sender',contextId:'fleet-sender-v1',label:'Ignored label',payload:{version:1,kind:'agent',environmentId:'3630e7fa-f1df-4631-b5a2-6086ddaf28a1',threadId:'2801be1c-a9f2-5106-bf29-242a97eee8fe',title:'Source agent'}}]};
const state=():InlineThreadState=>({messages:[assistant('First.\n\nPartial')],activities:[],session:{status:'running',activeTurnId:'turn'},latestTurn:{turnId:'turn',state:'running',messageId:'primary',requestedAt:at(0)}});
const event=(s:InlineThreadState,n:number,type:string,payload:any)=>applyThreadItem(s,{kind:'event',event:{sequence:n,type,payload}}).state;

test('external steer captures live paragraph boundary, structured context and exact binding through reload',()=>{
 let s=state();s=event(s,1,'thread.turn-start-requested',{messageId:'external',createdAt:at(10)});
 s=event(s,2,'thread.message-sent',{messageId:'external',role:'user',text:'Change direction',streaming:false,createdAt:at(10),context:sender});
 assert.deepEqual(s.messages.at(-1)?.context,sender);
 // Display the confirmed input immediately without inventing an execution binding.
 assert.equal(s.bindings?.external,undefined);assert.equal(observeIncoming(s,['turn']).length,1);
 s=event(s,3,'thread.message-sent',{messageId:'answer',role:'assistant',text:' finished.\n\nFinal.',streaming:true,turnId:'turn',createdAt:at(11)});
 let incoming=observeIncoming(s,['turn']);assert.equal(incoming[0].label,'Agent · Source agent');assert.equal(incoming[0].position,'live');
 assert.equal(incoming[0].before[0].text,'First.\n\n');
 const checkpoint=JSON.parse(JSON.stringify(inlineBindingCheckpoint(s)));
 const snapshot=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:s}}).state;
 s=restoreInlineBindings(snapshot,checkpoint);incoming=observeIncoming(s,['turn'],JSON.parse(JSON.stringify(incoming)));
 incoming=observeIncoming(event(s,3,'thread.message-sent',{messageId:'external',role:'user',text:'Change direction'}),['turn'],incoming);
 assert.equal(incoming.length,1);assert.equal(incoming[0].before[0].text,'First.\n\n');
 assert.deepEqual(steeringSegments([assistant('First.\n\nPartial finished.\n\nFinal.')],incoming).map(x=>x.text.trim()),['First.','Change direction','Partial finished.\n\nFinal.']);
 assert.doesNotMatch(renderInlineTurn(s,'turn','thread','running',true,undefined,{messages:s.messages.filter(m=>m.role==='assistant'),steering:incoming}),/Recovered/);
});

test('recovered inputs show only their sender label and exclude unrelated later turns',()=>{
 const s=state();s.messages.push({id:'native',role:'user',turnId:'turn',text:'Native T3 input',streaming:false,createdAt:at(10)},{id:'other',role:'user',turnId:'later',text:'Unrelated input',streaming:false});
 const incoming=observeIncoming(s,['turn'],[],[],['primary']);assert.equal(incoming.length,1);assert.equal(incoming[0].label,'User');assert.equal(incoming[0].position,'recovered');
 const rendered=renderInlineTurn(s,'turn','thread','complete',true,undefined,{messages:[assistant('First.')],steering:incoming});
 assert.match(rendered,/\[!t3-steering\] User\n/);assert.doesNotMatch(rendered,/Recovered|approximate/);
 assert.equal(observeIncoming({...s,bindings:{native:{turnId:'later',kind:'explicit'}},messages:s.messages.map(m=>m.id==='native'?{...m,turnId:'later'}:m)},['turn'],incoming).length,0);
});

test('local receipt supplies only selection bookkeeping and verified display fragment; canonical differences win',()=>{
 const local:InlineSteering={messageId:'local',text:'Selected question',before:[assistant('First.')],selection:{text:'Selected question',start:0,end:17,before:'',after:''}};
 const s=state();s.messages.push({id:'local',role:'user',text:'Selected question\n\nObsidian delivery instructions',turnId:'turn',streaming:false});
 const incoming=observeIncoming(s,['turn'],[],[local]);assert.equal(incoming[0].text,'Selected question');assert.equal(incoming[0].label,'You');assert.equal(incoming[0].selection,undefined);
 assert.equal(local.confirmed,undefined);assert.equal(local.text,'Selected question');
 s.messages.at(-1)!.text='Actual canonical text';assert.equal(observeIncoming(s,['turn'],incoming,[local])[0].text,'Actual canonical text');
});

test('canonical agent authors without a sender thread stay Agent while human and unknown authors stay neutral',()=>{
 const message:InlineMessage={id:'input',role:'user',text:'Delegated task completed',turnId:'turn',streaming:false};
 for(const creationSource of ['server','mcp']){
  assert.equal(incomingLabel({...message,createdBy:'agent',creationSource}),'Agent');
  assert.equal(incomingLabel({...message,createdBy:'agent',creationSource},true),'Agent');
 }
 assert.equal(incomingLabel({...message,createdBy:'agent',senderThreadId:'invalid'}),'Agent');
 assert.equal(incomingLabel({...message,createdBy:'agent',context:sender}),'Agent · Source agent');
 assert.equal(incomingLabel({...message,createdBy:'user',senderThreadId:sender.records[0].payload.threadId}),'User');
 assert.equal(incomingLabel(message),'User');assert.equal(incomingLabel(message,true),'You');
});

test('dated inputs from Obsidian, T3, agents and delegated tasks retain one fold across live updates and reload',()=>{
 const origins=[
  {createdBy:'user',creationSource:'web',local:true,label:'You'},
  {createdBy:'user',creationSource:'web',local:false,label:'User'},
  {createdBy:'agent',creationSource:'mcp',local:false,label:'Agent'},
  {createdBy:'agent',creationSource:'server',local:false,label:'Agent',delegatedCompletion:{parentRunId:'turn',generation:1,taskIds:['synthetic-task']}},
 ];
 const keys=(body:string)=>[...body.matchAll(/data-t3-fold="([^"]+)"/g)].map(match=>match[1]);
 for(const origin of origins){
  let s=state();s.messages=[{...assistant('Before input.'),streaming:false}];
  const progress=s.messages[0],initial={messageId:'primary',text:'Original prompt'},timing={startedAt:at(0)};
  const render=(current:InlineThreadState,inputs:InlineSteering[]=[])=>renderInlineTurn(current,'turn','thread','running','collapse',undefined,{messages:current.messages.filter(m=>m.role==='assistant'),steering:inputs},initial,undefined,timing);
  const original=render(s);
  const reservation=origin.local?[{messageId:'input',text:'Change direction.',before:[progress]}]:[];
  s=event(s,1,'thread.message-sent',{messageId:'input',role:'user',turnId:'turn',text:'Change direction.',streaming:false,createdAt:at(10),createdBy:origin.createdBy,creationSource:origin.creationSource,...('delegatedCompletion' in origin?{delegatedCompletion:origin.delegatedCompletion}:{})});
  let inputs=observeIncoming(s,['turn'],[],reservation,['primary']);
  assert.equal(inputs[0].label,origin.label);
  const waiting=render(s,inputs);assert.deepEqual(keys(waiting),keys(original));
  s=event(s,2,'thread.message-sent',{messageId:'after',role:'assistant',turnId:'turn',text:'After input.',streaming:false,createdAt:at(11)});
  inputs=observeIncoming(s,['turn'],inputs,reservation,['primary']);
  const live=render(s,inputs);
  const checkpoint=JSON.parse(JSON.stringify(inlineBindingCheckpoint(s)));
  const restored=restoreInlineBindings(applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:JSON.parse(JSON.stringify(s))}}).state,checkpoint);
  const recovered=render(restored,observeIncoming(restored,['turn'],JSON.parse(JSON.stringify(inputs)),reservation,['primary']));
  for(const output of [waiting,live,recovered]){
   assert.equal((output.match(/^> \[!t3-progress\][+-]/gm)??[]).length,1);
   assert.deepEqual(keys(output),keys(original));
   assert.equal(output.match(/class="send-to-t3-run-timer"/g)?.length,1);
   assert.equal(output.split('Change direction.').length-1,1);
   assert.match(output,new RegExp(`\\[!t3-steering\\] ${origin.label}\\n`));
   assert.ok(output.indexOf('Original prompt')<output.indexOf('Before input.'));
   assert.ok(output.indexOf('Before input.')<output.indexOf('Change direction.'));
  }
  assert.ok(recovered.indexOf('Change direction.')<recovered.indexOf('After input.'));
 }
});

test('plain prose, invalid or conflicting sender records stay neutral; titles cannot inject callouts',()=>{
 const msg:InlineMessage={id:'native',role:'user',text:'Coordination from an agent',turnId:'turn',streaming:false};
 assert.equal(incomingLabel(msg),'User');assert.equal(incomingLabel({...msg,context:{version:1,records:[{...sender.records[0],payload:{kind:'agent',title:'Imposter'}}]}}),'User');
 assert.equal(incomingLabel({...msg,context:{version:1,records:[sender.records[0],sender.records[0]]}}),'User');
 const incoming=observeIncoming({...state(),messages:[{...msg,context:{...sender,records:[{...sender.records[0],payload:{...sender.records[0].payload,title:'Bad\n> [!danger]'}}]}}]},['turn']);
 const rendered=renderInlineTurn(state(),'turn','thread','running',true,undefined,{messages:[],steering:incoming});assert.doesNotMatch(rendered,/\n> \[!danger\]/);
 const native={...msg,createdBy:'agent',senderThreadId:sender.records[0].payload.threadId,senderThreadTitle:'Native\n> [!danger]',context:sender};
 assert.equal(incomingLabel(native),'Agent · Native\n> [!danger]');
 const nativeInput=observeIncoming({...state(),messages:[native]},['turn']);
 assert.doesNotMatch(renderInlineTurn(state(),'turn','thread','running',true,undefined,{messages:[],steering:nativeInput}),/\n> \[!danger\]/);
});

test('recovery requires a dated canonical lifecycle before associating an unbound input',()=>{
 const s=state();delete s.latestTurn!.requestedAt;
 s.messages.push({id:'unknown',role:'user',text:'Unbound input',turnId:null,createdAt:at(10),streaming:false});
 assert.equal(observeIncoming(s,['turn']).length,0);
});


test('installed detail feed omits starts but still displays canonical agent and neutral inputs without adopting turns',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/incoming-detail-events.json',import.meta.url),'utf8'));
 let s:InlineThreadState=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:fixture.initial}}).state;
 let incoming:InlineSteering[]=[];
 for(const e of fixture.events){
  assert.notEqual(e.type,'thread.turn-start-requested');
  s=event(s,e.sequence,e.type,e.payload);
  incoming=observeIncoming(s,[fixture.turnId],incoming,[],[fixture.primary]);
 }
 assert.equal(s.bindings?.[fixture.external],undefined,'display association is not an execution binding');
 assert.equal(s.bindings?.[fixture.neutral],undefined);
 assert.deepEqual(incoming.map(input=>input.messageId),[fixture.external,fixture.neutral,fixture.local]);
 assert.deepEqual(incoming.map(input=>input.label),['Agent · i love this','User','User']);
 assert.equal(incoming[0].before.length,1);assert.equal(incoming[0].before[0].text,'SMOKE_PROGRESS');
 const checkpoint=JSON.parse(JSON.stringify(inlineBindingCheckpoint(s)));
 const reloaded=restoreInlineBindings(applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:s}}).state,checkpoint);
 assert.equal(observeIncoming(reloaded,[fixture.turnId],incoming,[],[fixture.primary]).length,3);
 // With no witnessed boundary, recovery discloses an approximate position.
 delete reloaded.inputTurns;delete reloaded.inputBoundaries;
 const recovered=observeIncoming(reloaded,[fixture.turnId],[],[],[fixture.primary]);
 assert.equal(recovered.length,3);assert.equal(recovered[0].position,'recovered');
});
