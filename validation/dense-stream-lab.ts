import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {DirectInlinePreview} from '../direct-inline-preview';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {contentHash} from '../completion';
import type {LeaseRecord} from '../inline-lease';
import type {ThreadStreamCallbacks,watchThread} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Dense native-editor replay; synthetic content, no Sync or external dispatch. */
export default class DenseStreamLab extends Plugin {
  private root='';private preview?:DirectInlinePreview;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated fixture vault is required.');
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document,setIcon));
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>nativeResponses(this.app).filter(tr)));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('error.json',{message:String(error),stack:error.stack})));
  }
  private write(name:string,data:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
  private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,name),image.toPNG());}
  async run(){
    await pause(900);const app=this.app,manager=nativeResponses(app),id=crypto.randomUUID(),startedAt=new Date().toISOString();
    let saved='# Dense stream fixture\n\nOrdinary text before.\n\n'+responseAnchor(id)+'\n\nOrdinary text after.\n';
    const file=await app.vault.create('Dense.md',saved),first=app.workspace.getLeaf(false);await first.openFile(file);
    const second=app.workspace.createLeafBySplit(first,'vertical');await second.openFile(file);const leaves=[first,second];
    const record:LeaseRecord={coordinated:true,migrating:true,owner:'host',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:4,nativeProjection:true,id,initialOwner:crypto.randomUUID(),vaultId:crypto.randomUUID(),host:{environmentId:'fixture',workspaceRoot:'/unavailable-host',directory:'.obsidian/inline'},notePath:file.path,threadId:'fixture-thread',messageId:'prompt',projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:startedAt,intermediateMode:'collapse',threadTitle:'Dense stream'}};
    let callbacks!:ThreadStreamCallbacks,updates=0,lastBody='',sequence=2;
    const watch:typeof watchThread=(_id,_access,next)=>{callbacks=next;return {stop:()=>{}};};
    this.preview=new DirectInlinePreview(record,async()=>{throw Error('No network in dense fixture');},update=>{updates++;lastBody=update.body;manager.stream(update);},watch);
    await manager.receive(record);this.preview.tick(true);
    const start=Date.now(),at=(ms:number)=>new Date(start+ms).toISOString();
    callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{id:'fixture-thread',projectId:'fixture-project',title:'Dense stream',messages:[{id:'prompt',role:'user',text:'Synthetic prompt',turnId:'turn',streaming:false},{id:'answer',role:'assistant',text:'A stable opening paragraph.\n\n',turnId:'turn',createdAt:at(1),streaming:true}],activities:[],latestTurn:{turnId:'turn',messageId:'prompt',state:'running'},session:{status:'running',activeTurnId:'turn'}}}});
    await pause(250);
    const fold=(leaf:any)=>leaf.view.containerEl.querySelector(leaf.view.getMode()==='preview'?'.markdown-preview-view .callout[data-callout="t3-progress"]':'.cm-content .callout[data-callout="t3-progress"]') as HTMLElement;
    const originals=leaves.map(fold),paragraphs=originals.map(node=>node?.querySelector('blockquote p')),rows:any[]=[],failures:string[]=[];
    const check=(name:string,value:boolean)=>{rows.push({name,pass:value});if(!value)failures.push(name);};
    check('initial boxes expanded in both panes',originals.every(node=>node&&!node.classList.contains('is-collapsed')));
    const event=(type:string,payload:any)=>callbacks.item({kind:'event',event:{sequence:++sequence,aggregateId:'fixture-thread',type,payload}});
    const tool=(kind:string,toolCallId:string,data:any,status='inProgress')=>event('thread.activity-appended',{activity:{id:crypto.randomUUID(),turnId:'turn',kind,summary:'Tool',createdAt:at(sequence),payload:{toolCallId,status,data}}});
    tool('tool.started','npm',{item:{command:"/bin/bash -lc 'npm test > /tmp/dense.log 2>&1'"}});
    tool('tool.started','read',{toolName:'Read',input:{path:'/tmp/synthetic.md'}});await pause(120);
    const details=originals.map(node=>node?.querySelector<HTMLDetailsElement>('[data-t3-tool-id="npm"]'));
    details.forEach(node=>{if(node)node.open=true;});
    const editor=(first.view as MarkdownView).editor;editor.setSelection({line:2,ch:0},{line:2,ch:8});
    const text='The next paragraph grows without changing the opening paragraph. '.repeat(2)+'\n\n| Name | Value |\n| --- | --- |\n| Stable | 1 |\n\n```ts\n\nconst value = 1;\n```\n\nLast growing paragraph.';
    let frames=0,missingFrames=0,closedFrames=0,replacedFrames=0,sampling=true;
    const frame=()=>{if(!sampling)return;frames++;leaves.forEach((leaf,index)=>{const current=fold(leaf);if(!current)missingFrames++;else {if(current!==originals[index])replacedFrames++;if(current.classList.contains('is-collapsed'))closedFrames++;}});requestAnimationFrame(frame);};requestAnimationFrame(frame);
    let accumulated='A stable opening paragraph.\n\n';
    for(let index=0;index<text.length;index+=3){const delta=text.slice(index,index+3);accumulated+=delta;event('thread.message-sent',{messageId:'answer',role:'assistant',text:delta,turnId:'turn',streaming:true});await pause(5);}
    tool('tool.completed','npm',{item:{aggregatedOutput:'Synthetic tests passed.\n<script>literal output</script>',exitCode:0,durationMs:1300}},'completed');await pause(150);
    sampling=false;
    check('ordinary editor selection survives dense updates',editor.getSelection()==='Ordinary');
    check('every paint retains expanded history nodes',frames>10&&missingFrames===0&&closedFrames===0&&replacedFrames===0);
    check('completed paragraph nodes retained',leaves.every((leaf,index)=>fold(leaf)?.querySelector('blockquote p')===paragraphs[index]));
    check('expanded tool details retained',details.every((node,index)=>node?.isConnected&&node.open&&node===fold(leaves[index])?.querySelector('[data-t3-tool-id="npm"]')));
    check('results visible and escaped',details.every(node=>node?.textContent?.includes('Exit code: 0')&&node.textContent.includes('<script>literal output</script>')&&!node.querySelector('script')));
    check('short shell label and concurrent read',details.every(node=>node?.querySelector('summary')?.textContent==='Ran npm')&&originals.every(node=>node?.textContent?.includes('Reading synthetic.md')));
    check('dense stream displays all received text',leaves.every(leaf=>manager.view(leaf.view as MarkdownView)?.currentProjection().display.includes('Last growing paragraph.')));
    check('display grouped',updates<text.length/3/2);
    details[0]?.scrollIntoView({block:'center'});await pause(100);
    this.write('LIVE-DOM.json',{details:details.map(node=>node?.outerHTML),folds:leaves.map(leaf=>fold(leaf)?.outerHTML)});
    await this.capture('dense-live.png');
    // A user can close a retained box, and that choice survives new tokens.
    originals[0]?.querySelector<HTMLElement>(':scope > .callout-title')?.click();event('thread.message-sent',{messageId:'answer',role:'assistant',text:' More.',turnId:'turn',streaming:true});accumulated+=' More.';await pause(150);
    check('user collapse survives streaming',fold(first)===originals[0]&&fold(first)?.classList.contains('is-collapsed')&&getComputedStyle(fold(first).querySelector('.callout-content')!).display==='none'&&fold(first).querySelector('.callout-fold')!.classList.contains('is-collapsed'));
    originals[0]?.querySelector<HTMLElement>(':scope > .callout-title')?.click();
    // Reading view runs the same retaining path; source view remains exact text.
    await second.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});await pause(150);const reading=fold(second);
    event('thread.message-sent',{messageId:'answer',role:'assistant',text:' Reading.',turnId:'turn',streaming:true});accumulated+=' Reading.';await pause(150);
    this.write('READING-DOM.json',{before:reading?.outerHTML,after:fold(second)?.outerHTML,mode:second.view.getState()});
    check('reading view retains its active box',!!reading&&reading===fold(second)&&!reading.classList.contains('is-collapsed'));
    check('saved projection and disk contain no generated stream',leaves.every(leaf=>(leaf.view as MarkdownView).getViewData()===saved)&&await app.vault.read(file)===saved);
    const copy=fold(first)?.querySelector<HTMLButtonElement>('[data-t3-tool-id="npm"] .copy-code-button');
    const clipboard=require('electron').clipboard,oldImage=clipboard.readImage();
    const previousClipboard={text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),...(!oldImage.isEmpty()?{image:oldImage}:{})};
    try {copy?.click();await pause(100);check('native command copy action remains usable',!!copy&&clipboard.readText()==="/bin/bash -lc 'npm test > /tmp/dense.log 2>&1'");}
    finally {clipboard.write(previousClipboard);}
    editor.replaceRange(' Edited.',{line:2,ch:'Ordinary text before.'.length});await pause(200);
    check('ordinary edit retained during stream',(first.view as MarkdownView).getViewData().includes('Ordinary text before. Edited.'));
    (editor as any).undo();await (first.view as MarkdownView).save();await pause(200);check('ordinary undo does not undo generated text',(first.view as MarkdownView).getViewData()===saved&&!!manager.view(first.view as MarkdownView)?.currentProjection().display.includes('Last growing paragraph.'));
    await second.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:true}});await pause(150);
    check('source mode shows generated text with clean saved projection',!!manager.view(second.view as MarkdownView)?.currentProjection().display.includes('Reading.')&&(second.view as MarkdownView).getViewData()===saved);
    await second.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});await pause(150);
    // Finish the tool and message before terminal turn evidence.
    tool('tool.completed','read',{content:[{type:'text',text:'Synthetic file contents.'}]},'completed');
    event('thread.message-sent',{messageId:'answer',role:'assistant',text:accumulated,turnId:'turn',streaming:false});
    event('thread.session-set',{session:{status:'ready',activeTurnId:null}});await pause(250);
    this.write('TERMINAL-DOM.json',{body:lastBody,folds:leaves.map(leaf=>fold(leaf)?.outerHTML)});
    check('finished answer outside closed history and no active tools',!lastBody.includes('stream-tail')&&!lastBody.includes('status="inProgress"')&&leaves.every(leaf=>fold(leaf)?.classList.contains('is-collapsed')));
    const final=saved.replace(responseAnchor(id),lastBody.trimEnd());
    const complete:LeaseRecord={...record,revision:2,migrating:false,state:{requestHash:'fixture',accepted:true,notePath:file.path,status:'complete',hashes:[],updatedAt:'',body:lastBody,finalBody:lastBody.trimEnd(),cleanupComplete:true,finalSaved:true,delivery:{commitId:crypto.randomUUID(),hash:contentHash(final),verifiedOnHost:true,observedBy:[]}}};
    this.preview.update(complete);this.preview.tick(true);await manager.receive(complete);await pause(100);check('delayed checked final leaves disk clean',await app.vault.read(file)===saved);
    await app.vault.modify(file,final);await manager.changed(file.path);await pause(350);check('checked final adopted in both panes',leaves.every(leaf=>(leaf.view as MarkdownView).getViewData()===final&&!manager.view(leaf.view as MarkdownView)?.conflictRecord()));
    this.write('RESULT.json',{pass:failures.length===0,rows,frames,missingFrames,closedFrames,replacedFrames,receivedDeltas:Math.ceil(text.length/3),displayUpdates:updates});await this.capture('dense-final.png');
  }
  onunload(){this.preview?.dispose();nativeResponses(this.app).dispose();}
}
