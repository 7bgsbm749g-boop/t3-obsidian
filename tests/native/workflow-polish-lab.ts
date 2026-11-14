import {MarkdownView} from 'obsidian';
import Main from '../../src/app/main';
import {CompletionGlow} from '../../src/responses/completion-glow';
import {renderInlineTurn} from '../../src/conversations/inline-thread';
// Product commands, menus and editor; synthetic catalog and provider output.
// This lab runs only in its unsynced fixture vault and sends no prompts.
export default class WorkflowPolishLab extends Main {
  async onload(){
    const fs=require('node:fs'),path=require('node:path'),root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('Use the isolated native lab builder.');
    const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const fail=(error:unknown)=>write('ERROR.json',{message:String(error),stack:(error as Error).stack});
    await super.onload();
    const subject=this as any;
    subject.projects=()=>[
      {id:'one',title:'Atlas',workspaceRoot:'/synthetic/atlas',connectionId:'desktop',connectionName:'Desktop',repositoryIdentity:{canonicalKey:'github.com/example/atlas'}},
      {id:'two',title:'Atlas',workspaceRoot:'C:/synthetic/atlas',connectionId:'laptop',connectionName:'Laptop',repositoryIdentity:{canonicalKey:'github.com/example/atlas'}},
      {id:'three',title:'Local notes',workspaceRoot:'/synthetic/notes',connectionId:'desktop',connectionName:'Desktop'},
      {id:'four',title:'Travel',workspaceRoot:'C:/synthetic/travel',connectionId:'laptop',connectionName:'Laptop'},
    ];
    this.app.workspace.onLayoutReady(()=>void(async()=>{
      await this.app.vault.createFolder('Project');
      const history=renderInlineTurn({messages:[{id:'progress',role:'assistant',text:'I checked the source and compared the two paths.',turnId:'lab-run',streaming:false},{id:'final',role:'assistant',text:'The selected sentence is part of a saved response. A later question should appear below its selection.',turnId:'lab-run',streaming:false}],activities:[],latestTurn:{turnId:'lab-run',state:'completed'},turns:{'lab-run':{turnId:'lab-run',state:'completed',messageId:'prompt',completedAt:'2026-11-13T00:00:00Z'}}},'lab-run','lab-thread','complete','collapse');
      const file=await this.app.vault.create('Project/Review.md','# Review\n\nSelect this sentence to ask a question.\n\n'+history+'\n\nA fresh paragraph for the next send.\n');
      const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
      const view=leaf.view as MarkdownView,start=view.editor.getValue().indexOf('Select this');
      view.editor.setSelection(view.editor.offsetToPos(start),view.editor.offsetToPos(start+20));
      subject.completionGlow?.dispose();
      const completed='2026-11-13T00:00:00Z';let lastVisited='2026-11-12T00:00:00Z';
      subject.completionGlow=new CompletionGlow([{id:'lab-binding',completionId:'lab-run',notePath:file.path,completion:{environmentId:'synthetic',projectId:'project',threadId:'lab-thread',runId:'lab-run',completedAt:completed}}],()=>{}, {changed:()=>subject.folderIndicators?.refresh(),access:async()=>({origin:'https://synthetic.invalid',api:async(_path:string,command?:any)=>{if(command){lastVisited=command.visitedAt;return {};}return {threads:[{id:'lab-thread',projectId:'project',lastVisitedAt:lastVisited,latestRunId:'lab-run',latestRunCompletedAt:completed,status:'completed'}]};}})});
      await subject.completionGlow.refresh(true);
      const other=await this.app.vault.create('Other.md','# Native workflow fixture\n\nReview is already open in another tab. Its completed response is unread.\n\nAll catalog and run data in this vault are synthetic. No Sync or external dispatch.\n');
      await this.app.workspace.getLeaf('tab').openFile(other);
      if(subject.queueAsk){subject.queueAsk(file,'Select this sentence to ask a question.','Why does this matter?');subject.queueAsk(file,'A fresh paragraph for the next send.','What should happen next?');}
      subject.performResolvedChat=async(prompt:string,_note:unknown,context:any)=>{write('COMBINED-SEND.json',{prompt,queueSend:context?.queueSend,insertion:context?.insertion,scope:'Synthetic provider, product queue and composer; no external dispatch.'});};
      const record=()=>write('STATE.json',{scope:'Native Obsidian product menus, palette, queue and history; synthetic catalog, run and read-state API; no Sync, external dispatch or native mobile proof.',activeNote:this.app.workspace.getActiveFile()?.path,history:document.querySelector('.callout[data-callout="t3-progress"] .callout-content')?.textContent,loading:document.body.textContent?.includes('Loading history…'),lastVisited,queue:subject.askQueueKey?this.app.loadLocalStorage(subject.askQueueKey()):undefined});
      this.registerDomEvent(document,'click',()=>queueMicrotask(record));record();
      this.addCommand({id:'fixture-cleanup',name:'Clean up workflow polish fixture',callback:()=>void(async()=>{for(const tab of this.app.workspace.getLeavesOfType('markdown'))tab.detach();for(const path of ['Project/Review.md','Project','Other.md','Reference.md','Virtual.md']){const item=this.app.vault.getAbstractFileByPath(path);if(item)await this.app.vault.delete(item);}write('CLEANUP.json',{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),threadsCreated:[],syncConfigured:false});})()});
    })().catch(fail));
  }
}
