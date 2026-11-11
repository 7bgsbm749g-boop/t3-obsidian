import {isRecord} from '../shared/values';
export interface ClientCommand {
  version:1;id:string;kind:'client-status'|'send-failure-log'|'diagnostic-settings';
  projectId?:string;environmentId?:string;archiveDirectory?:string;
  since?:string;
  diagnosticPreferences?:Partial<import('./diagnostics').DiagnosticPreferences>;
}
export interface ClientCommandResult {
  id:string;ok:boolean;error?:string;
  client?:{instanceId:string;loadedVersion:string};
  diagnosticLog?:ReturnType<import('./diagnostic-archive').DiagnosticArchive['status']>;
  failureLog?:import('../responses/send-failures').SendFailureLog;
  diagnosticSettings?:{previous:import('./diagnostics').DiagnosticPreferences;enabled:import('./diagnostics').DiagnosticPreferences};
  replyImports?:{files:number;removed:number;directory:string;sha256?:Record<string,string>};
  legacyRepliesRetired?:true;
  codeRangeCache?:ReturnType<typeof import('../responses/reply-html').markdownCodeCacheStatus>;
  responseHost?:{active:false;retired:true};
}
export function isClientCommand(value:unknown):value is ClientCommand{return isRecord(value)&&typeof value.kind==='string'&&(['client-status','send-failure-log','diagnostic-settings'].includes(value.kind??''));}
export function validateClientCommand(input:unknown):ClientCommand {
  if(!isRecord(input))throw Error('Invalid client command.');
  // The checks below establish this complete persisted command contract.
  const value=input as unknown as ClientCommand;
  if(value?.version!==1||!isClientCommand(value)||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id??''))throw Error('Invalid client command.');
  if(value.projectId!==undefined||value.environmentId!==undefined||value.archiveDirectory!==undefined)throw Error('Old attachment cleanup was removed.');
  if(value.since!==undefined&&(value.kind!=='send-failure-log'||typeof value.since!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.since)||!Number.isFinite(Date.parse(value.since))))throw Error('Failure log requires a UTC timestamp.');
  if(value.diagnosticPreferences!==undefined){
    if(value.kind!=='diagnostic-settings'||!isRecord(value.diagnosticPreferences)||Object.entries(value.diagnosticPreferences).some(([key,value])=>!['connection','response','follow','memory'].includes(key)||typeof value!=='boolean'))throw Error('Diagnostic settings require named boolean categories.');
  }
  if(input.releaseVersion!==undefined||input.runtimeSha256!==undefined)throw Error('Client diagnostics do not accept release metadata.');
  return value;
}
