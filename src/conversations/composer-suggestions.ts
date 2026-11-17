import {setIcon} from 'obsidian';
import type {OutgoingContext} from '../connection/send-contracts';
import type {ComposerModel} from './composer-models';

export interface ComposerTrigger {prefix:'@'|'$'|'/';query:string;start:number;end:number}
export interface ComposerSuggestion {kind:'file'|'skill'|'command'|'action';name:string;description:string;path?:string}
/** T3 composer-logic.ts: triggers use the token at the caret, not the whole draft. */
export function composerTrigger(text:string,cursor:number):ComposerTrigger|undefined {
  const before=text.slice(0,cursor),match=before.match(/(?:^|\s)([@$/])([^\s]*)$/u);
  if(!match||match[1]==='/'&&match[2].includes('/')||match[1]==='$'&&/^\d/.test(match[2]))return;
  return {prefix:match[1] as ComposerTrigger['prefix'],query:match[2],start:cursor-match[2].length-1,end:cursor};
}
/** Provider slash commands are offered only at prompt start, as in T3.
 * Skills also appear as /skill:name; file searches remain on the chosen machine. */
export function composerSuggestions(trigger:ComposerTrigger,text:string,model:ComposerModel|undefined,files:string[]=[]):ComposerSuggestion[]{
  const skills=(model?.skills??[]).map(skill=>({kind:'skill' as const,name:skill.name,path:skill.path,description:skill.description??skill.path}));
  const commands=!text.slice(0,trigger.start).trim()?(model?.commands??[]).map(command=>({kind:'command' as const,name:command.name.replace(/^\//,''),description:command.description??''})):[];
  const actions:ComposerSuggestion[]=[{kind:'action',name:'model',description:'Choose provider and model'},...(model?.plan?[{kind:'action' as const,name:'plan',description:'Switch to plan mode'},{kind:'action' as const,name:'default',description:'Switch to normal mode'}]:[])];
  const items=trigger.prefix==='@'?files.map(path=>({kind:'file' as const,name:path,description:path,path})):trigger.prefix==='$'?skills:[...actions,...commands.filter(command=>!actions.some(action=>action.name===command.name)),...skills];
  const query=trigger.query.toLowerCase().replace(/^skill:/,'');
  const score=(item:ComposerSuggestion)=>item.name.toLowerCase()===query?0:item.name.toLowerCase().startsWith(query)?2:item.name.toLowerCase().includes(query)?6:item.description.toLowerCase().includes(query)?26:Infinity;
  return items.filter(item=>Number.isFinite(score(item))).sort((a,b)=>score(a)-score(b)||a.name.localeCompare(b.name)).slice(0,100);
}

export class ComposerSuggestions {
  private menu:HTMLElement;private sequence=0;private index=0;private items:ComposerSuggestion[]=[];private trigger?:ComposerTrigger;private disposed=false;
  private records:Record<string,unknown>[];private listId:string;
  constructor(private input:HTMLTextAreaElement,parent:HTMLElement,private host:{catalog():Promise<{model?:ComposerModel}>;files(query:string):Promise<string[]>;changed():void;action(name:string):void},context?:OutgoingContext){
    this.records=structuredClone(context?.records??[]);this.listId='t3-composer-menu-'+(++menuId);
    this.menu=parent.createDiv({cls:'t3-send-suggestions',attr:{id:this.listId,role:'listbox','aria-label':'Prompt suggestions'}});this.menu.hidden=true;
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',this.listId);input.setAttribute('aria-expanded','false');
    input.addEventListener('input',this.refresh);input.addEventListener('click',this.refresh);input.addEventListener('keydown',this.keydown);input.addEventListener('blur',this.blur);
  }
  private blur=()=>this.hide();
  private refresh=()=>{void this.search();};
  private async search(){
    const trigger=composerTrigger(this.input.value,this.input.selectionStart??this.input.value.length);this.trigger=trigger;
    if(!trigger){this.hide();return;}
    const sequence=++this.sequence;this.showMessage(trigger.prefix==='@'?'Searching workspace files...':'Searching workspace skills...');
    try{
      const [{model},files]=await Promise.all([this.host.catalog(),trigger.prefix==='@'?this.host.files(trigger.query):Promise.resolve([])]);
      if(this.disposed||sequence!==this.sequence)return;
      this.items=composerSuggestions(trigger,this.input.value,model,files);this.index=0;this.draw();
    }catch(error){if(!this.disposed&&sequence===this.sequence)this.showMessage(error instanceof Error?error.message:'Suggestions unavailable');}
  }
  private showMessage(message:string){this.items=[];this.menu.empty();this.menu.hidden=false;this.input.setAttribute('aria-expanded','true');this.input.removeAttribute('aria-activedescendant');this.menu.createDiv({cls:'t3-send-suggestions-empty',text:message,attr:{role:'status'}});}
  private draw(){
    if(!this.items.length){this.showMessage(this.trigger?.prefix==='$'?'No skills found. Try / to browse provider commands.':this.trigger?.prefix==='@'?'No matching files or folders.':'No matching command.');return;}
    this.menu.empty();this.menu.hidden=false;this.input.setAttribute('aria-expanded','true');
    for(const [index,item] of this.items.entries()){
      const id=this.listId+'-'+index,row=this.menu.createDiv({cls:'t3-send-suggestion',attr:{id,role:'option','aria-selected':String(index===this.index)}});
      setIcon(row.createSpan(),item.kind==='file'?'file-text':item.kind==='skill'?'package':'terminal');
      row.createSpan({cls:'t3-send-suggestion-name',text:item.kind==='skill'&&this.trigger?.prefix==='/'?'/skill:'+item.name:(this.trigger?.prefix??'')+item.name});row.createSpan({cls:'t3-send-suggestion-description',text:item.description});
      row.addEventListener('pointerdown',event=>{event.preventDefault();this.insert(item);});row.addEventListener('pointermove',()=>{if(this.index!==index){this.index=index;this.highlight();}});
    }
    this.highlight();
  }
  private highlight(){for(const [index,row] of Array.from(this.menu.children).entries())row.setAttribute('aria-selected',String(index===this.index));const selected=this.menu.children[this.index] as HTMLElement|undefined;this.input.setAttribute('aria-activedescendant',selected?.id??'');selected?.scrollIntoView?.({block:'nearest'});}
  private keydown=(event:KeyboardEvent)=>{
    if(this.menu.hidden||event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.hide();return;}
    if(['ArrowUp','ArrowDown','Enter','Tab'].includes(event.key)&&this.items.length){event.preventDefault();event.stopImmediatePropagation();if(event.key==='Enter'||event.key==='Tab')this.insert(this.items[this.index]);else{this.index=(this.index+(event.key==='ArrowDown'?1:this.items.length-1))%this.items.length;this.highlight();}}
  };
  private insert(item:ComposerSuggestion){
    const trigger=this.trigger;if(!trigger)return;
    if(item.kind==='action'){this.input.setRangeText('',trigger.start,trigger.end,'end');this.hide();this.host.changed();this.host.action(item.name);return;}
    const prefix=item.kind==='skill'?'$':trigger.prefix,value=prefix+item.name;
    this.input.setRangeText(value+' ',trigger.start,trigger.end,'end');
    if((item.kind==='file'||item.kind==='skill')&&this.records.length<100){const id=this.input.ownerDocument.defaultView?.crypto?.randomUUID?.()??crypto.randomUUID();this.records.push({version:1,contextId:id,label:item.name.slice(0,200),kind:item.kind==='file'?'mention':'skill',...(item.kind==='file'?{path:item.path}:{name:item.name,path:item.path})});}
    this.hide();this.input.focus();this.host.changed();
  }
  context():OutgoingContext|undefined {const records=this.records.filter(record=>this.input.value.includes((record.kind==='mention'?'@':'$')+String(record.kind==='mention'?record.path:record.name)));return records.length?{version:1,records:structuredClone(records)}:undefined;}
  private hide(){this.sequence++;this.menu.hidden=true;this.items=[];this.input.setAttribute('aria-expanded','false');this.input.removeAttribute('aria-activedescendant');}
  dispose(){this.disposed=true;this.hide();this.input.removeEventListener('input',this.refresh);this.input.removeEventListener('click',this.refresh);this.input.removeEventListener('keydown',this.keydown);this.input.removeEventListener('blur',this.blur);this.menu.remove();}
}
let menuId=0;
