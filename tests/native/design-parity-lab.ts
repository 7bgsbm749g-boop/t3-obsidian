/** Synthetic source replay in an unsynced native vault. No T3 dispatch. */
import {Plugin,MarkdownRenderer,setIcon} from 'obsidian';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
 private root='';private results:Array<{name:string;pass:boolean}>=[];
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated vault required');
  this.register(installResponsePresentation(document,setIcon));
  this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
 }
 private write(name:string,data:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
 private check(name:string,pass:boolean){this.results.push({name,pass});if(!pass)throw Error(name);}
 private async capture(name:string){await pause(350);fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
 private async cleanup(){for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);this.write('CLEANUP.json',{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),temporaryThreads:[],synced:false});}
 private async run(){
  const file=await this.app.vault.create('Design parity synthetic replay.md','# Synthetic design parity replay\n'),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
  await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});await pause(400);
  const container=(leaf.view as any).previewMode.containerEl as HTMLElement;
  const render=async(title:string,body:string)=>{container.empty();container.createEl('h2',{text:title});container.createEl('p',{text:'Synthetic replay fixture · VPS native Obsidian · no real vault content or T3 run'});const target=container.createDiv({cls:'markdown-rendered'});await MarkdownRenderer.render(this.app,body,target,file.path,this);await pause(1100);return target;};
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
  live!.click();await pause(350);
  this.check('click opens its real activity group',!!target.querySelector<HTMLDetailsElement>('details[data-t3-tool-group]')?.open);
  this.check('tools are flat and outputs absent',!target.querySelector('details.send-to-t3-tool')&&!target.textContent!.includes('OUTPUT MUST NOT APPEAR'));
  this.check('thread title is linked',!!target.querySelector('a[href="t3-thread://v2/synthetic/synthetic-thread"]'));
  await this.capture('03-live-thoughts-flat-tools.png');
  target=await render('Thought-only count',renderResponseToolGroup({...responseToolGroups(state,['run'])[0],tools:[]}));await this.capture('04-thought-count.png');
  const taskState:InlineThreadState={...state,messages:[{id:'before',turnId:'run',role:'assistant',streaming:false,text:'Before the task list.',createdAt:at(1)}],activities:[{id:'task1',turnId:'run',kind:'response.plan',summary:'Tasks',createdAt:at(2),payload:{steps:[{step:'Read request',status:'completed'},{step:'Verify active step',status:'running'},{step:'Finish review',status:'pending'}]}},{id:'compact',turnId:'run',kind:'context-compaction',summary:'Compaction',createdAt:at(3),payload:{status:'completed',beforeTokenCount:128000,afterTokenCount:32000}}]};
  target=await render('Timeline tasks and compaction token counts',renderInlineTurn(taskState,'run','synthetic','running','collapse','synthetic',undefined,undefined,undefined,{startedAt:at(0)}));target.querySelector<HTMLDetailsElement>('.send-to-t3-tasks')!.open=true;
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
  const sections=panel.contentEl.querySelectorAll('fieldset');sections[0].querySelectorAll<HTMLInputElement>('input')[0].click();this.check('single select advances without submit',sections[0].hidden&&!sections[1].hidden&&!questionController.record(panel.target).command);await this.capture('10-question-next.png');panel.close();questionController.dispose();
  this.check('fixture note was never overwritten by display',await this.app.vault.read(file)==='# Synthetic design parity replay\n');
  this.write('RESULT.json',{pass:this.results.every(row=>row.pass),checks:this.results,nativeMobileTested:false,syntheticReplay:true});
 }
}
