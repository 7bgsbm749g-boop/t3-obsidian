import {editorLivePreviewField} from 'obsidian';
import {Notice,editorInfoField,type App} from 'obsidian';
import {NoteTabPanel} from './note-tab-panel';
import type {Extension} from '@codemirror/state';
import type {DecorationSet,EditorView,ViewUpdate} from '@codemirror/view';
import {parseQuestionToken,questionKey,questionSections,type QuestionTarget} from './questions';
import {QuestionController} from './question-controller';

function buttonLabel(controller:QuestionController,target:QuestionTarget){const view=controller.view(target);return view.status==='submitting'?(view.accepted?'Answer sent':'Submitting…'):view.status==='resolved'?'Answered':'Answer';}
export function questionButton(controller:QuestionController,target:QuestionTarget,open:(target:QuestionTarget)=>void){
  const untrack=controller.track(target);
  const button=document.createElement('button');button.className='send-to-t3-question-answer';
  const update=()=>{button.textContent=buttonLabel(controller,target);button.disabled=controller.view(target).status==='resolved';const row=button.closest<HTMLElement>('[data-t3-question], blockquote');if(row)row.hidden=controller.isHidden(target);};
  update();button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open(target);});
  const stop=controller.subscribe(update);return {button,unsubscribe:()=>{stop();untrack();}};
}

/** Live Preview's native HTML embeds do not run Markdown postprocessors.
 * Bind their generated links after attachment, and release removed controls. */
export function installQuestionLinks(root:Document,controller:QuestionController,open:(target:QuestionTarget,button:HTMLElement)=>void){
  const controls=new Map<HTMLElement,()=>void>();
  const scan=()=>{
    for(const [button,dispose] of controls)if(!button.isConnected){dispose();controls.delete(button);}
    for(const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-t3-question] a[href^="t3-question:"]'))){
      const target=parseQuestionToken((link.getAttribute('href')??'').slice('t3-question:'.length)),row=link.closest<HTMLElement>('[data-t3-question]'),owner=parseQuestionToken(row?.getAttribute('data-t3-question')??'');
      if(!target||!owner||questionKey(target)!==questionKey(owner))continue;
      const control=questionButton(controller,target,target=>open(target,control.button));link.replaceWith(control.button);controls.set(control.button,control.unsubscribe);
      row!.hidden=controller.isHidden(target);
    }
  };
  const observer=new MutationObserver(scan);observer.observe(root,{childList:true,subtree:true});scan();
  return ()=>{observer.disconnect();for(const dispose of controls.values())dispose();controls.clear();};
}

