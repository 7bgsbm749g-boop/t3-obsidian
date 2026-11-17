import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {itemActivities,normalizeV2Snapshot,normalizeV2StreamItem} from '../src/connection/orchestration-v2';
import {applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,renderInlineTurn,type InlineThreadState} from '../src/conversations/inline-thread';
import {responseEmissions} from '../src/responses/response-emissions';
import {responseToolGroups} from '../src/responses/response-tools';
import {observeIncoming} from '../src/conversations/inline-steering';
import {chatTimeline} from '../src/conversations/chat-timeline';
import {installSubagentLinks,parseSubagentUrl,renderSubagent,subagentUrl} from '../src/responses/response-subagents';
import {reconcileResponseDOM} from '../src/responses/response-dom';
const at=(n:number)=>new Date(n*1000).toISOString();
const source={environmentId:'environment',threadId:'parent'};
const reference={...source,version:1 as const,runId:'run',subagentId:'task'};
const child={id:'task',runId:'run',title:'Review configuration',status:'running',origin:'app_owned',childThreadId:'child',driver:'codex',model:'gpt-test',startedAt:at(2),progress:'Checking **configuration**.'};
function snapshot(){return applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot({snapshotSequence:1,projection:{thread:{id:'parent',projectId:'project'},runs:[{id:'run',ordinal:1,status:'running',userMessageId:'prompt',requestedAt:at(0)}],messages:[{id:'prompt',role:'user',runId:'run',text:'Review',createdAt:at(0),streaming:false},{id:'prose',role:'assistant',runId:'run',text:'Parent commentary.',createdAt:at(5),streaming:false}],subagents:[child],turnItems:[{...child,id:'item',subagentId:'task',type:'subagent',ordinal:2,updatedAt:at(2)}],runtimeRequests:[]}})}).state;}
const event=(state:InlineThreadState,n:number,type:string,payload:any)=>applyThreadItem(state,normalizeV2StreamItem({kind:'event',sequence:n,event:{type,payload}})).state;

test('subagent rows retain timeline position, status, preview and a checked sidebar link instead of a tool row',()=>{
 let state=snapshot();
 assert.equal(responseToolGroups(state,['run']).length,0);
 const rendered=renderInlineTurn(state,'run','parent','running','collapse',source.environmentId);
 const {document}=parseHTML(rendered);const row=document.querySelector('a.send-to-t3-subagent')!;
 assert.ok(row);assert.equal(row.querySelector('.send-to-t3-subagent-title')?.textContent,child.title);
 assert.equal(row.querySelector('.send-to-t3-subagent-detail')?.textContent,'Checking **configuration**.');
 assert.deepEqual(parseSubagentUrl(row.getAttribute('href')!),reference);
 assert.ok(rendered.indexOf('send-to-t3-subagent')<rendered.indexOf('Parent commentary.'));
 state=event(state,2,'subagent.updated',{...child,status:'completed',completedAt:at(10),result:'**Configuration** is valid.'});
 state=event(state,3,'turn-item.updated',{id:'notice',runId:'run',type:'notification',status:'completed',ordinal:4,startedAt:at(10),updatedAt:at(10),summary:'Task completed',source:{kind:'delegated_task',taskIds:['task'],childThreadId:'child'},outcome:'completed'});
 const output=renderInlineTurn(state,'run','parent','running','collapse',source.environmentId);
 const after=parseHTML(output).document;
 assert.equal(after.querySelectorAll('.send-to-t3-subagent').length,2);
 assert.doesNotMatch(output,/\[!t3-notification\]/);assert.match(output,/Finished/);assert.match(output,/data-t3-end="10000"/);
 assert.equal(after.querySelectorAll('a[href^="t3-subagent:"]').length,2);
 assert.equal(chatTimeline(state,source)[0].history?.filter(entry=>entry.text.includes('send-to-t3-subagent')).length,2);
});

