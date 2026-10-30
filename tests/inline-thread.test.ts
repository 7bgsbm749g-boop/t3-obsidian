import {responseActivityRow} from '../response-activity';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contentHash} from '../completion';
import {activeInlineIds,applyThreadItem,endInsertionOffset,failedInlineIds,finalizeRegion,initialRegion,insertionOffset,inlineSteeringTarget,selectionOverlapsInlineResponse,regionBody,renderInlineTurn,replaceRegion,selectionAnchor,turnForMessage,turnPhase} from '../inline-thread';

test('async-answer replay requires message-mode resolution and exact timestamp, and refuses competing starts',()=>{
 const at='2026-10-03T14:40:50Z';
 for(const variant of ['native','mismatch','missing','competing']){
  let state:any={messages:[],activities:[],session:{status:'ready',activeTurnId:null}};
  if(variant!=='missing')state=applyThreadItem(state,{kind:'event',event:{sequence:1,type:'thread.activity-appended',payload:{activity:{id:'resolved',kind:'user-input.resolved',summary:'Resolved',turnId:'old',createdAt:variant==='mismatch'?'2026-10-03T14:40:49Z':at,payload:{requestId:'answer',responseMode:variant==='native'?'native':'message',answers:{choice:'Yes'}}}}}}).state;
  state=applyThreadItem(state,{kind:'event',event:{sequence:2,type:'thread.message-sent',payload:{messageId:'async-answer:answer',role:'user',text:'Yes',createdAt:at}}}).state;
  if(variant==='competing')state=applyThreadItem(state,{kind:'event',event:{sequence:3,type:'thread.turn-start-requested',payload:{messageId:'other',createdAt:at}}}).state;
  state=applyThreadItem(state,{kind:'event',event:{sequence:4,type:'thread.session-set',payload:{session:{status:'running',activeTurnId:'newer',updatedAt:at}}}}).state;
  assert.equal(turnForMessage(state,'async-answer:answer'),undefined,variant);
 }
});

test('follow-up steering targets the sole running reply outside its block and scopes multiple replies explicitly',()=>{
  const a='f95a3b36-7393-4508-9fb3-38aa2da3590f',b='915e8577-9bbc-463c-88c6-e6c2d3e24c3b';
  const single='Follow-up before\n'+initialRegion(a).text+'Follow-up after';
  assert.equal(inlineSteeringTarget(single,0),a);
  assert.equal(inlineSteeringTarget(single,single.length),a);
  const multiple=single+initialRegion(b).text+'Tail';
  assert.equal(inlineSteeringTarget(multiple,multiple.length),undefined);
  assert.equal(inlineSteeringTarget(multiple,regionBody(multiple,b)!.from),b);
  assert.equal(inlineSteeringTarget(multiple,0,b),b);
  const second=regionBody(multiple,b)!;
  const failed=multiple.slice(0,second.from)+'**T3 · Error**'+multiple.slice(second.to);
  assert.equal(inlineSteeringTarget(failed,regionBody(failed,b)!.from),undefined);
  assert.equal(inlineSteeringTarget(failed,failed.length),a);
  assert.equal(inlineSteeringTarget('Completed reply',0),undefined);
});

test('a failed turn shows its T3 reason and remains identifiable for recovery',()=>{
  const id='f95a3b36-7393-4508-9fb3-38aa2da3590f',region=initialRegion(id);
  const state={messages:[],activities:[],session:{status:'error',activeTurnId:null,lastError:'Codex usage limit reached. Reset in 2h.'},latestTurn:{turnId:'turn',state:'error'}} as any;
  const body=renderInlineTurn(state,'turn','thread','error');
  assert.match(body,/Codex usage limit reached\. Reset in 2h/);
  assert.match(body,/send-to-t3-provider-error/);
  const change=replaceRegion(region.text,id,region.bodyHash,body)!;
  const document=region.text.slice(0,change.from)+change.text+region.text.slice(change.to);
  assert.deepEqual(failedInlineIds(document),[id]);
});