export class QuestionModal extends NoteTabPanel {
  private unsubscribe?:()=>void;
  private untrack?:()=>void;
  private form?:HTMLElement;
  private status?:HTMLElement;
  private submitButton?:HTMLButtonElement;
  private dismissButton?:HTMLButtonElement;
  private signature='';
  private opened=false;
  constructor(app:App,private controller:QuestionController,readonly target:QuestionTarget,private sourceNotePath?:string){super(app);}
  onOpen(){
    this.opened=true;
    this.unsubscribe?.();
    this.contentEl.empty();this.untrack?.();this.untrack=this.controller.track(this.target);
    this.signature='';
    this.contentEl.addClass('send-to-t3-question-dialog');this.contentEl.createEl('h2',{text:'Answer T3 question'});
    this.status=this.contentEl.createEl('p',{attr:{'aria-live':'polite'}});this.form=this.contentEl.createDiv();
    const actions=this.contentEl.createDiv({cls:'send-to-t3-question-actions'});
    this.submitButton=actions.createEl('button',{text:'Submit answer',cls:'mod-cta'});this.submitButton.onclick=()=>this.send(false);
    this.dismissButton=actions.createEl('button',{text:'Dismiss'});this.dismissButton.onclick=()=>this.send(true);
    actions.createEl('button',{text:'Close'}).onclick=()=>this.close();
    this.unsubscribe=this.controller.subscribe(()=>this.update());this.update();void this.controller.refresh([this.target]);
  }
  private send(dismiss:boolean){void this.controller.submit(this.target,dismiss,this.sourceNotePath).catch(error=>{new Notice(error instanceof Error?error.message:'Cannot submit the answer.',8000);this.update();});}
  private update(){
    if(!this.opened)return;
    const view=this.controller.view(this.target),record=this.controller.record(this.target);
    if(this.controller.isDismissed(this.target)){this.close();new Notice('T3 question dismissed.');return;}
    if(view.status==='resolved'){this.close();new Notice('T3 question resolved.');return;}
    this.status!.textContent=view.status==='submitting'?(view.accepted?'Answer sent. Waiting for T3 to continue.':'Submitting…'):view.detail??(view.request?.responseMode==='message'?'Question pending. T3 can keep working while you answer.':view.request?'T3 is waiting for your answer.':'Loading question…');
    const signature=JSON.stringify(view.request?.questions??[]);
    // Streaming refreshes update status only. Keep DOM, focus, selection, and drafts intact.
    if(signature!==this.signature){
      this.signature=signature;this.form!.replaceChildren();
      for(const question of view.request?.questions??[]){
        const section=this.form!.createEl('fieldset');section.createEl('legend',{text:question.header});section.createEl('p',{text:question.question});
        let draft=record.drafts[question.id]??{};
        const inputs:HTMLInputElement[]=[];
        for(const [index,option] of question.options.entries()){
          const label=section.createEl('label',{cls:'send-to-t3-question-option'}),input=label.createEl('input',{type:question.multiSelect?'checkbox':'radio'});
          input.name=`t3-question-${question.id}`;input.value=option.value??option.label;input.checked=draft.selected?.includes(input.value)??(index===0&&!draft.text&&!question.multiSelect&&!record.command);
          // A default choice is a draft only, never an implicit submission.
          if(input.checked&&!draft.selected?.length){draft={...draft,selected:[input.value]};if(!record.command)this.controller.draft(this.target,question.id,draft);}
          inputs.push(input);label.createEl('span',{text:option.label});if(option.description)label.createEl('small',{text:option.description});
          input.onchange=()=>{draft={...draft,selected:inputs.filter(i=>i.checked).map(i=>i.value),mode:'options'};this.controller.draft(this.target,question.id,draft);updateCustom();};
        }
        const textarea=question.allowCustomAnswer!==false?section.createEl('textarea',{attr:{'aria-label':question.options.length?`Custom answer for ${question.header}`:question.header,placeholder:question.options.length?'Or write your own answer':'Your answer'}}):undefined;
        const hint=textarea?section.createEl('small',{cls:'send-to-t3-custom-answer-hint'}):undefined;
        const updateCustom=()=>{
          if(!textarea)return;
          const active=draft.mode==='custom'||(draft.mode!=='options'&&(!!draft.text||!question.options.length));
          textarea.dataset.answerActive=String(active);
          hint!.textContent=!active&&draft.text?'Draft saved. The selected option will be submitted.':'';
        };
        if(textarea){
          textarea.value=draft.text??'';
          const activate=()=>{draft={text:textarea.value,selected:[],mode:'custom'};for(const input of inputs)input.checked=false;this.controller.draft(this.target,question.id,draft);updateCustom();};
          textarea.onfocus=activate;textarea.oninput=activate;updateCustom();
        }
      }
    }
    const locked=!!record.command||!view.request||view.status==='submitting';
    for(const input of Array.from(this.form!.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')))input.disabled=locked;
    this.submitButton!.disabled=!view.request||['loading','resolved','unavailable','submitting'].includes(view.status);
    this.submitButton!.textContent=view.status==='submitting'?(view.accepted?'Answer sent':'Submitting…'):record.command?'Retry saved answer':'Submit answer';
    this.dismissButton!.hidden=view.request?.responseMode!=='message';this.dismissButton!.disabled=locked;
  }
  close(restoreFocus=true){
    // Obsidian restores keyboard focus to the editor on modal close. Its
    // retained cursor may be above the reader's viewport, so prevent that
    // focus restoration from scrolling the note before streaming resumes.
    const editors=this.app.workspace?.getLeavesOfType('markdown').map(leaf=>(leaf.view as any).editor).filter(Boolean)??[];
    const positions=editors.map(editor=>({editor,scroll:editor.getScrollInfo?.()}));
    super.close(restoreFocus);
    for(const {editor,scroll} of positions)if(scroll)editor.scrollTo(scroll.left,scroll.top);
  }
  onClose(){this.opened=false;this.unsubscribe?.();this.untrack?.();this.untrack=undefined;try{this.controller.flushDrafts();}catch(error){new Notice(error instanceof Error?error.message:'Cannot save the draft.',8000);}this.contentEl.empty();}
}

/** Replace the readable Markdown answer link with a real Live Preview button. */
export function questionEditorExtension(controller:QuestionController,open:(target:QuestionTarget,notePath?:string)=>void):Extension {
  const {Decoration,EditorView,ViewPlugin,WidgetType}=require('@codemirror/view') as typeof import('@codemirror/view');
  const {StateEffect,StateField}=require('@codemirror/state') as typeof import('@codemirror/state');
  const refreshDismissed=StateEffect.define<void>();
  const hidden=(document:string)=>controller.hasHiddenQuestions()?Decoration.set(questionSections(document).filter(section=>controller.isHidden(section.target)).map(section=>Decoration.replace({block:true}).range(section.from,section.to))):Decoration.none;
  // Direct StateField decorations can hide complete multiline sections. The
  // underlying live response remains untouched, preserving its writer hash.
  const dismissed=StateField.define<DecorationSet>({
    create:state=>hidden(state.doc.toString()),
    update:(value,transaction)=>{
      if(transaction.effects.some(effect=>effect.is(refreshDismissed)))return hidden(transaction.state.doc.toString());
      if(!transaction.docChanged)return value;
      // Ordinary typing only maps existing ranges. Structural edits can create
      // a marker, change a code fence, or change the hidden section itself.
      let structural=false;
      transaction.changes.iterChanges((from,to,_from,_to,inserted)=>{
        if(/[\n`~<>]/.test(inserted.toString())||/[\n`~<>]/.test(transaction.startState.doc.sliceString(from,to)))structural=true;
        const line=transaction.startState.doc.lineAt(from);
        if(from-line.from<=4&&(/^\s/.test(inserted.toString())||/^\s*(?:`|~|>)/.test(line.text)))structural=true;
        value.between(Math.max(0,from-1),Math.min(transaction.startState.doc.length,to+1),()=>{structural=true;});
      });
      return structural?hidden(transaction.state.doc.toString()):value.map(transaction.changes);
    },
    provide:field=>[EditorView.decorations.from(field),EditorView.atomicRanges.of(view=>view.state.field(field))],
  });
  const dismissalUpdates=ViewPlugin.fromClass(class {
    private unsubscribe:()=>void;
    constructor(view:EditorView){let revision=controller.visibilityRevision;this.unsubscribe=controller.subscribe(()=>{if(revision===controller.visibilityRevision)return;revision=controller.visibilityRevision;view.dispatch({effects:refreshDismissed.of(undefined)});});}
    destroy(){this.unsubscribe();}
  });
  class AnswerWidget extends WidgetType {
    private unsubscribe?:()=>void;
    constructor(readonly target:QuestionTarget){super();}
    eq(other:AnswerWidget){return questionKey(this.target)===questionKey(other.target);}
    toDOM(view?:EditorView){const path=view&&editorInfoField?view.state.field(editorInfoField,false)?.file?.path:undefined;const result=questionButton(controller,this.target,target=>open(target,path));this.unsubscribe=result.unsubscribe;return result.button;}
    destroy(){this.unsubscribe?.();}
    ignoreEvent(){return true;}
  }
  const build=(view:EditorView)=>{
    const doc=view.state.doc.toString(),ranges=[];
    // Obsidian exposes livePreview on the view; source mode keeps ordinary Markdown.
    const live=(view as any).contentDOM?.closest('.markdown-source-view')?.classList.contains('is-live-preview');
    if(!live)return Decoration.none;
    const regexp=/^> \[Answer\]\(t3-question:([^\s)]+)\)$/gm;
    for(const match of doc.matchAll(regexp)){const target=parseQuestionToken(match[1]);if(target&&!controller.isDismissed(target))ranges.push(Decoration.replace({widget:new AnswerWidget(target)}).range(match.index!+2,match.index!+match[0].length));}
    return Decoration.set(ranges);
  };
  const plugin=ViewPlugin.fromClass(class {
    decorations:DecorationSet;
    constructor(view:EditorView){this.decorations=build(view);}
    update(update:ViewUpdate){if(update.docChanged||update.startState.field(editorLivePreviewField,false)!==update.state.field(editorLivePreviewField,false)||update.transactions.some(transaction=>transaction.effects.some(effect=>effect.is(refreshDismissed))))this.decorations=build(update.view);}
  },{decorations:value=>value.decorations});
  return [plugin,EditorView.atomicRanges.of(view=>view.plugin(plugin)?.decorations??Decoration.none),dismissed,dismissalUpdates];
}
