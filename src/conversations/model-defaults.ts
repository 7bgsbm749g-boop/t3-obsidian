import {isRecord,records} from '../shared/values';
import {connectT3Rpc,type T3Api,type SocketFactory} from '../connection/t3-rpc';

export interface ModelSelection {instanceId:string;model:string;options?:{id:string;value:unknown}[]}
export type RuntimeMode='approval-required'|'auto-accept-edits'|'auto'|'full-access';
export interface NewThreadDefaults {modelSelection:ModelSelection;runtimeMode:RuntimeMode}
interface Provider {instanceId:string;enabled:boolean;availability?:string;status:string;models:{slug:string;isDefault?:boolean;isCustom?:boolean}[]}
interface Project {id:string;defaultModelSelection?:ModelSelection|null}

/** Match T3's project override, migration, and provider-picker precedence. */
export function resolveNewThreadModel(config:unknown,project:Project):ModelSelection {
  if(!isRecord(config)||!isRecord(config.settings)||!Object.hasOwn(config.settings,'defaultModelSelection')||!Array.isArray(config.providers))throw Error('T3 did not return its model defaults. Update T3 and retry the saved request.');
  const settings=config.settings,providers=readProviders(config.providers);
  const storedOverrides=isRecord(settings.projectSettingsOverrides)?settings.projectSettingsOverrides[project.id]:undefined;
  const overrides:Record<string,unknown>={
    ...(!settings.projectSettingsFolded&&project.defaultModelSelection!=null?{defaultModelSelection:project.defaultModelSelection}:{}),
    ...(isRecord(storedOverrides)?storedOverrides:{}),
  };
  let selection:unknown=settings.defaultModelSelection;
  if(Object.hasOwn(overrides,'defaultModelSelection')){
    const override=overrides.defaultModelSelection;
    // A disabled project provider inherits the environment default. An explicit
    // null instead means automatic selection, even when the environment is fixed.
    if(override==null||isRecord(override)&&providers.some(p=>p.instanceId===override.instanceId&&p.enabled))selection=override;
  }
  if(selection!=null&&(!isRecord(selection)||typeof selection.instanceId!=='string'||!selection.instanceId||typeof selection.model!=='string'||!selection.model))throw Error('T3 returned an invalid default model. Choose a default in T3 settings and retry.');
  const selected=selection==null?null:selection as unknown as ModelSelection;
  const available=providers.filter(p=>p.enabled&&p.availability!=='unavailable');
  const requested=available.find(p=>p.instanceId===selected?.instanceId);
  if(requested&&selected)return {...selected,...(selected.options?{options:selected.options.map(option=>({...option}))}:{})};
  const provider=available.find(p=>p.status==='ready')??available.find(p=>p.status!=='error');
  const models=provider?.models??[];
  const model=models.find(m=>m.isDefault&&!m.isCustom)?.slug??models.find(m=>!m.isCustom)?.slug??models[0]?.slug;
  if(!provider||!model)throw Error('No default model is available on this T3 machine. Choose an enabled provider and default model in T3 settings, then retry.');
  return {instanceId:provider.instanceId,model};
}

/** Use the same project/environment access setting as T3's new-thread UI.
 * Older configurations omit this key; T3's own default is Full Access. */
export function resolveNewThreadDefaults(config:unknown,project:Project):NewThreadDefaults {
  const modelSelection=resolveNewThreadModel(config,project);
  if(!isRecord(config)||!isRecord(config.settings))throw Error('T3 did not return its model defaults.');
  const overrides=isRecord(config.settings.projectSettingsOverrides)?config.settings.projectSettingsOverrides[project.id]:undefined;
  const projectMode=isRecord(overrides)?overrides.defaultRuntimeMode:undefined;
  const runtimeMode=projectMode!==undefined?projectMode:config.settings.defaultRuntimeMode!==undefined?config.settings.defaultRuntimeMode:'full-access';
  if(typeof runtimeMode!=='string'||!['approval-required','auto-accept-edits','auto','full-access'].includes(runtimeMode))throw Error('T3 returned an invalid access default. Choose an access mode in T3 settings and retry.');
  return {modelSelection,runtimeMode:runtimeMode as RuntimeMode};
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

function readProviders(value:unknown):Provider[]{
  return records(value).map(provider=>{
    if(typeof provider.instanceId!=='string'||typeof provider.enabled!=='boolean'||typeof provider.status!=='string')throw Error('T3 returned an invalid provider catalog.');
    const models=records(provider.models).map(model=>{
      if(typeof model.slug!=='string')throw Error('T3 returned an invalid model catalog.');
      return {slug:model.slug,isDefault:model.isDefault===true,isCustom:model.isCustom===true};
    });
    return {instanceId:provider.instanceId,enabled:provider.enabled,status:provider.status,availability:typeof provider.availability==='string'?provider.availability:undefined,models};
  });
}
