import {Modal,Notice,type App} from 'obsidian';
import type {Extension} from '@codemirror/state';
import type {DecorationSet,EditorView,ViewUpdate} from '@codemirror/view';
import {parseQuestionToken,questionKey,type QuestionTarget} from './questions';
import {QuestionController} from './question-controller';

function buttonLabel(controller:QuestionController,target:QuestionTarget){const view=controller.view(target);return view.status==='submitting'?'Submitting…':view.status==='resolved'?'Answered':'Answer';}
export function questionButton(controller:QuestionController,target:QuestionTarget,open:(target:QuestionTarget)=>void){
  const button=document.createElement('button');button.className='send-to-t3-question-answer';
  const update=()=>{button.textContent=buttonLabel(controller,target);button.disabled=controller.view(target).status==='resolved';};
  update();button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open(target);});
  const unsubscribe=controller.subscribe(update);return {button,unsubscribe};
}

export class QuestionModal extends Modal {
  private unsubscribe?:()=>void;
  private form?:HTMLElement;
  private status?:HTMLElement;
  private submitButton?:HTMLButtonElement;
  private dismissButton?:HTMLButtonElement;
  private signature='';
  constructor(app:App,private controller:QuestionController,readonly target:QuestionTarget){super(app);}
  onOpen(){
    this.signature='';
    this.contentEl.addClass('send-to-t3-question-dialog');this.contentEl.createEl('h2',{text:'Answer T3 question'});
    this.status=this.contentEl.createEl('p',{attr:{'aria-live':'polite'}});this.form=this.contentEl.createDiv();
    const actions=this.contentEl.createDiv({cls:'send-to-t3-question-actions'});
    this.submitButton=actions.createEl('button',{text:'Submit answer',cls:'mod-cta'});this.submitButton.onclick=()=>this.send(false);
    this.dismissButton=actions.createEl('button',{text:'Dismiss'});this.dismissButton.onclick=()=>this.send(true);
    actions.createEl('button',{text:'Close'}).onclick=()=>this.close();
    this.unsubscribe=this.controller.subscribe(()=>this.update());this.update();void this.controller.refresh([this.target]);
  }
  private send(dismiss:boolean){void this.controller.submit(this.target,dismiss).catch(error=>{new Notice(error instanceof Error?error.message:'Cannot submit the answer.',8000);this.update();});}
  private update(){
    const view=this.controller.view(this.target),record=this.controller.record(this.target);
    this.status!.textContent=view.status==='resolved'?'Answered in T3.':view.status==='submitting'?'Submitting… Waiting for T3 to confirm.':view.detail??(view.request?.responseMode==='message'?'Question pending. T3 can keep working while you answer.':view.request?'T3 is waiting for your answer.':'Loading question…');
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
          input.onchange=()=>{draft={selected:inputs.filter(i=>i.checked).map(i=>i.value),text:''};if(textarea)textarea.value='';this.controller.draft(this.target,question.id,draft);};
        }
        const textarea=question.allowCustomAnswer!==false?section.createEl('textarea',{attr:{'aria-label':question.options.length?`Custom answer for ${question.header}`:question.header,placeholder:question.options.length?'Or write your own answer':'Your answer'}}):undefined;
        if(textarea){textarea.value=draft.text??'';textarea.oninput=()=>{draft={text:textarea.value,selected:[]};for(const input of inputs)input.checked=false;this.controller.draft(this.target,question.id,draft);};}
      }
    }
    const locked=!!record.command||!view.request||view.status==='resolved';
    for(const input of Array.from(this.form!.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')))input.disabled=locked;
    this.submitButton!.disabled=!view.request||['loading','resolved','unavailable','submitting'].includes(view.status);
    this.submitButton!.textContent=view.status==='submitting'?'Submitting…':record.command?'Retry saved answer':'Submit answer';
    this.dismissButton!.hidden=view.request?.responseMode!=='message';this.dismissButton!.disabled=locked;
  }
  onClose(){this.unsubscribe?.();this.contentEl.empty();}
}

/** Replace the readable Markdown answer link with a real Live Preview button. */
export function questionEditorExtension(controller:QuestionController,open:(target:QuestionTarget)=>void):Extension {
  const {Decoration,EditorView,ViewPlugin,WidgetType}=require('@codemirror/view') as typeof import('@codemirror/view');
  class AnswerWidget extends WidgetType {
    private unsubscribe?:()=>void;
    constructor(readonly target:QuestionTarget){super();}
    eq(other:AnswerWidget){return questionKey(this.target)===questionKey(other.target);}
    toDOM(){const result=questionButton(controller,this.target,open);this.unsubscribe=result.unsubscribe;return result.button;}
    destroy(){this.unsubscribe?.();}
    ignoreEvent(){return true;}
  }
  const build=(view:EditorView)=>{
    const doc=view.state.doc.toString(),ranges=[];
    // Obsidian exposes livePreview on the view; source mode keeps ordinary Markdown.
    const live=(view as any).contentDOM?.closest('.markdown-source-view')?.classList.contains('is-live-preview');
    if(!live)return Decoration.none;
    const regexp=/^> \[Answer\]\(t3-question:([^\s)]+)\)$/gm;
    for(const match of doc.matchAll(regexp)){const target=parseQuestionToken(match[1]);if(target)ranges.push(Decoration.replace({widget:new AnswerWidget(target)}).range(match.index!+2,match.index!+match[0].length));}
    return Decoration.set(ranges);
  };
  const plugin=ViewPlugin.fromClass(class {
    decorations:DecorationSet;
    constructor(view:EditorView){this.decorations=build(view);}
    update(update:ViewUpdate){if(update.docChanged||update.viewportChanged)this.decorations=build(update.view);}
  },{decorations:value=>value.decorations});
  return [plugin,EditorView.atomicRanges.of(view=>view.plugin(plugin)?.decorations??Decoration.none)];
}
