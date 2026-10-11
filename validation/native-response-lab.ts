import {productionNative} from './production-native';
import {nativeResponseHandoff} from './native-response-handoff';
import {traceNativeView} from './native-view-trace';
import {nativeResponses} from '../native-response-manager';
import {Plugin,MarkdownView,MarkdownRenderChild} from 'obsidian';
import {NativeResponseView} from '../native-response-view';
import {responseAnchor} from '../native-response-projection';
import {renderInlineTurn,regionBody} from '../inline-thread';
import {hiddenInlineMarkerExtension,hideResponseContainerBoundaries} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {questionEditorExtension,questionButton} from '../question-ui';
import {parseQuestionToken} from '../questions';
import {GeneratedNoteCoordinator} from '../generated-note-coordinator';
import {DesktopGenerationJournal} from '../generation-journal-desktop';
import {initialRegion} from '../inline-thread';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const before='# Harness\n\nBefore response.\n\n',after='\n\nAfter response.\n';
const saved=before+responseAnchor(id)+after;
const content='Paragraph fixture with **Bold fixture**, *emphasis*, `inline code`, and [link](https://example.com).\n\n## Heading fixture\n\n- List fixture\n- Second item\n\n| Table fixture | Value |\n| --- | ---: |\n| Example | 25kg |\n\n```js\n// Code fixture\nconst weight = 25;\n```\n\n> Quoted paragraph.';
function inspect(root:HTMLElement){
  const rect=root.getBoundingClientRect(),probes:Record<string,unknown>={};
  const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null;
  while(node=walk.nextNode())for(const needle of ['Before response.','Paragraph fixture','Bold fixture','Heading fixture','List fixture','Table fixture','Code fixture','After response.']){
    const text=node.textContent??'',at=text.indexOf(needle);if(at<0||probes[needle])continue;
    const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+needle.length);const box=Array.from(range.getClientRects()).find(box=>box.width&&box.height);if(!box)continue;
    const style=getComputedStyle(node.parentElement!);probes[needle]={x:box.x-rect.x,y:box.y-rect.y,width:box.width,height:box.height,font:style.font,lineHeight:style.lineHeight,margin:style.margin,padding:style.padding};
  }
  return {probes,height:rect.height,callouts:Array.from(root.querySelectorAll<HTMLElement>('.callout')).map(el=>{const box=el.getBoundingClientRect();return {type:el.dataset.callout,width:box.width,height:box.height,y:box.y-rect.y};})};
}
export default class NativeResponseLab extends Plugin {
  private root='';private adapter?:NativeResponseView;private answerClicks=0;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An explicitly isolated, unsynced fixture vault is required.');
    this.registerDomEvent(window,'error',event=>this.write('window-error.json',{message:event.message,stack:event.error?.stack}));
    const originalError=console.error,errors:string[]=[];console.error=(...values:unknown[])=>{errors.push(values.map(value=>value instanceof Error?value.stack:String(value)).join(' '));this.write('console-errors.json',errors);originalError(...values);};this.register(()=>{console.error=originalError;});
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document));
    this.registerMarkdownPostProcessor(hideResponseContainerBoundaries);
    const {EditorState}=require('@codemirror/state');
    this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>(()=>{const result=this.adapter?.filterTransaction(transaction)??transaction;return Array.isArray(result)?result:nativeResponses(this.app).filter(result);})()));
    const controller:any={subscribe:()=>()=>{},view:()=>({status:'pending'}),hasDismissals:()=>false,isDismissed:()=>false};
    this.registerEditorExtension(questionEditorExtension(controller,()=>this.answerClicks++));
    this.registerMarkdownPostProcessor((element,ctx)=>{for(const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href^="t3-question:"]'))){const target=parseQuestionToken((link.getAttribute('href')??'').slice(12));if(!target)continue;const control=questionButton(controller,target,()=>this.answerClicks++);link.replaceWith(control.button);const child=new MarkdownRenderChild(control.button);child.register(control.unsubscribe);ctx.addChild(child);}});
    this.app.workspace.onLayoutReady(()=>void this.run().catch((error:Error)=>this.write('error.json',{message:error.message,stack:error.stack})));
  }
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private capture(name:string){try{const wc=require('@electron/remote').getCurrentWebContents();return wc.capturePage().then((image:any)=>fs.writeFileSync(path.join(this.root,name+'.png'),image.toPNG()));}catch{return Promise.resolve();}}
  async run(){
    await pause(1000);const app=this.app;
    const reference=app.workspace.getLeaf(false);await reference.openFile(app.vault.getFileByPath('Reference.md')!);
    await reference.setViewState({type:'markdown',state:{file:'Reference.md',mode:'source',source:false}});
    for(const leaf of app.workspace.getLeavesOfType('markdown'))if(leaf!==reference)leaf.detach();
    const virtual=app.workspace.createLeafBySplit(reference,'vertical');await virtual.openFile(app.vault.getFileByPath('Virtual.md')!);
    await virtual.setViewState({type:'markdown',state:{file:'Virtual.md',mode:'source',source:false}});
    await reference.loadIfDeferred();await virtual.loadIfDeferred();
    this.write('setup.json',{files:app.vault.getMarkdownFiles().map(file=>file.path),leaves:[reference,virtual].map(leaf=>({state:leaf.getViewState(),type:leaf.view.getViewType(),file:(leaf.view as MarkdownView).file?.path}))});
    const ref=reference.view as MarkdownView,view=virtual.view as MarkdownView;
    await app.vault.modify(view.file!,saved);view.setViewData(saved,false);
    const conflicts:any[]=[];this.adapter=new NativeResponseView(view,saved,record=>conflicts.push(record),()=>app.vault.read(view.file!));
    const matrix:any[]=[];const now='2026-10-02T20:00:00Z';
    for(const width of [414,320])for(const mode of ['live','source','reading']){
      for(const [leaf,file] of [[reference,'Reference.md'],[virtual,'Virtual.md']] as const)await leaf.setViewState({type:'markdown',state:{file,mode:mode==='reading'?'preview':'source',source:mode==='source'}});
      const style=document.createElement('style');style.textContent=`.markdown-source-view.mod-cm6 .cm-content {width:${width}px !important;min-width:${width}px !important;} .markdown-preview-sizer {width:${width}px !important;min-width:${width}px !important;max-width:${width}px !important;}`;document.head.append(style);
      for(const phase of ['running','complete'] as const)for(const progress of ['collapse','keep','remove'] as const)for(const format of ['formatted','raw-markdown'] as const){
        const messages=[{id:'progress',role:'assistant',turnId:'turn',text:'Checking the formatting.',streaming:false},{id:'final',role:'assistant',turnId:'turn',text:content,streaming:false}];
        const state:any={title:'Formatting investigation',messages,activities:[],latestTurn:{turnId:'turn',state:phase==='complete'?'completed':'running',assistantMessageId:'final',completedAt:now},session:{status:phase==='complete'?'ready':'running',activeTurnId:phase==='complete'?null:'turn'}};
        const body=renderInlineTurn(state,'turn','thread',phase,progress,undefined,undefined,undefined,undefined,{startedAt:now,finishedAt:phase==='complete'?now:undefined},format);
        const display=before+`<!-- t3-inline:start:${id} -->\n${body}\n<!-- t3-inline:end:${id} -->`+after;
        ref.setViewData(display,false);this.adapter.setResponses([{id,body}]);await view.save();await pause(250);
        for(const v of [ref,view]){v.editor.scrollTo(0,0);if(progress==='collapse')for(const el of Array.from(v.contentEl.querySelectorAll<HTMLElement>('.callout.is-collapsed .callout-title')))el.click();}
        await pause(120);const selector=mode==='reading'?'.markdown-preview-sizer':'.cm-content';
        const actual=inspect(view.contentEl.querySelector<HTMLElement>(selector)!),expected=inspect(ref.contentEl.querySelector<HTMLElement>(selector)!);
        const name=[width,mode,phase,progress,format].join('-');matrix.push({name,actual,expected,layoutEqual:JSON.stringify(actual)===JSON.stringify(expected),displayEqual:view.editor.getValue()===ref.editor.getValue(),bodyEqual:regionBody(view.editor.getValue(),id)?.body===regionBody(ref.editor.getValue(),id)?.body,savedClean:await app.vault.adapter.read('Virtual.md')===saved});this.write('matrix.json',matrix);
        if(phase==='complete'&&progress==='keep'&&format==='formatted')await this.capture(name);
      }
      style.remove();
    }
    const rich:any[]=[];
    for(const width of [414,320])for(const mode of ['live','source','reading']){
      for(const [leaf,file] of [[reference,'Reference.md'],[virtual,'Virtual.md']] as const)await leaf.setViewState({type:'markdown',state:{file,mode:mode==='reading'?'preview':'source',source:mode==='source'}});
      const style=document.createElement('style');style.textContent=`.markdown-source-view.mod-cm6 .cm-content {width:${width}px !important;min-width:${width}px !important;} .markdown-preview-sizer {width:${width}px !important;min-width:${width}px !important;max-width:${width}px !important;}`;document.head.append(style);
      const messages=[{id:'progress',role:'assistant',turnId:'turn',text:'Checking the formatting.',streaming:false},{id:'final',role:'assistant',turnId:'turn',text:content+'\n\n###### Heading six fixture',streaming:false}];
      const state:any={title:'Formatting investigation',messages,activities:[{id:'question',kind:'user-input.requested',turnId:'turn',payload:{requestId:'request',questions:[{id:'q',header:'Question fixture',question:'Which formatting?',options:[{label:'Exactly the same',description:'Preserve appearance'}]}]}}],latestTurn:{turnId:'turn',state:'running',assistantMessageId:'final'},session:{status:'running',activeTurnId:'turn'}};
      const body=renderInlineTurn(state,'turn','thread','running','collapse','fixture',{messages,steering:[{messageId:'steer',text:'Keep formatting exactly.',before:[messages[0]],confirmed:true,label:'You'}]},{messageId:id,text:'Add a 25kg column.',label:'You'},undefined,{startedAt:now},'formatted');
      ref.setViewData(before+`<!-- t3-inline:start:${id} -->\n${body}\n<!-- t3-inline:end:${id} -->`+after,false);this.adapter.setResponses([{id,body}]);await view.save();await pause(300);
      for(const v of [ref,view]){v.editor.scrollTo(0,0);for(const el of Array.from(v.contentEl.querySelectorAll<HTMLElement>('.callout.is-collapsed .callout-title')))el.click();}
      await pause(100);const selector=mode==='reading'?'.markdown-preview-sizer':'.cm-content';
      const actual=inspect(view.contentEl.querySelector<HTMLElement>(selector)!),expected=inspect(ref.contentEl.querySelector<HTMLElement>(selector)!);
      const buttons=[ref,view].map(v=>Array.from(v.contentEl.querySelectorAll<HTMLButtonElement>('button.send-to-t3-question-answer')).filter(button=>button.getBoundingClientRect().width).map(button=>({text:button.textContent,disabled:button.disabled,width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})));
      const clicks=this.answerClicks;for(const v of [ref,view])v.contentEl.querySelector<HTMLButtonElement>('button.send-to-t3-question-answer')?.click();
      rich.push({width,mode,layoutEqual:JSON.stringify(actual)===JSON.stringify(expected),displayEqual:view.editor.getValue()===ref.editor.getValue(),bodyEqual:regionBody(view.editor.getValue(),id)?.body===regionBody(ref.editor.getValue(),id)?.body,buttonsEqual:JSON.stringify(buttons[0])===JSON.stringify(buttons[1]),buttons,answerClicks:this.answerClicks-clicks,savedClean:await app.vault.adapter.read('Virtual.md')===saved});
      style.remove();
    }
    this.write('rich.json',rich);
    const edges:any[]=[];
    const trace:unknown[]=[];traceNativeView(this.adapter,trace,'edge');
    await virtual.setViewState({type:'markdown',state:{file:'Virtual.md',mode:'source',source:false}});
    this.adapter.setResponses([{id,body:'> **Bold fixture**\n\n> Response for selection.'}]);
    view.editor.replaceRange('Edited ',{line:2,ch:0});view.requestSave();
    const expectedEdit=saved.replace('Before','Edited Before');let autosaved='';
    for(let attempt=0;attempt<50;attempt++){autosaved=await app.vault.adapter.read('Virtual.md');if(autosaved===expectedEdit)break;await pause(100);}
    edges.push({name:'ordinary-autosave',pass:autosaved===expectedEdit,observed:autosaved,expected:expectedEdit});
    this.adapter.setResponses([{id,body:'> **Bold fixture**\n\n> Stream updated.'}]);
    const snapshot=async()=>({saved:view.getViewData(),display:view.editor.getValue(),disk:await app.vault.read(view.file!)});
    view.editor.undo();const undoBeforeSave=await snapshot();await view.save();edges.push({name:'undo-ordinary-edit-after-stream',pass:view.getViewData()===saved&&view.editor.getValue().includes('Stream updated.'),beforeSave:undoBeforeSave,afterSave:await snapshot()});
    view.editor.redo();const redoBeforeSave=await snapshot();await view.save();edges.push({name:'redo-ordinary-edit-after-stream',pass:view.getViewData()===saved.replace('Before','Edited Before')&&view.editor.getValue().includes('Stream updated.'),beforeSave:redoBeforeSave,afterSave:await snapshot()});
    const editedSaved=saved.replace('Before','Edited Before');
    await virtual.setViewState({type:'markdown',state:{file:'Virtual.md',mode:'preview'}});await pause(150);
    edges.push({name:'reading-after-edit',pass:view.getViewData()===editedSaved&&view.editor.getValue().includes('Stream updated.'),observed:await snapshot()});
    await virtual.setViewState({type:'markdown',state:{file:'Virtual.md',mode:'source',source:true}});await pause(150);
    edges.push({name:'source-after-edit',pass:view.getViewData()===editedSaved&&view.editor.getValue().includes('Stream updated.'),observed:await snapshot()});
    await virtual.setViewState({type:'markdown',state:{file:'Virtual.md',mode:'source',source:false}});await pause(150);
    const incoming=editedSaved.replace('After response.','External ordinary edit.');await app.vault.modify(view.file!,incoming);await pause(500);
    this.write('edge-trace.json',trace);
    edges.push({name:'incoming-compatible-file-update',pass:view.getViewData()===incoming&&view.editor.getValue().includes('Stream updated.')});
    const at=view.editor.getValue().indexOf('Bold fixture');view.editor.setSelection(view.editor.offsetToPos(at),view.editor.offsetToPos(at+12));edges.push({name:'native-selection',pass:view.editor.getSelection()==='Bold fixture'});
    view.editor.replaceRange('Changed',view.editor.offsetToPos(at),view.editor.offsetToPos(at+12));edges.push({name:'protect-generated-text',pass:view.editor.getValue().includes('Bold fixture')});
    this.adapter.dispose();
    // Bounded real Obsidian table edit + reply: staged file and journal are
    // outside this fixture vault. No agent is dispatched and no execution
    // sandbox is claimed by this probe.
    const bounded=`# Staged fixture\n\n| Exercise | 20kg |\n| --- | ---: |\n| Barb | 20 |\n\n${responseAnchor(id)}\n\nOrdinary tail\n`;
    const file=await app.vault.create('Bounded.md',bounded);await virtual.openFile(file);
    const boundedView=virtual.view as MarkdownView;this.adapter=new NativeResponseView(boundedView,bounded,record=>conflicts.push(record),()=>app.vault.read(file));this.adapter.setResponses([{id,body:'> Working on the table.'}]);
    const journal=await DesktopGenerationJournal.open(path.join(this.root,'private-journal'),[(app.vault.adapter as any).getFullPath('')]);let writes=0;
    const coordinator=new GeneratedNoteCoordinator(journal,{read:async()=>app.vault.read(file),compareAndSet:async(_path,previous,next)=>{
      if(boundedView.getViewData()!==previous)return false;
      this.adapter!.prepareMaterialization(previous,next,[id]);
      let applied=false;try{await app.vault.process(file,value=>{if(value!==previous||boundedView.getViewData()!==previous)return value;applied=true;writes++;return next;});return applied;}finally{if(!applied)this.adapter!.cancelMaterialization();}
    }});
    const request:any={version:2,id,initialOwner:id,vaultId:'fixture',host:{environmentId:'fixture',workspaceRoot:(app.vault.adapter as any).getFullPath(''),directory:'.obsidian/t3-code/inline/v1'},notePath:'Bounded.md',threadId:'fixture-thread',messageId:id,projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:initialRegion(id).bodyHash,createdAt:now,independent:true};
    await coordinator.accept(request,bounded);
    const staged=bounded.replace('| Exercise | 20kg |','| Exercise | 20kg | 25kg |').replace('| --- | ---: |','| --- | ---: | ---: |').replace('| Barb | 20 |','| Barb | 20 | |');
    fs.writeFileSync(path.join(this.root,'staged-note.md'),staged);
    await coordinator.result(id,fs.readFileSync(path.join(this.root,'staged-note.md'),'utf8'),'> Added **25kg**.');
    const commit=await coordinator.commit(id);if(commit.verified)this.adapter.acceptCommitted(commit.verified.document,[id]);await boundedView.save();
    const disk=await app.vault.read(file);edges.push({name:'staged-table-and-response-one-native-save',pass:commit.status==='verified'&&writes===1&&disk.includes('| Barb | 20 | |')&&disk.includes('> Added **25kg**.')&&!disk.includes('Working on the table.'),writes,commitId:commit.verified?.commitId,hash:commit.verified?.hash,acknowledgements:commit.acknowledgements,enforcedAgentBoundary:false});
    await boundedView.onUnloadFile(file);edges.push({name:'unload-projection',pass:await app.vault.read(file)===disk});
    this.adapter.dispose();this.adapter=undefined;
    const production=await productionNative(app,this.root);this.write('production.json',production);
    const handoff=await nativeResponseHandoff(app,this.root);this.write('handoff.json',handoff);
    this.write('edges.json',edges);this.write('done.json',{cases:matrix.length,richCases:rich.length,allRichPassed:rich.every(test=>test.layoutEqual&&test.bodyEqual&&test.buttonsEqual&&test.savedClean&&(test.mode==='source'||test.answerClicks===2)),allLayoutsEqual:matrix.every(test=>test.layoutEqual),allResponseBodiesEqual:matrix.every(test=>test.bodyEqual),allSavedClean:matrix.every(test=>test.savedClean),edges,conflicts,iphoneTested:false,liveSyncTested:false,productionFixturePassed:production.every(row=>row.pass),handoffFixturePassed:handoff.every(row=>row.pass),productionActivated:false});
  }
}
