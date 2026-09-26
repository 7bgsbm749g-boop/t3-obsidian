import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyThreadItem,initialRegion,insertionOffset,regionBody,renderInlineTurn,replaceRegion,selectionAnchor,turnPhase} from '../inline-thread';

test('selection anchor tolerates unrelated edits, rejects ambiguity, and inserts after fenced code',()=>{
  const source='Before\n```ts\nconst x = 1;\n```\nAfter';
  const selected='const x = 1;',start=source.indexOf(selected),anchor=selectionAnchor(source,selected,start,start+selected.length);
  assert.equal(insertionOffset(source,anchor),source.indexOf('After'));
  assert.equal(insertionOffset('New line\n'+source,anchor),'New line\n'.length+source.indexOf('After'));
  assert.throws(()=>insertionOffset('New line\n'+source+'\n'+selected,anchor),/moved or changed/);
  assert.throws(()=>insertionOffset('```ts\n'+selected,selectionAnchor('```ts\n'+selected,selected,6,6+selected.length)),/unclosed Markdown code fence/);
});

test('inline markers permit edits outside the response but stop on edits inside it',()=>{
  const id='abc',region=initialRegion(id);let document='Source\n'+region.text+'After';
  const edit=replaceRegion(document,id,region.bodyHash,'**T3 answer**\n\nFirst paragraph');assert.ok(edit);
  document=document.slice(0,edit.from)+edit.text+document.slice(edit.to);
  assert.equal(regionBody(document,id)?.body,'**T3 answer**\n\nFirst paragraph');
  document='User addition\n'+document;
  assert.ok(replaceRegion(document,id,edit.hash,'**T3 answer**\n\nNext paragraph'));
  document=document.replace('First paragraph','User edited the response');
  assert.equal(replaceRegion(document,id,edit.hash,'overwrite'),null);
  assert.equal(regionBody(document.replace('<!-- t3-inline:end:abc -->',''),id),null);
});

test('stream deltas, final replacement, snapshots, status, and fence balancing render without duplicate text',()=>{
  let state={messages:[],activities:[]} as any;
  const event=(sequence:number,text:string,streaming:boolean)=>({kind:'event',event:{sequence,type:'thread.message-sent',payload:{messageId:'m1',role:'assistant',text,streaming,turnId:'turn'}}});
  state=applyThreadItem(state,event(1,'Here is\n',true)).state;
  state=applyThreadItem(state,event(2,'```ts\nconst x = 1;',true)).state;
  assert.match(renderInlineTurn(state,'turn','thread'),/const x = 1;\n```$/);
  state=applyThreadItem(state,event(3,'Here is ```ts\nconst x = 2;\n```',false)).state;
  assert.equal(state.messages[0].text,'Here is ```ts\nconst x = 2;\n```');
  state=applyThreadItem(state,{kind:'event',event:{sequence:4,type:'thread.activity-appended',payload:{activity:{id:'a1',kind:'approval.requested',summary:'Review the command',turnId:'turn'}}}}).state;
  assert.match(renderInlineTurn(state,'turn','thread'),/Action needed in T3: Review the command/);
  state=applyThreadItem(state,{kind:'event',event:{sequence:5,type:'thread.session-set',payload:{session:{status:'ready',activeTurnId:null}}}}).state;
  assert.equal(turnPhase(state,'turn'),'complete');
  assert.doesNotMatch(renderInlineTurn(state,'turn','thread','complete'),/Action needed/);
  const snapshot={kind:'snapshot',snapshot:{snapshotSequence:20,thread:{messages:[{id:'m1',role:'assistant',text:'Canonical answer',streaming:false,turnId:'turn'}],activities:[],latestTurn:{turnId:'turn',state:'completed'},session:{status:'ready',activeTurnId:null}}}};
  const restored=applyThreadItem(state,snapshot);assert.equal(restored.sequence,20);assert.equal(restored.state.messages[0].text,'Canonical answer');
});
