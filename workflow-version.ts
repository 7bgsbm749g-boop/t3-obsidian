import type {WorkflowIR} from './automation-ir';
import type {FolderWorkflow} from './workflow';

export type WorkflowVersion='v1'|'v2';
export interface WorkflowVersionSettings {active:WorkflowVersion;saved:{v1:Record<string,boolean>;v2:Record<string,boolean>}}
export function loadWorkflowVersionSettings(value:unknown,v1:FolderWorkflow[],v2:WorkflowIR[]):WorkflowVersionSettings {const input=value as Partial<WorkflowVersionSettings>|null|undefined,active:WorkflowVersion=input?.active==='v2'?'v2':'v1',saved={v1:validFlags(input?.saved?.v1)??flags(v1),v2:validFlags(input?.saved?.v2)??flags(v2)};return {active,saved};}
export function switchWorkflowVersion(settings:WorkflowVersionSettings,target:WorkflowVersion,v1:FolderWorkflow[],v2:WorkflowIR[]):WorkflowVersionSettings {if(target===settings.active)return settings;const saved={v1:{...settings.saved.v1},v2:{...settings.saved.v2}};saved[settings.active]=settings.active==='v1'?flags(v1):flags(v2);setEnabled(settings.active==='v1'?v1:v2,{});setEnabled(target==='v1'?v1:v2,saved[target]);return {active:target,saved};}
export function syncActiveWorkflowFlags(settings:WorkflowVersionSettings,v1:FolderWorkflow[],v2:WorkflowIR[]):WorkflowVersionSettings {return {...settings,saved:{...settings.saved,[settings.active]:settings.active==='v1'?flags(v1):flags(v2)}};}
function flags(items:Array<{id?:string;workflowId?:string;enabled:boolean}>){return Object.fromEntries(items.map(item=>[item.id??item.workflowId!,item.enabled]));}
function validFlags(value:unknown):Record<string,boolean>|undefined {if(!value||typeof value!=='object'||Array.isArray(value))return;const result:Record<string,boolean>={};for(const [key,enabled] of Object.entries(value))if(typeof enabled==='boolean')result[key]=enabled;else return;return result;}
function setEnabled(items:Array<{id?:string;workflowId?:string;enabled:boolean}>,state:Record<string,boolean>){for(const item of items)item.enabled=state[item.id??item.workflowId!]===true;}