test('turn-item-only snapshots and live item updates retain child navigation and bounded metadata through reload',()=>{
 let state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot({snapshotSequence:1,projection:{thread:{id:'parent',projectId:'project'},runs:[{id:'run',ordinal:1,status:'running',userMessageId:'prompt'}],messages:[],turnItems:[{...child,id:'item',subagentId:'task',type:'subagent',ordinal:1,prompt:'Private child prompt',result:'x'.repeat(100000),progress:'Working'}]}})}).state;
 state=event(state,2,'turn-item.updated',{...child,id:'item',subagentId:'task',type:'subagent',status:'completed',completedAt:at(10),result:'Done <script>alert(1)</script>',ordinal:1});
 const checkpoint=JSON.parse(JSON.stringify(inlineBindingCheckpoint(state)));
 assert.doesNotMatch(JSON.stringify(checkpoint),/Private child prompt/);
 assert.ok(JSON.stringify(checkpoint).length<10000);
 assert.equal(checkpoint.subagents.task.result,undefined);
 const recovered=restoreInlineBindings({messages:[],activities:[]},checkpoint);
 const emissions=responseEmissions(recovered,['run'],text=>text,undefined,source);
 assert.equal(emissions.length,1);assert.match(emissions[0].body,/t3-subagent:/);assert.match(emissions[0].body,/&lt;script&gt;/);assert.doesNotMatch(emissions[0].body,/<script>/);
 assert.equal(recovered.subagents?.task.childThreadId,'child');
});

test('structured delivery inputs use their task rows while unknown notifications and ordinary agent messages remain visible',()=>{
 const state=snapshot();
 state.messages.push({id:'delivery',turnId:'run',role:'user',text:'Raw task report',streaming:false,createdBy:'agent',delegatedCompletion:{parentRunId:'run',generation:1,taskIds:['task']}});
 assert.equal(observeIncoming(state,['run']).some(input=>input.messageId==='delivery'),false);
 assert.equal(observeIncoming({...state,subagents:{}},['run']).some(input=>input.messageId==='delivery'),true);
 state.messages.at(-1)!.delegatedCompletion!.taskIds.push('missing');
 assert.equal(observeIncoming(state,['run']).some(input=>input.messageId==='delivery'),true,'partial metadata must not hide unrepresented delivery text');
 state.activities.push({id:'unknown',kind:'response.notification',turnId:'run',createdAt:at(11),summary:'Delegated task "not metadata" finished'});
 assert.match(responseEmissions(state,['run'],text=>text).map(row=>row.body).join(''),/\[!t3-notification\] Notice/);
 const noThread=renderSubagent({...child,childThreadId:null});assert.doesNotMatch(noThread,/href=|chevron-right/);
 assert.match(renderSubagent({...child,remoteChild:{environmentId:'other',threadId:'remote',label:'Remote machine'}},source),/on Remote machine/);
});

