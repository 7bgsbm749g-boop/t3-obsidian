import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {interruptStoppedResponse,stopResponseEdit,stoppedResponseBody} from '../response-stop';
import {initialRegion,replaceRegion} from '../inline-thread';

test('stop cleanup preserves the displayed transcript and status/tag examples inside code',()=>{
  const id=randomUUID(),initial=initialRegion(id);
  const body='> [!t3-steering] You\n> Continue\n\n**Named thread · Reconnecting** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n\n> Partial answer\n\n```text\n**T3 · Working**\n<!-- t3-inline:start:'+id+' -->\n<!-- t3-inline:end:'+id+' -->\n```';
  const update=replaceRegion(initial.text,id,initial.bodyHash,body)!;
  const document='Before\n'+initial.text.slice(0,update.from)+update.text+initial.text.slice(update.to)+'After';
  const change=stopResponseEdit(document,id)!;assert.ok(change);
  const after=document.slice(0,change.from)+change.text+document.slice(change.to);
  assert.match(after,/Before[\s\S]*Continue[\s\S]*Partial answer[\s\S]*After/);
  assert.doesNotMatch(after,/Reconnecting|send-to-t3-inline-spinner/);
  assert.match(after,/```text\n\*\*T3 · Working\*\*\n<!-- t3-inline:start:/);
  assert.equal(stopResponseEdit(after,id),null);
});

test('stop formatting closes raw and quoted open fences and preserves literal prose',()=>{
  assert.equal(stoppedResponseBody('**T3 · Working**\n\n```js\nlet x = 1;'),'```js\nlet x = 1;\n```');
  assert.equal(stoppedResponseBody('> ```\n> partial'),' > ```\n> partial\n> ```'.trim());
  assert.equal(stoppedResponseBody('> **T3 · Working**\n\nUser edits'),' > **T3 · Working**\n\nUser edits'.trim());
});

test('stop refuses nested or incomplete boundaries',()=>{
  const id=randomUUID(),other=randomUUID(),initial=initialRegion(id);
  assert.equal(stopResponseEdit(initial.text.replace('<!-- t3-inline:end:', '<!-- changed:end:'),id),null);
  const nested=initial.text.replace('**T3',initialRegion(other).text+'**T3');
  assert.equal(stopResponseEdit(nested,id),null);
});

test('interrupt deadline prevents a late access result from dispatching',async()=>{
  let resolve!:(value:any)=>void,calls=0,closed=0;
  const access=new Promise<any>(r=>{resolve=r;});
  await assert.rejects(interruptStoppedResponse(()=>access,randomUUID(),'thread','turn',5),/did not acknowledge/);
  resolve({api:async()=>{calls++;},close:()=>{closed++;}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);assert.equal(closed,1);
});

test('interrupt deadline releases access even when dispatch never resolves',async()=>{
  let closed=0;
  await assert.rejects(interruptStoppedResponse(async()=>({origin:'https://test',api:()=>new Promise(()=>{}),close:()=>{closed++;}}),randomUUID(),'thread','turn',5),/did not acknowledge/);
  assert.equal(closed,1);
});

test('stopping removes pending question controls while preserving the prompt and code examples',async()=>{
  const {renderQuestion}=await import('../questions');
  const question=renderQuestion({requestId:'q',turnId:'turn',createdAt:'',questions:[{id:'choice',header:'Choice',question:'Which approach?',options:[],multiSelect:false}]},{environmentId:'env',threadId:'thread',requestId:'q'});
  const stopped=stoppedResponseBody('**T3 · Working**\n\n'+question+'\n\n```text\n'+question+'\n```');
  assert.match(stopped,/> Which approach\?/);assert.ok(stopped.startsWith('>\n> **Choice**'));
  assert.equal(stopped.split('<!-- t3-question:start:').length-1,1,'The code example remains literal');
  assert.equal(stopped.split('> [Answer]').length-1,1);
});

test('an unbound stop resolves the original message turn rather than interrupting the newest turn',async()=>{
  const commands:any[]=[];
  const snapshot={thread:{id:'thread',messages:[{id:'original',role:'user',turnId:'original-turn',streaming:false,text:'Question',createdAt:'2026-10-01T00:00:00Z'},{id:'partial',role:'assistant',text:'Partial',turnId:'original-turn',streaming:false},{id:'new',role:'user',streaming:false,text:'Later',createdAt:'2026-10-02T00:00:00Z'}],activities:[],latestTurn:{turnId:'new-turn',state:'running',requestedAt:'2026-10-02T00:00:00Z'},checkpoints:[{turnId:'original-turn',status:'ready',checkpointRef:'refs/t3/checkpoints/thread/turn/1',assistantMessageId:'partial',completedAt:'2026-10-01T01:00:00Z'}]}};
  await interruptStoppedResponse(async()=>({origin:'https://test',api:async(_path,payload)=>{if(payload){commands.push(payload);return {};}return snapshot;}}),randomUUID(),'thread',undefined,1000,'original');
  assert.equal(commands.length,1);assert.equal(commands[0].turnId,'original-turn');
});
