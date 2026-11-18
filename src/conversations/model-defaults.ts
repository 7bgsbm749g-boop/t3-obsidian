import {isRecord,records} from '../shared/values';
import {acquireT3UnaryRpc,type T3Api,type T3RpcConnection,type SocketFactory} from '../connection/t3-rpc';

export interface ModelSelection {instanceId:string;model:string;options?:{id:string;value:unknown}[]}
export type RuntimeMode='approval-required'|'auto-accept-edits'|'auto'|'full-access';
export type WorkspaceStrategy={type:'root'}|{type:'worktree';baseRef:string;startFromOrigin:boolean};
export interface NewThreadDefaults {modelSelection:ModelSelection;runtimeMode:RuntimeMode;workspaceStrategy?:WorkspaceStrategy}
interface Provider {instanceId:string;enabled:boolean;availability?:string;status:string;models:{slug:string;isDefault?:boolean;isCustom?:boolean}[]}
interface Project {id:string;workspaceRoot?:string;defaultModelSelection?:ModelSelection|null;defaultThreadEnvMode?:'local'|'worktree'|null}

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
  const storedMode=isRecord(overrides)?overrides.defaultThreadEnvMode:undefined;
  const workspaceMode=storedMode??(!config.settings.projectSettingsFolded?project.defaultThreadEnvMode:undefined)??config.settings.defaultThreadEnvMode??'local';
  if(workspaceMode!=='local'&&workspaceMode!=='worktree')throw Error('T3 returned an invalid workspace default. Choose a workspace mode in T3 settings and retry.');
  const fromOrigin=config.settings.newWorktreesStartFromOrigin??false;
  if(typeof fromOrigin!=='boolean')throw Error('T3 returned an invalid worktree origin default.');
  return {modelSelection,runtimeMode:runtimeMode as RuntimeMode,workspaceStrategy:workspaceMode==='worktree'?{type:'worktree',baseRef:'HEAD',startFromOrigin:fromOrigin}:{type:'root'}};
}

async function readRepositoryHead(rpc:T3RpcConnection,cwd:string):Promise<string|undefined>{
  try{
    const file=await rpc.call('projects.readFile',{cwd,relativePath:'.git/HEAD',allowMissing:true});
    if(!isRecord(file)||file.truncated||typeof file.contents!=='string')return;
    const head=file.contents.trimEnd();
    if(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(head))return 'HEAD';
    // Read only a normal clone's symbolic local branch. Linked worktrees,
    // nested folders and unfamiliar HEAD formats use T3's VCS API.
    const branch=/^ref: refs\/heads\/([^\u0000-\u0020\u007f~^:?*\[\\]+)$/u.exec(head)?.[1];
    if(branch&&!branch.startsWith('-')&&!branch.includes('..')&&!branch.includes('@{'))return branch;
  }catch(error){
    if(!isRecord(error)||!['ProjectReadFileError','EnvironmentAuthorizationError'].includes(String(error.kind)))throw error;
  }
}

export async function readNewThreadDefaults(api:T3Api,origin:string,project:Project,makeSocket?:SocketFactory,readLegacyProject?:()=>Promise<Project>):Promise<NewThreadDefaults>{
  const rpc=await acquireT3UnaryRpc(api,origin,makeSocket);
  try{
    const config=await rpc.call('server.getConfig',{});
    // Current servers migrate aggregate defaults into projectSettingsOverrides.
    if(readLegacyProject&&isRecord(config)&&isRecord(config.settings)&&config.settings.projectSettingsFolded!==true)project=await readLegacyProject();
    const defaults=resolveNewThreadDefaults(config,project);
    if(defaults.workspaceStrategy?.type==='worktree'&&project.workspaceRoot){
      const migrated=isRecord(config)&&isRecord(config.settings)&&config.settings.projectSettingsFolded===true;
      const head=migrated&&readLegacyProject?await readRepositoryHead(rpc,project.workspaceRoot):undefined;
      if(head){defaults.workspaceStrategy.baseRef=head;return defaults;}
      const status=migrated
        ?await rpc.call('vcs.listRefs',{cwd:project.workspaceRoot,refKind:'local',limit:1,refresh:true})
        :await rpc.call('vcs.refreshStatus',{cwd:project.workspaceRoot,localOnly:true});
      if(!isRecord(status)||typeof status.isRepo!=='boolean')throw Error('T3 did not return the project repository status. Retry the saved request.');
      // The ref endpoint puts the checked-out local branch first. It reads
      // refs without scanning the worktree or computing changes and upstream status.
      const current=records(status.refs)[0];
      const refName=migrated?(current?.current===true?current.name:undefined):status.refName;
      // Non-repository folders and No project stay in their T3-managed folder.
      if(!status.isRepo)defaults.workspaceStrategy={type:'root'};
      else if(migrated&&!Array.isArray(status.refs))throw Error('T3 did not return project refs. Retry the saved request.');
      else if(typeof refName==='string'&&refName)defaults.workspaceStrategy.baseRef=refName;
    }
    return defaults;
  }
  finally{rpc.close();}
}

export async function readNewThreadModel(api:T3Api,origin:string,project:Project,makeSocket?:SocketFactory):Promise<ModelSelection>{
  const rpc=await acquireT3UnaryRpc(api,origin,makeSocket);
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
