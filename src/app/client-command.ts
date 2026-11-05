import {isRecord} from '../shared/values';
export interface ClientCommand {
  version:1;id:string;kind:'client-status'|'send-failure-log'|'reload-client';
  projectId?:string;environmentId?:string;archiveDirectory?:string;
  since?:string;
  releaseVersion?:string;runtimeSha256?:Record<'main.js'|'manifest.json'|'styles.css',string>;
}
export interface ClientCommandResult {
  id:string;ok:boolean;error?:string;
  client?:{instanceId:string;loadedVersion:string};reloadScheduled?:boolean;
  failureLog?:import('../responses/send-failures').SendFailureLog;
  replyImports?:{files:number;removed:number;directory:string;sha256?:Record<string,string>};
  legacyRepliesRetired?:true;
  connectionRecovery?:import('../connection/connection-recovery').ConnectionReloadState&{pending:boolean;reloading:boolean};
  codeRangeCache?:ReturnType<typeof import('../responses/reply-html').markdownCodeCacheStatus>;
  responseHost?:{active:false;retired:true};
}
export function isClientCommand(value:unknown):value is ClientCommand{return isRecord(value)&&typeof value.kind==='string'&&(['client-status','send-failure-log','reload-client'].includes(value.kind??''));}
export function validateClientCommand(input:unknown):ClientCommand {
  if(!isRecord(input))throw Error('Invalid client command.');
  // The checks below establish this complete persisted command contract.
  const value=input as unknown as ClientCommand;
  if(value?.version!==1||!isClientCommand(value)||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id??''))throw Error('Invalid client command.');
  if(value.projectId!==undefined||value.environmentId!==undefined||value.archiveDirectory!==undefined)throw Error('Old attachment cleanup was removed.');
  if(value.since!==undefined&&(value.kind!=='send-failure-log'||typeof value.since!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.since)||!Number.isFinite(Date.parse(value.since))))throw Error('Failure log requires a UTC timestamp.');
  if(value.kind==='reload-client'){
    const hashes=value.runtimeSha256;
    if(!/^(?:\d+\.\d+\.\d+|0\.0\.(?:0|[1-9]\d*)-alpha)$/.test(value.releaseVersion??'')||!hashes||Object.keys(hashes).length!==3||(['main.js','manifest.json','styles.css'] as const).some(name=>!/^[0-9a-f]{64}$/.test(hashes[name]??'')))throw Error('Reload requires an exact release version and all runtime hashes.');
  }else if(value.releaseVersion!==undefined||value.runtimeSha256!==undefined)throw Error('Client status does not request a reload.');
  return value;
}
