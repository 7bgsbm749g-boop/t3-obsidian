/** Core Sync exposes this status internally, not as a public plugin API.
 * A configured core Sync must finish. Other transports have no common status
 * API; their local edits still use the checked current-note save. */
export function localSyncReady(app:unknown):boolean {
  const plugins=(app as any).internalPlugins;
  const sync=typeof plugins?.getEnabledPluginById==='function'?plugins.getEnabledPluginById('sync'):plugins?.plugins?.sync?.enabled?plugins.plugins.sync.instance:undefined;
  if(!sync?.vaultId)return true;
  try{return typeof sync.getStatus==='function'&&sync.getStatus()==='synced';}catch{return false;}
}