test('selection anchor tolerates unrelated edits, rejects ambiguity, and inserts after fenced code',()=>{
  const source='Before\n```ts\nconst x = 1;\n```\nAfter';
  const selected='const x = 1;',start=source.indexOf(selected),anchor=selectionAnchor(source,selected,start,start+selected.length);
  assert.equal(insertionOffset(source,anchor),source.indexOf('After'));
  assert.equal(insertionOffset('New line\n'+source,anchor),'New line\n'.length+source.indexOf('After'));
  assert.throws(()=>insertionOffset('New line\n'+source+'\n'+selected,anchor),/moved or changed/);
  assert.throws(()=>insertionOffset('```ts\n'+selected,selectionAnchor('```ts\n'+selected,selected,6,6+selected.length)),/unclosed Markdown code fence/);
});

test('end-of-note insertion rejects an unclosed Markdown fence',()=>{
  const closed='A note\n```ts\ncode\n```\n';
  assert.equal(endInsertionOffset(closed),closed.length);
  assert.throws(()=>endInsertionOffset('A note\n```ts\ncode'),/unclosed Markdown code fence/);
});

test('inline markers permit edits outside the response but stop on edits inside it',()=>{
  const id='abc',region=initialRegion(id);let document='Source\n'+region.text+'After';
  const edit=replaceRegion(document,id,region.bodyHash,'First paragraph');assert.ok(edit);
  document=document.slice(0,edit.from)+edit.text+document.slice(edit.to);
  assert.equal(regionBody(document,id)?.body,'First paragraph');
  document='User addition\n'+document;
  assert.ok(replaceRegion(document,id,edit.hash,'Next paragraph'));
  document=document.replace('First paragraph','User edited the response');
  assert.equal(replaceRegion(document,id,edit.hash,'overwrite'),null);
  assert.equal(regionBody(document.replace('<!-- t3-inline:end:abc -->',''),id),null);
});

test('completed response removes only its guarded markers and preserves surrounding note text',()=>{
  const id='finished',region=initialRegion(id),source='User paragraph\n'+region.text+'Next user paragraph';
  const progress=replaceRegion(source,id,region.bodyHash,'**T3 · Working**\n\n> Progress.\n');assert.ok(progress);
  const document='Earlier user edit\n'+source.slice(0,progress.from)+progress.text+source.slice(progress.to);
  const final='> First paragraph.\n>\n> Second paragraph.\n';
  const edit=finalizeRegion(document,id,progress.hash,final);assert.ok(edit);
  const completed=document.slice(0,edit.from)+edit.text+document.slice(edit.to);
  assert.equal(completed,'Earlier user edit\nUser paragraph\n\n\n> First paragraph.\n>\n> Second paragraph.\n\nNext user paragraph');
  assert.doesNotMatch(completed,/t3-inline:(?:start|end)/);
  assert.equal(finalizeRegion(document.replace('Progress.','User changed this.'),id,progress.hash,final),null);
  const nested=document.replace('> Progress.','> Progress.\n<!-- t3-inline:start:another -->');
  assert.equal(finalizeRegion(nested,id,contentHash(regionBody(nested,id)!.body),final),null);
});

