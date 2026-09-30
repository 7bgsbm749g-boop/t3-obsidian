import {test} from 'node:test';
import assert from 'node:assert/strict';
import {steeringBoundary,steeringSegments,mergeProse,selectionRange} from '../inline-steering';
import {renderInlineTurn,selectionAnchor,type InlineMessage} from '../inline-thread';
const message=(id:string,text:string,streaming=false,turnId='turn'):InlineMessage=>({id,text,streaming,turnId,role:'assistant'});

test('steering boundaries retain complete paragraphs and do not split a live fence',()=>{
  const input=message('a','Complete paragraph.\n\n```ts\nconst a = 1;\n\nunfinished',true);
  assert.equal(steeringBoundary([input])[0].text,'Complete paragraph.\n\n');
  assert.equal(steeringBoundary([message('a','Partial paragraph',true)])[0].text,'');
  assert.equal(steeringBoundary([message('a','Complete paragraph.')])[0].text,'Complete paragraph.');
});

test('multiple steering quotes retain their position as one assistant message grows and reconnects',()=>{
  const first=message('a','First.\n\n'),second=message('a','First.\n\nSecond.\n\n');
  const inputs=[{messageId:'one',text:'Do this.',before:[first],confirmed:true},{messageId:'two',text:'Then this.',before:[second],confirmed:true}];
  assert.deepEqual(steeringSegments([message('a','First.\n\nSecond.\n\nThird.')],inputs).map(s=>[s.role,s.text.trim()]),[['assistant','First.'],['user','Do this.'],['assistant','Second.'],['user','Then this.'],['assistant','Third.']]);
  const prose=mergeProse([message('old','Previous turn.')],[message('new','Final.',false,'next')],['turn','next']);
  assert.equal(prose.length,2);
  const body=renderInlineTurn({messages:prose,activities:[]},'next','thread','complete',false,undefined,{messages:prose,steering:[{messageId:'one',text:'Continue differently.',before:[prose[0]],confirmed:true}]});
  assert.match(body,/> Previous turn\.[\s\S]*> \[!t3-steering\] You[\s\S]*> Continue differently\.[\s\S]*> Final\./);
  assert.doesNotMatch(body,/T3 · Working/);
});

test('a replaced final message keeps frozen pre-steering prose and renders the replacement after input',()=>{
  const input={messageId:'one',text:'Change direction.',before:[message('a','Earlier progress.')],confirmed:true};
  assert.deepEqual(steeringSegments([message('a','Revised final answer.')],[input]).map(s=>s.text),['Earlier progress.','Change direction.','Revised final answer.']);
});

test('selection relocation requires original text and context rather than deleting an unrelated match',()=>{
  const source='Before\nMy question\nAfter',anchor=selectionAnchor(source,'My question',7,18);
  assert.deepEqual(selectionRange('Outside edit\n'+source,anchor),{from:20,to:31});
  assert.equal(selectionRange('Other\nMy question\nChanged',anchor),null);
});

test('snapshot recovery places missed commentary before the already received final message',()=>{
  const progress={...message('progress','Progress.'),createdAt:'2026-09-30T03:53:00Z'};
  const ack={...message('ack','Acknowledged.'),createdAt:'2026-09-30T03:54:00Z'};
  const final={...message('final','Final.'),createdAt:'2026-09-30T03:57:00Z'};
  const prose=mergeProse([progress,final],[progress,ack,final],['turn']);
  assert.deepEqual(prose.map(m=>m.id),['progress','ack','final']);
});
