import {Plugin,MarkdownView} from 'obsidian';
import {hiddenInlineMarkerExtension,hideResponseContainerBoundaries,type ContainerMarkerDecorations} from '../inline-markers';
import {containerBody,containerStart} from '../response-container';
import {markdownCodeCacheStatus} from '../reply-html';
import type {StateField} from '@codemirror/state';
const fs=require('node:fs'),path=require('node:path');
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Synthetic, unsynced native editor validation. No T3 work is dispatched. */
export default class ContainerTypingLab extends Plugin {
  private root='';private extension=hiddenInlineMarkerExtension() as any[];
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name+'.json'),JSON.stringify(value,null,2)+'\n');}
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-CONTAINER-TYPING-LAB')))throw Error('An isolated typing lab is required.');
    this.registerEditorExtension(this.extension);
    this.registerMarkdownPostProcessor(hideResponseContainerBoundaries);
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR',{error:String(error),stack:error.stack})));
  }
  private async run(){
    const leaf=this.app.workspace.getLeaf(false),field=this.extension[2] as StateField<ContainerMarkerDecorations>,rows:any[]=[];
    const unit='Synthetic paragraph with a `code span`.\n\n```ts\nconst value=123;\n```\n\n';
    const body=unit.repeat(Math.ceil(480000/unit.length)).slice(0,480000);
    for(const kind of ['legacy','container'])for(const sourceMode of [true,false]){
      const source='# Native editor regression\n\nType here: \n\n'+(kind==='container'?containerBody(id,body):`<!-- t3-inline:start:${id} -->\n${body}\n<!-- t3-inline:end:${id} -->`);
      const file=await this.app.vault.create(kind+'-'+(sourceMode?'source':'live')+'.md',source);
      await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:sourceMode}});await pause(200);
      const view=leaf.view as MarkdownView,cm=(view.editor as any).cm,before=markdownCodeCacheStatus().sourceParses,samples:number[]=[];
      for(let key=0;key<12;key++){
        const start=performance.now();cm.dispatch({changes:{from:0,insert:'x'}});cm.dispatch({changes:{from:0,to:1,insert:''}});samples.push((performance.now()-start)/2);
      }
      const ranges=cm.state.field(field).decorations;
      await view.save();const saved=await this.app.vault.read(file),ordered=[...samples].sort((a,b)=>a-b);
      rows.push({kind,mode:sourceMode?'source':'live',characters:source.length,samplesMilliseconds:samples,medianMilliseconds:ordered[6],maxMilliseconds:Math.max(...samples),fullCommonMarkParses:markdownCodeCacheStatus().sourceParses-before,hiddenBoundaryCount:ranges.size,bytesPreserved:saved===source});
    }
    const literal='```md\n'+containerBody(id,'Literal example.')+'\n```\n\n'+containerBody(id,'Actual response.');
    const file=await this.app.vault.create('Code examples.md',literal);await leaf.openFile(file);await pause(200);
    const view=leaf.view as MarkdownView,cm=(view.editor as any).cm,hidden:Array<[number,number]>=[];
    cm.state.field(field).decorations.between(0,cm.state.doc.length,(from:number,to:number)=>hidden.push([from,to]));
    const literalVisible=hidden.every(([from])=>from>literal.indexOf('```',3));
    await view.save();
    this.write('results',{platform:process.platform,method:'Real native CodeMirror transactions; no Windows or physical-key timing claim',rows,literalVisible,hiddenBoundaryCount:hidden.length,allPassed:rows.every(row=>row.bytesPreserved&&row.fullCommonMarkParses===0&&row.hiddenBoundaryCount===(row.kind==='container'?2:0)&&row.medianMilliseconds<100)&&literalVisible&&hidden.length===2});
    const ready=await this.app.vault.create('Native key check.md','# Native key check\n\nType here: \n\n'+containerBody(id,body));
    await leaf.openFile(ready);await leaf.setViewState({type:'markdown',state:{file:ready.path,mode:'source',source:true}});await pause(200);
    const keyView=leaf.view as MarkdownView,keyCm=(keyView.editor as any).cm;
    keyView.editor.setCursor({line:2,ch:'Type here: '.length});
    let pending:{at:number;key:string;trusted:boolean}|undefined;
    this.registerDomEvent(keyView.contentEl,'keydown',event=>{if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey)pending={at:performance.now(),key:event.key,trusted:event.isTrusted};},true);
    const {ViewPlugin}=require('@codemirror/view'),{StateEffect}=require('@codemirror/state'),lab=this;
    keyCm.dispatch({effects:StateEffect.appendConfig.of(ViewPlugin.fromClass(class {
      update(update:any){
        if(!update.docChanged||!pending)return;
        const sample={...pending,transactionMilliseconds:performance.now()-pending.at,characters:update.state.doc.length};pending=undefined;
        requestAnimationFrame(()=>{lab.write('native-key',{...sample,firstFrameMilliseconds:performance.now()-sample.at,containerHidden:update.state.field(field).decorations.size===2});void keyView.save();});
      }
    }))});
    this.write('ready',{file:ready.path,characters:keyCm.state.doc.length,containerStart:containerStart(id),awaitsNativeKey:true});
    const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,'ready.png'),image.toPNG());
  }
}