test('note and sidebar work retain images beside subagents after merging streamed image support',()=>{
 const current=snapshot();current.messages=current.messages.filter(message=>message.role==='user');
 current.activities.push(...itemActivities({id:'image',runId:'run',type:'dynamic_tool',toolName:'view_image',input:{path:'/fixture/synthetic.png'},status:'completed',ordinal:3,startedAt:at(3),updatedAt:at(3)}));
 const note=renderInlineTurn(current,'run','parent','running','collapse',source.environmentId);
 const sidebar=chatTimeline(current,source)[0].history!.map(entry=>entry.text).join('\n');
 for(const rendered of [note,sidebar]){
  assert.equal((rendered.match(/```t3-image/g)??[]).length,1);
  assert.equal((rendered.match(/data-t3-subagent-key=/g)??[]).length,1);
  assert.ok(rendered.indexOf('data-t3-subagent-key=')<rendered.indexOf('```t3-image'));
 }
});

test('subagent URLs reject malformed and executable content, and titles/results cannot inject markup',()=>{
 assert.deepEqual(parseSubagentUrl(subagentUrl(reference)),reference);
 for(const url of ['javascript:alert(1)','t3-subagent:%','t3-subagent:'+encodeURIComponent(JSON.stringify({...reference,threadId:'bad\nthread'})),subagentUrl({...reference,subagentId:''})])assert.equal(parseSubagentUrl(url),undefined);
 const rendered=renderSubagent({...child,title:'<img onerror="bad">',displayDetail:'<script>bad</script>'},source);
 assert.doesNotMatch(rendered,/<img|<script|onerror="bad"/);assert.match(rendered,/&lt;img/);
});

test('saved and live links share one document handler, deduplicate clicks, report errors and dispose',async()=>{
 const {document,window}=parseHTML(`<html><body>${renderSubagent(child,source)}</body></html>`);
 const opened:unknown[]=[],errors:unknown[]=[];let finish!:()=>void;
 const stop=installSubagentLinks(document,async ref=>{opened.push(ref);await new Promise<void>(resolve=>{finish=resolve;});},error=>errors.push(error));
 const link=document.querySelector('a')!;
 const click=()=>link.firstElementChild!.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));
 click();click();await Promise.resolve();assert.deepEqual(opened,[reference]);finish();await new Promise(resolve=>setTimeout(resolve,0));
 stop();click();await Promise.resolve();assert.equal(opened.length,1);assert.equal(errors.length,0);
 const failure=installSubagentLinks(document,async()=>{throw Error('Disconnected');},error=>errors.push(error));
 click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal((errors[0] as Error).message,'Disconnected');failure();
});

test('live row reconciliation preserves child link nodes and updates their status in place',()=>{
 const {document}=parseHTML('<html><body></body></html>');
 const current=document.createElement('div'),incoming=document.createElement('div');current.innerHTML=renderSubagent(child,source);
 const link=current.querySelector('a');incoming.innerHTML=renderSubagent({...child,status:'completed',completedAt:at(12),displayDetail:'Review complete.'},source);
 reconcileResponseDOM(current,incoming);
 assert.equal(current.querySelector('a'),link);assert.equal(link?.getAttribute('data-t3-subagent-status'),'completed');assert.match(current.textContent!,/Review complete/);
});

test('a subagent entry separates tool batches so later calls cannot move before the row',()=>{
 const state=snapshot();state.messages=[];
 state.activities.unshift({id:'before',kind:'tool.completed',turnId:'run',createdAt:at(1),sequence:1,summary:'Tool',payload:{toolCallId:'before',status:'completed',data:{toolName:'exec_command',command:'before'}}});
 state.activities.push({id:'after',kind:'tool.completed',turnId:'run',createdAt:at(3),sequence:3,summary:'Tool',payload:{toolCallId:'after',status:'completed',data:{toolName:'exec_command',command:'after'}}});
 assert.equal(responseToolGroups(state,['run']).length,2);
 const output=renderInlineTurn(state,'run','parent','running','collapse',source.environmentId);
 assert.ok(output.indexOf('before')<output.indexOf('send-to-t3-subagent'));
 assert.ok(output.indexOf('send-to-t3-subagent')<output.lastIndexOf('after'));
});

test('a resumed child keeps its notice identity distinct from its original task row',()=>{
 const running={...child,startedAt:at(20)},notice={id:'notice',outcome:'completed',createdAt:at(10)};
 const {document}=parseHTML(renderSubagent(running,source)+renderSubagent(running,source,notice));
 const rows=Array.from(document.querySelectorAll('.send-to-t3-subagent'));
 assert.equal(new Set(rows.map(row=>row.getAttribute('data-t3-subagent-key'))).size,2);
 assert.ok(rows.every(row=>row.getAttribute('data-t3-subagent-status')==='running'));
 assert.equal(parseHTML(renderSubagent(child,source,notice)).document.querySelector('.send-to-t3-subagent')?.getAttribute('data-t3-subagent-key'),rows[1].getAttribute('data-t3-subagent-key'));
});


test('a grouped task notice preserves every known completion row and its event time',()=>{
 const state=snapshot();state.subagents!.task={...state.subagents!.task,status:'completed',completedAt:at(10),displayDetail:'First result'};
 state.subagents!.second={...state.subagents!.task,id:'second',title:'Second review',childThreadId:'second-child',displayDetail:'Second result'};
 state.activities.push({id:'batch',kind:'response.notification',turnId:'run',createdAt:at(11),summary:'Both tasks finished',payload:{text:'Both tasks finished',source:{kind:'delegated_task',taskIds:['task','second','task']},outcome:'completed'}});
 const batch=responseEmissions(state,['run'],text=>text,undefined,source).find(item=>item.id==='batch')!;
 const doc=parseHTML(batch.body).document,rows=Array.from(doc.querySelectorAll('.send-to-t3-subagent'));
 assert.deepEqual(rows.map(row=>row.getAttribute('data-t3-subagent-id')),['task','second']);
 assert.equal(new Set(rows.map(row=>row.getAttribute('data-t3-subagent-key'))).size,2);
 for(const row of rows){assert.equal(row.getAttribute('aria-description'),'Finished');assert.equal(row.querySelector('time')?.getAttribute('data-t3-notification-at'),'11000');}
 assert.match(batch.body,/First result/);assert.match(batch.body,/Second result/);assert.doesNotMatch(batch.body,/\[!t3-notification\]/);
});

test('a partially known batch retains the original notice instead of hiding unknown task outcomes',()=>{
 const state=snapshot();state.activities.push({id:'partial',kind:'response.notification',turnId:'run',summary:'Other task failed',payload:{text:'The unprojected task failed; retain these details.',source:{kind:'delegated_task',taskIds:['task','unknown']},outcome:'failed'}});
 const notice=responseEmissions(state,['run'],text=>text,undefined,source).find(item=>item.id==='partial')!;
 assert.match(notice.body,/The unprojected task failed; retain these details/);assert.match(notice.body,/\[!t3-notification\]/);
});
