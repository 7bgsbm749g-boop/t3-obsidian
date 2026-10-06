import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {CoordinatedHost} from '../coordinated-host-desktop';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,type LeaseFiles} from '../inline-lease';
import {HostedInlineWriter,type HostedInlineRequest} from '../hosted-inline';
import {nativeResponses} from '../native-response-manager';
import {initialRegion,renderInlineTurn} from '../inline-thread';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {installStreamBlockControls} from '../stream-block-controls';
const fs=require('node:fs/promises'),path=require('node:path');

/** Synthetic lifecycle controls only. Text selection, folds, links and close
 * must be exercised through real native input, never through this mailbox. */
export default class StreamCloseLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    await fs.access(path.join(root,'ISOLATED-NATIVE-LAB'));
    const manager=nativeResponses(this.app);
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');
    this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>manager.filter(tr)));
    this.register(installResponsePresentation(document));this.register(()=>manager.dispose());
    this.app.workspace.onLayoutReady(()=>void (async()=>{
      const id=crypto.randomUUID(),actor=crypto.randomUUID(),identity={vaultId:crypto.randomUUID(),environmentId:'fixture',workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/stream-close-fixture'};
      const file=this.app.vault.getFileByPath('Virtual.md')!,saved=`# Streaming close fixture\n\nOrdinary before.\n\n${responseAnchor(id)}\n\nOrdinary after.\n`;
      await this.app.vault.modify(file,saved);
      const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
      await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
      const view=leaf.view as MarkdownView;
      const bytes=new Map<string,string>(),files:LeaseFiles={read:async key=>bytes.get(key),write:async(key,value)=>{bytes.set(key,value);},remove:async key=>{bytes.delete(key);},list:async dir=>[...bytes.keys()].filter(key=>key.startsWith(dir+'/'))};
      const authority=new InlineLeaseAuthority(identity,files),client=new InlineLeaseClient(actor,{...files,read:async key=>{if(key.includes('/replies/'))await authority.tick();return files.read(key);}},identity.directory,undefined,undefined,async()=>{await authority.tick();});
      const request:HostedInlineRequest={version:2,id,initialOwner:actor,nativeProjection:true,independent:true,intermediateMode:'collapse',vaultId:identity.vaultId,host:identity,notePath:file.path,threadId:'fixture-thread',messageId:crypto.randomUUID(),projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:initialRegion(id).bodyHash,createdAt:new Date().toISOString()};
      await client.command({kind:'register',jobId:id,request});
      const host=await CoordinatedHost.open(this.app,identity,files,authority,{journalRoot:path.join(root,'journal')});await host.scan();
      this.register(()=>{host.stop();authority.stop();client.dispose();});
      this.register(installStreamBlockControls(this.app,document,command=>host.command(command.kind,command.foldKey,command.hash,command.notePath),setIcon,error=>void fs.writeFile(path.join(root,'close-error.json'),String(error))));
      let complete=false;
      const thread=()=>({id:request.threadId,projectId:request.projectId,title:'Streaming close fixture',messages:[{id:request.messageId,role:'user',text:'Synthetic fixture',streaming:false,createdAt:request.createdAt},{id:'progress',role:'assistant',turnId:'turn',text:'Select and copy this progress text. Open [[Reference]].',streaming:false},{id:'answer',role:'assistant',turnId:'turn',text:'Final answer stays.',streaming:!complete}],activities:[{id:'tool',turnId:'turn',sequence:1,kind:'tool.completed',payload:{toolCallId:'synthetic-command',status:'completed',data:{item:{command:'printf synthetic',exitCode:0,aggregatedOutput:'synthetic output'}}}}],latestTurn:{turnId:'turn',messageId:request.messageId,state:complete?'completed':'running',requestedAt:request.createdAt,assistantMessageId:'answer'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}});
      const writer=new HostedInlineWriter(identity,host.io({...files,requests:async()=>[],access:async()=>({origin:'https://fixture',api:async()=>({thread:thread()})}),updateNote:async()=>{throw Error('Legacy writes forbidden');}}));
      this.register(()=>writer.stop());await writer.tick();
      const events:any[]=[];
      const snapshot=async(label:string)=>{
        const box=(element:Element)=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        events.push({label,saved:view.getViewData(),display:view.editor.getValue(),disk:await this.app.vault.read(file),domSelection:window.getSelection()?.toString(),editorSelection:view.editor.getSelection(),callouts:Array.from(view.contentEl.querySelectorAll('.callout')).map(el=>({type:(el as HTMLElement).dataset.callout,collapsed:el.classList.contains('is-collapsed'),text:el.textContent,box:box(el)})),buttons:Array.from(view.contentEl.querySelectorAll<HTMLElement>('.edit-block-button')).map(el=>({classes:el.className,hidden:el.hidden,display:getComputedStyle(el).display,title:el.title,box:box(el)})),journal:await host.journal.read(id)});
        await fs.writeFile(path.join(root,'stream-close.json'),JSON.stringify(events,null,2));
      };
      let busy=false;
      this.registerInterval(window.setInterval(()=>{
        manager.refresh();if(busy)return;busy=true;
        void (async()=>{
          const mailbox=path.join(root,'control.json');let command:any;
          try{command=JSON.parse(await fs.readFile(mailbox,'utf8'));}catch(error:any){if(error.code==='ENOENT')return;throw error;}
          await fs.unlink(mailbox);
          if(command.kind==='complete-preview'){
            complete=true;const record=JSON.parse(bytes.get(leasePaths(identity.directory,id).record)!);
            record.revision++;record.state.body=renderInlineTurn(thread() as any,'turn',request.threadId,'complete','collapse',undefined,undefined,undefined,undefined,{startedAt:request.createdAt});
            await manager.receive(record);
          }
          if(command.kind==='finish'){complete=true;await writer.tick();await host.scan();}
          await snapshot(command.kind);
        })().catch(error=>fs.writeFile(path.join(root,'error.json'),String(error.stack))).finally(()=>{busy=false;});
      },200));
      await snapshot('ready');
    })().catch(error=>fs.writeFile(path.join(root,'error.json'),String(error.stack))));
  }
}