test('finalization ignores marker examples in fenced and inline code, including its own exact ID',()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const body='**T3 · Working**\n\n```text\n<!-- t3-inline:start:'+id+' -->\n<!-- t3-inline:end:'+id+' -->\nWhile streaming: <!-- t3-inline:start:ID -->\n```\n\n> `<!-- t3-inline:end:'+id+' -->`\n';
  const document='Before\n<!-- t3-inline:start:'+id+' -->\n'+body+'\n<!-- t3-inline:end:'+id+' -->\nAfter';
  assert.equal(regionBody(document,id)?.body,body);
  const change=finalizeRegion(document,id,contentHash(body),body.replace('**T3 · Working**\n\n',''));
  assert.ok(change);
  const completed=document.slice(0,change.from)+change.text+document.slice(change.to);
  assert.equal(regionBody(completed,id),null);
  assert.match(completed,/```text\n<!-- t3-inline:start:/);
  assert.match(completed,/Before[\s\S]*After/);
});

test('stream deltas, final replacement, snapshots, status, and fence balancing render without duplicate text',()=>{
  let state={messages:[],activities:[]} as any;
  const event=(sequence:number,text:string,streaming:boolean)=>({kind:'event',event:{sequence,type:'thread.message-sent',payload:{messageId:'m1',role:'assistant',text,streaming,turnId:'turn'}}});
  state=applyThreadItem(state,event(1,'Here is\n',true)).state;
  state=applyThreadItem(state,event(2,'```ts\nconst x = 1;',true)).state;
  assert.match(renderInlineTurn(state,'turn','thread'),/stream-tail">Here is&#10;```ts&#10;const x = 1;<\/span>/);
  state=applyThreadItem(state,event(3,'Here is ```ts\nconst x = 2;\n```',false)).state;
  assert.equal(state.messages[0].text,'Here is ```ts\nconst x = 2;\n```');
  state=applyThreadItem(state,{kind:'event',event:{sequence:4,type:'thread.activity-appended',payload:{activity:{id:'a1',kind:'approval.requested',summary:'Review the command',turnId:'turn',payload:{requestId:'approval'}}}}}).state;
  assert.match(renderInlineTurn(state,'turn','thread'),/Action needed in T3: Review the command/);
  state=applyThreadItem(state,{kind:'event',event:{sequence:5,type:'thread.activity-appended',payload:{activity:{id:'a2',kind:'tool.started',summary:'Ran command started',turnId:'turn'}}}}).state;
  assert.doesNotMatch(renderInlineTurn(state,'turn','thread'),/Ran command/);
  state=applyThreadItem(state,{kind:'event',event:{sequence:6,type:'thread.session-set',payload:{session:{status:'ready',activeTurnId:null}}}}).state;
  assert.equal(turnPhase(state,'turn'),'complete');
  assert.doesNotMatch(renderInlineTurn(state,'turn','thread','complete'),/Action needed/);
  const snapshot={kind:'snapshot',snapshot:{snapshotSequence:20,thread:{messages:[{id:'m1',role:'assistant',text:'Canonical answer',streaming:false,turnId:'turn'}],activities:[],latestTurn:{turnId:'turn',state:'completed'},session:{status:'ready',activeTurnId:null}}}};
  const restored=applyThreadItem(state,snapshot);assert.equal(restored.sequence,20);assert.equal(restored.state.messages[0].text,'Canonical answer');
});

test('a provider-assigned turn is matched to its dispatched user message by requested time',()=>{
  const requestedAt='2026-09-26T14:06:06.071Z';
  const snapshot={kind:'snapshot',snapshot:{snapshotSequence:20,thread:{messages:[
    {id:'our-message',role:'user',text:'Question',streaming:false,turnId:null,createdAt:requestedAt},
    {id:'answer',role:'assistant',text:'Answer',streaming:false,turnId:'provider-turn'},
  ],activities:[],latestTurn:{turnId:'provider-turn',state:'completed',requestedAt},session:{status:'ready',activeTurnId:null}}}};
  const state=applyThreadItem({messages:[],activities:[]},snapshot).state;
  assert.equal(turnForMessage(state,'our-message'),'provider-turn');
  assert.equal(turnForMessage(state,'other-message'),undefined);
  assert.equal(turnForMessage({...state,latestTurn:{turnId:'other-turn',state:'completed',requestedAt:'2026-09-26T14:06:07.000Z'}},'our-message'),'provider-turn');
  assert.equal(turnForMessage({...state,bindings:{},turns:{},latestTurn:{turnId:'other-turn',state:'completed',requestedAt:'2026-09-26T14:06:07.000Z'}},'our-message'),undefined);
  assert.equal(renderInlineTurn(state,'provider-turn','thread','complete'),'> Answer\n');
});

test('repeated snapshots retain inferred binding evidence instead of restamping global watermarks',()=>{
 const requestedAt='2026-10-07T02:00:00Z';
 const snapshot=(sequence:number)=>({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{messages:[{id:'question',role:'user',text:'Question',turnId:null,streaming:false,createdAt:requestedAt}],activities:[],latestTurn:{turnId:'provider-turn',messageId:'question',state:'running',requestedAt},session:{status:'running',activeTurnId:'provider-turn'}}}});
 let state=applyThreadItem({messages:[],activities:[],starts:{question:{messageId:'question',requestedAt,sequence:7,turnId:'provider-turn'}}},snapshot(100)).state;
 const evidence=structuredClone(state.bindings?.question);
 for(let sequence=101;sequence<=120;sequence++)state=applyThreadItem(state,snapshot(sequence)).state;
 assert.deepEqual(state.bindings?.question,evidence);
 assert.equal(state.bindings?.question.sequence,100);
 assert.equal(state.starts?.question.sequence,7,'the exact start event must remain intact');
 assert.equal(state.sequence,120,'the current snapshot watermark still advances');
 assert.equal(turnForMessage(state,'question'),'provider-turn');
});

