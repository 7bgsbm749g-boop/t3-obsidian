import {Plugin,MarkdownView,MarkdownRenderer,MarkdownRenderChild} from 'obsidian';
import {NativeResponseView} from '../native-response-view';
import {responseAnchor} from '../native-response-projection';
import {renderResponseToolGroup,type ResponseToolGroup} from '../response-tools';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {contentHash} from '../completion';
import {mountToolGroups} from '../response-tool-presentation';
const fs=require('node:fs'),path=require('node:path');
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
/** Synthetic isolated measurement. Edits must come from native desktop keys. */
export default class MegapatchTypingLab extends Plugin {
  private adapter?:NativeResponseView;private evidence='';private guardMs=0;private samples:any[]=[];
  private afterPaint(callback:()=>void){requestAnimationFrame(()=>requestAnimationFrame(callback));}
  private async screenshot(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.evidence,name+'.png'),image.toPNG());}
  private write(name:string,value:any){fs.writeFileSync(path.join(this.evidence,name+'.json'),JSON.stringify(value,null,2));}
  async onload(){
    this.evidence=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.evidence,'ISOLATED-NATIVE-LAB')))throw Error('An isolated synthetic native lab is required.');
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document));
    const {EditorState}=require('@codemirror/state');
    this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>{const start=performance.now(),result=this.adapter?.filterTransaction(transaction)??transaction;this.guardMs=performance.now()-start;return result;}));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR',{message:String(error),stack:error.stack})));
  }
  private async run(){
    const saved='# Native typing measurement\n\nType here: \n\n'+responseAnchor(id)+'\n\nOrdinary tail\n';
    let file=this.app.vault.getFileByPath('Native typing.md');if(!file)file=await this.app.vault.create('Native typing.md',saved);
    const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
    const view=leaf.view as MarkdownView;
    const group:ResponseToolGroup={id:'synthetic',turnId:'synthetic',tools:Array.from({length:20},(_,index)=>({id:'tool-'+index,turnId:'synthetic',key:'synthetic-'+index,status:'completed',label:'Read synthetic output '+index,activeLabel:'Read synthetic output',icon:'file-text',action:'read',sequence:index,output:('Synthetic retained output '+index+'\n').repeat(900)}))};
    const body='> Synthetic reply.\n\n'+renderResponseToolGroup(group);
    this.adapter=new NativeResponseView(view,saved,record=>this.write('conflict',record),()=>this.app.vault.read(file!));this.adapter.setResponses([{id,body}]);view.editor.setCursor({line:2,ch:'Type here: '.length});
    const mounted=new WeakSet<HTMLDetailsElement>();
    this.registerDomEvent(view.contentEl,'toggle',event=>{
      if(!(event.target as HTMLElement)?.matches?.('details'))return;
      this.afterPaint(()=>{const outer=view.contentEl.querySelector<HTMLDetailsElement>('details[data-t3-tool-ref]'),first=outer?.querySelector<HTMLDetailsElement>('details.send-to-t3-tool');this.write('tool-visible',{outerOpen:outer?.open,firstToolOpen:first?.open,toolCount:outer?.querySelectorAll('details.send-to-t3-tool').length,retainedOutputPresent:outer?.textContent?.includes('Synthetic retained output 0')===true,editorCharacters:(view.editor as any).cm.state.doc.length,canonicalHash:contentHash(this.adapter!.responseBody(id)??'')});void this.screenshot('tool-visible');});
    },true);
    this.registerDomEvent(view.contentEl,'toggle',event=>{
      const details=event.target as HTMLDetailsElement;if(!details?.matches?.('details[data-t3-tool-ref]')||!details.open||mounted.has(details))return;mounted.add(details);
      const child=new MarkdownRenderChild(details);this.addChild(child);
      const dispose=mountToolGroups(details,ref=>this.adapter?.toolGroup(ref),async(html,target)=>{
        await MarkdownRenderer.render(this.app,html,target,file!.path,child);
        this.afterPaint(()=>{this.write('lazy',{outerOpen:details.open,toolCount:details.querySelectorAll('details.send-to-t3-tool').length,retainedOutputPresent:details.textContent?.includes('Synthetic retained output 0')===true,editorCharacters:(view.editor as any).cm.state.doc.length,canonicalCharacters:body.length,canonicalHash:contentHash(this.adapter!.responseBody(id)??'')});void this.screenshot('lazy');});
      },error=>this.write('lazy-error',{message:String(error)}));child.register(dispose);
    },true);
    let pending:{at:number;key:string;trusted:boolean}|undefined;
    this.registerDomEvent(view.contentEl,'keydown',event=>{if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey)pending={at:performance.now(),key:event.key,trusted:event.isTrusted};},true);
    const cm=(view.editor as any).cm,thisLab=this;
    const {ViewPlugin}=require('@codemirror/view'),{StateEffect}=require('@codemirror/state');
    cm.dispatch({effects:StateEffect.appendConfig.of(ViewPlugin.fromClass(class {
      update(update:any){if(!update.docChanged||!pending)return;const sample={...pending,guardMs:thisLab.guardMs,transactionMs:performance.now()-pending.at,characters:update.state.doc.length};pending=undefined;requestAnimationFrame(()=>{thisLab.samples.push({...sample,firstFrameMs:performance.now()-sample.at});thisLab.write('samples',{samples:thisLab.samples,savedProjection:thisLab.adapter!.saved(),canonicalCharacters:body.length,canonicalHash:contentHash(body)});thisLab.afterPaint(()=>void thisLab.screenshot('key-frame-'+thisLab.samples.length));});}
    }))});
    this.write('ready',{savedCharacters:saved.length,editorCharacters:cm.state.doc.length,canonicalCharacters:body.length,canonicalHash:contentHash(body),platform:process.platform});
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));await this.screenshot('ready');
  }
  onunload(){this.adapter?.dispose();}
}
