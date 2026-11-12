import {FuzzySuggestModal,Notice,type App} from 'obsidian';
import {isRecord,records} from '../shared/values';
import {resolveNewThreadModel,type ModelSelection} from './model-defaults';

export interface ModelChoice {label:string;selection?:ModelSelection}
export function modelChoices(config:unknown,projectId:string):ModelChoice[]{
  const inherited=resolveNewThreadModel(config,{id:projectId});
  if(!isRecord(config))throw Error('T3 model catalog is unavailable.');
  return [{label:`T3 default · ${inherited.model}`},...records(config.providers).filter(p=>p.enabled===true&&p.availability!=='unavailable').flatMap(p=>records(p.models).filter(m=>typeof m.slug==='string').map(m=>({label:`${String(p.displayName??p.name??p.instanceId)} · ${String(m.name??m.slug)}`,selection:{instanceId:String(p.instanceId),model:String(m.slug),...(p.instanceId===inherited.instanceId&&m.slug===inherited.model&&inherited.options?{options:inherited.options.map(o=>({...o}))}:{})}})))];
}
class ModelPicker extends FuzzySuggestModal<ModelChoice>{
  constructor(app:App,private choices:ModelChoice[],private choose:(selection?:ModelSelection)=>void){super(app);this.setPlaceholder('Choose a model for this send');}
  getItems(){return this.choices;}
  getItemText(choice:ModelChoice){return choice.label;}
  onChooseItem(choice:ModelChoice){this.choose(choice.selection);}
}
export function modelButton(app:App,container:HTMLElement,selected:()=>ModelSelection|undefined,load:()=>Promise<ModelChoice[]>,choose:(selection?:ModelSelection)=>void){
  const button=container.createEl('button',{cls:'t3-composer-chip',text:selected()?.model??'Model · T3 default',attr:{'aria-label':'Choose model for this send'}});
  button.addEventListener('click',()=>{button.disabled=true;void load().then(choices=>{if(!button.isConnected)return;new ModelPicker(app,choices,selection=>{if(!button.isConnected)return;choose(selection);button.setText(selection?.model??'Model · T3 default');}).open();}).catch(error=>new Notice(error instanceof Error?error.message:String(error))).finally(()=>{if(button.isConnected)button.disabled=false;});});
  return button;
}
