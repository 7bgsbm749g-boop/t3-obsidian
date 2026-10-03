import {Notice} from 'obsidian';
import type {Extension} from '@codemirror/state';
import type {DecorationSet,EditorView,ViewUpdate} from '@codemirror/view';
import {approvalKey,parseApprovalUrl,type ApprovalTarget,type ApprovalDecision} from './approvals';
import {ApprovalController} from './approval-controller';
import {markdownCodeRanges} from './reply-html';

export function approvalButton(controller:ApprovalController,target:ApprovalTarget,decision:ApprovalDecision){
  const button=document.createElement('button');button.className=`send-to-t3-approval-button${decision==='accept'?' mod-cta':''}`;
  const update=()=>{
    const view=controller.view(target),saved=controller.record(target).command,label=decision==='accept'?'Approve':'Deny';
    button.textContent=view.status==='resolved'?'Resolved':view.status==='submitting'&&saved?.decision===decision?'Sending…':saved&&view.status==='error'&&saved.decision===decision?`Retry ${label.toLowerCase()}`:label;
    button.disabled=['loading','resolved','unavailable','submitting'].includes(view.status)||!!saved&&saved.decision!==decision||!!saved&&!controller.record(target).uncertain;
    button.title=view.detail??(decision==='accept'?'Approve this command once':'Deny this command');
    button.setAttribute('aria-label',button.textContent);
  };
  update();button.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    void controller.submit(target,decision).catch(error=>new Notice(error instanceof Error?error.message:'Cannot send the approval decision.',8000));
  });
  const unsubscribe=controller.subscribe(update),unwatch=controller.watch(target);
  return {button,unsubscribe:()=>{unsubscribe();unwatch();}};
}

/** Source mode retains links; Live Preview replaces only valid approval controls. */
export function approvalEditorExtension(controller:ApprovalController):Extension {
  const {Decoration,EditorView,ViewPlugin,WidgetType}=require('@codemirror/view') as typeof import('@codemirror/view');
  class ApprovalWidget extends WidgetType {
    private unsubscribe?:()=>void;
    constructor(readonly target:ApprovalTarget,readonly decision:ApprovalDecision){super();}
    eq(other:ApprovalWidget){return approvalKey(this.target)===approvalKey(other.target)&&this.decision===other.decision;}
    toDOM(){const result=approvalButton(controller,this.target,this.decision);this.unsubscribe=result.unsubscribe;return result.button;}
    destroy(){this.unsubscribe?.();}
    ignoreEvent(){return true;}
  }
  const build=(view:EditorView)=>{
    if(!(view as any).contentDOM?.closest('.markdown-source-view')?.classList.contains('is-live-preview'))return Decoration.none;
    const doc=view.state.doc.toString();if(!doc.includes('t3-approval:'))return Decoration.none;
    const code=markdownCodeRanges(doc),ranges=[];
    for(const match of doc.matchAll(/\[(?:Approve|Deny)\]\((t3-approval:[^\s)]+)\)/g)){
      if(code.some(([from,to])=>match.index!>=from&&match.index!<to))continue;
      const parsed=parseApprovalUrl(match[1]);if(parsed)ranges.push(Decoration.replace({widget:new ApprovalWidget(parsed.target,parsed.decision)}).range(match.index!,match.index!+match[0].length));
    }
    return Decoration.set(ranges);
  };
  const plugin=ViewPlugin.fromClass(class {
    decorations:DecorationSet;
    constructor(view:EditorView){this.decorations=build(view);}
    update(update:ViewUpdate){if(update.docChanged||update.viewportChanged)this.decorations=build(update.view);}
  },{decorations:value=>value.decorations});
  return [plugin,EditorView.atomicRanges.of(view=>view.plugin(plugin)?.decorations??Decoration.none)];
}
