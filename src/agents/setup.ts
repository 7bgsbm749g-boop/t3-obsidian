import {hasControlCharacters,isRecord,records} from '../shared/values';
import {supportsAgent,agentLaunchArguments,type AgentDriver} from './adapters';
export {agentLaunchArguments} from './adapters';
import {contentHash} from '../responses/completion';
import type {CommandFiles} from '../notes/connect-command-host';

type Rpc={call(method:string,input:unknown):Promise<unknown>};
export interface AgentProvider {id:string;driver:AgentDriver;name:string}
export interface AgentBundle {files:Record<string,string>;hash:string}
interface InstallRecord {version:1;environmentId:string;providerId:string;driver:AgentProvider['driver'];originalArgs:string;installedArgs:string;bundle:string;runtime:string;status:'prepared'|'installed'|'removed';addedArgs?:string;createdInstance?:boolean;environment?:{name:string;value:string}}
export interface ManualSetup {config:string;path:string}
export interface AgentSetupState {inactive?:AgentProvider[];manual?:ManualSetup;providers:AgentProvider[];unsupported:{id:string;name:string;driver:string}[];windows:boolean}
export interface AgentStatus {installed:boolean;owned:boolean;needsUpdate?:boolean;custom?:boolean;lastConnected?:number}
const DIRECTORY='.t3-obsidian/agent-tools';
const slug=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const validText=(value:string)=>!hasControlCharacters(value);
function text(value:unknown){if(typeof value!=='string')throw Error('T3 returned invalid agent settings.');return value;}
function object(value:unknown){if(!isRecord(value))throw Error('T3 returned invalid agent settings.');return value;}
function join(root:string,relative:string){if(!validText(root)||!root||!(/^(?:\/|[A-Za-z]:[\\/])/.test(root)))throw Error('T3 did not return an absolute workspace.');return root.replace(/[\\/]$/,'')+'/'+relative;}
function configState(value:unknown,environmentId:string):{config:Record<string,unknown>;settings:Record<string,unknown>;state:AgentSetupState}{
  const config=object(value),environment=object(config.environment);
  if(environment.environmentId!==environmentId)throw Error('The selected T3 machine changed. Nothing was installed.');
  const providers:AgentProvider[]=records(config.providers).flatMap(provider=>slug(provider.instanceId)&&supportsAgent(String(provider.driver))&&provider.enabled===true&&provider.installed===true&&provider.availability!=='unavailable'?[{id:provider.instanceId,driver:provider.driver as AgentProvider['driver'],name:typeof provider.displayName==='string'?provider.displayName:String(provider.driver)}]:[]);
  return {config,settings:object(config.settings),state:{providers,unsupported:records(config.providers).filter(provider=>typeof provider.driver==='string'&&!supportsAgent(provider.driver)&&provider.enabled===true&&provider.installed===true).map(provider=>({id:String(provider.instanceId),name:typeof provider.displayName==='string'?provider.displayName:String(provider.driver),driver:String(provider.driver)})),windows:isRecord(environment.platform)&&environment.platform.os==='windows'}};
}
function providerConfig(settings:Record<string,unknown>,provider:AgentProvider){
  const instances=isRecord(settings.providerInstances)?settings.providerInstances:{};
  const instance=instances[provider.id];
  if(instance!==undefined){
    if(!isRecord(instance)||instance.driver!==provider.driver||instance.config!==undefined&&!isRecord(instance.config))throw Error('The selected agent configuration changed. Refresh agent setup.');
    if(records(instance.environment).some(value=>value.name==='T3CODE_CODEX_LAUNCH_ARGS'&&(value.valueRedacted===true||!!value.value)))throw Error('This agent overrides its launch arguments through T3CODE_CODEX_LAUNCH_ARGS. Remove that override in T3 settings before using automatic setup.');
    return {config:isRecord(instance.config)?instance.config:{},instances,instance};
  }
  if(provider.id!==provider.driver)throw Error('This T3 version cannot configure the selected agent instance.');
  if(isRecord(settings.providers))return {config:object(settings.providers[provider.driver]),instances,instance:undefined};
  return {config:{},instances,instance:{driver:provider.driver,enabled:true,config:{}}};
}
function args(config:Record<string,unknown>){return config.launchArgs===undefined?'':text(config.launchArgs);}
function record(value:string|undefined,environmentId:string,provider:AgentProvider,root:string):InstallRecord|undefined{
  if(value===undefined)return;
  const item:unknown=JSON.parse(value);
  if(!isRecord(item)||item.version!==1||item.environmentId!==environmentId||item.providerId!==provider.id||item.driver!==provider.driver||typeof item.originalArgs!=='string'||typeof item.installedArgs!=='string'||typeof item.bundle!=='string'||typeof item.runtime!=='string'||!['prepared','installed','removed'].includes(String(item.status)))throw Error('The existing agent setup receipt is invalid. Nothing was changed.');
  if(!/^\.t3-obsidian\/agent-tools\/bundles\/[a-f0-9]{64}$/.test(item.bundle)||!validText(item.runtime))throw Error('Invalid agent bundle receipt.');
  const directory=item.bundle,server=join(root,directory+'/mcp_server.py'),configuration=directory+(provider.driver==='cursor'?'/cursor-':'/claude-')+contentHash(item.runtime).slice(0,16)+(provider.driver==='cursor'?'':'.json');
  const fragment=agentLaunchArguments(provider.driver,item.runtime,server,root,join(root,configuration));
  if(item.installedArgs!==[item.originalArgs,fragment].filter(Boolean).join(' ')||item.addedArgs!==undefined&&item.addedArgs!==fragment||item.createdInstance!==undefined&&typeof item.createdInstance!=='boolean')throw Error('The agent setup receipt does not match its launch options.');
  if(item.environment!==undefined&&(!isRecord(item.environment)||provider.driver!=='opencode'||item.environment.name!=='OPENCODE_CONFIG'||item.environment.value!==join(root,directory+'/opencode-'+contentHash(item.runtime).slice(0,16)+'.json')))throw Error('Invalid MCP environment receipt.');
  return {...item,addedArgs:fragment} as unknown as InstallRecord;
}
export class AgentSetup {
  constructor(private rpc:Rpc,private files:CommandFiles,private environmentId:string,private root:string,private bundle:AgentBundle){}
  async inspect(){
    const data=configState(await this.rpc.call('server.getConfig',{}),this.environmentId),inactive:AgentProvider[]=[];
    for(const provider of records(data.config.providers)){
      if(!slug(provider.instanceId)||!supportsAgent(String(provider.driver))||data.state.providers.some(item=>item.id===provider.instanceId))continue;
      const candidate:AgentProvider={id:provider.instanceId,driver:provider.driver as AgentDriver,name:typeof provider.displayName==='string'?provider.displayName:String(provider.driver)};
      const receipt=record(await this.files.read(this.receipt(candidate)),this.environmentId,candidate,this.root);
      if(receipt&&receipt.status!=='removed')inactive.push(candidate);
    }
    return {...data.state,inactive,manual:await this.manual(data.state.windows?'python':'python3')};
  }
  private shared(runtime:string){
    const directory=`${DIRECTORY}/bundles/${this.bundle.hash}`,server=join(this.root,directory+'/mcp_server.py');
    // Validate a single executable name/path even for manual setup.
    agentLaunchArguments('codex',runtime,server,this.root,'');
    const config=JSON.stringify({mcpServers:{'t3-obsidian':{type:'stdio',command:runtime,args:[server,'--transport-root',this.root]}}},null,2);
    return {directory,config,path:directory+'/mcp-'+contentHash(runtime).slice(0,16)+'.json'};
  }
  async manual(runtime:string):Promise<ManualSetup|undefined>{
    const item=this.shared(runtime);if(await this.files.read(item.path)!==item.config)return;
    return {config:item.config,path:join(this.root,item.path)};
  }
  async prepare(runtime:string):Promise<ManualSetup>{
    const names=['mcp_server.py','connect_commands.py','SKILL.md','LICENSE'];
    if(Object.keys(this.bundle.files).sort().join('|')!==[...names].sort().join('|')||!/^[a-f0-9]{64}$/.test(this.bundle.hash)||contentHash(JSON.stringify(this.bundle.files))!==this.bundle.hash)throw Error('The bundled agent tools failed verification.');
    const item=this.shared(runtime);
    for(const [name,source] of [...Object.entries(this.bundle.files).map(([name,value])=>[item.directory+'/'+name,value]),[item.path,item.config]]){
      const existing=await this.files.read(name);if(existing!==undefined&&existing!==source)throw Error('An installed agent tool changed. It was kept; automatic setup stopped.');
      if(existing===undefined)await this.files.write(name,source);
      if(await this.files.read(name)!==source)throw Error('T3 did not verify the complete agent tool. Agent options were not changed.');
    }
    return {config:item.config,path:join(this.root,item.path)};
  }
  private receipt(provider:AgentProvider){if(!slug(provider.id))throw Error('Invalid agent instance.');return `${DIRECTORY}/installations/${provider.id}.json`;}
  private async current(provider:AgentProvider,allowInactive=false){
    const data=configState(await this.rpc.call('server.getConfig',{}),this.environmentId);
    if(!(allowInactive?records(data.config.providers).some(item=>item.instanceId===provider.id&&item.driver===provider.driver):data.state.providers.some(item=>item.id===provider.id&&item.driver===provider.driver)))throw Error('The selected agent is unavailable. Refresh agent setup.');
    return {...data,...providerConfig(data.settings,provider)};
  }
  private async setArgs(provider:AgentProvider,expected:string,replacement:string,environment?:{name:string;value:string},removeEnvironment=false,previousEnvironment?:{name:string;value:string},allowInactive=false){
    // Change only the selected provider instance. Preserve credential-redaction
    // markers, custom options, and every other provider.
    const data=await this.current(provider,allowInactive);
    if(args(data.config)!==expected)throw Error('Agent options changed during setup. Refresh and try again; those options were kept.');
    const entries=records(data.instance?.environment),owned=environment&&entries.find(entry=>entry.name===environment.name);
    if(environment&&owned&&owned.value!==environment.value&&owned.value!==previousEnvironment?.value)throw Error('This agent has custom OpenCode MCP settings. They were kept.');
    const nextEnvironment=environment?(removeEnvironment?entries.filter(entry=>entry.name!==environment.name):owned?entries.map(entry=>entry.name===environment.name?{...entry,value:environment.value}:entry):[...entries,{...environment,sensitive:false}]):data.instance?.environment;
    const instance=data.instance?{...data.instance,...(nextEnvironment?{environment:nextEnvironment}:{}),config:{...data.config,launchArgs:replacement}}:undefined;
    await this.rpc.call('server.updateSettings',instance?{patch:{},providerInstanceMutation:{operation:data.instances[provider.id]===undefined?'create':'upsert',instanceId:provider.id,instance}}:{patch:{providers:{[provider.driver]:{launchArgs:replacement}}}});
    // T3 refreshes provider health after an update. During that refresh its
    // installed/ready snapshot may briefly be absent; verify the saved options.
    const after=configState(await this.rpc.call('server.getConfig',{}),this.environmentId);
    const saved=providerConfig(after.settings,provider);
    if(environment&&(removeEnvironment?records(saved.instance?.environment).some(entry=>entry.name===environment.name):!records(saved.instance?.environment).some(entry=>entry.name===environment.name&&entry.value===environment.value)))throw Error('T3 did not confirm the agent MCP environment.');
    if(args(saved.config)!==replacement)throw Error('T3 did not confirm the agent options. The setup receipt is retained for recovery.');
  }
  async install(provider:AgentProvider,runtime:string){
    const data=await this.current(provider),path=this.receipt(provider),previous=record(await this.files.read(path),this.environmentId,provider,this.root),current=args(data.config);
    if(previous&&previous.status!=='removed'&&current!==previous.installedArgs&&current!==previous.originalArgs)throw Error('Agent options changed after the previous setup. Keep those changes and remove the old integration in T3 settings before reinstalling.');
    const original=previous&&previous.status!=='removed'?previous.originalArgs:current;
    if(original.includes('t3-obsidian')||provider.driver==='claudeAgent'&&/(?:^|\s)--mcp-config(?:\s|=)/.test(original))throw Error('This agent already has a custom MCP launch configuration. Merge the Obsidian server there before using automatic setup; existing settings were kept.');
    const directory=`${DIRECTORY}/bundles/${this.bundle.hash}`,server=join(this.root,directory+'/mcp_server.py'),configuration=directory+'/claude-'+contentHash(runtime).slice(0,16)+'.json';
    const cursorDirectory=directory+'/cursor-'+contentHash(runtime).slice(0,16);
    const addedArgs=agentLaunchArguments(provider.driver,runtime,server,this.root,join(this.root,provider.driver==='cursor'?cursorDirectory:configuration));
    const installed=[original,addedArgs].filter(Boolean).join(' ');
    const environment=provider.driver==='opencode'?{name:'OPENCODE_CONFIG',value:join(this.root,directory+'/opencode-'+contentHash(runtime).slice(0,16)+'.json')}:undefined;
    if(environment&&records(data.instance?.environment).some(entry=>entry.name===environment.name&&entry.value!==environment.value&&entry.value!==previous?.environment?.value))throw Error('Custom OpenCode configuration was kept. Add the Obsidian MCP server there.');
    await this.prepare(runtime);
    const config=JSON.stringify({mcpServers:{'t3-obsidian':{type:'stdio',command:runtime,args:[server,'--transport-root',this.root]}}},null,2);
    const existing=await this.files.read(configuration);
    if(existing!==undefined&&existing!==config)throw Error('This bundle already has another Python executable configured. Use its current executable, or remove that setup first.');
    if(existing===undefined)await this.files.write(configuration,config);
    if(await this.files.read(configuration)!==config)throw Error('T3 did not verify the agent configuration.');
    const extra=provider.driver==='cursor'?{[cursorDirectory+'/.cursor-plugin/plugin.json']:JSON.stringify({name:'t3-obsidian',version:'1.0.0',description:'Checked Obsidian editing tools and skill.'}),[cursorDirectory+'/mcp.json']:config,[cursorDirectory+'/SKILL.md']:this.bundle.files['SKILL.md']}:environment?{[directory+'/opencode-'+contentHash(runtime).slice(0,16)+'.json']:JSON.stringify({mcp:{'t3-obsidian':{type:'local',command:[runtime,server,'--transport-root',this.root],enabled:true}}})}:{};
    for(const [target,source] of Object.entries(extra)){const existing=await this.files.read(target);if(existing!==undefined&&existing!==source)throw Error('Installed agent configuration changed. It was kept.');if(existing===undefined)await this.files.write(target,source);if(await this.files.read(target)!==source)throw Error('T3 could not verify the agent configuration.');}
    const receipt:InstallRecord={version:1,environmentId:this.environmentId,providerId:provider.id,driver:provider.driver,originalArgs:original,installedArgs:installed,bundle:directory,runtime,status:'prepared',addedArgs,createdInstance:previous?.createdInstance??(data.instance!==undefined&&data.instances[provider.id]===undefined),...(environment?{environment}:{})};
    await this.files.write(path,JSON.stringify(receipt));
    await this.setArgs(provider,current,installed,environment,false,previous?.environment);
    await this.files.write(path,JSON.stringify({...receipt,status:'installed'}));
    return {installed:true as const,activation:'Start a new agent session to load the tools and skill.',bundle:directory};
  }
  async status(provider:AgentProvider):Promise<AgentStatus>{
    const current=await this.current(provider,true),receipt=record(await this.files.read(this.receipt(provider)),this.environmentId,provider,this.root);
    if(!receipt||receipt.status==='removed')return {installed:args(current.config).includes('t3-obsidian'),owned:false,custom:args(current.config).includes('t3-obsidian')};
    let installed=args(current.config)===receipt.installedArgs&&(!receipt.environment||records(current.instance?.environment).some(entry=>entry.name===receipt.environment!.name&&entry.value===receipt.environment!.value));
    if(installed&&receipt.bundle===DIRECTORY+'/bundles/'+this.bundle.hash)for(const [name,source] of Object.entries(this.bundle.files))if(await this.files.read(receipt.bundle+'/'+name)!==source){installed=false;break;}
    const raw=await this.files.read(receipt.bundle+'/last-connected.json');let lastConnected:number|undefined;
    if(raw){const value:unknown=JSON.parse(raw);if(isRecord(value)&&typeof value.at==='number'&&value.at<=Date.now()+60_000)lastConnected=value.at;}
    return {installed,owned:true,needsUpdate:receipt.bundle!==DIRECTORY+'/bundles/'+this.bundle.hash,lastConnected};
  }
  async remove(provider:AgentProvider){
    const receipt=record(await this.files.read(this.receipt(provider)),this.environmentId,provider,this.root);if(!receipt||receipt.status==='removed')return;
    const current=args((await this.current(provider,true)).config);
    if(current!==receipt.installedArgs&&current!==receipt.originalArgs)throw Error('Agent options changed after setup. Remove only the t3-obsidian option in T3 settings; automatic removal kept your changes.');
    if(current!==receipt.originalArgs||receipt.environment)await this.setArgs(provider,current,receipt.originalArgs,receipt.environment,true,undefined,true);
    if(receipt.createdInstance&&provider.id===provider.driver){
      const settings=configState(await this.rpc.call('server.getConfig',{}),this.environmentId).settings,instances=isRecord(settings.providerInstances)?settings.providerInstances:{},instance=instances[provider.id];
      if(isRecord(instance)&&instance.driver===provider.driver&&instance.enabled===true&&Object.keys(instance).every(key=>['driver','enabled','config','environment'].includes(key))&&isRecord(instance.config)&&Object.keys(instance.config).every(key=>key==='launchArgs')&&args(instance.config)===receipt.originalArgs&&records(instance.environment).length===0)await this.rpc.call('server.updateSettings',{patch:{},providerInstanceMutation:{operation:'remove',instanceId:provider.id}});
    }
    // Existing sessions can still use their immutable bundle. T3 owns its
    // lifetime; removing configuration must not kill a running conversation.
    await this.files.write(this.receipt(provider),JSON.stringify({...receipt,status:'removed'}));
  }
}
