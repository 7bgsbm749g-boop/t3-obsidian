import {hasControlCharacters,isRecord,records} from '../shared/values';
import {contentHash} from '../responses/completion';
import type {CommandFiles} from '../notes/connect-command-host';

type Rpc={call(method:string,input:unknown):Promise<unknown>};
export interface AgentProvider {id:string;driver:'codex'|'claudeAgent';name:string}
export interface AgentBundle {files:Record<string,string>;hash:string}
interface InstallRecord {version:1;environmentId:string;providerId:string;driver:AgentProvider['driver'];originalArgs:string;installedArgs:string;bundle:string;runtime:string;status:'prepared'|'installed'|'removed'}
export interface AgentSetupState {providers:AgentProvider[];windows:boolean}
const DIRECTORY='.t3-obsidian/agent-tools';
const slug=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const validText=(value:string)=>!hasControlCharacters(value);
function text(value:unknown){if(typeof value!=='string')throw Error('T3 returned invalid agent settings.');return value;}
function object(value:unknown){if(!isRecord(value))throw Error('T3 returned invalid agent settings.');return value;}
/** Quoting for T3's documented quote-aware argument tokenizer, not a shell. */
export function quoteAgentArgument(value:string){if(!validText(value))throw Error('Invalid agent launch argument.');return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';}
function join(root:string,relative:string){if(!validText(root)||!root||!(/^(?:\/|[A-Za-z]:[\\/])/.test(root)))throw Error('T3 did not return an absolute workspace.');return root.replace(/[\\/]$/,'')+'/'+relative;}
export function agentLaunchArguments(driver:AgentProvider['driver'],runtime:string,server:string,root:string,config:string){
  if(!runtime.trim()||runtime!==runtime.trim()||!validText(runtime))throw Error('Enter one Python 3 executable name or absolute path, without arguments.');
  if(driver==='codex'){
    const value='mcp_servers.t3-obsidian={command='+JSON.stringify(runtime)+',args=['+[server,'--transport-root',root].map(value=>JSON.stringify(value)).join(',')+']}';
    return '-c '+quoteAgentArgument(value);
  }
  return '--mcp-config '+quoteAgentArgument(config);
}
function configState(value:unknown,environmentId:string):{config:Record<string,unknown>;settings:Record<string,unknown>;state:AgentSetupState}{
  const config=object(value),environment=object(config.environment);
  if(environment.environmentId!==environmentId)throw Error('The selected T3 machine changed. Nothing was installed.');
  const providers:AgentProvider[]=records(config.providers).flatMap(provider=>slug(provider.instanceId)&&['codex','claudeAgent'].includes(String(provider.driver))&&provider.enabled===true&&provider.installed===true&&provider.availability!=='unavailable'?[{id:provider.instanceId,driver:provider.driver as AgentProvider['driver'],name:typeof provider.displayName==='string'?provider.displayName:provider.driver==='codex'?'Codex':'Claude Code'}]:[]);
  return {config,settings:object(config.settings),state:{providers,windows:isRecord(environment.platform)&&environment.platform.os==='windows'}};
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
  return {config:object(object(settings.providers)[provider.driver]),instances,instance:undefined};
}
function args(config:Record<string,unknown>){return config.launchArgs===undefined?'':text(config.launchArgs);}
function record(value:string|undefined,environmentId:string,provider:AgentProvider):InstallRecord|undefined{
  if(value===undefined)return;
  const item:unknown=JSON.parse(value);
  if(!isRecord(item)||item.version!==1||item.environmentId!==environmentId||item.providerId!==provider.id||item.driver!==provider.driver||typeof item.originalArgs!=='string'||typeof item.installedArgs!=='string'||typeof item.bundle!=='string'||typeof item.runtime!=='string'||!['prepared','installed','removed'].includes(String(item.status)))throw Error('The existing agent setup receipt is invalid. Nothing was changed.');
  return item as unknown as InstallRecord;
}
export class AgentSetup {
  constructor(private rpc:Rpc,private files:CommandFiles,private environmentId:string,private root:string,private bundle:AgentBundle){}
  async inspect(){return configState(await this.rpc.call('server.getConfig',{}),this.environmentId).state;}
  private receipt(provider:AgentProvider){if(!slug(provider.id))throw Error('Invalid agent instance.');return `${DIRECTORY}/installations/${provider.id}.json`;}
  private async current(provider:AgentProvider){
    const data=configState(await this.rpc.call('server.getConfig',{}),this.environmentId);
    if(!data.state.providers.some(item=>item.id===provider.id&&item.driver===provider.driver))throw Error('The selected agent is unavailable. Refresh agent setup.');
    return {...data,...providerConfig(data.settings,provider)};
  }
  private async setArgs(provider:AgentProvider,expected:string,replacement:string){
    // Legacy settings have a narrow field patch. Instance settings use T3's
    // whole-map API; preserve its credential-redaction markers and other keys.
    const data=await this.current(provider);
    if(args(data.config)!==expected)throw Error('Agent options changed during setup. Refresh and try again; those options were kept.');
    const patch=data.instance?{providerInstances:{...data.instances,[provider.id]:{...data.instance,config:{...data.config,launchArgs:replacement}}}}:{providers:{[provider.driver]:{launchArgs:replacement}}};
    await this.rpc.call('server.updateSettings',{patch});
    // T3 refreshes provider health after an update. During that refresh its
    // installed/ready snapshot may briefly be absent; verify the saved options.
    const after=configState(await this.rpc.call('server.getConfig',{}),this.environmentId);
    if(args(providerConfig(after.settings,provider).config)!==replacement)throw Error('T3 did not confirm the agent options. The setup receipt is retained for recovery.');
  }
  async install(provider:AgentProvider,runtime:string){
    const data=await this.current(provider),path=this.receipt(provider),previous=record(await this.files.read(path),this.environmentId,provider),current=args(data.config);
    if(previous&&previous.status!=='removed'&&current!==previous.installedArgs&&current!==previous.originalArgs)throw Error('Agent options changed after the previous setup. Keep those changes and remove the old integration in T3 settings before reinstalling.');
    const original=previous&&previous.status!=='removed'?previous.originalArgs:current;
    if(original.includes('t3-obsidian')||provider.driver==='claudeAgent'&&/(?:^|\s)--mcp-config(?:\s|=)/.test(original))throw Error('This agent already has a custom MCP launch configuration. Merge the Obsidian server there before using automatic setup; existing settings were kept.');
    const names=['mcp_server.py','connect_commands.py','SKILL.md','LICENSE'];
    if(Object.keys(this.bundle.files).sort().join('|')!==[...names].sort().join('|')||!/^[a-f0-9]{64}$/.test(this.bundle.hash)||contentHash(JSON.stringify(this.bundle.files))!==this.bundle.hash)throw Error('The bundled agent tools failed verification.');
    const directory=`${DIRECTORY}/bundles/${this.bundle.hash}`,server=join(this.root,directory+'/mcp_server.py'),configuration=directory+'/claude-'+contentHash(runtime).slice(0,16)+'.json';
    const installed=[original,agentLaunchArguments(provider.driver,runtime,server,this.root,join(this.root,configuration))].filter(Boolean).join(' ');
    for(const [name,source] of Object.entries(this.bundle.files)){
      if(!names.includes(name))throw Error('Unexpected agent tool asset.');
      const target=directory+'/'+name,existing=await this.files.read(target);
      if(existing!==undefined&&existing!==source)throw Error('An installed agent tool changed. It was kept; automatic setup stopped.');
      if(existing===undefined)await this.files.write(target,source);
      if(await this.files.read(target)!==source)throw Error('T3 did not verify the complete agent tool. Agent options were not changed.');
    }
    const config=JSON.stringify({mcpServers:{'t3-obsidian':{type:'stdio',command:runtime,args:[server,'--transport-root',this.root]}}},null,2);
    const existing=await this.files.read(configuration);
    if(existing!==undefined&&existing!==config)throw Error('This bundle already has another Python executable configured. Use its current executable, or remove that setup first.');
    if(existing===undefined)await this.files.write(configuration,config);
    if(await this.files.read(configuration)!==config)throw Error('T3 did not verify the agent configuration.');
    const receipt:InstallRecord={version:1,environmentId:this.environmentId,providerId:provider.id,driver:provider.driver,originalArgs:original,installedArgs:installed,bundle:directory,runtime,status:'prepared'};
    await this.files.write(path,JSON.stringify(receipt));
    await this.setArgs(provider,current,installed);
    await this.files.write(path,JSON.stringify({...receipt,status:'installed'}));
    return {installed:true as const,activation:'Start a new agent session to load the tools and skill.',bundle:directory};
  }
  async status(provider:AgentProvider){
    const current=await this.current(provider),receipt=record(await this.files.read(this.receipt(provider)),this.environmentId,provider);
    if(!receipt||receipt.status==='removed')return {installed:false,lastConnected:undefined};
    const installed=args(current.config)===receipt.installedArgs;
    const raw=await this.files.read(receipt.bundle+'/last-connected.json');let lastConnected:number|undefined;
    if(raw){const value:unknown=JSON.parse(raw);if(isRecord(value)&&typeof value.at==='number'&&value.at<=Date.now()+60_000)lastConnected=value.at;}
    return {installed,lastConnected};
  }
  async remove(provider:AgentProvider){
    const receipt=record(await this.files.read(this.receipt(provider)),this.environmentId,provider);if(!receipt||receipt.status==='removed')return;
    const current=args((await this.current(provider)).config);
    if(current!==receipt.installedArgs&&current!==receipt.originalArgs)throw Error('Agent options changed after setup. Remove only the t3-obsidian option in T3 settings; automatic removal kept your changes.');
    if(current!==receipt.originalArgs)await this.setArgs(provider,current,receipt.originalArgs);
    // Existing sessions can still use their immutable bundle. T3 owns its
    // lifetime; removing configuration must not kill a running conversation.
    await this.files.write(this.receipt(provider),JSON.stringify({...receipt,status:'removed'}));
  }
}
