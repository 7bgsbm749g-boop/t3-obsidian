import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventSubscriptions,type NoteEventSnapshot} from '../event-subscriptions';
import {projectEventNote} from '../event-note-projection';
import {loadSmartSend,rememberResponse,rememberNoteEdits} from '../smart-send';
import {responseAnchor} from '../native-response-projection';
import type {ResponseRequest} from '../response-model';

function fixture(bindingAvailable=true){
  const binding={id:randomUUID(),notePath:'Synthetic.md'} as ResponseRequest,anchor=responseAnchor(binding.id),before='User opening.\n\n'+anchor+'\n\nUser ending.',body='Generated final answer.';
  let document=before,data=loadSmartSend(undefined),now=1000,deliveries=0;
  const snapshot=():NoteEventSnapshot=>({path:binding.notePath,content:document,properties:{}});
  const service=new EventSubscriptions({load:async()=>undefined,save:async()=>{},notes:async()=>[snapshot()],projectNote:note=>projectEventNote(note,data,bindingAvailable?[binding]:[]),validateTarget:async()=>{},isBusy:async()=>false,prepare:async()=>({}),deliver:async()=>{deliveries++;return 'delivered';},recording(){},now:()=>now,id:randomUUID});
  return {service,binding,anchor,before,body,snapshot,write:(text:string)=>{document=text;},advance:()=>{now+=2000;},copyProvenance:()=>{data=loadSmartSend(JSON.parse(JSON.stringify(data)));},remember:()=>rememberResponse(data,binding.notePath,binding.id,body,'User opening.\n\n','\n\nUser ending.',14),rememberEdit:(from:string,to:string)=>rememberNoteEdits(data,binding.notePath,binding.id,from,to),deliveries:()=>deliveries};
}
async function start(h:ReturnType<typeof fixture>){await h.service.initialize();await h.service.command({version:1,id:randomUUID(),kind:'subscribe',target:{threadId:'other-observer',projectId:'project',environmentId:'env'},scope:{path:h.binding.notePath,kind:'note',recursive:false},filter:{events:['modify']}});}

test('final materialization is silent while an independent user edit still produces one notification',async()=>{
  const h=fixture();await start(h);await h.remember();h.write(h.before.replace(h.anchor,h.body));
  await h.service.observe('modify',h.binding.notePath,h.snapshot());h.advance();await h.service.tick();assert.equal(h.deliveries(),0);
  h.write(h.snapshot().content+'\nUser addition.');await h.service.observe('modify',h.binding.notePath,h.snapshot());h.advance();await h.service.tick();assert.equal(h.deliveries(),1);h.service.stop();
});

test('a Sync receiver waits for delayed provenance and retains simultaneous user edits',async()=>{
  for(const bindingAvailable of [false,true])for(const userEdit of [false,true]){
    const h=fixture(bindingAvailable);await start(h);h.write(h.before.replace(h.anchor,h.body)+(userEdit?'\nUser addition.':''));
    await h.service.observe('modify',h.binding.notePath,h.snapshot());h.advance();await h.service.tick();assert.equal(h.deliveries(),0);assert.equal(h.service.snapshot.notifications.length,0);
    await h.remember();h.copyProvenance();await h.service.tick();h.advance();await h.service.tick();assert.equal(h.deliveries(),userEdit?1:0);h.service.stop();
  }
});

test('baselines reproject with newly available provenance and staged output stays separate from user changes',async()=>{
  const h=fixture();h.write(h.before.replace(h.anchor,h.body));await start(h);await h.remember();
  const before=h.snapshot().content,after=before.replace('User opening.','Agent replacement.');await h.rememberEdit(before,after);h.write(after);
  await h.service.observe('modify',h.binding.notePath,h.snapshot());h.advance();await h.service.tick();assert.equal(h.deliveries(),1,'removing previous user source remains a real change');
  h.service.stop();
});

test('deleting an empty response anchor does not wait for final provenance',async()=>{
  const h=fixture();await start(h);h.write(h.before.replace(h.anchor,''));await h.service.observe('modify',h.binding.notePath,h.snapshot());h.advance();await h.service.tick();
  assert.equal(h.deliveries(),0);h.write(h.snapshot().content+'\nUser addition.');await h.service.observe('modify',h.binding.notePath,h.snapshot());h.advance();await h.service.tick();assert.equal(h.deliveries(),1);h.service.stop();
});
