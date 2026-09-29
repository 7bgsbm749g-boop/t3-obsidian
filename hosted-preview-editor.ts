import type {App} from 'obsidian';
import type {Extension} from '@codemirror/state';
import {activeInlineIds} from './inline-thread';
import {hostedPreviewRanges,type HostedPreview} from './hosted-preview';

/** Read-only rendered progress. Decorations never modify the editor document,
 * so editing elsewhere cannot race a second writer against the VPS. */
export function hostedPreviewExtension(app:App,read:(id:string)=>Promise<HostedPreview|undefined>):Extension {
  const {StateEffect,StateField}=require('@codemirror/state') as typeof import('@codemirror/state');
  const {Decoration,EditorView,ViewPlugin,WidgetType}=require('@codemirror/view') as typeof import('@codemirror/view');
  const {Component,MarkdownRenderer,editorInfoField}=require('obsidian') as typeof import('obsidian');
  const updatePreview=StateEffect.define<Map<string,HostedPreview>>();
  class PreviewWidget extends WidgetType {
    constructor(readonly body:string,readonly path:string){super();}
    eq(other:PreviewWidget){return other.body===this.body&&other.path===this.path;}
    toDOM(){
      const element=document.createElement('div');element.className='send-to-t3-hosted-preview';
      const component=new Component();component.load();components.set(element,component);
      void MarkdownRenderer.render(app,this.body,element,this.path,component).catch(()=>{element.textContent=this.body;});
      return element;
    }
    destroy(element:HTMLElement){components.get(element)?.unload();components.delete(element);}
    ignoreEvent(){return false;}
  }
  const components=new WeakMap<HTMLElement,InstanceType<typeof Component>>();
  const previews=StateField.define<Map<string,HostedPreview>>({create:()=>new Map(),update:(value,tr)=>{for(const effect of tr.effects)if(effect.is(updatePreview))return effect.value;return value;}});
  const decorations=StateField.define({
    create:()=>Decoration.none,
    update:(_value,tr)=>{
      const path=tr.state.field(editorInfoField,false)?.file?.path;
      if(!path)return Decoration.none;
      return Decoration.set(hostedPreviewRanges(tr.state.doc.toString(),path,tr.state.field(previews)).filter(range=>!tr.state.selection.ranges.some(selection=>selection.from<range.to&&selection.to>range.from)).map(range=>Decoration.replace({widget:new PreviewWidget(range.body,path),block:true}).range(range.from,range.to)),true);
    },
    provide:field=>EditorView.decorations.from(field),
  });
  const polling=ViewPlugin.fromClass(class {
    stopped=false;
    timer?:ReturnType<typeof setTimeout>;
    constructor(readonly view:import('@codemirror/view').EditorView){this.timer=setTimeout(()=>void this.poll(),0);}
    async poll(){
      const path=this.view.state.field(editorInfoField,false)?.file?.path;
      const ids=activeInlineIds(this.view.state.doc.toString());
      const values=await Promise.all(ids.map(async id=>{try{return [id,await read(id)] as const;}catch{return [id,undefined] as const;}}));
      if(this.stopped)return;
      if(path===this.view.state.field(editorInfoField,false)?.file?.path)this.view.dispatch({effects:updatePreview.of(new Map(values.filter((entry):entry is readonly [string,HostedPreview]=>!!entry[1])))});
      this.timer=setTimeout(()=>void this.poll(),1500);
    }
    destroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
  });
  return [previews,decorations,polling];
}
