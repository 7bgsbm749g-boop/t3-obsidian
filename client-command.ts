export interface ClientCommand {
  version:1;id:string;kind:'client-status'|'reload-client';
  releaseVersion?:string;runtimeSha256?:Record<'main.js'|'manifest.json'|'styles.css',string>;
}
export interface ClientCommandResult {
  id:string;ok:boolean;error?:string;
  client?:{instanceId:string;loadedVersion:string};reloadScheduled?:boolean;
}
export function isClientCommand(value:{kind?:string}):value is ClientCommand{return value.kind==='client-status'||value.kind==='reload-client';}
export function validateClientCommand(value:any):ClientCommand {
  if(value?.version!==1||!isClientCommand(value)||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id??''))throw Error('Invalid client command.');
  if(value.kind==='reload-client'){
    const hashes=value.runtimeSha256;
    if(!/^\d+\.\d+\.\d+$/.test(value.releaseVersion??'')||!hashes||Object.keys(hashes).length!==3||(['main.js','manifest.json','styles.css'] as const).some(name=>!/^[0-9a-f]{64}$/.test(hashes[name]??'')))throw Error('Reload requires an exact release version and all runtime hashes.');
  }else if(value.releaseVersion!==undefined||value.runtimeSha256!==undefined)throw Error('Client status does not request a reload.');
  return value;
}