test('streamed numbered Markdown is marker-safe across trailing newlines',()=>{
  const id='numbered',region=initialRegion(id),source='Question\n'+region.text+'Following paragraph';
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:'1. First line.\n2. Second line.\n',streaming:true}],activities:[]};
  const rendered=renderInlineTurn(state,'turn','thread');
  assert.equal(rendered,'**T3 · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n\n> <span class="send-to-t3-stream-tail">1. First line.&#10;2. Second line.&#10;</span>\n\n\n'+responseActivityRow()+'\n');
  const change=replaceRegion(source,id,region.bodyHash,rendered);assert.ok(change);
  const updated=source.slice(0,change.from)+change.text+source.slice(change.to);
  assert.equal(regionBody(updated,id)?.body,rendered);
  assert.ok(replaceRegion(updated,id,change.hash,rendered+'\n3. Third line.'));
});

test('completed turn keeps only its final message and separates the quote from the end marker',()=>{
  const state={messages:[
    {id:'progress',role:'assistant',turnId:'turn',text:'I will inspect the note.',streaming:false},
    {id:'final',role:'assistant',turnId:'turn',text:'Final paragraph.\n\nSecond paragraph.\n\n',streaming:false},
    {id:'other',role:'assistant',turnId:'turn',text:'Older update delivered out of order.',streaming:false},
  ],activities:[{id:'tool',kind:'tool.started',summary:'Ran command started',turnId:'turn'}],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final'}} as any;
  assert.match(renderInlineTurn(state,'turn','thread'),/I will inspect the note/);
  assert.equal(renderInlineTurn(state,'turn','thread','complete'),'> Final paragraph.\n>\n> Second paragraph.\n');
  assert.doesNotMatch(renderInlineTurn(state,'turn','thread','complete'),/T3|progress|Ran command/);
  const region=initialRegion('final'),source='Question'+region.text;
  const edit=replaceRegion(source,'final',region.bodyHash,renderInlineTurn(state,'turn','thread','complete'));assert.ok(edit);
  const updated=source.slice(0,edit.from)+edit.text+source.slice(edit.to);
  assert.match(updated,/> Second paragraph\.\n\n<!-- t3-inline:end:final -->\n\n$/);
  assert.doesNotMatch(updated,/>\s*\n<!-- t3-inline:end:final -->/);
});

test('live assistant events retain the final message ID through session updates',()=>{
  const start={messages:[],activities:[],latestTurn:{turnId:'turn',state:'running',requestedAt:'now'}} as any;
  const message=applyThreadItem(start,{kind:'event',event:{sequence:1,type:'thread.message-sent',payload:{messageId:'final',role:'assistant',turnId:'turn',text:'Answer',streaming:false}}}).state;
  const running=applyThreadItem(message,{kind:'event',event:{sequence:2,type:'thread.session-set',payload:{session:{status:'running',activeTurnId:'turn'}}}}).state;
  assert.equal(running.latestTurn?.assistantMessageId,'final');
  assert.equal(running.latestTurn?.requestedAt,'now');
  const complete=applyThreadItem(running,{kind:'event',event:{sequence:3,type:'thread.session-set',payload:{session:{status:'ready',activeTurnId:null}}}}).state;
  assert.equal(renderInlineTurn(complete,'turn','thread','complete'),'> Answer\n');
});

test('tables and code fences leave the quote while surrounding prose stays quoted',()=>{
  const answer='Before the table.\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n\nBetween blocks.\n\n```ts\nconst value = 1;\n```\n\nAfter the code.';
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:answer,streaming:false}],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'answer'}} as any;
  assert.equal(renderInlineTurn(state,'turn','thread','complete'),'> Before the table.\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n\n> Between blocks.\n\n```ts\nconst value = 1;\n```\n\n> After the code.\n');
});

test('Markdown headings leave the quote while surrounding prose remains quoted',()=>{
  const answer='Intro\n\n## Section\n\nBody\n\n### Detail\n\nMore body\n\n```md\n## Example only\n```';
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:answer,streaming:false}],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'answer'}} as any;
  assert.equal(renderInlineTurn(state,'turn','thread','complete'),'> Intro\n\n## Section\n\n> Body\n\n### Detail\n\n> More body\n\n```md\n## Example only\n```\n');
});

