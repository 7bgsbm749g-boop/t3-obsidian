import {Component,Notice,Platform,setIcon} from 'obsidian';
import type {ComposerModel,ComposerOption,ComposerSettings} from './composer-models';
import type {ModelSelection,RuntimeMode} from './model-defaults';
import {renderProviderIcon} from './provider-icons';

/** Obsidian DOM adaptation of T3 Code's docked ProviderModelPicker,
 * ModelPickerContent, ModelPickerSidebar, and ComposerModelEffort.
 * Reference: pingdotgg/t3code@983654b3b2f7267a69e3d5d049d781aadbbc3166.
 * Geometry and interaction follow T3; all surfaces use the vault's theme. */
const permissions:Record<RuntimeMode,string>={'approval-required':'Ask before changes','auto-accept-edits':'Allow edits',auto:'Automatic','full-access':'Full access'};
function copy(settings:ComposerSettings):ComposerSettings{return {...settings,modelSelection:settings.modelSelection?{...settings.modelSelection,options:settings.modelSelection.options?.map(option=>({...option}))}:undefined};}
export function composerOptionValue(model:ComposerModel,settings:ComposerSettings,option:ComposerOption):string|boolean|undefined{
 const saved=settings.modelSelection?.instanceId===model.selection.instanceId&&settings.modelSelection.model===model.selection.model?settings.modelSelection.options?.find(value=>value.id===option.id)?.value:undefined;
 return typeof saved==='string'||typeof saved==='boolean'?saved:option.currentValue??(option.type==='boolean'?false:option.options.find(choice=>choice.isDefault)?.id??option.options[0]?.id);
}
const isReasoning=(option:ComposerOption)=>option.role==='reasoning'||/effort|reasoning|thought/i.test(option.id);
const isSpeed=(option:ComposerOption)=>['serviceTier','fastMode','ultracode'].includes(option.id);
export class ComposerModelPicker extends Component {
 readonly el:HTMLElement;
 private settings:ComposerSettings;private tab:string;private query='';private expanded=new Set<string>();private pending=false;private closed=false;
 private list!:HTMLElement;private column!:HTMLElement;private footer!:HTMLElement;private rail!:HTMLElement;private search!:HTMLInputElement;private menu?:HTMLElement;private menuTrigger?:HTMLButtonElement;
 constructor(private anchor:HTMLButtonElement,private models:ComposerModel[],settings:ComposerSettings,private apply:(settings:ComposerSettings)=>Promise<void>,private dismissed:()=>void,private noteSend?:{defaultSelection?:ModelSelection}){
  super();this.settings=copy(settings);this.tab=models.some(model=>model.isFavorite)?'favorites':settings.modelSelection?.instanceId??models[0]?.selection.instanceId??'';
  this.el=anchor.ownerDocument.win.createDiv();this.el.className='t3-model-picker';this.el.setAttribute('role','dialog');this.el.setAttribute('aria-label',noteSend?'Model for this send':'Model and permissions');
 }
 open(){
  this.load();(this.anchor.closest('.modal-container')??this.anchor.ownerDocument.body).appendChild(this.el);this.anchor.setAttribute('aria-expanded','true');this.anchor.setAttribute('aria-haspopup','dialog');
  const body=this.el.createDiv({cls:'t3-model-picker-body'});this.rail=body.createDiv({cls:'t3-model-picker-rail',attr:{role:'toolbar','aria-label':'Providers','aria-orientation':'vertical'}});
  const center=body.createDiv({cls:'t3-model-picker-models'}),searchRow=center.createDiv({cls:'t3-model-picker-search'});setIcon(searchRow.createSpan(),'search');
  this.search=searchRow.createEl('input',{attr:{type:'search',placeholder:'Search models…','aria-label':'Search models'}});this.search.addEventListener('input',()=>{this.query=this.search.value;this.renderModels();});
  this.list=center.createDiv({cls:'t3-model-picker-list',attr:{role:'group','aria-label':'Models'}});this.column=body.createDiv({cls:'t3-model-picker-options'});this.footer=this.el.createDiv({cls:'t3-model-picker-footer'});
  this.registerDomEvent(this.anchor.ownerDocument,'pointerdown',event=>{const target=event.target as Node|null;if(target&&!this.el.contains(target)&&!this.anchor.contains(target))this.close(false);});
  this.registerDomEvent(this.el,'pointerdown',event=>{if(this.menu&&!this.menu.contains(event.target as Node)&&!this.menuTrigger?.contains(event.target as Node))this.closeMenu();});
  this.registerDomEvent(this.el,'keydown',event=>this.keydown(event));
  const owner=this.anchor.ownerDocument.defaultView;if(owner){this.registerDomEvent(owner,'resize',()=>this.position());this.registerDomEvent(owner,'scroll',()=>this.position(),true);}
  this.render();this.position();this.search.focus();
 }
 update(settings:ComposerSettings){if(this.pending||this.closed||JSON.stringify(settings)===JSON.stringify(this.settings))return;this.settings=copy(settings);this.render();}
 close(focus=true){if(this.closed)return;this.closed=true;this.el.remove();this.unload();this.anchor.setAttribute('aria-expanded','false');if(focus&&this.anchor.isConnected)this.anchor.focus();this.dismissed();}
 private selected(){return this.models.find(model=>model.selection.instanceId===this.settings.modelSelection?.instanceId&&model.selection.model===this.settings.modelSelection.model);}
 private position(){
  if(this.closed)return;if(!this.anchor.isConnected){this.close(false);return;}
  const owner=this.anchor.ownerDocument.defaultView;if(!owner)return;const rect=this.anchor.getBoundingClientRect(),width=Math.min(552,owner.innerWidth-16),height=Math.min(width<480?590:392,owner.innerHeight-16);
  const left=Math.max(8,Math.min(rect.right-width,owner.innerWidth-width-8)),top=Math.max(8,Math.min(rect.top-height-8,owner.innerHeight-height-8));
  this.el.setCssProps({'--t3-picker-left':`${left}px`,'--t3-picker-top':`${top}px`,'--t3-picker-width':`${width}px`,'--t3-picker-height':`${height}px`});
 }
 private button(parent:HTMLElement,label:string,action:()=>void,cls='t3-model-picker-row'){
  const button=parent.createEl('button',{cls,attr:{type:'button','aria-label':label}});button.addEventListener('click',action);button.disabled=this.pending;return button;
 }
 private icon(parent:HTMLElement,name:string){const icon=parent.createSpan({cls:'t3-model-picker-icon',attr:{'aria-hidden':'true'}});setIcon(icon,name);}
 private render(){
  if(this.closed)return;this.menu?.remove();this.menu=undefined;this.menuTrigger=undefined;this.rail.empty();
  const favorites=this.button(this.rail,'Favorites',()=>{this.tab='favorites';this.query='';this.search.value='';this.render();this.search.focus();},'t3-model-picker-provider');this.icon(favorites,'star');favorites.setAttribute('aria-pressed',String(this.tab==='favorites'));
  this.rail.createDiv({cls:'t3-model-picker-divider'});
  const providers=[...new Map(this.models.map(model=>[model.selection.instanceId,model])).values()];
  for(const provider of providers){const id=provider.selection.instanceId,button=this.button(this.rail,provider.provider,()=>{this.tab=id;this.query='';this.search.value='';this.render();this.search.focus();},'t3-model-picker-provider');renderProviderIcon(button,provider.driver,provider.provider);button.title=provider.provider;button.setAttribute('aria-pressed',String(this.tab===id));button.disabled=this.pending||this.models.filter(model=>model.selection.instanceId===id).every(model=>model.disabled);}
  this.renderModels();this.renderOptions();this.renderFooter();this.search.disabled=this.pending;
 }
 private renderModels(){
  this.list.empty();const query=this.query.trim().toLowerCase();
  const models=this.models.filter(model=>query?`${model.provider} ${model.label} ${model.selection.model}`.toLowerCase().includes(query):this.tab==='favorites'?model.isFavorite:model.selection.instanceId===this.tab);
  const visible=models.filter(model=>query||this.tab==='favorites'||!model.isLegacy||model.isFavorite||this.expanded.has(model.selection.instanceId)||this.selected()===model);
  for(const [index,model] of visible.entries()){
   const selected=this.selected()===model,button=this.button(this.list,model.label,()=>{void this.pickModel(model,button);},'t3-model-picker-row t3-model-picker-model');button.setAttribute('aria-pressed',String(selected));button.disabled=this.pending||model.disabled===true;
   renderProviderIcon(button,model.driver,model.provider);button.createSpan({cls:'t3-model-picker-label',text:model.label});if(selected)this.icon(button,'check');
   if(index<9)button.createEl('kbd',{text:`${Platform.isMacOS?'⌘':'Ctrl+'}${index+1}`});
  }
  if(!visible.length)this.list.createDiv({cls:'t3-model-picker-empty',text:this.tab==='favorites'&&!query?'No favorites yet':'No models found'});
  if(!query&&this.tab!=='favorites'&&models.some(model=>model.isLegacy&&!model.isFavorite))this.button(this.list,this.expanded.has(this.tab)?'Show less':'Show more',()=>{if(this.expanded.has(this.tab))this.expanded.delete(this.tab);else this.expanded.add(this.tab);this.renderModels();}).setText(this.expanded.has(this.tab)?'Show less':'Show more');
 }
 private async pickModel(model:ComposerModel,trigger:HTMLButtonElement){
  if(model.disabled)return;const next=copy(this.settings),same=next.modelSelection?.instanceId===model.selection.instanceId;
  next.modelSelection={...model.selection,...(same?{options:next.modelSelection?.options?.filter(saved=>model.options.some(option=>option.id===saved.id&&(option.type==='boolean'?typeof saved.value==='boolean':option.options.some(choice=>choice.id===saved.value))))}:{})};
  const mode=next.runtimeMode??'full-access';
  if(!this.noteSend&&!model.runtimeModes.includes(mode)){
   new Notice(`${model.label} does not support ${permissions[mode]}. Choose permissions explicitly to switch models.`);
   if(model.runtimeModes.length){trigger.setAttribute('aria-haspopup','menu');this.showMenu(trigger,model.runtimeModes.map(value=>({label:permissions[value],selected:false,pick:()=>{void this.commit({...next,runtimeMode:value});}})),'right');}
   return;
  }
  await this.commit(next);
 }
 private async changeOption(model:ComposerModel,option:ComposerOption,value?:string|boolean){
  const next=copy(this.settings),options=(next.modelSelection?.options??[]).filter(saved=>saved.id!==option.id);
  if(value!==undefined)options.push({id:option.id,value});
  next.modelSelection={...model.selection,options};await this.commit(next);
 }
 private overridden(option:ComposerOption){return this.settings.modelSelection?.options?.some(saved=>saved.id===option.id)??false;}
 private optionReset(button:HTMLButtonElement,model:ComposerModel,option:ComposerOption){
  button.title=`${option.label}: right-click to use default`;
  const open=()=>{if(this.pending||model.disabled)return;this.showMenu(button,[{label:'Use default',selected:!this.overridden(option),pick:()=>{void this.changeOption(model,option);}}]);};
  button.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();open();});
  button.addEventListener('keydown',event=>{if(!event.isComposing&&(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){event.preventDefault();event.stopPropagation();open();}});
 }
 private async commit(next:ComposerSettings){
  if(this.pending||this.closed)return;const active=this.menuTrigger?.getAttribute('aria-label')??this.anchor.ownerDocument.activeElement?.getAttribute('aria-label');this.pending=true;this.render();
  try{await this.apply(next);this.settings=copy({...next,modelSelection:next.modelSelection??this.noteSend?.defaultSelection});}catch(error){new Notice(error instanceof Error?error.message:String(error));}
  finally{this.pending=false;if(!this.closed){this.render();this.position();if(active)Array.from(this.el.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.getAttribute('aria-label')===active&&!button.disabled)?.focus();}}
 }
 private renderOptions(){
  this.column.empty();const model=this.selected(),options=model?.options.filter(option=>!isSpeed(option))??[],effort=options.find(isReasoning);
  const header=this.column.createDiv({cls:'t3-model-picker-option-header'});header.createSpan({text:effort?.label??(options.length?'Options':'Effort')});header.createSpan({cls:'t3-model-picker-label',text:model?.label??this.settings.modelSelection?.model??''});
  const content=this.column.createDiv({cls:'t3-model-picker-option-content'});
  if(!model||!options.length){content.createDiv({cls:'t3-model-picker-empty',text:'No options available'});return;}
  if(effort){
   const group=content.createDiv({attr:{role:'radiogroup','aria-label':effort.label}}),value=composerOptionValue(model,this.settings,effort);
   const choices=effort.type==='boolean'?[{id:true,label:'On'},{id:false,label:'Off'}]:effort.options;
   for(const choice of choices){const button=this.button(group,choice.label,()=>{void this.changeOption(model,effort,choice.id);});this.optionReset(button,model,effort);button.setAttribute('role','radio');button.setAttribute('aria-checked',String(choice.id===value));button.disabled=this.pending||model.disabled===true;button.createSpan({text:choice.label});if(choice.id===value)this.icon(button,'check');else if('isDefault' in choice&&choice.isDefault)button.createSpan({cls:'t3-model-picker-default',text:'Default'});}
  }
  const others=options.filter(option=>option!==effort);if(effort&&others.length)content.createDiv({cls:'t3-model-picker-divider'});
  for(const option of others){const value=composerOptionValue(model,this.settings,option),button=this.button(content,option.label,()=>{
   if(option.type==='boolean')void this.changeOption(model,option,value!==true);else this.optionMenu(button,model,option);
  });this.optionReset(button,model,option);button.disabled=this.pending||model.disabled===true;button.addClass('t3-model-picker-option');const labels=button.createSpan({cls:'t3-model-picker-label'});labels.createSpan({cls:'t3-model-picker-option-name',text:option.label});labels.createSpan({text:option.type==='boolean'?(value?'On':'Off'):option.options.find(choice=>choice.id===value)?.label??'Default'});
   if(option.type==='boolean'){button.setAttribute('role','switch');button.setAttribute('aria-checked',String(value===true));button.createSpan({cls:'t3-model-picker-switch',attr:{'aria-hidden':'true'}});}else{button.setAttribute('aria-haspopup','menu');this.icon(button,'chevron-right');}
  }
 }
 private renderFooter(){
  this.footer.empty();const model=this.selected();
  for(const option of model?.options.filter(isSpeed)??[]){
   const value=composerOptionValue(model!,this.settings,option),group=this.footer.createDiv({cls:'t3-model-picker-speed',attr:{role:option.id==='ultracode'?'group':'radiogroup','aria-label':option.label}});
   const choices=option.type==='boolean'?option.id==='ultracode'?[{id:value!==true,label:option.label}]:[{id:false,label:'Standard'},{id:true,label:'Fast'}]:option.options;
   for(const choice of choices){const button=this.button(group,choice.label,()=>{void this.changeOption(model!,option,choice.id);},'t3-model-picker-segment');this.optionReset(button,model!,option);if(choice.label==='Fast')this.icon(button,'zap');button.createSpan({text:choice.label});button.disabled=this.pending||model?.disabled===true;
    if(option.id==='ultracode')button.setAttribute('aria-pressed',String(value===true));else{button.setAttribute('role','radio');button.setAttribute('aria-checked',String(value===choice.id));}}
  }
  if(this.noteSend){
   if(this.noteSend.defaultSelection){
    const reset=()=>{void this.commit({});};
    this.button(this.footer,'Use destination default',reset,'t3-model-picker-segment').setText('Use destination default');
   }
   return;
  }
  const mode=this.settings.runtimeMode??'full-access',modes=model?.runtimeModes??[];
  if(modes.length){const button=this.button(this.footer,`Permissions: ${permissions[mode]}`,()=>this.showMenu(button,modes.map(value=>({label:permissions[value],selected:value===mode,pick:()=>{void this.commit({...copy(this.settings),runtimeMode:value});}}))),'t3-model-picker-permissions');this.icon(button,'shield-off');button.createSpan({text:permissions[mode]});this.icon(button,'chevron-up');button.setAttribute('aria-haspopup','menu');}
 }
 private optionMenu(button:HTMLButtonElement,model:ComposerModel,option:ComposerOption){this.showMenu(button,[{label:'Use default',selected:!this.overridden(option),pick:()=>{void this.changeOption(model,option);}},...option.options.map(choice=>({label:choice.label,selected:this.overridden(option)&&choice.id===composerOptionValue(model,this.settings,option),pick:()=>{void this.changeOption(model,option,choice.id);}}))],'right');}
 private showMenu(button:HTMLButtonElement,choices:{label:string;selected:boolean;pick:()=>void}[],side:'right'|'top'='top'){
  if(this.menu){this.closeMenu();return;}
  this.menuTrigger=button;const menu=this.menu=this.el.createDiv({cls:'t3-model-picker-menu',attr:{role:'menu','aria-label':button.getAttribute('aria-label')??'Options'}});button.setAttribute('aria-expanded','true');
  for(const choice of choices){const row=this.button(menu,choice.label,choice.pick);row.setAttribute('role','menuitemradio');row.setAttribute('aria-checked',String(choice.selected));row.createSpan({text:choice.label});if(choice.selected)this.icon(row,'check');}
  const rect=button.getBoundingClientRect(),root=this.el.getBoundingClientRect(),owner=this.anchor.ownerDocument.defaultView,width=menu.offsetWidth||180,height=menu.offsetHeight||choices.length*34+8;
  const left=side==='right'?(rect.right+width+4<=(owner?.innerWidth??root.right)-8?rect.right+4:rect.left-width-4):rect.right-width;
  const top=side==='right'?rect.top:rect.top-height-4;
  menu.setCssProps({'--t3-picker-menu-top':`${Math.max(8,Math.min(top,(owner?.innerHeight??root.bottom)-height-8))-root.top}px`,'--t3-picker-menu-left':`${Math.max(8,Math.min(left,(owner?.innerWidth??root.right)-width-8))-root.left}px`});
  (menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')??menu.querySelector('button'))?.focus();
 }
 private closeMenu(){this.menu?.remove();this.menu=undefined;this.menuTrigger?.setAttribute('aria-expanded','false');this.menuTrigger?.focus();this.menuTrigger=undefined;}
 private keydown(event:KeyboardEvent){
  if(event.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(this.menu)this.closeMenu();else this.close();return;}
  if((event.ctrlKey||event.metaKey)&&/^[1-9]$/.test(event.key)){const button=this.list.querySelectorAll<HTMLButtonElement>('.t3-model-picker-model')[Number(event.key)-1];if(button&&!button.disabled){event.preventDefault();button.click();}return;}
  if(event.key==='ArrowRight'&&event.target===this.search&&!this.search.value&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();(this.column.querySelector<HTMLButtonElement>('[aria-checked="true"]')??this.column.querySelector('button'))?.focus();return;}
  if(event.key==='ArrowRight'&&this.rail.contains(event.target as Node)){event.preventDefault();this.search.focus();return;}
  if(event.key==='ArrowLeft'&&this.column.contains(event.target as Node)){event.preventDefault();this.search.focus();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   const parent=this.menu??(this.rail.contains(event.target as Node)?this.rail:this.column.contains(event.target as Node)?this.column:this.list),buttons=Array.from(parent.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));if(!buttons.length)return;
   const index=buttons.indexOf(event.target as HTMLButtonElement),next=buttons[index<0?(event.key==='ArrowDown'?0:buttons.length-1):(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length];event.preventDefault();next.focus();
  }
 }
}
