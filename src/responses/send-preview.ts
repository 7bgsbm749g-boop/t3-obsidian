import type {EditorView,DecorationSet} from '@codemirror/view';
import type {App,MarkdownView,Component} from 'obsidian';
import {renderInlineTurn} from '../conversations/inline-thread';
import {logFailure} from '../app/diagnostics';

export interface SendPreview {app:App;path:string;title:string;id:string;startedAt:string}
interface PreviewPosition {offset:number;preview:SendPreview}
export function sendPreviewBody(preview:SendPreview){
  return renderInlineTurn({messages:[],activities:[],title:preview.title},'',preview.id,'sending','collapse',undefined,undefined,undefined,undefined,{startedAt:preview.startedAt});
}

/** A send indicator is editor UI only. It must never enter note snapshots,
 * autosave, Sync, undo history, or the prompt being prepared. */
export function sendPreviewField(){
  const {StateEffect,StateField}=require('@codemirror/state') as typeof import('@codemirror/state');
  const {Decoration,EditorView,WidgetType}=require('@codemirror/view') as typeof import('@codemirror/view');
  const change=StateEffect.define<PreviewPosition|null>();
  class Pending extends WidgetType {
    constructor(readonly preview:SendPreview){super();}
    toDOM(view:EditorView){return sendPreviewElement(view.dom.ownerDocument,this.preview,()=>view.requestMeasure());}
    eq(other:Pending){return this.preview===other.preview;}
    destroy(element:HTMLElement){disposePreview(element);}
  }
  const field=StateField.define<DecorationSet>({
    create:()=>Decoration.none,
    update:(value,transaction)=>{
      value=value.map(transaction.changes);
      for(const effect of transaction.effects)if(effect.is(change))value=effect.value===null?Decoration.none:Decoration.set([Decoration.widget({widget:new Pending(effect.value.preview),block:true,side:1}).range(effect.value.offset)]);
      return value;
    },
    provide:field=>EditorView.decorations.from(field),
  });
  return {field,change,append:StateEffect.appendConfig};
}
let configuration:ReturnType<typeof sendPreviewField>|undefined;
let nextPreview=0;

const renderings=new WeakMap<HTMLElement,Component>();
function disposePreview(element:HTMLElement){renderings.get(element)?.unload();renderings.delete(element);}
export function sendPreviewElement(document:Document,preview:SendPreview,measure:()=>void=()=>{}){
  const {Component,MarkdownRenderer}=require('obsidian') as typeof import('obsidian');
  const block=document.win.createDiv();
  block.className='markdown-rendered send-to-t3-send-preview';block.contentEditable='false';
  block.setAttribute('aria-label',`${preview.title} · Sending`);
  const child=new Component();child.load();renderings.set(block,child);
  // Use Obsidian's real callout renderer, including its fold and content area.
  // The widget owns the render child; no generated Markdown enters the note.
  void MarkdownRenderer.render(preview.app,sendPreviewBody(preview),block,preview.path,child).then(()=>{
    if(renderings.get(block)===child)measure();else child.unload();
  }).catch(error=>{if(renderings.get(block)===child)logFailure('send.preview.render.failed',error);});
  return block;
}

interface PendingPreview {users:number;clear:()=>void;file:MarkdownView['file']}
export class SendPreviews {
  private pending=new Map<MarkdownView,PendingPreview>();
  begin(view:MarkdownView,offset:number):()=>void {
    if(!view.file)return ()=>{};
    let current=this.pending.get(view);
    if(current&&current.file!==view.file){this.hide(view);current=undefined;}
    if(!current){
      const path=view.file.path,preview:SendPreview={app:view.app,path,title:view.file.basename??path.split('/').at(-1)!.replace(/\.md$/i,''),id:`send:${++nextPreview}`,startedAt:new Date().toISOString()};
      const cm=(view.editor as unknown as {cm?:EditorView})?.cm;
      let clear:()=>void;
      if(view.getMode?.()!=='preview'&&cm?.state){
        const config=configuration??=sendPreviewField();
        const effects=[...(!cm.state.field(config.field,false)?[config.append.of(config.field)]:[]),config.change.of({offset:Math.max(0,Math.min(offset,cm.state.doc.length)),preview})];
        cm.dispatch({effects});
        clear=()=>{if(!(cm as unknown as {destroyed:boolean}).destroyed&&cm.state.field(config.field,false))cm.dispatch({effects:config.change.of(null)});};
      }else{
        const target=view.contentEl?.querySelector('.markdown-preview-sizer');if(!target)return ()=>{};
        const block=sendPreviewElement(target.ownerDocument,preview);target.appendChild(block);clear=()=>{disposePreview(block);block.remove();};
      }
      current={users:0,clear,file:view.file};this.pending.set(view,current);
    }
    const entry=current;entry.users++;let released=false;
    return ()=>{if(released)return;released=true;if(--entry.users===0&&this.pending.get(view)===entry)this.hide(view);};
  }
  hide(view:MarkdownView){const pending=this.pending.get(view);if(!pending)return;this.pending.delete(view);pending.clear();}
  dispose(){for(const view of this.pending.keys())this.hide(view);}
}