test('a growing table stays literal until a block boundary, then renders without losing text',()=>{
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:'Intro\n\n| Name | Value |',streaming:true}],activities:[]} as any;
  assert.match(renderInlineTurn(state,'turn','thread'),/stream-tail">\| Name \| Value \|<\/span>/);
  state.messages[0].text+='\n| --- | --- |\n| A | 1 |\n\n';
  assert.match(renderInlineTurn(state,'turn','thread'),/> Intro\n\n\| Name \| Value \|\n\| --- \| --- \|\n\| A \| 1 \|\n\n\n<span class="send-to-t3-response-activity"/);
});

test('an unfinished code fence stays literal and formats once the block is complete',()=>{
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:'Intro\n\n```ts\nconst value = 1;',streaming:true}],activities:[]} as any;
  assert.match(renderInlineTurn(state,'turn','thread'),/stream-tail">```ts&#10;const value = 1;<\/span>/);
  state.messages[0].text+='\n```\n\nDone.';
  assert.match(renderInlineTurn(state,'turn','thread'),/```ts\nconst value = 1;\n```\n>\n> <span class="send-to-t3-stream-tail">Done\.<\/span>/);
});

test('pipes inside fences, escaped pipes, and prose do not create tables',()=>{
  const answer='A | B\n\n```md\n| Head | Cell |\n| --- | --- |\n```\n\n| Name | Value |\n| --- | --- |\n| A \\| B | 1 |\n\nEnd.';
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:answer,streaming:false}],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'answer'}} as any;
  const rendered=renderInlineTurn(state,'turn','thread','complete');
  assert.match(rendered,/> A \| B\n\n```md\n\| Head \| Cell \|\n\| --- \| --- \|\n```\n\n\| Name \| Value \|\n\| --- \| --- \|\n\| A \\| B \| 1 \|\n\n> End\.\n$/);
});

test('vault image aliases remain in unquoted table rows after reply asset import',()=>{
  const answer='Before.\n\n| Case | Smoke evidence |\n| --- | --- |\n| Normal editor stream | ![[T3 Code Attachments/job/real-stream-result.png|Completed editor stream]] |\n| Limit-like failure and restart | ![[T3 Code Attachments/job/live-simulated-limit.png|Simulated limit error]] → ![[T3 Code Attachments/job/recovery-after-continue.png|Recovered response]] |\n| Attach a newer T3 turn | [[T3 Code Attachments/job/attach-after-click.png|Attached turn]] |\n\nAfter.';
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:answer,streaming:false}],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'answer'}} as any;
  assert.equal(renderInlineTurn(state,'turn','thread','complete'),'> Before.\n\n'+answer.slice('Before.\n\n'.length,-'\n\nAfter.'.length)+'\n\n> After.\n');
});


