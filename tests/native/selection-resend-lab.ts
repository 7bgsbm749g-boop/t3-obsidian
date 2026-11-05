import {readWireShell,readMetadataSnapshot} from '../../src/connection/wire-readers';
import {Plugin,MarkdownView} from 'obsidian';
import SendToT3 from '../../src/app/main';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,uuid5} from '../../src/connection/desktop';
import {readInlineSnapshot,type ThreadAccess} from '../../src/conversations/thread-stream';
import {applyThreadItem} from '../../src/conversations/inline-thread';
import {closeNoteTabPanel} from '../../src/notes/note-tab-panel';

const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const note='Fixture/Selection.md';
const selected='SELECTED_PASSAGE_BEGIN\n'+('This complete paragraph is selected deliberately, including on repeated sends. '.repeat(8))+'\nSELECTED_PASSAGE_END\nReply only SELECTION_RESEND_OK. Do not use tools, inspect or change files, or start other work. This is a bounded delivery test.';

/** Three real bounded deliveries through production selection routing. Only the
 * dedicated configured test project can receive them; no production vault data. */
export default class SelectionResendLab extends Plugin {
  private root='';private access?:ThreadAccess;private threadId?:string;private subject:any;
  private sent:any[]=[];private errors:string[]=[];private trusted:string[]=[];
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    this.app.workspace.onLayoutReady(()=>void pause(600).then(()=>this.run()).catch(error=>{this.errors.push(String(error));this.write('ERROR.json',{error:String(error),stack:error.stack});}).finally(()=>this.cleanup()));
  }
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2)+'\n');}
  private assert(value:unknown,message:string){if(!value)throw Error(message);}
  private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=120_000){const end=Date.now()+timeout;do{if(await check())return;await pause(350);}while(Date.now()<end);throw Error('Timed out: '+label);}
  private async capture(name:string){fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
  private async run(){
    const config=JSON.parse(fs.readFileSync(path.join(this.root,'TEST-CONFIG.json'),'utf8')),connection=(await desktopDefaults());
    this.access=await desktopThreadAccess(connection);
    const project=(readWireShell(await this.access.api('/api/orchestration/shell'))).projects.find((item:any)=>item.id===config.projectId);if(!project)throw Error('The synthetic project is unavailable.');
    this.assert(project?.workspaceRoot===path.join(this.root,'workspace'),'A dedicated temporary project is required.');
    const environmentId=await desktopEnvironment(connection),p:any=new SendToT3(this.app,this.manifest);this.subject=p;
    p.settings={vaultId:'selection-lab-'+crypto.randomUUID(),threadNoteMode:'free',threadTitleGeneration:'untitled-only',projects:[project],directProjects:[],paired:[],connection,autoSettleThreads:false,completion:{action:'keep'},completionJobs:[],settlementJobs:[],pending:[],noteThreads:[],noteContexts:[],vaultLocations:[],folderLinkChanges:[],projectCreationLocations:[],responseBindings:{},inlineStreaming:{enabled:false},folderLinks:[{id:crypto.randomUUID(),folderPath:'Fixture',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:'',environmentId,self:false}]};
    p.mode='desktop';p.eventLocalEnvironmentId=environmentId;p.localInlineEnvironment=async()=>environmentId;
    p.save=async()=>{await this.saveData(p.settings);};
    const dispatch=p.dispatch.bind(p);
    p.dispatch=async(request:any)=>{
      this.threadId=request.threadId??uuid5(request.id,'thread');
      this.write('TEMPORARY.json',{projectId:project.id,threadIds:[this.threadId],notePaths:[note]});
      const threadId=await dispatch(request);
      this.sent.push({requestId:request.id,messageId:uuid5(request.id,'message'),threadId,prompt:request.prompt});this.write('DELIVERIES.json',this.sent);return threadId;
    };
    await this.app.vault.createFolder('Fixture');
    const original='Unsent opening outside the selection.\n\n'+selected+'\n\nUnsent ending outside the selection.\n';
    const file=await this.app.vault.create(note,original),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
    await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false},active:true});const view=leaf.view as MarkdownView;
    const select=()=>{const document=view.editor.getValue(),from=document.indexOf(selected);this.assert(from>=0,'Selected source disappeared.');view.editor.setSelection(view.editor.offsetToPos(from),view.editor.offsetToPos(from+selected.length));};
    const send=async(question='')=>{select();await p.openManualAction(file,question,selected,{view,editor:view.editor});};
    const click=(event:MouseEvent)=>{if(event.isTrusted&&(event.target as HTMLElement).textContent==='New thread')this.trusted.push('native-new-thread');};document.addEventListener('click',click,true);
    try{
      await send();await pause(200);this.assert(document.querySelector('.send-to-t3-tab-panel'),'First-send chooser missing.');
      await this.capture('first-selection-menu.png');this.write('STAGE.json',{stage:'choose-new-thread',note});
      await this.until(()=>this.sent.length===1,'native New thread click and first delivery');
      const states:any[]=[];
      const completed=async(count:number,marker:string)=>{
        let snapshot:any;
        await this.until(async()=>{snapshot=await readInlineSnapshot(this.access!,this.threadId!,project.id,undefined,true);const thread=snapshot.thread;return thread.latestTurn?.state==='completed'&&!thread.session?.activeTurnId;},'completed delivery '+count);
        const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
        const users=state.messages.filter(message=>message.role==='user'),answers=state.messages.filter(message=>message.role==='assistant'&&!message.streaming);
        this.assert(users.length===count,'Canonical T3 user-message count differs from the real deliveries.');
        const actual=users.find(message=>message.id===this.sent[count-1].messageId);this.assert(actual?.text===this.sent[count-1].prompt,'T3 did not retain the exact prepared message.');
        this.assert(answers.at(-1)?.text.trim()===marker,'The bounded provider response was not observed.');
        states.push({count,users,answers});this.write('CANONICAL-T3.json',states);
      };
      await completed(1,'SELECTION_RESEND_OK');
      await send();this.assert(this.sent.length===2&&!document.querySelector('.send-to-t3-tab-panel'),'A repeated selection was blocked or rerouted.');await completed(2,'SELECTION_RESEND_OK');
      const question='For that selected passage, reply only SELECTION_RESEND_ASK_OK. Do not use tools or change files.';
      await send(question);this.assert(this.sent.length===3&&!document.querySelector('.send-to-t3-tab-panel'),'Repeated selection plus question was blocked.');await completed(3,'SELECTION_RESEND_ASK_OK');
      for(const request of this.sent){this.assert(request.prompt.startsWith(selected),'Selection was omitted, filtered, or shortened.');this.assert(!/Unsent opening|Unsent ending|Selection reference:|t3-note-id/.test(request.prompt),'Outside text or private tracking entered the prompt.');}
      this.assert(this.sent[2].prompt.includes('**USER ASKS:**\n'+question),'The question did not accompany the full selection.');
      this.assert(this.trusted.includes('native-new-thread'),'No native destination choice was captured.');
      select();await this.capture('repeated-selection-delivered.png');
      this.write('RESULT.json',{ok:true,scope:'Native Obsidian editor and production Send/Ask paths; three real T3 deliveries and completed provider responses in one temporary thread. Streaming disabled. No Sync or native mobile claim.',selected,question,deliveries:this.sent,threadId:this.threadId,trusted:this.trusted,sourcePreserved:view.editor.getValue().includes(selected)});
      this.write('STAGE.json',{stage:'complete'});
    }finally{document.removeEventListener('click',click,true);}
  }
  private async cleanup(){
    closeNoteTabPanel(this.app);this.subject?.sendPreviews.dispose();await this.subject?.localDesktopAccess?.dispose();
    const remainingThreadIds:string[]=[];
    try{
      if(this.threadId&&this.access){
        const snapshot=readMetadataSnapshot(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true'));
        if(snapshot.thread.session?.activeTurnId)await this.access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.threadId,turnId:snapshot.thread.session.activeTurnId,createdAt:new Date().toISOString()});
        await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});
        let deleted=false;try{deleted=!!(readMetadataSnapshot(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true'))).thread.deletedAt;}catch(error){deleted=(error as any).status===404;}
        if(!deleted)remainingThreadIds.push(this.threadId);
      }
    }catch(error){this.errors.push('Thread cleanup: '+String(error));if(this.threadId)remainingThreadIds.push(this.threadId);}
    await this.access?.close?.();
    for(const leaf of this.app.workspace.getLeavesOfType('markdown')){await (leaf.view as MarkdownView).save();leaf.detach();}
    for(const name of [note,'Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
    this.write('CLEANUP.json',{temporaryThreadIds:this.threadId?[this.threadId]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.errors});
  }
}
