/** Synthetic source replay in an unsynced native vault. No T3 dispatch. */
import {Plugin,MarkdownRenderer,setIcon} from 'obsidian';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {itemActivities} from '../../src/connection/orchestration-v2';
import {renderInlineTurn,type InlineThreadState} from '../../src/conversations/inline-thread';
import {renderResponseToolGroup,responseToolGroups} from '../../src/responses/response-tools';
import {installResponsePresentation} from '../../src/responses/response-presentation';
import {renderApproval,pendingApprovals,parseApprovalUrl} from '../../src/interaction/approvals';
import {approvalButton} from '../../src/interaction/approval-ui';
import {ApprovalController} from '../../src/interaction/approval-controller';
import {QuestionController} from '../../src/interaction/question-controller';
import {QuestionModal} from '../../src/interaction/question-ui';
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export default class DesignParityLab extends Plugin {
 private root='';private before=false;private scenes:Record<string,unknown>={};private results:Array<{name:string;pass:boolean}>=[];
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  this.before=fs.existsSync(path.join(this.root,'REPLAY-BASELINE'));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated vault required');
  this.register(installResponsePresentation(document,setIcon));
  this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
 }
 private write(name:string,data:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
 private check(name:string,pass:boolean){this.results.push({name,pass});if(!pass&&!this.before)throw Error(name);}
 private async capture(name:string){await pause(350);const selectors={live:'.send-to-t3-response-activity',group:'details[data-t3-tool-group]',thought:'.send-to-t3-thought',tools:'.send-to-t3-tool',tasks:'.send-to-t3-tasks',compaction:'.send-to-t3-context',work:'.callout[data-callout=\"t3-progress\"] > .callout-title',approvals:'.send-to-t3-approval-button',questions:'.send-to-t3-question-dialog',navigation:'.send-to-t3-question-navigation',plan:'.send-to-t3-proposed-plan'};this.scenes[name]={viewport:{width:innerWidth,height:innerHeight},regions:Object.fromEntries(Object.entries(selectors).map(([key,selector])=>[key,Array.from(document.querySelectorAll(selector)).map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}).filter(r=>r.width>0&&r.height>0)]))};this.write('SCENES.json',this.scenes);fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
 private async cleanup(){for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);this.write('CLEANUP.json',{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),temporaryThreads:[],synced:false});}
 private async run(){
  const file=await this.app.vault.create('Design parity synthetic replay.md','# Synthetic design parity replay\n'),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
  await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});await pause(400);
  const container=(leaf.view as any).previewMode.containerEl as HTMLElement;
  const render=async(title:string,body:string)=>{container.empty();container.createEl('h2',{text:(this.before?'BEFORE · ':'AFTER · ')+title});container.createEl('p',{text:'Synthetic replay fixture · VPS native Obsidian · no real vault content or T3 run'});const target=container.createDiv({cls:'markdown-rendered'});await MarkdownRenderer.render(this.app,body,target,file.path,this);await pause(1100);return target;};
  const shared=path.dirname(this.root);
  const upstream=JSON.parse(fs.readFileSync(path.join(shared,'t3-summary.json'),'utf8'));
  let target=await render('T3 existing mixed summary — source renderer replay',upstream.markup);
  const css=target.createEl('style');css.textContent=fs.readFileSync(path.join(shared,'t3-worklog.css'),'utf8');
  this.check('T3 source summary excludes thoughts and limits action categories',!upstream.summary.includes('Thought')&&upstream.summary.includes('other action'));
  await this.capture('01-t3-existing-mixed.png');
  target=await render('Plugin existing mixed summary — baseline source replay',fs.readFileSync(path.join(shared,'baseline-group.html'),'utf8'));
  await this.capture('02-plugin-existing-mixed.png');
  const replayStart=Date.now()-12000;const at=(seconds:number)=>new Date(replayStart+seconds*1000).toISOString();
  const state:InlineThreadState={title:'Design parity replay',messages:[{id:'r1',turnId:'run',role:'reasoning',streaming:false,text:'**Checking release commit structure**\n\nPublic reasoning summary with a second sentence.',createdAt:at(1)},{id:'r2',turnId:'run',role:'reasoning',streaming:false,text:'Checking the visible activity rows.',createdAt:at(2)}],activities:[
   {id:'pr',turnId:'run',kind:'tool.completed',summary:'Tool',createdAt:at(3),payload:{toolCallId:'pr',status:'completed',data:{toolName:'mcp__t3_code__watch_pull_request',output:'OUTPUT MUST NOT APPEAR'}}},
   {id:'thread',turnId:'run',kind:'tool.completed',summary:'Tool',createdAt:at(4),payload:{toolCallId:'thread',status:'completed',data:{toolName:'mcp__t3_code__t3_thread_read',input:{threadId:'synthetic-thread'},output:{thread:{title:'Release checks',link:'t3-thread://v2/synthetic/synthetic-thread'}}}}},
   {id:'integration',turnId:'run',kind:'tool.completed',summary:'Tool',createdAt:at(5),payload:{toolCallId:'integration',status:'completed',data:{toolName:'mcp__calendar__list_events',toolSource:{key:'calendar',name:'Calendar',kind:'integration'},output:'OUTPUT MUST NOT APPEAR'}}},
  ],latestTurn:{turnId:'run',state:'running',startedAt:at(0)},session:{status:'running',activeTurnId:'run'}};
  target=await render('Thought count, live public preview, tool labels and flat rows',renderInlineTurn(state,'run','synthetic','running','collapse','synthetic',undefined,undefined,undefined,{startedAt:at(0)}));
  const live=target.querySelector<HTMLButtonElement>('[data-t3-open-tool-group]');this.check('live public heading is a button',!!live&&live.textContent!.includes('Checking the visible activity rows.'));
  if(live)live.click();else{const group=target.querySelector<HTMLDetailsElement>('details[data-t3-tool-group]');if(group)group.open=true;}await pause(350);if(this.before){const tool=target.querySelector<HTMLDetailsElement>('details.send-to-t3-tool');if(tool)tool.open=true;}
  this.check('click opens its real activity group',!!target.querySelector<HTMLDetailsElement>('details[data-t3-tool-group]')?.open);
  this.check('tools are flat and outputs absent',!target.querySelector('details.send-to-t3-tool')&&!target.textContent!.includes('OUTPUT MUST NOT APPEAR'));
  this.check('thread title is linked',!!target.querySelector('a[href="t3-thread://v2/synthetic/synthetic-thread"]'));
  await this.capture('03-live-thoughts-flat-tools.png');
  target=await render('Thought labels and count',renderResponseToolGroup({...responseToolGroups(state,['run'])[0],tools:[]}));
  const thoughtGroup=target.querySelector<HTMLDetailsElement>('details[data-t3-tool-group]');if(thoughtGroup)thoughtGroup.open=true;
  this.check('long thought is identified by its public summary',target.querySelector('details.send-to-t3-thought > summary')?.textContent?.includes('Checking release commit structure')===true);
  this.check('short thought is a labelled row without expansion',target.querySelector('div.send-to-t3-thought')?.textContent?.includes('Checking the visible activity rows.')===true);
  await this.capture('04-thought-count.png');
  const longThought=target.querySelector<HTMLDetailsElement>('details.send-to-t3-thought');if(longThought)longThought.querySelector<HTMLElement>('summary')?.click();
  this.check('long thought expands to its full public trace',!!longThought?.open&&longThought.textContent!.includes('Public reasoning summary with a second sentence.'));
  await this.capture('14-thought-expanded.png');
  const taskState:InlineThreadState={...state,messages:[{id:'before',turnId:'run',role:'assistant',streaming:false,text:'Before the task list.',createdAt:at(1)}],activities:[{id:'task1',turnId:'run',kind:'response.plan',summary:'Tasks',createdAt:at(2),payload:{steps:[{step:'Read request',status:'completed'},{step:'Verify active step',status:'running'},{step:'Finish review',status:'pending'}]}},{id:'compact',turnId:'run',kind:'context-compaction',summary:'Compaction',createdAt:at(3),payload:{status:'completed',beforeTokenCount:128000,afterTokenCount:32000}}]};
  target=await render('Timeline tasks and compaction token counts',renderInlineTurn(taskState,'run','synthetic','running','collapse','synthetic',undefined,undefined,undefined,{startedAt:at(0)}));const tasks=target.querySelector<HTMLDetailsElement>('.send-to-t3-tasks');if(tasks)tasks.open=true;
  this.check('v2 running is active',!!target.querySelector('[data-t3-task-state="in_progress"]'));
  this.check('task follows its prior commentary',target.textContent!.indexOf('Before the task list.')<target.textContent!.indexOf('Verify active step'));
  this.check('token counts survive rendering',target.textContent!.includes('128K → 32K tokens'));
  await this.capture('05-tasks-compaction.png');
  taskState.activities=[{id:'compact',turnId:'run',kind:'context-compaction',summary:'Compaction',createdAt:at(2),payload:{status:'inProgress'}}];
  target=await render('Live compaction elapsed time',renderInlineTurn(taskState,'run','synthetic','running','collapse','synthetic',undefined,undefined,undefined,{startedAt:at(0)}));this.check('compaction has native elapsed timer',!!target.querySelector('.send-to-t3-context .send-to-t3-run-timer'));await this.capture('06-compacting-time.png');
  const final={id:'final',turnId:'run',role:'assistant' as const,text:'Final answer remains outside both work folds.',streaming:false,createdAt:at(30)};
  const messages=[{id:'progress',turnId:'run',role:'assistant' as const,text:'Initial progress.',streaming:false,createdAt:at(5)},final];
  target=await render('Measured work and continuation segments',renderInlineTurn({...state,messages,activities:[],latestTurn:{turnId:'run',state:'completed',completedAt:at(30),assistantMessageId:'final'}},'run','synthetic','complete','collapse','synthetic',{messages,steering:[{messageId:'steer',text:'Keep the title.',confirmed:true,createdAt:at(12),before:[messages[0]]}]},undefined,undefined,{startedAt:at(0),finishedAt:at(30)}));
  this.check('steering produces separate folds',target.querySelectorAll('.callout[data-callout="t3-progress"]').length===2);this.check('segment durations and title remain',target.textContent!.includes('12s')&&target.textContent!.includes('18s')&&target.textContent!.includes('Continued for'));
  await this.capture('07-continuation-timing.png');
  const activities=['command','file-change','file-read','app-permission','app-access','mcp-elicitation'].map((kind,index)=>({id:kind,turnId:'run',kind:'approval.requested',summary:'Approval',payload:{requestId:kind,requestKind:kind,appName:index>2?'Synthetic app':undefined,options:index===5?[{decision:'acceptAlways',label:'Allow this scope',warning:'Remember this permission'},{decision:'cancel',label:'Cancel'}]:undefined}}));
  const controller=new ApprovalController(async()=>({origin:'https://synthetic.invalid',api:async()=>({thread:{id:'synthetic',activities}})}),{load:()=>[],save:()=>{}},()=>crypto.randomUUID());
  target=await render('Approval kinds and provider choices',pendingApprovals(activities).map(request=>renderApproval(request,{environmentId:'synthetic',threadId:'synthetic',requestId:request.requestId})).join('\n\n'));
  const disposers:Array<()=>void>=[];
  for(const link of Array.from(target.querySelectorAll<HTMLAnchorElement>('a[href^="t3-approval:"]'))){const parsed=parseApprovalUrl(link.getAttribute('href')!);if(parsed){const control=approvalButton(controller,parsed.target,parsed.decision,document);link.replaceWith(control.button);disposers.push(control.unsubscribe);}}
  await controller.refresh(pendingApprovals(activities).map(request=>({environmentId:'synthetic',threadId:'synthetic',requestId:request.requestId})));
  this.check('provider permission option is a real control',Array.from(target.querySelectorAll('button')).some(button=>button.textContent==='Allow this scope'&&!button.disabled));await this.capture('08-approval-options.png');disposers.forEach(dispose=>dispose());controller.dispose();
  await render('Note-tab question panel', 'The question remains attached to this native note tab.');
  const questionController=new QuestionController(async()=>({origin:'https://synthetic.invalid',api:async()=>({thread:{id:'synthetic',activities:[{id:'question',turnId:'run',kind:'user-input.requested',summary:'Question',payload:{requestId:'q',questions:[{id:'first',header:'Design',question:'Choose the next view.',options:[{label:'Timeline',description:'Keep tasks in chronological order.'},{label:'Compact',description:'Use less space.'}]},{id:'second',header:'Details',question:'Which details help?',multiSelect:true,options:[{label:'Progress',description:'Show answered count.'},{label:'Navigation',description:'Move between questions.'}]}]}}]}})}),{load:()=>[],save:()=>{}},()=>crypto.randomUUID());
  const panel=new QuestionModal(this.app,questionController,{environmentId:'synthetic',threadId:'synthetic',requestId:'q'},file.path);panel.open();await questionController.refresh([panel.target]);await this.capture('09-question-navigation.png');
  const nativeWindow=require('@electron/remote').getCurrentWindow(),bounds=nativeWindow.getBounds();
  await this.app.workspace.leftSplit.collapse();nativeWindow.setSize(430,804);await pause(500);
  const navigation=panel.contentEl.querySelector<HTMLElement>('.send-to-t3-question-navigation');
  this.check('navigation fits a narrow native VPS window',!!navigation&&navigation.clientWidth>0&&navigation.scrollWidth<=navigation.clientWidth+1);
  await this.capture('11-question-narrow.png');nativeWindow.setBounds(bounds);await this.app.workspace.leftSplit.expand();await pause(250);
  const sections=panel.contentEl.querySelectorAll('fieldset');sections[0].querySelectorAll<HTMLInputElement>('input')[0].click();this.check('single select advances without submit',sections[0].hidden&&!sections[1].hidden&&!questionController.record(panel.target).command);await this.capture('10-question-next.png');panel.close();questionController.dispose();
  const planMarkdown='# Release review plan\n\n## Summary\n\nVerify each public response state.\n\n## Steps\n\n'+Array.from({length:22},(_,i)=>`${i+1}. Review scenario ${i+1} and keep its evidence.`).join('\n');
  const planState:InlineThreadState={messages:[{id:'plan-before',turnId:'run',role:'assistant',streaming:false,text:'The public proposal follows this message.',createdAt:at(1)}],activities:[...itemActivities({id:'proposal',planId:'public-plan',type:'proposed_plan',status:'completed',runId:'run',ordinal:2,startedAt:at(2),markdown:planMarkdown}),...itemActivities({id:'todo',type:'todo_list',status:'running',runId:'run',ordinal:3,startedAt:at(3),steps:[{step:'Tasks remain a separate list',status:'running'}]})],latestTurn:{turnId:'run',state:'running',startedAt:at(0)},session:{status:'running',activeTurnId:'run'}};
  target=await render('Plan mode proposal and separate tasks',renderInlineTurn(planState,'run','synthetic','running','collapse','synthetic',undefined,undefined,undefined,{startedAt:at(0)}));
  this.check('plan mode keeps a public proposal card separate from tasks',!!target.querySelector('.send-to-t3-proposed-plan')&&!!target.querySelector('.send-to-t3-tasks'));
  await this.capture('12-plan-preview.png');
  const planFold=target.querySelector<HTMLDetailsElement>('details[data-t3-plan-id]');
  if(planFold){planFold.querySelector<HTMLElement>('summary')!.click();await pause(100);this.check('plan expansion shows the complete public Markdown',planFold.open&&planFold.querySelector('.send-to-t3-plan-content')!.textContent!.includes('Review scenario 22'));await this.capture('13-plan-expanded.png');
   target=await render('Plan mode proposal and separate tasks',renderInlineTurn(planState,'run','synthetic','running','collapse','synthetic',undefined,undefined,undefined,{startedAt:at(0)}));
   this.check('plan expansion survives a native rerender',!!target.querySelector<HTMLDetailsElement>('details[data-t3-plan-id]')?.open);
  }else await this.capture('13-plan-expanded.png');
  this.check('fixture note was never overwritten by display',await this.app.vault.read(file)==='# Synthetic design parity replay\n');
  this.write('RESULT.json',{pass:this.before||this.results.every(row=>row.pass),baselineObservation:this.before,checks:this.results,nativeMobileTested:false,syntheticReplay:true});
 }
}
