import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatTimeline} from '../src/conversations/chat-timeline';
import {responseWork} from '../src/responses/response-work';
import {readChatObservations} from '../src/conversations/chat-observations';
import {composerModels,composerModelLabel} from '../src/conversations/composer-models';
import type {InlineThreadState} from '../src/conversations/inline-thread';
const start='2026-11-16T12:00:00Z',end='2026-11-16T12:00:21Z';
function thread():InlineThreadState{return {messages:[{id:'input',role:'user',text:'Question\n\nSent from Obsidian.\nVault: Synthetic\nNote: Fixture.md',turnId:'run',streaming:false,createdAt:start},{id:'progress',role:'assistant',text:'Checking the source.',turnId:'run',streaming:false,createdAt:start},{id:'answer',role:'assistant',text:'The final answer.',turnId:'run',streaming:false,createdAt:end}],activities:[],turns:{run:{turnId:'run',state:'completed',startedAt:start,completedAt:end}},session:{status:'ready',activeTurnId:null}};}
test('canonical input, work history and final answer have separate chronological ownership',()=>{
 const state=thread(),[segment]=chatTimeline(state);assert.equal(segment.input?.text,'Question');assert.equal(segment.progress.length,1);assert.equal(segment.final?.id,'answer');assert.equal(segment.label,'Worked');assert.deepEqual(segment.timing,{startedAt:start,finishedAt:end});
 state.turns!.run.state='running';state.session={status:'running',activeTurnId:'run'};state.messages.at(-1)!.streaming=true;
 const [live]=chatTimeline(state);assert.equal(live.active,true);assert.equal(live.final,undefined);assert.match(live.work,/Thinking/);assert.equal(live.progress.at(-1)?.id,'answer');
});
test('steering creates a continuation segment and keeps live work beside the latest input',()=>{
 const state=thread();state.turns!.run.state='running';state.session={status:'running',activeTurnId:'run'};state.messages.push({id:'steer',role:'user',text:'Change direction',turnId:'run',streaming:false,createdAt:end});
 const [before,after]=chatTimeline(state);assert.equal(before.active,false);assert.equal(after.active,true);assert.equal(after.steer,true);assert.equal(before.work,'');assert.match(after.work,/Thinking/);
});
test('sidebar and stream projections share canonical tool and emission rows',()=>{
 const state=thread();state.activities=[{id:'read',turnId:'run',kind:'tool.completed',createdAt:start,summary:'Read',payload:{data:{toolName:'Read',input:{path:'synthetic.ts'}},status:'completed'}}];
 const rows=responseWork(state,['run'],'run','complete','collapse',false,text=>text).historyRows;
 assert.ok(rows.length);assert.equal(chatTimeline(state)[0].work,rows.map(row=>row.body).join('\n\n'));
});
test('composer catalog exposes only available providers and their actual option values',()=>{
 const models=composerModels({providers:[{instanceId:'off',enabled:false,models:[{slug:'hidden'}]},{instanceId:'codex',enabled:true,driver:'codex',displayName:'Codex',models:[{slug:'sol',name:'6.1 Sol',capabilities:{optionDescriptors:[{id:'reasoningEffort',label:'Reasoning',role:'reasoning',type:'select',options:[{id:'xhigh',label:'Extra High'}]}]}}],skills:[{name:'example',path:'/synthetic/SKILL.md',enabled:true}],slashCommands:[{name:'compact'}]}]});
 assert.equal(models.length,1);assert.equal(models[0].skills[0].name,'example');assert.equal(models[0].commands[0].name,'compact');assert.equal(composerModelLabel({instanceId:'codex',model:'sol',options:[{id:'reasoningEffort',value:'xhigh'}]},models),'6.1 Sol Extra High');
});
test('recovered commentary cannot replace the canonical final answer',()=>{
 const state=thread();state.latestTurn={...state.turns!.run,assistantMessageId:'progress'};
 state.messages.push({id:'recovered',role:'assistant',text:'Recovered commentary.',turnId:'run',streaming:false,createdAt:'2026-11-16T12:00:10Z'});
 const [segment]=chatTimeline(state);
 assert.equal(segment.final?.id,'answer');assert.deepEqual(segment.progress.map(message=>message.id),['progress','recovered']);
 assert.ok(!segment.history!.some(row=>row.text==='The final answer.'));
});
test('same-message growth splits at the saved steering boundary and finishes below the input',()=>{
 const state=thread(),growing={id:'growing',role:'assistant',text:'Before steering.\n\nAfter steering.',turnId:'run',streaming:true,createdAt:'2026-11-16T12:00:01Z'};
 state.messages=[state.messages[0],growing,{id:'steer',role:'user',text:'Change direction',turnId:null,streaming:false,createdAt:'2026-11-16T12:00:10Z'}];
 state.inputTurns={steer:'run'};state.inputBoundaries={steer:[{...growing,text:'Before steering.\n\n'}]};state.turns!.run.state='running';state.session={status:'running',activeTurnId:'run'};
 const [before,after]=chatTimeline(state);
 assert.equal(before.progress[0].text,'Before steering.\n\n');assert.equal(after.progress[0].text,'After steering.');assert.equal(after.input?.id,'steer');assert.equal(after.active,true);
 state.turns!.run={...state.turns!.run,state:'completed',assistantMessageId:'growing'};state.session={status:'ready',activeTurnId:null};growing.streaming=false;
 const completed=chatTimeline(state);assert.equal(completed[1].final?.text,'After steering.');assert.equal(completed[0].progress[0].text,'Before steering.\n\n');
});
test('sidebar tool results retain native image and HTML references with their source identity',()=>{
 const state=thread(),createdAt='2026-11-16T12:00:10Z';
 state.activities=[{id:'image',kind:'response.image',turnId:'run',summary:'Image',createdAt,payload:{itemId:'image-item',imageSources:[{kind:'file',path:'/synthetic/chart.png'}]}},{id:'html',kind:'response.html',turnId:'run',summary:'Chart',createdAt,payload:{itemId:'html-item',htmlRender:{attachmentId:'synthetic-chart',title:'Chart',height:200}}}];
 const [segment]=chatTimeline(state,{environmentId:'env',threadId:'thread'});
 assert.equal((segment.work.match(/```t3-image/g)??[]).length,1);assert.equal((segment.work.match(/```t3-html/g)??[]).length,1);assert.match(segment.work,/"environmentId":"env","threadId":"thread","runId":"run"/);
 assert.doesNotMatch(chatTimeline(state)[0].work,/```t3-(?:image|html)/);
});
test('cold detail snapshots associate null-turn steering and keep later final text below it',()=>{
 const state=thread();state.turns!.run={...state.turns!.run,messageId:'input',requestedAt:start,assistantMessageId:'answer'};
 state.messages=[state.messages[0],{...state.messages[2],createdAt:'2026-11-16T12:00:01Z',updatedAt:end},{id:'steer',role:'user',text:'Steering input',turnId:null,streaming:false,createdAt:'2026-11-16T12:00:10Z'}];
 const [before,after]=chatTimeline(state);assert.equal(before.final,undefined);assert.equal(after.steer,true);assert.equal(after.turnId,'run');assert.equal(after.final?.text,'The final answer.');assert.equal(after.active,false);assert.equal(after.timing?.finishedAt,end);
});
test('saved steering observations are bounded, exact and scoped to one source',()=>{
 const value={source:'env/project/thread',inputTurns:{steer:'run'},inputBoundaries:{steer:[{id:'reply',role:'assistant',turnId:'run',text:'Exact prefix.\n\n',streaming:true}]}};
 assert.equal(readChatObservations(value,value.source).inputBoundaries.steer[0].text,'Exact prefix.\n\n');assert.deepEqual(readChatObservations(value,'other').inputTurns,{});
 assert.deepEqual(readChatObservations({...value,inputBoundaries:{steer:[{...value.inputBoundaries.steer[0],text:'x'.repeat(1_000_001)}]}},value.source).inputBoundaries,{});
});
