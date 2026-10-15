export interface ClientCommand {
  version:1;id:string;kind:'client-status'|'send-failure-log'|'reload-client'|'archive-reply-imports';
  projectId?:string;environmentId?:string;archiveDirectory?:string;
  since?:string;
  releaseVersion?:string;runtimeSha256?:Record<'main.js'|'manifest.json'|'styles.css',string>;
}
export interface ClientCommandResult {
  id:string;ok:boolean;error?:string;
  client?:{instanceId:string;loadedVersion:string};reloadScheduled?:boolean;
  failureLog?:import('./send-failures').SendFailureLog;
  replyImports?:{files:number;removed:number;directory:string;sha256?:Record<string,string>};
  legacyRepliesRetired?:true;
  connectionRecovery?:import('./connection-recovery').ConnectionReloadState&{pending:boolean;reloading:boolean};
  codeRangeCache?:ReturnType<typeof import('./reply-html').markdownCodeCacheStatus>;
  responseHost?:{active:false;retired:true};
}
export function isClientCommand(value:{kind?:string}):value is ClientCommand{return ['client-status','send-failure-log','reload-client','archive-reply-imports'].includes(value.kind??'');}
export function validateClientCommand(value:any):ClientCommand {
  if(value?.version!==1||!isClientCommand(value)||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id??''))throw Error('Invalid client command.');
  if(value.kind==='archive-reply-imports'){
    if(typeof value.projectId!=='string'||!value.projectId||typeof value.environmentId!=='string'||!value.environmentId||typeof value.archiveDirectory!=='string'||!value.archiveDirectory||value.archiveDirectory.startsWith('/')||value.archiveDirectory.includes('\\')||/[:\x00-\x1f]/.test(value.archiveDirectory)||value.archiveDirectory.split('/').some((part:string)=>!part||part==='.'||part==='..'))throw Error('Moving old reply files requires an exact linked project and a directory inside it.');
  }else if(value.projectId!==undefined||value.environmentId!==undefined||value.archiveDirectory!==undefined)throw Error('Archive options require archive-reply-imports.');
  if(value.since!==undefined&&(value.kind!=='send-failure-log'||typeof value.since!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.since)||!Number.isFinite(Date.parse(value.since))))throw Error('Failure log requires a UTC timestamp.');
  if(value.kind==='reload-client'){
    const hashes=value.runtimeSha256;
    if(!/^\d+\.\d+\.\d+$/.test(value.releaseVersion??'')||!hashes||Object.keys(hashes).length!==3||(['main.js','manifest.json','styles.css'] as const).some(name=>!/^[0-9a-f]{64}$/.test(hashes[name]??'')))throw Error('Reload requires an exact release version and all runtime hashes.');
  }else if(value.releaseVersion!==undefined||value.runtimeSha256!==undefined)throw Error('Client status does not request a reload.');
  return value;
}
