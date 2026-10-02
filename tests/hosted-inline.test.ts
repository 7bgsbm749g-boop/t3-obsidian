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

function stranded(h:ReturnType<typeof harness>){
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
      assert.equal(path,`/api/orchestration/threads/${h.request.threadId}`);
      reads++;
      return {snapshotSequence:100,thread:{id:h.request.threadId,projectId:h.request.projectId,...original}};
    }};
  };
  return {original,recent,online:()=>{online=true;},get reads(){return reads;}};
}

function independent(h:ReturnType<typeof harness>){h.request.independent=true;h.files.set(h.paths.request,JSON.stringify(h.request));return h;}

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
  current.messages.push({id:steerMessage,role:'user',text:'Ask me a question',streaming:false,turnId:null,createdAt:new Date(Date.parse(nextTime)+1000).toISOString()});
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
  assert.equal(regionBody(h.document,h.request.id)?.body,'**T3 · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>');
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

test('final reply imports referenced files before replacing the response, then retries a failed import',async()=>{
  const h=harness();h.dispatch();h.answer('See ![plot](/tmp/plot.png) and [data](/tmp/data.pdf).',true);
  let fail=true;const sources:string[]=[];
  h.io.importReplyAsset=async reference=>{sources.push(reference.source);if(fail)throw Error('asset unavailable');return `${reference.image?'!':''}[[T3 Code Attachments/${reference.source.split('/').at(-1)}]]`;};
  await h.create().tick();assert.match(h.document,/t3-inline:start/);assert.doesNotMatch(h.document,/plot\.png/);assert.match(h.state.detail!,/asset unavailable/);
  fail=false;await h.create().tick();assert.equal(h.state.status,'complete');
  assert.match(h.document,/!\[\[T3 Code Attachments\/plot\.png\]\]/);
  assert.match(h.document,/\[\[T3 Code Attachments\/data\.pdf\]\]/);
  assert.deepEqual(sources,['/tmp/plot.png','/tmp/plot.png','/tmp/data.pdf']);
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
  h.io.importReplyAsset=async reference=>{sources.push(reference.source);return '[[T3 Code Attachments/data.txt]]';};
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
  h.io.threadState=async()=>({messages:[{id:h.request.messageId,role:'user',text:'Original',turnId:null,streaming:false,createdAt:h.request.createdAt},{id,role:'user',text:'User introduction',turnId:null,streaming:false},{id:'answer',role:'assistant',text:'After steering',turnId:'turn',streaming:true}],activities:[],latestTurn:{turnId:'turn',state:'running',requestedAt:h.request.createdAt},session:{status:'running',activeTurnId:'turn'}});
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
      {id,role:'user',turnId:null,text:'Finish',streaming:false},
      ...(refresh?[{id:'final',role:'assistant',text:'Final after steering',streaming:false,turnId:'turn'}]:[]),
    ],activities:[],latestTurn:{turnId:'turn',state:'completed',requestedAt:h.request.createdAt,assistantMessageId:refresh?'final':'answer'},session:{status:'ready',activeTurnId:null}};
  };
  await h.create().tick();
  assert.equal(refreshed,true);assert.equal(h.state.status,'complete');
  assert.match(h.document,/Progress A[\s\S]*Finish[\s\S]*Final after steering/);
  assert.doesNotMatch(h.document,/t3-inline:/);
});

