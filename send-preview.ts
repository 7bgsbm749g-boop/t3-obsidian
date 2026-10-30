import type {EditorView,DecorationSet} from '@codemirror/view';
import type {MarkdownView} from 'obsidian';

/** A send indicator is editor UI only. It must never enter note snapshots,
 * autosave, Sync, undo history, or the prompt being prepared. */
export function sendPreviewField(){
  const {StateEffect,StateField}=require('@codemirror/state') as typeof import('@codemirror/state');
  const {Decoration,EditorView,WidgetType}=require('@codemirror/view') as typeof import('@codemirror/view');
  const change=StateEffect.define<number|null>();
  class Pending extends WidgetType {
    toDOM(view:EditorView){return sendPreviewElement(view.dom.ownerDocument);}
    eq(){return true;}
  }
  const field=StateField.define<DecorationSet>({
    create:()=>Decoration.none,
    update:(value,transaction)=>{
      value=value.map(transaction.changes);
      for(const effect of transaction.effects)if(effect.is(change))value=effect.value===null?Decoration.none:Decoration.set([Decoration.widget({widget:new Pending(),block:true,side:1}).range(effect.value)]);
      return value;
    },
    provide:field=>EditorView.decorations.from(field),
  });
  return {field,change,append:StateEffect.appendConfig};
}
let configuration:ReturnType<typeof sendPreviewField>|undefined;

export function sendPreviewElement(document:Document){
  const block=document.createElement('div');
  block.className='callout send-to-t3-send-preview';block.dataset.callout='t3-progress';
  block.setAttribute('role','status');block.setAttribute('aria-label','Preparing T3 response');
  const title=block.appendChild(document.createElement('div'));title.className='callout-title';
  const text=title.appendChild(document.createElement('div'));text.className='callout-title-inner';
  text.appendChild(document.createElement('strong')).textContent='T3 · Working';
  const spinner=text.appendChild(document.createElement('span'));spinner.className='send-to-t3-inline-spinner';spinner.setAttribute('aria-label','Loading');
  return block;
}

interface PendingPreview {users:number;clear:()=>void;file:MarkdownView['file']}
export class SendPreviews {
  private pending=new Map<MarkdownView,PendingPreview>();
  begin(view:MarkdownView,offset:number):()=>void {
    let current=this.pending.get(view);
    if(current&&current.file!==view.file){this.hide(view);current=undefined;}
    if(!current){
      const cm=(view.editor as unknown as {cm?:EditorView})?.cm;
      let clear:()=>void;
      if(view.getMode?.()!=='preview'&&cm?.state){
        const config=configuration??=sendPreviewField();
        const effects=[...(!cm.state.field(config.field,false)?[config.append.of(config.field)]:[]),config.change.of(Math.max(0,Math.min(offset,cm.state.doc.length)))];
        cm.dispatch({effects});
        clear=()=>{if(!(cm as unknown as {destroyed:boolean}).destroyed&&cm.state.field(config.field,false))cm.dispatch({effects:config.change.of(null)});};
      }else{
        const target=view.contentEl?.querySelector('.markdown-preview-sizer');if(!target)return ()=>{};
        const block=sendPreviewElement(target.ownerDocument);target.appendChild(block);clear=()=>block.remove();
      }
      current={users:0,clear,file:view.file};this.pending.set(view,current);
    }
    const entry=current;entry.users++;let released=false;
    return ()=>{if(released)return;released=true;if(--entry.users===0&&this.pending.get(view)===entry)this.hide(view);};
  }
  hide(view:MarkdownView){const pending=this.pending.get(view);if(!pending)return;this.pending.delete(view);pending.clear();}
  dispose(){for(const view of this.pending.keys())this.hide(view);}
}
