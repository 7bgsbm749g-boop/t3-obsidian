import {isRecord,records} from '../shared/values';
import type {ModelSelection,RuntimeMode} from './model-defaults';
export interface ComposerOption {id:string;label:string;type:'select'|'boolean';role?:string;currentValue?:string|boolean;options:{id:string;label:string;isDefault?:boolean}[]}
export interface ComposerModel {selection:ModelSelection;label:string;provider:string;driver?:string;options:ComposerOption[];runtimeModes:RuntimeMode[];plan:boolean;commands:{name:string;description?:string}[];skills:{name:string;path:string}[]}
export interface ComposerSettings {modelSelection?:ModelSelection;runtimeMode?:RuntimeMode;interactionMode?:'default'|'plan'}
const modes:RuntimeMode[]=['approval-required','auto-accept-edits','auto','full-access'];
/** Only server-advertised model capabilities become controls. No invented
 * effort values, provider IDs, skills, or permission modes. */
export function composerModels(config:unknown,cwd?:string):ComposerModel[]{
 if(!isRecord(config)||!Array.isArray(config.providers))throw Error('T3 did not return a provider catalog.');
 return records(config.providers).filter(provider=>provider.enabled&&provider.availability!=='unavailable').flatMap(provider=>{
  if(typeof provider.instanceId!=='string')return [];
  const workspace=records(provider.workspaceSnapshots).find(row=>row.cwd===cwd),commands=records(workspace?.slashCommands??provider.slashCommands),skills=records(workspace?.skills??provider.skills);
  return records(provider.models).flatMap(model=>{
   if(typeof model.slug!=='string')return [];
   const descriptors=records(isRecord(model.capabilities)?model.capabilities.optionDescriptors:workspace?.optionDescriptors);
   const options=descriptors.flatMap((option):ComposerOption[]=>typeof option.id==='string'&&typeof option.label==='string'&&(option.type==='select'||option.type==='boolean')?[{id:option.id,label:option.label,type:option.type,role:typeof option.role==='string'?option.role:undefined,currentValue:typeof option.currentValue==='string'||typeof option.currentValue==='boolean'?option.currentValue:undefined,options:records(option.options).flatMap(choice=>typeof choice.id==='string'&&typeof choice.label==='string'?[{id:choice.id,label:choice.label,isDefault:choice.isDefault===true}]:[])}]:[]);
   return [{selection:{instanceId:provider.instanceId as string,model:model.slug},label:typeof model.shortName==='string'?model.shortName:typeof model.name==='string'?model.name:model.slug,driver:typeof provider.driver==='string'?provider.driver:undefined,provider:typeof provider.displayName==='string'?provider.displayName:String(provider.driver??provider.instanceId),options,runtimeModes:Array.isArray(provider.supportedRuntimeModes)?provider.supportedRuntimeModes.filter((mode):mode is RuntimeMode=>modes.includes(mode as RuntimeMode)):modes,plan:provider.showInteractionModeToggle===true,commands:commands.flatMap(row=>typeof row.name==='string'?[{name:row.name,description:typeof row.description==='string'?row.description:undefined}]:[]),skills:skills.flatMap(row=>row.enabled&&row.userInvocable!==false&&typeof row.name==='string'&&typeof row.path==='string'?[{name:row.name,path:row.path}]:[])}];
  });
 });
}
export function composerModelLabel(selection:ModelSelection|undefined,models:ComposerModel[]):string {
 if(!selection)return 'Choose model';const model=models.find(model=>model.selection.instanceId===selection.instanceId&&model.selection.model===selection.model);
 const labels=(selection.options??[]).flatMap(value=>{const option=model?.options.find(option=>option.id===value.id);return option?.role==='reasoning'||/effort|reasoning|thought/i.test(value.id)?[option?.options.find(choice=>choice.id===value.value)?.label??String(value.value)]:[];});
 return [model?.label??selection.model,...labels].join(' ');
}

export function readComposerSettings(value:unknown):ComposerSettings {
 if(!isRecord(value))return {};const result:ComposerSettings={};
 const model=value.modelSelection;
 if(isRecord(model)&&typeof model.instanceId==='string'&&model.instanceId&&typeof model.model==='string'&&model.model){result.modelSelection={instanceId:model.instanceId,model:model.model,...(Array.isArray(model.options)?{options:records(model.options).flatMap(option=>typeof option.id==='string'&&(typeof option.value==='string'||typeof option.value==='boolean')?[{id:option.id,value:option.value}]:[])}:{})};}
 if(modes.includes(value.runtimeMode as RuntimeMode))result.runtimeMode=value.runtimeMode as RuntimeMode;
 if(value.interactionMode==='plan'||value.interactionMode==='default')result.interactionMode=value.interactionMode;
 return result;
}
