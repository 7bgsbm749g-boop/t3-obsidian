import {isRecord as object,callMember} from '../shared/values';
/** Compatibility for older adapters. Sync never grants or denies a local
 * write; the native note IO performs the actual compare-and-set checks. */
export function localSyncReady(_app:unknown,_path?:string):boolean {return true;}

/** Sync status is diagnostic evidence only, never final-save permission. */
export function localSyncEvidence(app:unknown,_path?:string){
  try{
    if(!object(app)||!object(app.internalPlugins))return {provider:'external-or-none',freshness:'unknown',localSaveAllowed:true};
    const plugins=app.internalPlugins,registered=object(plugins.plugins)&&object(plugins.plugins.sync)?plugins.plugins.sync:undefined;
    const sync=typeof plugins.getEnabledPluginById==='function'?callMember(plugins,'getEnabledPluginById','sync'):registered?.enabled?registered.instance:undefined;
    if(!object(sync)||!sync.vaultId)return {provider:'external-or-none',freshness:'unknown',localSaveAllowed:true};
    return {provider:'obsidian-core',status:typeof sync.getStatus==='function'?callMember(sync,'getStatus'):undefined,localSaveAllowed:true};
  }catch{return {provider:'unknown',freshness:'unknown',localSaveAllowed:true};}
}
