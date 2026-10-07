import {responseActivityRow} from '../response-activity';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {HostedInlineWriter,handoffInline,hostedPaths,hostedRequestHash,validateHostedRequest,type HostedInlineRequest,type HostedInlineState,type HostedWriterIO} from '../hosted-inline';
import {initialRegion,regionBody,completionProof} from '../inline-thread';
import {contentHash} from '../completion';
import {commandId} from '../direct';
import {QuestionController} from '../question-controller';
import type {InlineThreadState} from '../inline-thread';

function harness(input?:string){
  const id=randomUUID(),initialInput=input?{messageId:commandId(id,'message'),text:input}:undefined,initial=initialRegion(id,initialInput),host={environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'};
  const request:HostedInlineRequest={version:1,...(initialInput?{initialInput}:{}),id,vaultId:'vault',host,notePath:'Notes/test.md',threadId:randomUUID(),messageId:commandId(id,'message'),projectId:'project',threadEnvironmentId:'thread-machine',initialHash:initial.bodyHash,createdAt:new Date().toISOString()};
  const paths=hostedPaths(host.directory,id),files=new Map<string,string>([[paths.request,JSON.stringify(request)]]);
  let document:string|undefined='User introduction\n'+initial.text+'User tail',answer='Progress A',phase='running',dispatched=false,unsaved=false,crashAfterEdit=false,failState=false,accessible=true;
  const calls:any[]=[];
  const snapshot=()=>({thread:{id:request.threadId,projectId:request.projectId,messages:[{id:request.messageId,role:'user',text:'Question',streaming:false,createdAt:request.createdAt},{id:'answer',role:'assistant',text:answer,streaming:phase==='running',turnId:'turn'}],activities:[],latestTurn:{turnId:'turn',state:phase,requestedAt:request.createdAt,assistantMessageId:'answer'},session:{status:phase==='running'?'running':'ready',activeTurnId:phase==='running'?'turn':null}}});
  const io:HostedWriterIO={read:async path=>files.get(path),write:async(path,bytes)=>{if(failState)throw Error('disk unavailable');files.set(path,bytes);},requests:async()=>[paths.request],
    access:async environmentId=>{calls.push({access:environmentId});if(!accessible)throw Error('Host is not paired');return {origin:'https://t3.example',api:async(path,payload)=>{if(payload){calls.push(payload);return {};}if(!dispatched)throw Error('Thread is not dispatched yet');return snapshot();}};},
    updateNote:async(path,change)=>{assert.equal(path,request.notePath);if(document===undefined||unsaved)return undefined;const before=document;document=change(document);if(crashAfterEdit&&before!==document){failState=true;throw Error('simulated crash after note edit');}return document;},
  };
  const create=()=>new HostedInlineWriter({vaultId:request.vaultId,...host},io);
  return {request,paths,files,io,create,calls,get document(){return document!;},set document(value:string){document=value;},get state():HostedInlineState{return JSON.parse(files.get(paths.state)!);},
    dispatch:()=>{dispatched=true;},answer:(text:string,complete=false)=>{answer=text;phase=complete?'completed':'running';},missing:()=>{document=undefined;},unsaved:(value:boolean)=>{unsaved=value;},access:(value:boolean)=>{accessible=value;},crash:(value:boolean)=>{crashAfterEdit=value;if(!value)failState=false;}};
}

test('an explicit Stop bypasses the paused-boundary retry wait',async()=>{
 const h=harness();let clock=0,reads=0;
 h.io.monotonic=()=>clock;
 h.files.set(h.paths.state,JSON.stringify({requestHash:hostedRequestHash(h.request),accepted:false,notePath:h.request.notePath,status:'paused',hashes:[h.request.initialHash],updatedAt:''}));
 h.document='Ordinary text only';const update=h.io.updateNote;
 h.io.updateNote=async(...args)=>{reads++;return update(...args);};
 const writer=h.create();await writer.tick();const before=h.document,saved=h.files.get(h.paths.state);
 for(let i=0;i<20;i++)await writer.tick();
 assert.equal(reads,1);assert.equal(h.files.get(h.paths.state),saved);assert.equal(h.document,before);
 writer.requestStop(h.request.id);await writer.tick();assert.ok(reads>1,'explicit Stop must not wait for background retry');assert.equal(h.document,before);writer.stop();
});

test('a paused missing response can recover when its exact boundaries return',async()=>{
 const h=harness();let clock=0,reads=0;
 h.io.monotonic=()=>clock;h.dispatch();h.answer('Restored exact answer',true);
 h.files.set(h.paths.state,JSON.stringify({requestHash:hostedRequestHash(h.request),accepted:false,notePath:h.request.notePath,status:'paused',hashes:[h.request.initialHash],updatedAt:''}));
 const original=h.document,update=h.io.updateNote;h.document='Ordinary text only';
 h.io.updateNote=async(...args)=>{reads++;return update(...args);};
 const writer=h.create();await writer.tick();
 for(let i=0;i<20;i++)await writer.tick();assert.equal(reads,1);assert.equal(h.document,'Ordinary text only');
 h.document=original+'New ordinary suffix\n';clock=5000;await writer.tick();
 assert.equal(h.state.status,'complete');assert.match(h.document,/Restored exact answer/);assert.ok(h.document.endsWith('New ordinary suffix\n'));writer.stop();
});

function stranded(h:ReturnType<typeof harness>){
  // Older turns are absent from canonical latestTurn. Recovery needs saved
  // exact bindings; a bare prose interval no longer proves a run association.
  if(!h.files.has(h.paths.state))h.files.set(h.paths.state,JSON.stringify({requestHash:hostedRequestHash(h.request),accepted:false,notePath:h.request.notePath,status:'waiting',hashes:[h.request.initialHash],updatedAt:'',bindingCheckpoint:{bindings:{[h.request.messageId]:{turnId:'original-turn',kind:'start'}}}}));
  const original:InlineThreadState={historyComplete:true,messages:[
    {id:h.request.messageId,role:'user',text:'Original question',turnId:null,streaming:false,createdAt:h.request.createdAt},
    {id:'original-final',role:'assistant',text:'Recovered original answer',turnId:'original-turn',streaming:false},
    {id:'later-user',role:'user',text:'Later unrelated question',turnId:null,streaming:false},
    {id:'later-answer',role:'assistant',text:'Unrelated answer',turnId:'later-turn',streaming:true}],
    activities:[],latestTurn:{turnId:'later-turn',state:'running'},session:{status:'running',activeTurnId:'later-turn'},
    checkpoints:[{turnId:'original-turn',status:'ready',checkpointRef:'refs/t3/checkpoints/thread/turn/1',assistantMessageId:'original-final'}]};
  const recent={...original,historyComplete:false,messages:original.messages.slice(2)};
  let online=false,reads=0;
  h.io.threadState=async(_request,_access,refresh)=>refresh?original:recent;
  h.io.access=async()=>{
    if(!online)throw Error('Server unavailable');
    return {origin:'https://t3.example',api:async(path,payload)=>{
      assert.equal(payload,undefined,'recovery must never dispatch or resend');
      assert.equal(path,`/api/orchestration/threads/${h.request.threadId}?reasoningMessages=true`);
      reads++;
      return {snapshotSequence:100,thread:{id:h.request.threadId,projectId:h.request.projectId,...original}};
    }};
  };
  return {original,recent,online:()=>{online=true;},get reads(){return reads;}};
}

function independent(h:ReturnType<typeof harness>){h.request.independent=true;h.files.set(h.paths.request,JSON.stringify(h.request));return h;}

test('an imported older run retains its exact lifecycle through newer unrelated snapshots',async()=>{
  const h=independent(harness('Original T3 prompt'));
  Object.assign(h.request,{version:4,initialOwner:randomUUID(),importTurn:{messageId:h.request.messageId,turnId:'imported-old',state:'completed',requestedAt:h.request.createdAt}});
  h.files.set(h.paths.request,JSON.stringify(h.request));
  h.io.accepts=()=>true;
  h.io.threadState=async()=>({historyComplete:true,messages:[{id:h.request.messageId,role:'user',text:'Original T3 prompt',createdAt:h.request.createdAt,turnId:null,streaming:false},{id:'import-final',role:'assistant',text:'EXACT OLD FINAL',turnId:'imported-old',streaming:false},{id:'other',role:'user',text:'Unrelated prompt',turnId:null,streaming:false},{id:'other-answer',role:'assistant',text:'UNRELATED LIVE',turnId:'other-run',streaming:true}],activities:[],latestTurn:{turnId:'other-run',state:'running'},session:{status:'running',activeTurnId:'other-run'}});
  await h.create().tick();assert.equal(h.state.status,'complete');assert.match(h.document,/EXACT OLD FINAL/);assert.doesNotMatch(h.document,/UNRELATED LIVE/);assert.match(h.document,/User introduction/);assert.match(h.document,/User tail/);
  assert.throws(()=>validateHostedRequest({...h.request,importTurn:{...h.request.importTurn,messageId:randomUUID()}}),/imported run evidence/);
  assert.throws(()=>validateHostedRequest({...h.request,version:3}),/imported run evidence/);
});

test('canonical title-only state updates the waiting header before any message or turn is bound',async()=>{
  const h=harness('Original question');h.dispatch();
  let title='Generated plan';
  h.io.threadState=async()=>({title,messages:[],activities:[],historyComplete:true});
  const writer=h.create();await writer.tick();
  assert.match(h.document,/Generated plan · Working/);
  assert.match(h.document,/Original question/);assert.equal(h.state.turnId,undefined);
  assert.match(h.document,/User introduction/);assert.match(h.document,/User tail/);
  title='Renamed **plan**';await writer.tick();
  assert.ok(h.document.includes('Renamed \\*\\*plan\\*\\*'));
  assert.doesNotMatch(h.document,/Generated plan/);
  assert.equal(h.state.hashes.at(-1),contentHash(regionBody(h.document,h.request.id)!.body));
});

for(const crash of ['none','proof','cleanup'])test(`independent reply removes all tracking boundaries and survives ${crash} crash`,async()=>{
  const h=independent(harness());h.dispatch();await h.create().tick();h.answer('Final reply',true);
  if(crash==='proof')h.crash(true);
  if(crash==='cleanup'){
    const write=h.io.write;let fail=true;
    h.io.write=async(path,value)=>{if(fail&&JSON.parse(value).cleanupComplete){fail=false;throw Error('Crash before cleanup acknowledgement');}await write(path,value);};
  }
  if(crash==='proof'){await assert.rejects(h.create().tick(),/disk unavailable/);h.crash(false);}else await h.create().tick();
  h.document+='\nAn independent surrounding edit';
  await h.create().tick();
  assert.equal(h.state.status,'complete');assert.equal(h.state.finalSaved,true);assert.equal(h.state.cleanupComplete,true);
  assert.doesNotMatch(h.document,/<!-- t3-(?:inline|response):/);assert.equal(h.document.split('Final reply').length-1,1);
  assert.match(h.document,/An independent surrounding edit/);
});

test('final marker examples complete successfully through the independent writer',async()=>{
  const h=independent(harness());h.dispatch();
  const answer='Example:\n\n```text\n<!-- t3-inline:start:'+h.request.id+' -->\n<!-- t3-inline:end:'+h.request.id+' -->\n```\n\nDone.';
  h.answer(answer);await h.create().tick();h.answer(answer,true);await h.create().tick();
  assert.equal(h.state.status,'complete');assert.equal(h.state.cleanupComplete,true);
  assert.equal(regionBody(h.document,h.request.id),null);assert.match(h.document,/```text\n<!-- t3-inline:start:/);assert.doesNotMatch(h.document,/· Working/);
});

test('upgrade cleans old completed proof tags without changing later user edits or accessing T3',async()=>{
  const h=independent(harness());
  h.document='Before\n'+completionProof(h.request.id,'> User edited the answer\n')+'\nAfter';
  h.files.set(h.paths.state,JSON.stringify({requestHash:hostedRequestHash(h.request),accepted:true,notePath:h.request.notePath,status:'complete',hashes:[],updatedAt:'',finalBody:'> Original answer\n',finalDocumentHash:'old hash'}));
  h.io.access=async()=>{throw Error('Must not access T3 during cleanup');};
  await h.create().tick();assert.equal(h.state.status,'complete');assert.equal(h.state.cleanupComplete,true);
  assert.equal(h.document,'Before\n> User edited the answer\nAfter');
});

test('an unbound response automatically recovers after an outage, reload, and later T3 chat',async()=>{
  const h=harness(),s=stranded(h);
  await h.create().tick();assert.equal(h.state.turnId,undefined);assert.match(h.state.detail!,/Server unavailable/);
  const duringOutage=h.document;
  s.online();await h.create().tick();
  assert.notEqual(h.document,duringOutage);
  assert.equal(h.state.turnId,'original-turn');assert.equal(h.state.status,'complete');
  assert.match(h.document,/Recovered original answer/);assert.doesNotMatch(h.document,/Unrelated answer|t3-inline:|Working/);
  assert.equal(s.reads,1);
  const completed=h.document;await h.create().tick();assert.equal(h.document,completed);
});

test('a previously bound writer recovers old history after restart without adopting the latest turn',async()=>{
  const h=harness();h.dispatch();await h.create().tick();
  // The checkpoint belongs to the originally observed provider turn.
  const s=stranded(h);s.original.messages=s.original.messages.map(m=>m.turnId==='original-turn'?{...m,turnId:'turn'}:m);
  s.original.checkpoints![0].turnId='turn';s.online();
  h.document='Outside edit\n'+h.document;
  await h.create().tick();
  assert.equal(h.state.turnId,'turn');assert.equal(h.state.status,'complete');assert.match(h.document,/^Outside edit/);
  assert.match(h.document,/Recovered original answer/);assert.doesNotMatch(h.document,/Unrelated answer|t3-inline:/);
});

test('automatic outage recovery overwrites changed active contents',async()=>{
  const h=harness(),s=stranded(h);await h.create().tick();
  h.document=h.document.replace('**T3 · Working**','My replacement text');s.online();
  await h.create().tick();
  assert.equal(h.state.status,'complete');assert.match(h.document,/Recovered original answer/);assert.doesNotMatch(h.document,/My replacement text/);
});

test('ambiguous recovered history remains tracked and retries without dispatching',async()=>{
  const h=harness(),s=stranded(h);s.online();
  const unbound=JSON.parse(h.files.get(h.paths.state)!);delete unbound.bindingCheckpoint;h.files.set(h.paths.state,JSON.stringify(unbound));
  s.original.messages.splice(2,0,{id:'ambiguous',role:'assistant',text:'Fan-out',turnId:'other-turn',streaming:false});
  const writer=h.create(),before=h.document;await writer.tick();await writer.tick();
  assert.equal(h.state.turnId,undefined);assert.equal(h.document,before);assert.equal(s.reads,1,'history retry is throttled');
});

test('progress, failure, continue, reload repair, steer, answer and final cleanup preserve one transcript',async()=>{
  const h=harness();h.request.keepIntermediate=true;h.files.set(h.paths.request,JSON.stringify(h.request));
  const oldTime=h.request.createdAt,nextTime=new Date(Date.parse(oldTime)+1000).toISOString(),nextMessage=randomUUID(),steerMessage=randomUUID();
  const old={id:'old',role:'assistant',text:'Original progress.',streaming:false,turnId:'old-turn',createdAt:oldTime};
  const next={id:'new',role:'assistant',text:'Continued progress.',streaming:false,turnId:'next-turn',createdAt:nextTime};
  let current:InlineThreadState={messages:[{id:h.request.messageId,role:'user',text:'Begin',streaming:false,turnId:null,createdAt:oldTime},old],activities:[],latestTurn:{turnId:'old-turn',state:'running',requestedAt:oldTime},session:{status:'running',activeTurnId:'old-turn'}};
  h.io.threadState=async()=>current;
  await h.create().tick();assert.match(h.document,/> Original progress\./);
  current={...current,latestTurn:{...current.latestTurn!,state:'error'},session:{status:'error',activeTurnId:null,lastError:'Routing timed out'}};
  await h.create().tick();assert.equal(h.state.status,'error');assert.match(h.document,/Original progress/);
  h.files.set(h.paths.state,JSON.stringify({...h.state,pendingMessageId:nextMessage}));
  current={...current,messages:[...current.messages,{id:nextMessage,role:'user',text:'Continue',streaming:false,turnId:null,createdAt:nextTime},next],latestTurn:{turnId:'next-turn',state:'running',requestedAt:nextTime},session:{status:'running',activeTurnId:'next-turn'}};
  await h.create().tick();assert.deepEqual(h.state.turnIds,['old-turn','next-turn']);
  assert.match(h.document,/> Original progress\.\n>\n> Continued progress\./,'continuation preserves prose before steering exists');
  // Model a checkpoint produced by the broken release, then reload the writer.
  h.files.set(h.paths.state,JSON.stringify({...h.state,turnIds:['old-turn'],prose:[old],steering:[{messageId:steerMessage,text:'Ask me a question',before:[old,next]}]}));
  current.messages.push({id:steerMessage,role:'user',text:'Ask me a question',streaming:false,turnId:'next-turn',createdAt:new Date(Date.parse(nextTime)+1000).toISOString()});
  const requested={id:'request',kind:'user-input.requested',summary:'Question',turnId:'next-turn',payload:{requestId:'request',responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Which result?',options:[{label:'OK',description:'Continue with OK',value:'native-ok'}]}]}};
  current.activities.push(requested);
  await h.create().tick();assert.deepEqual(h.state.turnIds,['old-turn','next-turn']);assert.match(h.document,/Original progress[\s\S]*Continued progress[\s\S]*Ask me a question[\s\S]*Question pending/);
  const target={environmentId:h.request.threadEnvironmentId,threadId:h.request.threadId,requestId:'request'};
  let command:any;
  const controller=new QuestionController(async environment=>{
    assert.equal(environment,target.environmentId);
    return {origin:'https://t3.example',api:async(_path,payload)=>{if(payload){command=payload;current.activities.push({id:'resolved',kind:'user-input.resolved',summary:'Answered',turnId:'next-turn',payload:{requestId:'request',answers:payload.answers}});current.messages.push({id:'async-answer:request',role:'user',text:'native-ok',turnId:'next-turn',streaming:false});return {};}return {thread:{id:h.request.threadId,...current}};}};
  },{load:()=>[],save:()=>{}},()=>randomUUID());
  controller.draft(target,'choice',{selected:['native-ok']});await controller.submit(target);
  assert.equal(controller.view(target).status,'resolved');assert.equal(command.threadId,h.request.threadId);assert.deepEqual(command.answers,{choice:'native-ok'});
  current.messages.push({id:'after',role:'assistant',text:'Progress after answering.',streaming:false,turnId:'next-turn',createdAt:new Date(Date.parse(nextTime)+2000).toISOString()});
  await h.create().tick();assert.match(h.document,/Ask me a question[\s\S]*Progress after answering/);assert.doesNotMatch(h.document,/t3-question:/);
  current.messages.push({id:'final',role:'assistant',text:'Final answer.',streaming:false,turnId:'next-turn',createdAt:new Date(Date.parse(nextTime)+3000).toISOString()});
  current.latestTurn={...current.latestTurn!,state:'completed',assistantMessageId:'final'};current.session={status:'ready',activeTurnId:null};
  await h.create().tick();assert.equal(h.state.status,'complete');assert.match(h.document,/Original progress[\s\S]*Continued progress[\s\S]*Ask me a question[\s\S]*Progress after answering\.\n>\n> Final answer\./);assert.doesNotMatch(h.document,/t3-inline:|t3-question:/);
  const finished=h.document;await h.create().tick();assert.equal(h.document,finished);controller.dispose();
});

test('handoff waits for a saved synced anchor and host-owned access before dispatch',async()=>{
  const h=harness(),writer=h.create();h.unsaved(true);
  await writer.tick();assert.equal(h.state.accepted,false);
  h.unsaved(false);h.access(false);await writer.tick();assert.equal(h.state.accepted,false);
  h.access(true);
  await handoffInline(h.io,h.request,()=>true,async()=>writer.tick());
  assert.equal(h.state.accepted,true);assert.equal(h.state.status,'waiting');
  assert.equal(h.calls.at(-1).access,'thread-machine');
  assert.equal(regionBody(h.document,h.request.id)?.body,'**T3 · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n\n'+responseActivityRow());
});

test('host continues after sender disappears, handles outside edits and known Sync rollbacks, and finalizes a closed note',async()=>{
  const h=harness();await h.create().tick();h.dispatch();
  await h.create().tick();assert.match(h.document,/Progress A/);
  const earlier=h.document;
  h.document='New outside paragraph\n'+h.document;
  h.answer('Progress A and B');await h.create().tick();assert.match(h.document,/New outside paragraph/);assert.match(h.document,/and B/);
  h.document='Another outside edit\n'+earlier;h.answer('Final answer',true);
  await h.create().tick();assert.equal(h.state.status,'complete');
  assert.match(h.document,/Another outside edit\nUser introduction/);assert.match(h.document,/> Final answer/);assert.match(h.document,/User tail/);assert.doesNotMatch(h.document,/t3-inline:/);
  const finished=h.document;await h.create().tick();assert.equal(h.document,finished);
});

test('failed hosted response keeps its marker until an explicitly bound T3 continuation appears',async()=>{
  const h=harness(),nextMessage=randomUUID(),nextTime='2026-09-29T13:00:00Z';
  h.dispatch();
  h.io.threadState=async()=>({messages:[{id:h.request.messageId,role:'user',text:'Question',turnId:null,streaming:false,createdAt:h.request.createdAt}],activities:[],latestTurn:{turnId:'turn',state:'error',requestedAt:h.request.createdAt},session:{status:'error',activeTurnId:null,lastError:'Codex usage limit reached. Reset in 2h.'}});
  await h.create().tick();
  assert.equal(h.state.status,'error');assert.match(h.document,/Codex usage limit reached/);
  const failed=h.document;
  await h.create().tick();assert.equal(h.document,failed,'an unrelated later turn cannot replace the failed block');
  h.files.set(h.paths.state,JSON.stringify({...h.state,pendingMessageId:nextMessage}));
  await h.create().tick();assert.equal(h.document,failed,'the writer waits for the selected user message');
  h.io.threadState=async()=>({messages:[
    {id:h.request.messageId,role:'user',text:'Question',turnId:null,streaming:false,createdAt:h.request.createdAt},
    {id:nextMessage,role:'user',text:'Continue',turnId:null,streaming:false,createdAt:nextTime},
    {id:'continued',role:'assistant',text:'Recovered answer',turnId:'next-turn',streaming:false}],activities:[],latestTurn:{turnId:'next-turn',state:'completed',requestedAt:nextTime,assistantMessageId:'continued'},session:{status:'ready',activeTurnId:null}});
  await h.create().tick();
  assert.equal(h.state.status,'complete');assert.equal(h.state.messageId,nextMessage);
  assert.match(h.document,/Recovered answer/);assert.doesNotMatch(h.document,/t3-inline:/);
});

test('a crashed T3 server may resume the original turn without another user message',async()=>{
  const h=harness();h.dispatch();
  h.io.threadState=async()=>({messages:[{id:h.request.messageId,role:'user',text:'Question',turnId:null,streaming:false,createdAt:h.request.createdAt}],activities:[],latestTurn:{turnId:'turn',state:'error',requestedAt:h.request.createdAt},session:{status:'error',activeTurnId:null,lastError:'Server restarted.'}});
  await h.create().tick();assert.equal(h.state.status,'error');
  h.io.threadState=async()=>({messages:[{id:h.request.messageId,role:'user',text:'Question',turnId:null,streaming:false,createdAt:h.request.createdAt},{id:'recovered',role:'assistant',turnId:'turn',text:'Recovered on the same turn',streaming:false}],activities:[],latestTurn:{turnId:'turn',state:'completed',requestedAt:h.request.createdAt,assistantMessageId:'recovered'},session:{status:'ready',activeTurnId:null}});
  await h.create().tick();assert.equal(h.state.status,'complete');assert.match(h.document,/Recovered on the same turn/);
});

test('failed imports preserve final text and original links without blocking completion',async()=>{
  const h=harness();h.dispatch();h.answer('See ![plot](/tmp/plot.png) and [data](/tmp/data.pdf).',true);
  const sources:string[]=[];
  h.io.resolveReplyReference=async reference=>{sources.push(reference.source);if(reference.image)throw Error('asset unavailable');return '[[T3 Code Attachments/data.pdf]]';};
  await h.create().tick();assert.equal(h.state.status,'complete');
  assert.match(h.document,/!\[plot\]\(\/tmp\/plot.png\)/);assert.match(h.document,/\[\[T3 Code Attachments\/data.pdf\]\]/);
  assert.match(h.document,/original links are preserved/);assert.doesNotMatch(h.document,/t3-inline:start/);
  assert.equal(h.state.assetFailures?.length,1);
  await h.create().tick();assert.deepEqual(sources,['/tmp/plot.png','/tmp/data.pdf'],'Terminal replies must not repeatedly retry unavailable files');
});

for(const complete of [false,true])test(`changed active contents are overwritten during ${complete?'completion':'streaming'} while surroundings survive`,async()=>{
  const h=harness();h.dispatch();const writer=h.create();await writer.tick();
  h.document='Outside edit\n'+h.document.replace('Progress A','Duplicated Sync text\n> Duplicated Sync text')+'\nAnother outside edit';
  h.answer('Progress B',complete);await writer.tick();
  assert.equal(h.state.status,complete?'complete':'running');assert.match(h.document,/Progress B/);assert.doesNotMatch(h.document,/Duplicated Sync text/);
  assert.match(h.document,/Outside edit/);assert.match(h.document,/Another outside edit/);
  if(complete){h.document=h.document.replace('Progress B','My completed edit');await h.create().tick();assert.match(h.document,/My completed edit/);}
});

test('upgrade resumes an old paused binding with changed contents without requiring the original editor',async()=>{
  const h=harness();h.dispatch();await h.create().tick();
  h.document=h.document.replace('Progress A','Sync duplication');
  h.files.set(h.paths.state,JSON.stringify({...h.state,status:'paused'}));
  h.answer('Recovered final',true);await h.create().tick();
  assert.equal(h.state.status,'complete');assert.match(h.document,/Recovered final/);assert.doesNotMatch(h.document,/Sync duplication/);
});

test('removed response boundaries still prevent overwriting surrounding text',async()=>{
  const h=harness();h.dispatch();await h.create().tick();
  h.document=h.document.replace(`<!-- t3-inline:start:${h.request.id} -->`,'User removed the response boundary');
  const before=h.document;h.answer('New progress');await h.create().tick();
  assert.equal(h.state.status,'conflict');assert.equal(h.document,before);
});

for(const complete of [false,true])test(`write-ahead recovery survives a crash after ${complete?'final':'progress'} insertion`,async()=>{
  const h=harness();h.dispatch();await h.create().tick();h.answer('New answer',complete);h.crash(true);
  await assert.rejects(h.create().tick(),/disk unavailable/);assert.match(h.document,/New answer/);
  h.crash(false);await h.create().tick();
  assert.equal(h.state.status,complete?'complete':'running');assert.equal((h.document.match(/New answer/g)??[]).length,1);
});

test('remote Stop interrupts the bound turn with one stable command and writes interrupted status',async()=>{
  const h=harness();h.dispatch();const writer=h.create();await writer.tick();
  h.files.set(h.paths.stop,'{}');await writer.tick();await writer.tick();
  assert.equal(h.state.status,'interrupted');assert.doesNotMatch(h.document,/T3 · (?:Working|Interrupted)/);
  assert.match(h.document,/Progress A/);assert.doesNotMatch(h.document,/t3-inline:(?:start|end)/);
  const interrupts=h.calls.filter(call=>call.type==='thread.turn.interrupt');assert.equal(interrupts.length,1);assert.equal(interrupts[0].turnId,'turn');assert.equal(interrupts[0].commandId,commandId(h.request.id,'interrupt'));
});

test('stopped response cleanup survives a crash between tag removal and its terminal checkpoint',async()=>{
  const h=harness();h.dispatch();await h.create().tick();
  h.files.set(h.paths.stop,'{}');h.crash(true);
  await assert.rejects(h.create().tick(),/disk unavailable/);
  assert.doesNotMatch(h.document,/t3-inline:(?:start|end)/);
  h.crash(false);await h.create().tick();
  assert.equal(h.state.status,'interrupted');assert.match(h.document,/Progress A/);
});

test('handoff is immutable and the wrong machine cannot claim a synced request',async()=>{
  const h=harness();
  await new HostedInlineWriter({vaultId:'vault',environmentId:'another',workspaceRoot:'/vault',directory:h.request.host.directory},h.io).tick();
  assert.equal(h.files.has(h.paths.state),false);
  await assert.rejects(handoffInline(h.io,{...h.request,notePath:'Other.md'},()=>true,async()=>{}),/different hosted job/);
  await assert.rejects(handoffInline(h.io,h.request,()=>true,async()=>{}),/not accepted/);
  assert.equal(h.files.get(h.paths.request),JSON.stringify(h.request));
  assert.throws(()=>validateHostedRequest({...h.request,notePath:'../secret.md'}),/Invalid/);
});

test('a handoff acknowledgement belongs to the exact request',async()=>{
  const h=harness();await h.create().tick();assert.equal(h.state.requestHash,hostedRequestHash(h.request));
  h.files.set(h.paths.state,JSON.stringify({...h.state,requestHash:contentHash('different')}));
  await assert.rejects(handoffInline(h.io,h.request),/different response job/);
});

test('a stalled note cannot block another note, later ticks, or cause overlapping writes',async()=>{
  const a=harness(),b=harness();a.dispatch();b.dispatch();
  let release!:()=>void,updated!:()=>void,blockedCalls=0;
  const stalled=new Promise<void>(resolve=>{release=resolve;});
  const secondUpdated=new Promise<void>(resolve=>{updated=resolve;});
  const io:HostedWriterIO={
    requests:async()=>[a.paths.request,b.paths.request],
    read:async path=>a.files.get(path)??b.files.get(path),
    write:async(path,bytes)=>{(path.includes(a.request.id)?a.files:b.files).set(path,bytes);},
    access:async()=>({origin:'https://t3.example',api:async(path,payload)=>{
      const h=path.includes(a.request.threadId)?a:b;
      if(h===a){blockedCalls++;await stalled;}
      return (await h.io.access('thread-machine')).api(path,payload);
    }}),
    updateNote:async(path,change)=>{const h=path===a.request.notePath?a:b;return h.io.updateNote(path,change);},
  };
  b.request.notePath='Notes/second.md';b.files.set(b.paths.request,JSON.stringify(b.request));
  io.updateNote=async(path,change)=>{const h=path===a.request.notePath?a:b;const result=await h.io.updateNote(path,change);if(h===b&&result?.includes('Progress A'))updated();return result;};
  const writer=new HostedInlineWriter({vaultId:a.request.vaultId,...a.request.host},io);
  const first=writer.tick();
  try{
    await secondUpdated;await new Promise<void>(resolve=>setImmediate(resolve));
    b.answer('Progress B');await writer.tick();
    assert.match(b.document,/Progress B/);assert.equal(blockedCalls,1);
    assert.match(a.document,/T3 · Working/);
  }finally{release();await first;writer.stop();}
  assert.match(a.document,/Progress A/);
});


for(const keepIntermediate of [undefined,false,true])test(`hosted response preference ${keepIntermediate} survives writer restart and imports retained assets`,async()=>{
  const h=harness();
  if(keepIntermediate!==undefined)h.request.keepIntermediate=keepIntermediate;
  h.files.set(h.paths.request,JSON.stringify(h.request));
  let complete=false;
  const thread=()=>({messages:[
    {id:h.request.messageId,role:'user',text:'Question',turnId:null,streaming:false,createdAt:h.request.createdAt},
    {id:'progress',role:'assistant',text:'I checked [data](/tmp/data.txt).',turnId:'turn',streaming:false},
    {id:'final',role:'assistant',text:'Final answer.',turnId:'turn',streaming:!complete},
  ],activities:[],latestTurn:{turnId:'turn',state:complete?'completed':'running',requestedAt:h.request.createdAt,assistantMessageId:'final'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}});
  h.io.threadState=async()=>thread();
  const sources:string[]=[];
  h.io.resolveReplyReference=async reference=>{sources.push(reference.source);return '[[T3 Code Attachments/data.txt]]';};
  await h.create().tick();assert.match(h.document,/I checked/);
  complete=true;await h.create().tick();
  assert.equal(h.state.status,'complete');assert.match(h.document,/Final answer/);assert.doesNotMatch(h.document,/t3-inline:|T3 · Working/);
  if(keepIntermediate){assert.match(h.document,/I checked \[\[T3 Code Attachments\/data.txt\]\]/);assert.deepEqual(sources,['/tmp/data.txt']);}
  else {assert.doesNotMatch(h.document,/I checked|data.txt/);assert.deepEqual(sources,[]);}
});

test('hosted preference rejects a non-boolean value',()=>{
  const h=harness();assert.throws(()=>validateHostedRequest({...h.request,keepIntermediate:'true'}),/preference/);
});

test('leased and older hosted writers keep tracking an async question after the turn completes',async()=>{
  const h=harness();h.dispatch();h.answer('Final prose',true);
  const activity={id:'question',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'async-request',responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Which option?',options:[{label:'First',description:'Description'}]}]}};
  h.io.threadState=async()=>({messages:[{id:h.request.messageId,role:'user',turnId:null,text:'Question',streaming:false,createdAt:h.request.createdAt},{id:'answer',role:'assistant',text:'Final prose',turnId:'turn',streaming:false}],activities:[activity],latestTurn:{turnId:'turn',state:'completed',requestedAt:h.request.createdAt,assistantMessageId:'answer'},session:{status:'ready',activeTurnId:null}});
  await h.create().tick();assert.equal(h.state.status,'waiting');assert.match(h.document,/t3-inline:/);assert.doesNotMatch(h.document,/T3 · Working/);assert.match(h.document,/Question pending/);assert.match(h.document,/t3-question:/);assert.match(h.document,/> Final prose/);
});

test('steering holds finalization until delivery, follows a completion-race turn, and moves selection atomically',async()=>{
  const h=harness();h.dispatch();await h.create().tick();
  const id=randomUUID(),selected='My steering request',before='User introduction\n';
  h.document=before+selected+'\n'+h.document.slice(before.length);
  const {selectionAnchor}=await import('../inline-thread');
  const anchor=selectionAnchor(h.document,selected,before.length,before.length+selected.length);
  h.files.set(h.paths.state,JSON.stringify({...h.state,steering:[{messageId:id,text:selected,before:h.state.prose,selection:anchor}]}));
  h.answer('Original final',true);await h.create().tick();
  assert.equal(h.state.status,'running');assert.match(h.document,/t3-inline:start/);assert.match(h.document,/My steering request/);
  h.io.threadState=async()=>({messages:[{id,role:'user',text:selected,turnId:null,streaming:false,createdAt:'next-time'},{id:'next-answer',role:'assistant',text:'Steered final',turnId:'next-turn',streaming:false}],activities:[],latestTurn:{turnId:'next-turn',state:'completed',requestedAt:'next-time',assistantMessageId:'next-answer'},session:{status:'ready',activeTurnId:null}});
  await h.create().tick();assert.equal(h.state.status,'complete');assert.equal(h.state.turnId,'next-turn');
  assert.equal((h.document.match(/My steering request/g)??[]).length,1);
  assert.match(h.document,/Progress A[\s\S]*\[!t3-steering\] You[\s\S]*My steering request[\s\S]*Steered final/);
  assert.doesNotMatch(h.document,/t3-inline:/);assert.match(h.document,/User tail/);
});

test('steering retries a rejected note write and removes a restored outside selection after restart',async()=>{
  const h=harness();h.dispatch();await h.create().tick();
  const id=randomUUID(),text='Move this steering message';
  h.document+='\n\n'+text;
  const {selectionAnchor}=await import('../inline-thread');
  const anchor=selectionAnchor(h.document,text,h.document.length-text.length,h.document.length);
  h.files.set(h.paths.state,JSON.stringify({...h.state,steering:[{messageId:id,text,before:h.state.prose,selection:anchor}]}));
  h.io.threadState=async()=>({messages:[{id:h.request.messageId,role:'user',text:'Original',turnId:null,streaming:false,createdAt:h.request.createdAt},{id,role:'user',text,turnId:'turn',streaming:false},{id:'answer',role:'assistant',text:'Progress after steering',turnId:'turn',streaming:true}],activities:[],latestTurn:{turnId:'turn',state:'running',requestedAt:h.request.createdAt},session:{status:'running',activeTurnId:'turn'}});
  const update=h.io.updateNote,original=h.document;
  h.io.updateNote=async(_path,change)=>{change(h.document);throw Error('Note changed before write');};
  await h.create().tick();assert.equal(h.document,original);assert.equal(h.state.steering![0].selectionApplied,undefined);
  h.io.updateNote=update;
  await h.create().tick();assert.equal(h.state.steering![0].selectionApplied,true);assert.equal(h.document.split(text).length-1,1);
  // Simulate a delayed synced editor save restoring just the outside text.
  h.document+=text;
  await h.create().tick();assert.equal(h.document.split(text).length-1,1);assert.match(h.document,/> Move this steering message/);
  h.document+='My edited steering message';
  await h.create().tick();assert.match(h.document,/My edited steering message$/);
});

test('steering never removes a selection changed before its T3 delivery is confirmed',async()=>{
  const h=harness();h.dispatch();await h.create().tick();const id=randomUUID();
  const {selectionAnchor}=await import('../inline-thread');
  const anchor=selectionAnchor(h.document,'User introduction',0,17);
  h.files.set(h.paths.state,JSON.stringify({...h.state,steering:[{messageId:id,text:'User introduction',before:h.state.prose,selection:anchor}]}));
  h.document=h.document.replace('User introduction','My updated introduction');
  h.io.threadState=async()=>({messages:[{id:h.request.messageId,role:'user',text:'Original',turnId:null,streaming:false,createdAt:h.request.createdAt},{id,role:'user',text:'User introduction',turnId:'turn',streaming:false},{id:'answer',role:'assistant',text:'After steering',turnId:'turn',streaming:true}],activities:[],latestTurn:{turnId:'turn',state:'running',requestedAt:h.request.createdAt},session:{status:'running',activeTurnId:'turn'}});
  await h.create().tick();assert.match(h.document,/My updated introduction/);assert.match(h.document,/\[!t3-steering\] You/);assert.equal(h.state.status,'running');
});

test('completion refresh includes the final message when session-ready overtakes its stream event',async()=>{
  const h=harness();h.dispatch();await h.create().tick();
  const id=randomUUID();
  h.files.set(h.paths.state,JSON.stringify({...h.state,steering:[{messageId:id,text:'Finish',before:h.state.prose}]}));
  let refreshed=false;
  h.io.threadState=async(_request,_access,refresh)=>{
    refreshed=refresh===true;
    return {messages:[
      {id:h.request.messageId,role:'user',turnId:null,text:'Question',streaming:false,createdAt:h.request.createdAt},
      {id:'answer',role:'assistant',text:'Progress A',streaming:false,turnId:'turn'},
      {id,role:'user',turnId:'turn',text:'Finish',streaming:false},
      ...(refresh?[{id:'final',role:'assistant',text:'Final after steering',streaming:false,turnId:'turn'}]:[]),
    ],activities:[],latestTurn:{turnId:'turn',state:'completed',requestedAt:h.request.createdAt,assistantMessageId:refresh?'final':'answer'},session:{status:'ready',activeTurnId:null}};
  };
  await h.create().tick();
  assert.equal(refreshed,true);assert.equal(h.state.status,'complete');
  assert.match(h.document,/Progress A[\s\S]*Finish[\s\S]*Final after steering/);
  assert.doesNotMatch(h.document,/t3-inline:/);
});

for(const version of [1,2,3] as const)test(`initial question survives hosted v${version} writer restart and final-only completion`,async()=>{
  const h=harness('Explain **this**.\n\nKeep it brief.');
  h.request.version=version;
  if(version!==1){h.request.initialOwner=randomUUID();h.io.accepts=request=>request.version===version;}
  if(version===3)h.request.finalAnswerFormat='raw-markdown';
  h.files.set(h.paths.request,JSON.stringify(h.request));
  assert.match(h.document,/> Keep it brief\.[\s\S]*T3 · Working/);
  h.dispatch();let writer=h.create();await writer.tick();writer.stop();
  assert.match(h.document,/> Keep it brief\.[\s\S]*stream-tail">Progress A/);
  writer=h.create();h.answer('Final answer.',true);await writer.tick();writer.stop();
  assert.match(h.document,version===3?/> \[!t3-steering\] You\n> Explain \*\*this\*\*\.\n>\n> Keep it brief\.\n\nFinal answer\./:/> \[!t3-steering\] You\n> Explain \*\*this\*\*\.\n>\n> Keep it brief\.\n\n> Final answer\./);
  assert.equal(h.document.split('[!t3-steering]').length-1,1);
  assert.doesNotMatch(h.document,/T3 · Working|Progress A|t3-inline:/);
});

test('hosted initial input validates bounded text and binds the original message identity',()=>{
  const h=harness('Question');
  for(const initialInput of [null,{messageId:randomUUID(),text:'Question'},{messageId:h.request.messageId,text:''},{messageId:h.request.messageId,text:'a'.repeat(120_001)}]){
    assert.throws(()=>validateHostedRequest({...h.request,initialInput}),/initial response input/);
  }
  assert.equal(validateHostedRequest(h.request).initialInput?.text,'Question');
});

for(const version of [1,2,3] as const)for(const dismiss of [false,true])test(`hosted v${version} follows a late async ${dismiss?'dismissal':'answer'} across restart`,async()=>{
  const h=harness();h.request.version=version;
  if(version!==1){h.request.initialOwner=randomUUID();h.io.accepts=request=>request.version===version;}
  if(version===3)h.request.finalAnswerFormat='raw-markdown';
  h.files.set(h.paths.request,JSON.stringify(h.request));h.dispatch();
  const time='2026-10-01T18:00:00Z';
  const requested={id:'question',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'late',responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Continue?',options:[{label:'Yes',description:''}]}]}};
  let current:InlineThreadState={messages:[{id:h.request.messageId,role:'user',text:'Begin',turnId:null,streaming:false,createdAt:h.request.createdAt},{id:'first',role:'assistant',text:'First final.',turnId:'turn',streaming:false}],activities:[requested],latestTurn:{turnId:'turn',state:'completed',requestedAt:h.request.createdAt,assistantMessageId:'first'},session:{status:'ready',activeTurnId:null}};
  h.io.threadState=async()=>current;
  await h.create().tick();assert.equal(h.state.status,'waiting');assert.match(h.document,/First final/);assert.doesNotMatch(h.document,/T3 · Working/);
  if(version===3)assert.match(h.document,/\nFirst final\.\n/);
  const waiting=h.document;
  current={...current,latestTurn:{turnId:'unrelated',state:'completed',requestedAt:time},messages:[...current.messages,{id:'other',role:'user',text:'Other work',turnId:'unrelated',streaming:false},{id:'other-final',role:'assistant',text:'Unrelated result',turnId:'unrelated',streaming:false}]};
  await h.create().tick();assert.equal(h.document,waiting);assert.equal(h.state.turnId,'turn');
  current.activities.push({id:'resolved',kind:'user-input.resolved',summary:'Resolved',turnId:'turn',payload:{requestId:'late',responseMode:'message',...(!dismiss?{answers:{choice:'Yes'}}:{})}});
  await h.create().tick();
  if(dismiss){assert.equal(h.state.status,'complete');assert.doesNotMatch(h.document,/t3-inline:|t3-question:/);return;}
  assert.equal(h.state.status,'running','accepted late answer must show working before the new turn is projected');
  assert.match(h.document,/First final[\s\S]*> Yes[\s\S]*\*\*T3 · Working\*\*[^\n]*<span class="send-to-t3-inline-spinner"/);
  current.messages.push({id:'async-answer:late',role:'user',text:'Continue? Yes',turnId:null,streaming:false,createdAt:time},{id:'continued',role:'assistant',text:'Follow-up progress.',turnId:'answer-turn',streaming:true});
  current.latestTurn={turnId:'answer-turn',state:'running',requestedAt:time};current.session={status:'running',activeTurnId:'answer-turn'};
  await h.create().tick();assert.equal(h.state.status,'running');assert.equal(h.state.turnId,'answer-turn');assert.match(h.document,/First final[\s\S]*> \[!t3-steering\] User\n> Yes[\s\S]*Follow-up progress/);assert.equal(h.document.split('> Yes').length-1,1);assert.doesNotMatch(h.document,/Unrelated result/);
  assert.match(h.document,/> Yes[\s\S]*\*\*T3 · Working\*\*[\s\S]*Follow-up progress/);
  assert.equal(h.document.split('· Working').length-1,1);
  current.messages.at(-1)!.streaming=false;current.messages.push({id:'last',role:'assistant',text:'Follow-up final.',turnId:'answer-turn',streaming:false});
  current.latestTurn={...current.latestTurn,state:'completed',assistantMessageId:'last'};current.session={status:'ready',activeTurnId:null};
  await h.create().tick();assert.equal(h.state.status,'complete');assert.match(h.document,/First final[\s\S]*> \[!t3-steering\] User\n> Yes[\s\S]*Follow-up final/);assert.equal(h.document.split('> Yes').length-1,1);assert.doesNotMatch(h.document,/t3-inline:|t3-question:/);
  if(version===3){assert.match(h.document,/\nFollow-up final\.\n/);assert.match(h.document,/> Follow-up progress/);}
  const finished=h.document;await h.create().tick();assert.equal(h.document,finished);
  assert.doesNotMatch(finished,/· Working|send-to-t3-inline-spinner/);
});

for(const repairHead of [false,true])for(const fallback of ['snapshot','events'])test(`exact late-answer recovery preserves its cursor across ${fallback} fallback${repairHead?' and repairs a saved snapshot-head cursor':''}`,async()=>{
 const h=independent(harness());h.dispatch();await h.create().tick();
 const saved=h.state;
 saved.bindingCheckpoint={...saved.bindingCheckpoint,sequence:50,session:{status:'ready',activeTurnId:null},latestTurn:{turnId:'turn',state:'completed',completedAt:'2026-10-03T14:38:20Z'}};
 const expectedCursor=repairHead?44:50;
 if(repairHead){
   saved.bindingCheckpoint={...saved.bindingCheckpoint,sequence:5000,starts:{[h.request.messageId]:{messageId:h.request.messageId,requestedAt:h.request.createdAt,sequence:45,turnId:'turn'}},latestTurn:{turnId:'unrelated',state:'completed'}};
   saved.bindingRecoverySequence=5000;saved.bindingRecoveryCheckpoint=saved.bindingCheckpoint;
 }
 h.files.set(h.paths.state,JSON.stringify(saved));
 const at='2026-10-03T14:40:50.423Z';
 const current:InlineThreadState={sequence:5000,historyComplete:true,messages:[
  {id:h.request.messageId,role:'user',text:'Begin',turnId:null,streaming:false,createdAt:h.request.createdAt},
  {id:'first',role:'assistant',text:'First final.',turnId:'turn',streaming:false},
  {id:'async-answer:recovered',role:'user',text:'Yes',turnId:null,streaming:false,createdAt:at},
  {id:'follow-final',role:'assistant',text:'Recovered follow-up.',turnId:'answer-turn',streaming:false},
  {id:'other-final',role:'assistant',text:'Unrelated work.',turnId:'unrelated',streaming:false}],
  activities:[{id:'q',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'recovered',responseMode:'message'}},{id:'r',kind:'user-input.resolved',summary:'Resolved',turnId:'turn',payload:{requestId:'recovered',answers:{choice:'Yes'}}}],
  checkpoints:[{turnId:'turn',status:'ready',checkpointRef:'refs/t3/checkpoints/one',assistantMessageId:'first',completedAt:'2026-10-03T14:38:20Z'},{turnId:'answer-turn',status:'ready',checkpointRef:'refs/t3/checkpoints/two',assistantMessageId:'follow-final',completedAt:'2026-10-03T14:40:59Z'}],
  latestTurn:{turnId:'unrelated',state:'completed'},session:{status:'ready',activeTurnId:null}};
 h.io.threadState=async()=>current;let replays=0,snapshotOnly=true;const cursors:number[]=[];
 h.io.replayBindings=async(_request,_access,signal,cursor)=>{assert.equal(signal.aborted,false);assert.equal(h.state.bindingRecoverySequence,expectedCursor,'persist the gap before starting interruptible network work');replays++;cursors.push(cursor);if(snapshotOnly)return fallback==='snapshot'?[{kind:'snapshot',snapshot:{snapshotSequence:5000,thread:current}}]:[{kind:'event',event:{sequence:5001,type:'thread.metadata-updated',payload:{title:'Unrelated recent activity'}}}];return [
  {kind:'event',event:{sequence:51,type:'thread.activity-appended',payload:{activity:{id:'resolution',kind:'user-input.resolved',summary:'Resolved',turnId:'turn',createdAt:at,payload:{requestId:'recovered',responseMode:'message',answers:{choice:'Yes'}}}}}},
  {kind:'event',event:{sequence:52,type:'thread.message-sent',payload:{messageId:'async-answer:recovered',role:'user',text:'Yes',createdAt:at}}},
  {kind:'event',event:{sequence:53,type:'thread.session-set',payload:{session:{status:'starting',activeTurnId:null,updatedAt:at}}}},
  {kind:'event',event:{sequence:54,type:'thread.session-set',payload:{session:{status:'running',activeTurnId:'answer-turn',updatedAt:at}}}},
  {kind:'event',event:{sequence:55,type:'thread.session-set',payload:{session:{status:'ready',activeTurnId:null,updatedAt:'2026-10-03T14:40:59Z'}}}}];};
 await h.create().tick();
 assert.equal(h.state.status,'waiting');assert.equal(h.state.bindingRecoveryIssue,'history-unavailable');assert.notEqual(h.state.finalSaved,true);
 assert.match(h.document,/waiting for exact T3 answer history/);assert.doesNotMatch(h.document,/Unrelated work/);
 const cursor=h.state.bindingRecoverySequence;
 assert.equal(cursor,expectedCursor,'the canonical head must not replace the last applied recovery checkpoint');
 assert.equal(h.state.bindingRecoveryCheckpoint?.sequence,repairHead?5000:50);
 snapshotOnly=false;await h.create().tick();
 assert.equal(replays,2);assert.deepEqual(cursors,[cursor,cursor],'fallback snapshots never advance the missing evidence cursor');assert.equal(h.state.bindingRecoveryIssue,undefined);
 assert.equal(h.state.turnId,'answer-turn');assert.equal(h.state.status,'complete');assert.equal(h.state.finalSaved,true);assert.equal(h.state.cleanupComplete,true);
 assert.match(h.document,/First final[\s\S]*Yes[\s\S]*Recovered follow-up/);assert.doesNotMatch(h.document,/Unrelated work|· Working|t3-inline:/);
 assert.ok(!h.calls.some(call=>call.type),'history recovery never dispatches a prompt or approval');
});

for(const version of [1,2,3] as const)test(`hosted v${version} completes a mid-turn async answer and repairs persisted Working after restart`,async()=>{
  const h=harness();h.request.version=version;
  h.request.createdAt='2026-10-02T08:42:00.000Z';
  if(version!==1){h.request.initialOwner=randomUUID();h.io.accepts=request=>request.version===version;}
  if(version===3)h.request.finalAnswerFormat='raw-markdown';
  h.files.set(h.paths.request,JSON.stringify(h.request));h.dispatch();
  const at=(seconds:number)=>`2026-10-02T08:42:${String(seconds).padStart(2,'0')}.000Z`;
  const requested={id:'question',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'steered',responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Continue?',options:[{label:'Yes',description:''}]}]}};
  let current:InlineThreadState={messages:[{id:h.request.messageId,role:'user',text:'Begin',turnId:null,streaming:false,createdAt:h.request.createdAt},{id:'before',role:'assistant',text:'Before answer.',turnId:'turn',streaming:false,createdAt:at(0)}],activities:[requested],latestTurn:{turnId:'turn',state:'running',requestedAt:h.request.createdAt},session:{status:'running',activeTurnId:'turn'}};
  h.io.threadState=async()=>current;
  await h.create().tick();
  current.messages.push({id:'async-answer:steered',role:'user',text:'Continue? Yes',turnId:null,streaming:false,createdAt:at(10)});
  current.activities.push({id:'resolved',kind:'user-input.resolved',summary:'Resolved',turnId:'turn',payload:{requestId:'steered',answers:{choice:'Yes'}}});
  await h.create().tick();assert.equal(h.state.status,'running');assert.equal(h.state.questionFollows![0].replyTurnId,undefined);
  current.messages.push({id:'final',role:'assistant',text:'Same-turn final.',turnId:'turn',streaming:false,createdAt:at(20)});
  current={...current,latestTurn:{...current.latestTurn!,state:'completed',completedAt:at(30),assistantMessageId:'final'},session:{status:'ready',activeTurnId:null}};
  // Reproduce an already stuck release checkpoint, then let a fresh writer recover.
  h.files.set(h.paths.state,JSON.stringify({...h.state,questionFollows:h.state.questionFollows!.map(item=>({...item,completed:true}))}));
  h.document+='\nOutside user edit';
  await h.create().tick();
  assert.equal(h.state.status,'complete');assert.equal(h.state.questionFollows![0].replyTurnId,'turn');assert.deepEqual(h.state.turnIds,['turn']);
  assert.match(h.document,/Before answer[\s\S]*> Yes[\s\S]*Same-turn final/);assert.match(h.document,/Outside user edit/);
  assert.doesNotMatch(h.document,/· Working|send-to-t3-inline-spinner|t3-inline:|t3-question:/);
  if(version===3){assert.match(h.document,/\nSame-turn final\.\n/);assert.match(h.document,/> Before answer/);}
  const final=h.document;await h.create().tick();assert.equal(h.document,final);
});

test('upgrade reopens an older finalized async question only from byte-identical output',async()=>{
  for(const edited of [false,true]){
    const h=harness();h.dispatch();
    const requested={id:'q',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'upgrade',responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Continue?',options:[{label:'Yes',description:''}]}]}};
    h.io.threadState=async()=>({messages:[{id:h.request.messageId,role:'user',text:'Begin',turnId:null,streaming:false,createdAt:h.request.createdAt},{id:'final',role:'assistant',text:'Old final.',turnId:'turn',streaming:false}],activities:[requested],latestTurn:{turnId:'turn',state:'completed',requestedAt:h.request.createdAt,assistantMessageId:'final'},session:{status:'ready',activeTurnId:null}});
    await h.create().tick();
    const {finalizeRegion}=await import('../inline-thread');
    const region=regionBody(h.document,h.request.id)!,change=finalizeRegion(h.document,h.request.id,contentHash(region.body),h.state.body!)!;
    h.document=h.document.slice(0,change.from)+change.text+h.document.slice(change.to);
    const legacy={...h.state,status:'complete',finalDocumentHash:contentHash(h.document)};delete legacy.questionFollows;
    h.files.set(h.paths.state,JSON.stringify(legacy));
    if(edited)h.document=h.document.replace('Old final.','My edited answer.');
    const before=h.document;
    await h.create().tick();
    if(edited){assert.equal(h.document,before);assert.equal(h.state.status,'complete');}
    else {assert.equal(h.state.status,'waiting');assert.match(h.document,/t3-inline:start/);assert.match(h.document,/Old final/);}
  }
});

test('copied response context survives hosted confirmation and writer restart without deleting assistant prose',async()=>{
  const h=harness(),id=randomUUID(),selected='Captured claim.';
  h.dispatch();h.answer(selected);await h.create().tick();
  h.files.set(h.paths.state,JSON.stringify({...h.state,steering:[{messageId:id,text:selected,before:h.state.prose}]}));
  h.answer('Original final',true);await h.create().tick();
  assert.equal(h.state.status,'running','unconfirmed input keeps the response attached');
  h.io.threadState=async()=>({messages:[{id,role:'user',text:selected,turnId:null,streaming:false,createdAt:'next-time'},{id:'next-answer',role:'assistant',text:'Steered final',turnId:'next-turn',streaming:false}],activities:[],latestTurn:{turnId:'next-turn',state:'completed',requestedAt:'next-time',assistantMessageId:'next-answer'},session:{status:'ready',activeTurnId:null}});
  await h.create().tick();
  assert.equal(h.state.status,'complete');assert.equal(h.state.steering![0].selection,undefined);
  assert.equal(h.document.split(selected).length-1,2,'assistant prose and the copied You quote both remain');
  assert.match(h.document,/Captured claim\.[\s\S]*\[!t3-steering\] You[\s\S]*Captured claim\.[\s\S]*Steered final/);
  assert.match(h.document,/^User introduction/);assert.match(h.document,/User tail$/);assert.doesNotMatch(h.document,/t3-inline:/);
  const completed=h.document;await h.create().tick();assert.equal(h.document,completed);
});

for(const independentReply of [false,true])test(`stop finalizes ${independentReply?'independent':'legacy'} output without T3 access or a bound turn`,async()=>{
  const h=independentReply?independent(harness()):harness();
  h.document=h.document.replace(/\*\*T3 · Working\*\*[^\n]*/, '**T3 · Reconnecting**\n\n> Visible partial answer');
  h.files.set(h.paths.stop,'{}');h.io.access=async()=>{throw Error('offline');};
  await h.create().tick();
  assert.equal(h.state.status,'interrupted');assert.equal(h.state.userStopped,true);assert.equal(h.state.turnId,undefined);
  assert.match(h.document,/Visible partial answer/);assert.doesNotMatch(h.document,/t3-inline:|t3-response:|Reconnecting|spinner/);
  if(independentReply)assert.equal(h.state.cleanupComplete,true);
});

test('stop bypasses an already hung history fetch and a late snapshot cannot rewrite the note',async()=>{
  const h=harness();h.dispatch();const writer=h.create();await writer.tick();
  let release!:(value:any)=>void,started=false;
  h.io.threadState=()=>{started=true;return new Promise(resolve=>{release=resolve;});};
  const pending=writer.tick();
  for(let n=0;n<30&&!started;n++)await new Promise(resolve=>setImmediate(resolve));assert.ok(started);
  h.files.set(h.paths.stop,'{}');await writer.tick();await pending;await writer.tick();
  const sealed=h.document;assert.equal(h.state.status,'interrupted');assert.match(sealed,/Progress A/);assert.doesNotMatch(sealed,/Working|t3-inline:/);
  release({messages:[],activities:[]});await new Promise(resolve=>setImmediate(resolve));await writer.tick();assert.equal(h.document,sealed);
});

test('stop seals a waiting question and unconfirmed steering without requiring delivery',async()=>{
  const h=independent(harness());h.dispatch();await h.create().tick();
  h.files.set(h.paths.state,JSON.stringify({...h.state,status:'waiting',steering:[{messageId:randomUUID(),text:'Not delivered',before:[]}]}));
  h.files.set(h.paths.stop,'{}');h.io.access=async()=>{throw Error('offline');};await h.create().tick();
  assert.equal(h.state.status,'interrupted');assert.match(h.document,/Progress A/);assert.doesNotMatch(h.document,/Working|t3-inline:|t3-response:/);
});

test('a stop between network stages prevents the next history fetch from starting',async()=>{
  const h=harness();h.dispatch();const writer=h.create(),update=h.io.updateNote;let stopped=false,historyReads=0;
  h.io.updateNote=async(path,change)=>{
    const value=await update(path,change);
    if(!stopped){stopped=true;h.files.set(h.paths.stop,'{}');writer.requestStop(h.request.id);}
    return value;
  };
  h.io.threadState=async()=>{historyReads++;return new Promise(()=>{});};
  await writer.tick();await writer.tick();
  assert.equal(historyReads,0);assert.equal(h.state.status,'interrupted');assert.doesNotMatch(h.document,/Working|t3-inline:/);
});

for(const version of [1,2,3] as const)test(`Collapse survives hosted v${version} restart, imports progress assets and retains a frozen duration`,async()=>{
  const h=harness();h.request.version=version;h.request.intermediateMode='collapse';
  if(version!==1){h.request.initialOwner=randomUUID();h.io.accepts=request=>request.version===version;}
  if(version===3)h.request.finalAnswerFormat='raw-markdown';
  h.files.set(h.paths.request,JSON.stringify(h.request));
  let complete=false;
  h.io.threadState=async()=>({messages:[
    {id:h.request.messageId,role:'user',text:'Question',turnId:null,streaming:false,createdAt:h.request.createdAt},
    {id:'progress',role:'assistant',text:'Checked [asset](/tmp/progress.txt).\n\n## Nested',turnId:'turn',streaming:false},
    {id:'final',role:'assistant',text:'Exact final answer.',turnId:'turn',streaming:!complete},
  ],activities:[],latestTurn:{turnId:'turn',state:complete?'completed':'running',requestedAt:h.request.createdAt,completedAt:complete?new Date(Date.parse(h.request.createdAt)+197000).toISOString():null,assistantMessageId:'final'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}});
  const assets:string[]=[];h.io.resolveReplyReference=async reference=>{assets.push(reference.source);return '[[T3 Code Attachments/progress.txt]]';};
  await h.create().tick();assert.match(h.document,/> \[!t3-progress\]\+ \*\*T3 · Working/);
  complete=true;await h.create().tick();
  assert.equal(h.state.status,'complete');assert.match(h.document,/T3 · Completed[\s\S]*>03:17<\/span>/);
  assert.match(h.document,/\[\[T3 Code Attachments\/progress.txt\]\]/);assert.deepEqual(assets,['/tmp/progress.txt']);
  assert.match(h.document,version===3?/\n\nExact final answer\.\n/:/\n\n> Exact final answer\.\n/);assert.doesNotMatch(h.document,/t3-inline:|spinner/);
  const finished=h.document;await h.create().tick();assert.equal(h.document,finished);
  assert.throws(()=>validateHostedRequest({...h.request,intermediateMode:'maybe'}),/preference/);
});

test('a hung historical read releases the serial writer on coordinator ticks and fences its late result',async()=>{
  const h=harness();h.dispatch();
  let clock=0,release!:(snapshot:any)=>void,hang=true;
  h.io.monotonic=()=>clock;
  const current:InlineThreadState={messages:[{id:h.request.messageId,role:'user',text:'Question',turnId:null,streaming:false,createdAt:h.request.createdAt}],activities:[],historyComplete:false};
  h.io.threadState=async()=>current;
  h.io.access=async()=>({origin:'https://t3.example',api:async()=>hang?new Promise(resolve=>{release=resolve;}):{snapshotSequence:5,thread:{id:h.request.threadId,projectId:h.request.projectId,messages:[{...current.messages[0],turnId:'correct'},{id:'final',role:'assistant',text:'Final after timeout',turnId:'correct',streaming:false}],activities:[],latestTurn:{turnId:'correct',state:'completed',requestedAt:h.request.createdAt,assistantMessageId:'final'}}}});
  const writer=h.create(),blocked=writer.tick();
  for(let n=0;n<12&&!release;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(release);
  clock=30_000;await writer.tick();await blocked;
  assert.match(h.state.detail!,/timed out/);assert.match(h.document,/Working/);
  hang=false;clock+=5000;delete h.io.threadState;await writer.tick();
  assert.equal(h.state.status,'complete');assert.match(h.document,/Final after timeout/);
  const final=h.document;
  release({snapshotSequence:1,thread:{id:h.request.threadId,projectId:h.request.projectId,messages:[{...current.messages[0],turnId:'wrong'},{id:'late',role:'assistant',text:'Late unrelated output',turnId:'wrong',streaming:false}],latestTurn:{turnId:'wrong',state:'completed'}}});
  await new Promise(resolve=>setImmediate(resolve));await writer.tick();assert.equal(h.document,final);
});

test('a start-only stream checkpoints exact evidence before its prompt or provider turn is projected',async()=>{
  const h=harness();h.dispatch();
  const {applyThreadItem}=await import('../inline-thread');
  const start=applyThreadItem({messages:[],activities:[]},{kind:'event',event:{sequence:4,type:'thread.turn-start-requested',payload:{messageId:h.request.messageId,createdAt:h.request.createdAt}}}).state;
  h.io.threadState=async()=>start;
  await h.create().tick();assert.equal(h.state.turnId,undefined);assert.equal(h.state.bindingCheckpoint?.starts?.[h.request.messageId].requestedAt,h.request.createdAt);
  h.io.threadState=undefined;h.answer('Recovered start-only answer',true);
  // The real canonical interface carries a sequence. The harness's older
  // snapshot is intentionally unsequenced and still supplies exact requestedAt.
  await h.create().tick();assert.equal(h.state.status,'complete');assert.match(h.document,/Recovered start-only answer/);
});

test('canonical external inputs complete independent mirrors without touching identical outside text',async()=>{
 const destinations=[independent(harness()),independent(harness())];
 const primary=destinations[0].request.messageId,external=randomUUID(),native=randomUUID();
 const current:InlineThreadState={historyComplete:true,messages:[{id:primary,role:'user',text:'Original',turnId:'turn',streaming:false},
 {id:'progress',role:'assistant',text:'Before incoming.',turnId:'turn',streaming:false},
 {id:external,role:'user',text:'External message',turnId:'turn',streaming:false,context:{version:1,records:[{version:1,kind:'fleet-sender',contextId:'fleet-sender-v1',payload:{version:1,kind:'agent',environmentId:'3630e7fa-f1df-4631-b5a2-6086ddaf28a1',threadId:'2801be1c-a9f2-5106-bf29-242a97eee8fe',title:'Sender'}}]}},
 {id:native,role:'user',text:'Native input',turnId:'turn',streaming:false},
 {id:'final',role:'assistant',text:'Final after incoming.',turnId:'turn',streaming:false},
 {id:'other',role:'user',text:'Later unrelated input',turnId:'other-turn',streaming:false}],activities:[],latestTurn:{turnId:'turn',state:'completed',messageId:primary,assistantMessageId:'final'},session:{status:'ready',activeTurnId:null}};
 for(const h of destinations){
  h.request.messageId=primary;h.files.set(h.paths.request,JSON.stringify(h.request));h.document+='\nExternal message\nNative input\n';h.io.threadState=async()=>current;
  await h.create().tick();await h.create().tick();
  assert.equal(h.state.status,'complete');assert.equal(h.state.cleanupComplete,true);assert.equal(h.state.steering,undefined);
  assert.equal(h.state.incoming?.length,2);assert.match(h.document,/\[!t3-steering\] Agent · Sender/);assert.match(h.document,/\[!t3-steering\] User/);
  assert.doesNotMatch(h.document,/Later unrelated input|t3-inline:|t3-response:/);assert.match(h.document,/\nExternal message\nNative input\n$/);
  assert.equal(h.document.split('> External message').length-1,1);
  const done=h.document;await h.create().tick();assert.equal(h.document,done);
 }
});

for(const format of ['formatted','raw-markdown'] as const)test(`v4 external-file writer retains ${format} formatting across completion`,async()=>{const h=harness();h.request.version=4;h.request.initialOwner=randomUUID();h.request.finalAnswerFormat=format;h.io.accepts=()=>true;h.files.set(h.paths.request,JSON.stringify(h.request));h.dispatch();h.answer('Final answer',true);await h.create().tick();assert.equal(h.state.status,'complete');assert.match(h.document,/Final answer/);assert.equal(validateHostedRequest(h.request).version,4);assert.equal(h.state.requestHash,hostedRequestHash(h.request));});

test('coordinated quiet polling avoids repeated render/download and finds a missed final on authority ticks',async()=>{
 const h=harness();h.dispatch();let clock=0,updates=0;h.io.monotonic=()=>clock;h.io.quietCanonicalPolling=true;
 const update=h.io.updateNote;h.io.updateNote=async(...args)=>{updates++;return update(...args);};
 const writer=h.create();await writer.tick();assert.equal(h.calls.length,1);
 clock=1500;await writer.tick();assert.equal(h.calls.length,2);const rendered=updates,state=h.files.get(h.paths.state);
 h.document+='\nOrdinary text added during quiet polling.';h.answer('Exact final after missed feed',true);
 clock=3000;await writer.tick();clock=4499;await writer.tick();
 assert.equal(h.calls.length,2);assert.equal(updates,rendered);assert.equal(h.files.get(h.paths.state),state);
 clock=4500;await writer.tick();assert.equal(h.calls.length,3);assert.equal(h.state.status,'complete');
 assert.match(h.document,/Exact final after missed feed/);assert.match(h.document,/Ordinary text added during quiet polling/);
 writer.stop();assert.equal((writer as any).canonicalPolls.size,0);
});

test('an explicit stop bypasses coordinated quiet polling immediately',async()=>{
 const h=harness();h.dispatch();let clock=0;h.io.monotonic=()=>clock;h.io.quietCanonicalPolling=true;
 const writer=h.create();await writer.tick();clock=1500;await writer.tick();
 writer.requestStop(h.request.id);clock=1501;await writer.tick();
 assert.equal(h.state.userStopped,true);assert.equal(h.state.status,'interrupted');assert.doesNotMatch(h.document,/t3-inline:/);
 writer.stop();
});

test('fresh durable recovery state bypasses a coordinated quiet deadline',async()=>{
 const h=harness();h.dispatch();let clock=0;h.io.monotonic=()=>clock;h.io.quietCanonicalPolling=true;
 const writer=h.create();await writer.tick();clock=1500;await writer.tick();
 const changed=h.state;changed.detail='External recovery changed the durable response';h.files.set(h.paths.state,JSON.stringify(changed));
 h.answer('Fresh response after recovery',true);clock=1501;await writer.tick();
 assert.equal(h.calls.length,3);assert.equal(h.state.status,'complete');assert.match(h.document,/Fresh response after recovery/);
 writer.stop();
});

test('note relocation stays fresh during a coordinated quiet deadline',async()=>{
 const h=harness();h.dispatch();let clock=0,location=h.request.notePath;h.io.monotonic=()=>clock;h.io.quietCanonicalPolling=true;
 const oldUpdate=h.io.updateNote;h.io.locateNote=async()=>location;h.io.updateNote=async(_path,change)=>oldUpdate(h.request.notePath,change);
 const writer=h.create();await writer.tick();clock=1500;await writer.tick();
 location='Notes/renamed.md';clock=1501;await writer.tick();assert.equal(h.state.notePath,location);assert.equal(h.calls.length,3);
 writer.stop();
});

test('a canonical failure clears quiet state and a live-state adapter remains exempt',async()=>{
 const h=harness();h.dispatch();let clock=0;h.io.monotonic=()=>clock;h.io.quietCanonicalPolling=true;
 const writer=h.create();await writer.tick();clock=1500;await writer.tick();
 h.access(false);clock=4500;await writer.tick();assert.match(h.state.detail!,/not paired/);assert.equal((writer as any).canonicalPolls.size,0);
 h.access(true);clock=4501;h.answer('Recovered final',true);await writer.tick();assert.equal(h.state.status,'complete');writer.stop();
 const live=harness();live.dispatch();live.io.quietCanonicalPolling=true;live.io.monotonic=()=>0;
 let text='Live A';live.io.threadState=async()=>({messages:[{id:live.request.messageId,role:'user',text:'Question',turnId:'turn',streaming:false},{id:'answer',role:'assistant',text,turnId:'turn',streaming:true}],activities:[],latestTurn:{turnId:'turn',state:'running'},bindings:{[live.request.messageId]:{turnId:'turn',kind:'explicit'}}});
 const direct=live.create();await direct.tick();await direct.tick();text='Live B';await direct.tick();
 assert.match(live.document,/Live B/);assert.equal((direct as any).canonicalPolls.size,0);direct.stop();
});
