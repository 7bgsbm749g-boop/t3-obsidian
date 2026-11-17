import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatTimeline} from '../src/conversations/chat-timeline';
import {responseWork} from '../src/responses/response-work';
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


test('waking children keep a completed parent open until the result is delivered',()=>{
 const state=thread();state.subagents={child:{id:'child',runId:'run',status:'running',origin:'app_owned',completionWake:'always'}};
 const [waiting]=chatTimeline(state);assert.equal(waiting.active,true);assert.equal(waiting.final,undefined);assert.equal(waiting.timing?.finishedAt,undefined);assert.match(waiting.label,/Waiting for 1 subagent/);
 state.subagents.child.status='completed';state.subagents.child.completionDelivery={state:'pending'};
 assert.equal(chatTimeline(state)[0].active,true);
 state.subagents.child.completionDelivery={state:'delivered'};
 const [done]=chatTimeline(state);assert.equal(done.active,false);assert.equal(done.final?.id,'answer');assert.equal(done.timing?.finishedAt,end);
});

test('sidebar keeps the latest generated HTML page in chronological work history',()=>{
 const state=thread(),source={environmentId:'env',threadId:'thread'};
 const html=(id:string,revision:string,title:string)=>({id,summary:title,kind:'response.html',turnId:'run',createdAt:start,sequence:2,payload:{itemId:'page',revision,htmlRender:{attachmentId:'synthetic_html',title,height:300}}});
 state.activities=[html('old','1','Old page'),html('new','2','Generated page')];
 const [segment]=chatTimeline(state,source),pages=segment.history!.filter(row=>row.text.includes('```t3-html'));
 assert.equal(pages.length,1);assert.match(pages[0].text,/Generated page/);assert.doesNotMatch(pages[0].text,/Old page/);assert.match(pages[0].text,/"environmentId":"env"/);assert.match(segment.work,/synthetic_html/);
 assert.equal(chatTimeline(state)[0].history?.filter(row=>row.text.includes('```t3-html')).length,0);
});
