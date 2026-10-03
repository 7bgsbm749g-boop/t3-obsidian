import {connectT3Rpc,type T3Api,type SocketFactory} from './t3-rpc';

export interface ModelSelection {instanceId:string;model:string;options?:{id:string;value:unknown}[]}
export type RuntimeMode='approval-required'|'auto-accept-edits'|'auto'|'full-access';
export interface NewThreadDefaults {modelSelection:ModelSelection;runtimeMode:RuntimeMode}
interface Provider {instanceId:string;enabled:boolean;availability?:string;status:string;models:{slug:string;isDefault?:boolean;isCustom?:boolean}[]}
interface Project {id:string;defaultModelSelection?:ModelSelection|null}

/** Match T3's project override, migration, and provider-picker precedence. */
export function resolveNewThreadModel(config:any,project:Project):ModelSelection {
  if(!config?.settings||!Object.hasOwn(config.settings,'defaultModelSelection')||!Array.isArray(config.providers))throw Error('T3 did not return its model defaults. Update T3 and retry the saved request.');
  const settings=config.settings,providers:Provider[]=config.providers;
  const overrides={
    ...(!settings.projectSettingsFolded&&project.defaultModelSelection!=null?{defaultModelSelection:project.defaultModelSelection}:{}),
    ...settings.projectSettingsOverrides?.[project.id],
  };
  let selection:ModelSelection|null=settings.defaultModelSelection;
  if(Object.hasOwn(overrides,'defaultModelSelection')){
    const override=overrides.defaultModelSelection;
    // A disabled project provider inherits the environment default. An explicit
    // null instead means automatic selection, even when the environment is fixed.
    if(override==null||providers.some(p=>p.instanceId===override.instanceId&&p.enabled))selection=override;
  }
  if(selection!=null&&(typeof selection.instanceId!=='string'||!selection.instanceId||typeof selection.model!=='string'||!selection.model))throw Error('T3 returned an invalid default model. Choose a default in T3 settings and retry.');
  const available=providers.filter(p=>p.enabled&&p.availability!=='unavailable');
  const requested=available.find(p=>p.instanceId===selection?.instanceId);
  if(requested&&selection)return JSON.parse(JSON.stringify(selection));
  const provider=available.find(p=>p.status==='ready')??available.find(p=>p.status!=='error');
  const models=provider?.models??[];
  const model=models.find(m=>m.isDefault&&!m.isCustom)?.slug??models.find(m=>!m.isCustom)?.slug??models[0]?.slug;
  if(!provider||!model)throw Error('No default model is available on this T3 machine. Choose an enabled provider and default model in T3 settings, then retry.');
  return {instanceId:provider.instanceId,model};
}

/** Use the same project/environment access setting as T3's new-thread UI.
 * Older configurations omit this key; T3's own default is Full Access. */
export function resolveNewThreadDefaults(config:any,project:Project):NewThreadDefaults {
  const modelSelection=resolveNewThreadModel(config,project);
  const overrides=config.settings.projectSettingsOverrides?.[project.id];
  const runtimeMode=overrides?.defaultRuntimeMode!==undefined?overrides.defaultRuntimeMode:config.settings.defaultRuntimeMode!==undefined?config.settings.defaultRuntimeMode:'full-access';
  if(!['approval-required','auto-accept-edits','auto','full-access'].includes(runtimeMode))throw Error('T3 returned an invalid access default. Choose an access mode in T3 settings and retry.');
  return {modelSelection,runtimeMode};
}

export async function readNewThreadDefaults(api:T3Api,origin:string,project:Project,makeSocket?:SocketFactory):Promise<NewThreadDefaults>{
  const rpc=await connectT3Rpc(api,origin,makeSocket);
  try{return resolveNewThreadDefaults(await rpc.call('server.getConfig',{}),project);}
  finally{rpc.close();}
}

export async function readNewThreadModel(api:T3Api,origin:string,project:Project,makeSocket?:SocketFactory):Promise<ModelSelection>{
  const rpc=await connectT3Rpc(api,origin,makeSocket);
  try{return resolveNewThreadModel(await rpc.call('server.getConfig',{}),project);}
  finally{rpc.close();}
}
