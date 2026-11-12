import {Plugin,FileSystemAdapter,MarkdownView,apiVersion} from 'obsidian';
import {AskComposer,SendDestinationModal,type ChatHost} from '../../src/conversations/chat-ui';
import {WorkspacePanel,type WorkspaceData,type WorkspaceTarget} from '../../src/projects/workspace-panel';
import {PullRequestPanel} from '../../src/projects/pull-request-panel';
import {closeNoteTabPanel,toggleNoteTabPanels} from '../../src/notes/note-tab-panel';
const fs=require('node:fs'),path=require('node:path'),remote=require('@electron/remote');
const wait=(ms=120)=>new Promise(resolve=>window.setTimeout(resolve,ms));
/** Synthetic API inputs, real production components and native Obsidian APIs.
 * No connection, live prompt, Sync, production vault or repository mutation. */
export default class FloatingPanelsLab extends Plugin{
  private root='';
  onload(){
    if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error('Local isolated vault required.');
    this.root=path.dirname(this.app.vault.adapter.getBasePath());
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Refuse non-lab vault.');
    this.app.workspace.onLayoutReady(()=>void this.run().catch(async error=>{this.write('ERROR.json',{message:String(error),stack:error.stack,buttons:Array.from(document.querySelectorAll('button')).map(b=>({text:b.textContent,disabled:b.disabled,connected:b.isConnected})),notices:Array.from(document.querySelectorAll('.notice')).map(e=>e.textContent),dialogs:Array.from(document.querySelectorAll('.modal-container,.prompt')).map(e=>e.outerHTML.slice(0,12000))});await this.shot('failure');this.retain();}));
  }
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private retain(){
    const target=JSON.parse(fs.readFileSync(path.join(this.root,'REPORTS.json'),'utf8')).evidence;
    if(!path.isAbsolute(target)||target===this.root)throw Error('Separate report destination required.');
    for(const name of ['ERROR.json','RESULT.json','failure.png','send.png','minimized.png','ask.png','workspace.png','pull-request.png','pull-request-checks.png','narrow.png']){
      const source=path.join(this.root,name);if(fs.existsSync(source))fs.copyFileSync(source,path.join(target,name));
    }
  }
  private assert(value:unknown,message:string){if(!value)throw Error(message);}
  private async shot(name:string){await wait(250);const image=await remote.getCurrentWindow().webContents.capturePage();fs.writeFileSync(path.join(this.root,name+'.png'),image.toPNG());}
  private async run(){
    await wait(2000);const win=remote.getCurrentWindow();win.setSize(1100,820);for(const name of ['ERROR.json','RESULT.json']){const file=path.join(this.root,name);if(fs.existsSync(file))fs.unlinkSync(file);}
    const file=this.app.vault.getFileByPath('Floating controls.md')??await this.app.vault.create('Floating controls.md','# Floating controls\n\nBring T3 controls into the note.\n\n## Design goals\n\n- Keep the note visible while you work.\n- Choose a model for each send.\n- Minimize panels without losing a draft.\n- Read workspace and pull request state in place.\n\nAll workspace and PR data in this lab is synthetic.\n');
    await this.app.workspace.getLeaf(false).openFile(file);await wait(400);
    let sends=0;const host:ChatHost={getNotePath:()=>file.path,getProjectName:()=> 'T3 Obsidian',getDefaultProjectKey:()=> 'demo',getTargetDescription:()=> 'Demo workspace',getProjectChoices:()=>[{key:'demo',label:'T3 Obsidian'}],getDefaultThread:()=>undefined,getPreview:()=>this.app.workspace.getActiveViewOfType(MarkdownView)!.editor.getValue(),getInlineDefaults:()=>({enabled:true}),loadModels:async()=>[{label:'T3 default'},{label:'Codex · gpt-6.1-sol',selection:{instanceId:'codex',model:'gpt-6.1-sol'}}],sendChat:async()=>{sends++;},sendToNew:async()=>{sends++;},sendToExisting:async()=>{sends++;}};
    const send=new SendDestinationModal(this.app,host);send.open();await wait();
    const field=send.contentEl.querySelector('textarea')!;field.value='Plan the floating controls and keep the note as context.';field.dispatchEvent(new Event('input'));
    await this.shot('send');send.toggleMinimized();this.assert(send.modalEl.hidden,'Minimize must hide card');await this.shot('minimized');
    toggleNoteTabPanels(this.app);this.assert(this.app.workspace.getActiveViewOfType(MarkdownView)!.containerEl.querySelector<HTMLButtonElement>('.t3-floating-launcher')?.hidden,'Hide must conceal launcher');toggleNoteTabPanels(this.app);send.toggleMinimized();this.assert(field.value.startsWith('Plan the floating'),'Draft survives visibility controls');
    const model=send.contentEl.querySelector<HTMLButtonElement>('[aria-label="Choose model for this send"]')!;model.click();await wait(700);
    const suggestions=Array.from(document.querySelectorAll<HTMLElement>('.suggestion-item'));this.assert(suggestions.length===2,'Model catalog rendered');suggestions[1].click();await wait();this.assert(model.textContent==='gpt-6.1-sol','Model choice updated');send.close();
    let saved='';const ask=new AskComposer(this.app,file.path,'Can you simplify the panel layout?',text=>saved=text,async()=>{throw Error('Synthetic offline failure');},{project:'T3 Obsidian',context:'Minimize panels without losing a draft.',loadModels:host.loadModels});ask.open();await this.shot('ask');
    ask.toggleMinimized();ask.toggleMinimized();this.assert(ask.contentEl.querySelector('textarea')?.value==='Can you simplify the panel layout?','Ask draft restored');ask.close();this.assert(saved==='Can you simplify the panel layout?','Ask draft saved');
    const target:WorkspaceTarget={notePath:file.path,projectId:'demo',projectTitle:'T3 Obsidian',workspaceRoot:'/demo/project',threadId:'demo-thread',environmentId:'demo-machine',machine:'Development machine'};
    const data:WorkspaceData={cwd:'/demo/project',branch:'t3/floating-controls',isRepo:true,insertions:483,deletions:194,files:[{path:'src/notes/note-tab-panel.ts',insertions:58,deletions:12},{path:'src/conversations/chat-ui.ts',insertions:126,deletions:47}],pullRequests:[{host:'github.com',repository:'example/demo',number:42,url:'https://github.com/example/demo/pull/42'}],relatives:[{id:'previous',title:'Design the floating controls'}],warnings:[]};
    const pr=()=>new PullRequestPanel(this.app,target,async()=>data,async()=>({detail:{title:'Bring T3 controls into Obsidian',state:'open',isDraft:true,headBranch:'t3/floating-controls',baseBranch:'main',body:'Floating workspace, Send and Ask controls, and pull request details.\n\nSynthetic data for design review.',changedFiles:8,additions:483,deletions:194,mergeability:'mergeable',checks:[{name:'Build and lint',bucket:'pass'},{name:'Affected tests',bucket:'pass'}]},activity:{comments:[{author:{login:'reviewer'},body:'Keep drafts when the panel is minimized.'}]}}));
    const workspace=new WorkspacePanel(this.app,target,async()=>data,()=>pr().open());workspace.open();await this.shot('workspace');workspace.toggleMinimized();
    const pull=pr();pull.open();await this.shot('pull-request');Array.from(pull.contentEl.querySelectorAll('button')).find(b=>b.textContent==='Checks')!.click();await this.shot('pull-request-checks');
    this.app.workspace.leftSplit.collapse();this.app.workspace.rightSplit.collapse();win.setSize(430,820);await this.shot('narrow');const rect=pull.modalEl.getBoundingClientRect();this.assert(rect.width>=300&&rect.width<=430&&rect.left>=0,'Narrow panel fits viewport');
    closeNoteTabPanel(this.app);await this.app.vault.delete(file);this.assert(!this.app.vault.getAbstractFileByPath(file.path),'Fixture note removed');this.assert(!document.querySelector('.t3-floating-launcher'),'Launchers removed');this.assert(sends===0,'Design checks never dispatch');
    this.write('RESULT.json',{ok:true,apiVersion,syntheticApiData:true,nativeDesktop:true,nativeMobile:false,sends,checks:['minimize/restore','hide/show launcher','draft retention','model selection','workspace rendering','PR tabs','narrow viewport'],cleanup:{notesRemoved:true,panelsRemoved:true},screenshots:['send','ask','workspace','minimized','pull-request','pull-request-checks','narrow']});
    this.retain();remote.app.quit();
  }
}