test('keeping intermediate responses retains only assistant prose for the selected turn',()=>{
  const state={messages:[
    {id:'old',role:'assistant',turnId:'old-turn',text:'Old answer',streaming:false},
    {id:'user',role:'user',turnId:'turn',text:'Question',streaming:false},
    {id:'progress',role:'assistant',turnId:'turn',text:'I will inspect it.\n\n',streaming:false},
    {id:'empty',role:'assistant',turnId:'turn',text:'',streaming:false},
    {id:'final',role:'assistant',turnId:'turn',text:'Final answer.',streaming:false},
  ],activities:[{id:'tool',kind:'tool.started',summary:'Tool details',turnId:'turn'}],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final'}};
  assert.equal(renderInlineTurn(state,'turn','thread','complete',true),'> I will inspect it.\n>\n> Final answer.\n');
  assert.equal(renderInlineTurn(state,'turn','thread','complete',false),'> Final answer.\n');
  assert.equal(renderInlineTurn(state,'turn','thread','complete'),'> Final answer.\n');
  assert.equal(renderInlineTurn(state,'turn','thread','running',true),renderInlineTurn(state,'turn','thread','running',false));
});

test('initial question stays first through streaming, final-only completion, errors and steering',()=>{
  const id='f95a3b36-7393-4508-9fb3-38aa2da3590f',input={messageId:'question',text:'Why?\n\n**T3 · Error**'};
  const initial=initialRegion(id,input);
  assert.deepEqual(activeInlineIds(initial.text),[id]);
  assert.deepEqual(failedInlineIds(initial.text),[],'quoted user text cannot impersonate status');
  const state={messages:[{id:'progress',role:'assistant' as const,text:'Progress.',turnId:'turn',streaming:false},{id:'final',role:'assistant' as const,text:'Final.',turnId:'turn',streaming:false}],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final'}};
  const final=renderInlineTurn(state,'turn','thread','complete',false,undefined,undefined,input);
  assert.match(final,/^> \[!t3-steering\] You[\s\S]*> Final\./);
  assert.doesNotMatch(final,/Progress\.|T3 · Working/);
  const error=renderInlineTurn(state,'turn','thread','error',false,undefined,undefined,input);
  assert.deepEqual(failedInlineIds(initial.text.replace(regionBody(initial.text,id)!.body,error)),[id]);
  const steered=renderInlineTurn(state,'turn','thread','complete',false,undefined,{messages:state.messages,steering:[{messageId:'steer',text:'More detail.',before:[state.messages[0]],confirmed:true}]},input);
  assert.match(steered,/> Why\?[\s\S]*> Progress\.[\s\S]*> More detail\.[\s\S]*> Final\./);
});

test('canonical thread names label active replies and disappear on completion',()=>{
  const id='f95a3b36-7393-4508-9fb3-38aa2da3590f',region=initialRegion(id);
  const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{title:'Alpha **plan** <script>',messages:[],activities:[]}}}).state;
  const progress=renderInlineTurn(state,'turn','thread');
  assert.match(progress,/Alpha \\\*\\\*plan\\\*\\\* &lt;script&gt; · Working/);assert.doesNotMatch(progress,/<script>/);
  const change=replaceRegion(region.text,id,region.bodyHash,progress)!;
  const document=region.text.slice(0,change.from)+change.text+region.text.slice(change.to);
  assert.deepEqual(activeInlineIds(document),[id]);
  assert.equal(renderInlineTurn(state,'turn','thread','complete'),'');
  state.messages=[{id:'final',role:'assistant',text:'Final answer.',turnId:'turn',streaming:false}];
  for(const keepIntermediate of [false,true]){
    assert.equal(renderInlineTurn(state,'turn','thread','complete',keepIntermediate),'> Final answer.\n');
    assert.equal(renderInlineTurn(state,'turn','thread','complete',keepIntermediate,undefined,undefined,{messageId:'question',text:'Question?'},'Prepared title'),'> [!t3-steering] You\n> Question?\n\n> Final answer.\n');
  }
  const updated=applyThreadItem(state,{kind:'snapshot',snapshot:{thread:{title:'Beta',messages:[],activities:[]}}}).state;
  assert.match(renderInlineTurn(updated,'turn','thread'),/^\*\*Beta · Working/);
});

test('selection overlap includes any tracked block and its boundaries, but excludes adjacent note text',()=>{
  const a='f95a3b36-7393-4508-9fb3-38aa2da3590f',b='915e8577-9bbc-463c-88c6-e6c2d3e24c3b';
  const document='Before'+initialRegion(a).text+'Between'+initialRegion(b).text+'After';
  for(const id of [a,b]){
    const region=regionBody(document,id)!;
    assert.equal(selectionOverlapsInlineResponse(document,{start:region.from,end:region.from+3}),true);
    assert.equal(selectionOverlapsInlineResponse(document,{start:0,end:region.from+3}),true);
    assert.equal(selectionOverlapsInlineResponse(document,{start:region.to,end:document.length}),true);
  }
  assert.equal(selectionOverlapsInlineResponse(document,{start:0,end:6}),false);
  assert.equal(selectionOverlapsInlineResponse(document,{start:document.length-5,end:document.length}),false);
});

test('a title-only event replaces the prepared header without requiring answer text',()=>{
  const initial={title:'New thread',messages:[],activities:[]};
  const updated=applyThreadItem(initial,{kind:'event',event:{sequence:2,type:'thread.metadata-updated',payload:{title:'Generated canonical title'}}}).state;
  assert.match(renderInlineTurn(updated,'','thread'),/^\*\*Generated canonical title · Working/);
  const restored=applyThreadItem(initial,{kind:'snapshot',snapshot:{thread:{title:'Generated canonical title',messages:[],activities:[]}}}).state;
  assert.match(renderInlineTurn(restored,'','thread'),/^\*\*Generated canonical title · Working/);
});