for(const version of [1,2] as const)test(`initial question survives hosted v${version} writer restart and final-only completion`,async()=>{
  const h=harness('Explain **this**.\n\nKeep it brief.');
  h.request.version=version;
  if(version===2){h.request.initialOwner=randomUUID();h.io.accepts=request=>request.version===2;}
  h.files.set(h.paths.request,JSON.stringify(h.request));
  assert.match(h.document,/> Keep it brief\.[\s\S]*T3 · Working/);
  h.dispatch();let writer=h.create();await writer.tick();writer.stop();
  assert.match(h.document,/> Keep it brief\.[\s\S]*> Progress A/);
  writer=h.create();h.answer('Final answer.',true);await writer.tick();writer.stop();
  assert.match(h.document,/> \[!t3-steering\] You\n> Explain \*\*this\*\*\.\n>\n> Keep it brief\.\n\n> Final answer\./);
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

for(const version of [1,2] as const)for(const dismiss of [false,true])test(`hosted v${version} follows a late async ${dismiss?'dismissal':'answer'} across restart`,async()=>{
  const h=harness();h.request.version=version;
  if(version===2){h.request.initialOwner=randomUUID();h.io.accepts=request=>request.version===2;}
  h.files.set(h.paths.request,JSON.stringify(h.request));h.dispatch();
  const time='2026-10-01T18:00:00Z';
  const requested={id:'question',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'late',responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Continue?',options:[{label:'Yes',description:''}]}]}};
  let current:InlineThreadState={messages:[{id:h.request.messageId,role:'user',text:'Begin',turnId:null,streaming:false,createdAt:h.request.createdAt},{id:'first',role:'assistant',text:'First final.',turnId:'turn',streaming:false}],activities:[requested],latestTurn:{turnId:'turn',state:'completed',requestedAt:h.request.createdAt,assistantMessageId:'first'},session:{status:'ready',activeTurnId:null}};
  h.io.threadState=async()=>current;
  await h.create().tick();assert.equal(h.state.status,'waiting');assert.match(h.document,/First final/);assert.doesNotMatch(h.document,/T3 · Working/);
  const waiting=h.document;
  current={...current,latestTurn:{turnId:'unrelated',state:'completed',requestedAt:time},messages:[...current.messages,{id:'other',role:'user',text:'Other work',turnId:'unrelated',streaming:false},{id:'other-final',role:'assistant',text:'Unrelated result',turnId:'unrelated',streaming:false}]};
  await h.create().tick();assert.equal(h.document,waiting);assert.equal(h.state.turnId,'turn');
  current.activities.push({id:'resolved',kind:'user-input.resolved',summary:'Resolved',turnId:'turn',payload:{requestId:'late',responseMode:'message',...(!dismiss?{answers:{choice:'Yes'}}:{})}});
  await h.create().tick();
  if(dismiss){assert.equal(h.state.status,'complete');assert.doesNotMatch(h.document,/t3-inline:|t3-question:/);return;}
  assert.equal(h.state.status,'running','accepted late answer must show working before the new turn is projected');
  assert.match(h.document,/First final[\s\S]*> Yes[\s\S]*\*\*T3 · Working\*\* <span class="send-to-t3-inline-spinner"/);
  current.messages.push({id:'async-answer:late',role:'user',text:'Continue? Yes',turnId:null,streaming:false,createdAt:time},{id:'continued',role:'assistant',text:'Follow-up progress.',turnId:'answer-turn',streaming:true});
  current.latestTurn={turnId:'answer-turn',state:'running',requestedAt:time};current.session={status:'running',activeTurnId:'answer-turn'};
  await h.create().tick();assert.equal(h.state.status,'running');assert.equal(h.state.turnId,'answer-turn');assert.match(h.document,/First final[\s\S]*> \[!t3-steering\] You\n> Yes[\s\S]*Follow-up progress/);assert.equal(h.document.split('> Yes').length-1,1);assert.doesNotMatch(h.document,/Unrelated result/);
  assert.match(h.document,/> Yes[\s\S]*\*\*T3 · Working\*\*[\s\S]*Follow-up progress/);
  assert.equal(h.document.split('· Working').length-1,1);
  current.messages.at(-1)!.streaming=false;current.messages.push({id:'last',role:'assistant',text:'Follow-up final.',turnId:'answer-turn',streaming:false});
  current.latestTurn={...current.latestTurn,state:'completed',assistantMessageId:'last'};current.session={status:'ready',activeTurnId:null};
  await h.create().tick();assert.equal(h.state.status,'complete');assert.match(h.document,/First final[\s\S]*> \[!t3-steering\] You\n> Yes[\s\S]*Follow-up final/);assert.equal(h.document.split('> Yes').length-1,1);assert.doesNotMatch(h.document,/t3-inline:|t3-question:/);
  const finished=h.document;await h.create().tick();assert.equal(h.document,finished);
  assert.doesNotMatch(finished,/· Working|send-to-t3-inline-spinner/);
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
