import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyThreadItem,endInsertionOffset,initialRegion,insertionOffset,regionBody,renderInlineTurn,replaceRegion,selectionAnchor,turnForMessage,turnPhase} from '../inline-thread';

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

test('stream deltas, final replacement, snapshots, status, and fence balancing render without duplicate text',()=>{
  let state={messages:[],activities:[]} as any;
  const event=(sequence:number,text:string,streaming:boolean)=>({kind:'event',event:{sequence,type:'thread.message-sent',payload:{messageId:'m1',role:'assistant',text,streaming,turnId:'turn'}}});
  state=applyThreadItem(state,event(1,'Here is\n',true)).state;
  state=applyThreadItem(state,event(2,'```ts\nconst x = 1;',true)).state;
  assert.match(renderInlineTurn(state,'turn','thread'),/```ts\nconst x = 1;\n```\n$/);
  state=applyThreadItem(state,event(3,'Here is ```ts\nconst x = 2;\n```',false)).state;
  assert.equal(state.messages[0].text,'Here is ```ts\nconst x = 2;\n```');
  state=applyThreadItem(state,{kind:'event',event:{sequence:4,type:'thread.activity-appended',payload:{activity:{id:'a1',kind:'approval.requested',summary:'Review the command',turnId:'turn'}}}}).state;
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
  assert.equal(turnForMessage({...state,latestTurn:{turnId:'other-turn',state:'completed',requestedAt:'2026-09-26T14:06:07.000Z'}},'our-message'),undefined);
  assert.equal(renderInlineTurn(state,'provider-turn','thread','complete'),'> Answer\n');
});

test('streamed numbered Markdown is marker-safe across trailing newlines',()=>{
  const id='numbered',region=initialRegion(id),source='Question\n'+region.text+'Following paragraph';
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:'1. First line.\n2. Second line.\n',streaming:true}],activities:[]};
  const rendered=renderInlineTurn(state,'turn','thread');
  assert.equal(rendered,'**T3 · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n\n> 1. First line.\n> 2. Second line.\n');
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

test('a partial table stays quoted until its delimiter arrives, then reflows without losing text',()=>{
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:'Intro\n\n| Name | Value |',streaming:true}],activities:[]} as any;
  assert.match(renderInlineTurn(state,'turn','thread'),/> \| Name \| Value \|\n$/);
  state.messages[0].text+='\n| --- | --- |\n| A | 1 |';
  assert.match(renderInlineTurn(state,'turn','thread'),/> Intro\n\n\| Name \| Value \|\n\| --- \| --- \|\n\| A \| 1 \|\n$/);
});

test('an unfinished code fence renders outside the quote with a temporary close',()=>{
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:'Intro\n\n```ts\nconst value = 1;',streaming:true}],activities:[]} as any;
  assert.match(renderInlineTurn(state,'turn','thread'),/> Intro\n\n```ts\nconst value = 1;\n```\n$/);
  state.messages[0].text+='\n```\n\nDone.';
  assert.match(renderInlineTurn(state,'turn','thread'),/> Intro\n\n```ts\nconst value = 1;\n```\n\n> Done\.\n$/);
});

test('pipes inside fences, escaped pipes, and prose do not create tables',()=>{
  const answer='A | B\n\n```md\n| Head | Cell |\n| --- | --- |\n```\n\n| Name | Value |\n| --- | --- |\n| A \\| B | 1 |\n\nEnd.';
  const state={messages:[{id:'answer',role:'assistant',turnId:'turn',text:answer,streaming:false}],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'answer'}} as any;
  const rendered=renderInlineTurn(state,'turn','thread','complete');
  assert.match(rendered,/> A \| B\n\n```md\n\| Head \| Cell \|\n\| --- \| --- \|\n```\n\n\| Name \| Value \|\n\| --- \| --- \|\n\| A \\| B \| 1 \|\n\n> End\.\n$/);
});
