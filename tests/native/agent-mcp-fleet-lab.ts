import {Plugin,FileSystemAdapter,apiVersion} from 'obsidian';
const fs=require('node:fs'),path=require('node:path');
/** Isolated UI controller. The production bundle is loaded unchanged. Only
 * fixture-owned provider entries are exposed to the test UI; API writes remain
 * real and cannot target a pre-existing user provider. No notes are created. */
export default class AgentMcpFleetLab extends Plugin {
  private root='';private subject:any;private config:any;private writes:any[]=[];private timer?:number;private busy=false;
  async onload(){
    if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error('A local test vault is required.');
    this.root=path.dirname(this.app.vault.adapter.getBasePath());
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Refuse a non-lab vault.');
    this.config=JSON.parse(fs.readFileSync(path.join(this.root,'CONFIG.json'),'utf8'));
    this.app.workspace.onLayoutReady(()=>void this.start().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})));
    this.register(()=>{if(this.timer)window.clearInterval(this.timer);});
  }
  private write(name:string,value:unknown){fs.mkdirSync(path.dirname(path.join(this.root,name)),{recursive:true});fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2)+'\n');}
  private async start(){
    const file=path.join(this.root,'SESSION.json'),session=JSON.parse(fs.readFileSync(file,'utf8'));fs.unlinkSync(file);
    this.app.saveLocalStorage('send-to-t3-code-device-v1',{deviceId:this.config.clientId,mode:'direct',pairedSessions:{'lab-connection':{token:session.token,expiresAt:typeof session.expiresAt==='number'?session.expiresAt:Date.parse(session.expiresAt),url:this.config.origin,environmentId:this.config.environmentId,permissions:session.scopes}}});
    await (this.app as any).plugins.enablePluginAndSave('t-three-code');this.subject=(this.app as any).plugins.plugins['t-three-code'];
    if(!this.subject)throw Error('The actual product did not load.');
    const inspect=this.subject.agentToolsInspect.bind(this.subject),install=this.subject.agentToolsInstall.bind(this.subject),remove=this.subject.agentToolsRemove.bind(this.subject);
    const allowed=new Set(this.config.ownedProviderIds);
    this.subject.agentToolsInspect=async(id:string)=>{const state=await inspect(id);return {...state,providers:state.providers.filter((provider:any)=>allowed.has(provider.id)),inactive:state.inactive?.filter((provider:any)=>allowed.has(provider.id)),unsupported:[]};};
    this.subject.agentToolsInstall=(id:string,provider:any,runtime:string)=>{if(!allowed.has(provider.id))throw Error('Refuse an unowned provider.');this.writes.push({kind:'connect',provider:provider.id});return install(id,provider,runtime);};
    this.subject.agentToolsRemove=(id:string,provider:any)=>{if(!allowed.has(provider.id))throw Error('Refuse an unowned provider.');this.writes.push({kind:'disconnect',provider:provider.id});return remove(id,provider);};
    this.timer=window.setInterval(()=>{if(this.busy)return;const file=path.join(this.root,'action.json');if(!fs.existsSync(file))return;this.busy=true;
      void(async()=>{const input=JSON.parse(fs.readFileSync(file,'utf8'));fs.unlinkSync(file);if(!/^[a-f0-9-]{36}$/.test(input.id))throw Error('Invalid action.');try{this.write('actions/'+input.id+'.json',{ok:true,result:await this.action(input.kind)});}catch(error){this.write('actions/'+input.id+'.json',{ok:false,error:String(error),stack:(error as Error).stack});}})().catch(error=>this.write('ERROR.json',{error:String(error)})).finally(()=>{this.busy=false;});
    },100);
    this.write('READY.json',{apiVersion,productVersion:this.subject.manifest.version,instanceId:this.subject.clientMaintenance.client.instanceId,sourceBundleSha256:this.config.sourceBundleSha256,fixtureScope:'Real T3 APIs; catalog restricted to fixture-owned providers; no vault notes.'});
  }
  private async action(kind:string):Promise<unknown>{
    if(kind==='preconfigure-ready'){const state=await this.subject.agentToolsInspect(this.config.environmentId),provider=state.providers.find((item:any)=>item.id===this.config.ownedProviderIds[0]);if(!provider)throw Error('Owned test provider is unavailable.');await this.subject.agentToolsInstall(this.config.environmentId,provider,'python3');return {configured:provider.id};}
    if(kind==='settings'){(this.app as any).setting.open();(this.app as any).setting.openTabById('t-three-code');return {opened:true};}
    if(kind==='state'){
      const tab=(this.app as any).setting.pluginTabs.find((tab:any)=>tab.plugin===this.subject||tab.id==='t-three-code');
      const providers=await this.subject.agentToolsInspect(this.config.environmentId),status=[];
      for(const provider of providers.providers)status.push({provider,status:await this.subject.agentToolsStatus(this.config.environmentId,provider)});
      const content=(this.app as any).setting.contentEl as HTMLElement,panel=content?.querySelector('.t3-agent-status');
      return {pages:tab?.getSettingDefinitions().map((page:any)=>page.name),status,manual:providers.manual,writes:this.writes,settingsText:content?.innerText,panel:panel?{state:(panel as HTMLElement).dataset.state,color:getComputedStyle(panel).color,border:getComputedStyle(panel).borderColor}:undefined,details:Array.from(content?.querySelectorAll('details')??[]).map((element:any)=>({title:element.querySelector('summary')?.textContent,open:element.open}))};
    }
    if(kind==='cleanup'){
      await (this.app as any).plugins.disablePluginAndSave('t-three-code');const value={productDisabled:!(this.app as any).plugins.plugins['t-three-code'],testNotesCreated:[],externalProviderCleanupRequired:true};this.write('CLEANUP.json',value);return value;
    }
    if(kind==='quit'){window.setTimeout(()=>require('@electron/remote').app.quit(),200);return {quitScheduled:true};}
    throw Error('Unknown lab action.');
  }
}
