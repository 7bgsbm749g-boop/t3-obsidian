import {beginLogin,pollLogin,refreshAccount,discoverMachines,connectMachine,type CloudAccount,type DeviceLogin,type CloudMachine} from './cloud';
import {beginEmailLogin,verifyEmailLogin,nativeRelayAccount,revokeNativeAccount,type NativeAccount,type EmailLogin} from './native-account';
import {pair,readDirect,type PairedConnection,type PairedSession} from './direct';
import { App, Menu, MenuItem, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, MarkdownView, Platform, FuzzySuggestModal } from 'obsidian';
import { Buffer } from 'buffer';
import { deviceState } from './device-state';
import { downloadImage,nativeAccountFetch } from './network';
import { collectImages, MAX_IMAGE_BYTES } from './images';
import { applyOrchestration, OrchestrationSettings } from './orchestration';
import { CompletionSettings, CompletionJob, CompletionAction, archiveFolder, contentHash, completionState, isOriginalCompletedTurn, cleanCompletedNote } from './completion';
import { Connection, Project, Request, parseProjects, runBridge, sendRequest, configureBridge, retiredConnection, RETIRED_MESSAGE, projectKey, projectLabel } from './bridge';
import {loadFolderLinks,upsertFolderLink,type FolderLink} from './folder-link';
interface Settings { paired:PairedConnection[];directProjects:Project[];directSelected:string[];directScanId:string; connection: Connection; projects: Project[]; selected: string[]; pending: Request[]; orchestration: OrchestrationSettings; completion: CompletionSettings; completionJobs: CompletionJob[]; folderLinks:FolderLink[] }
export default class SendToT3 extends Plugin {
  declare settings: Settings;
  mode: 'desktop'|'direct' = 'desktop';
  private pairedSessions:Record<string,PairedSession>={};
  cloudAccount:CloudAccount|null=null;
  nativeAccount:NativeAccount|null=null;
  emailLogin:EmailLogin|null=null;
  connecting=false;
  connectionSyncComplete=false;
  machineErrors:Record<string,string>={};
  private nativeToken:CloudAccount|undefined;
  private nativeRefreshing:Promise<CloudAccount>|undefined;
  private sessionRefreshing=new Map<string,Promise<PairedSession>>();
  private machineRefreshing:Promise<void>|undefined;
  private refreshRun=0;
  cloudLogin:DeviceLogin|null=null;
  cloudMachines:CloudMachine[]=[];
  cloudError='';
  cloudChanged:(()=>void)|undefined;
  private cloudTimer:ReturnType<typeof setTimeout>|undefined;
  private cloudGeneration=0;
  private cloudRefreshing:Promise<CloudAccount>|undefined;
  private readonly localKey = 'send-to-t3-code-device-v1';
  private deviceId = '';
  busy = false;
  scanError = '';
  private monitoring = false;
  private stopped = false;
  private saving = Promise.resolve();
  async onload() {
    const data = await this.loadData();
    const local = this.app.loadLocalStorage(this.localKey);
    this.deviceId=local?.deviceId??randomId();
    const state=await deviceState(this.deviceId);
    const defaults:Connection = Platform.isMobile ? {executable:'',host:'local'} : (await import('./desktop')).desktopDefaults();
    this.mode=Platform.isMobile||local?.mode!=='desktop'?'direct':'desktop';
    this.pairedSessions=local?.pairedSessions??{};
    this.cloudAccount=local?.cloudAccount??null;
    this.nativeAccount=local?.nativeAccount??null;
    this.settings = {paired:data?.paired??[],directProjects:data?.directProjects??[],directSelected:data?.directSelected??[],directScanId:data?.directScanId??'',connection:local?.connection??data?.connection??defaults,projects:data?.projects??[],selected:data?.selected??[],pending:state?.pending??(!Platform.isMobile?data?.pending:[])??[],orchestration:{waitForOtherThreads:data?.orchestration?.waitForOtherThreads === true},completion:{action:['archive','delete'].includes(data?.completion?.action)?data.completion.action:'keep',archiveFolder:data?.completion?.archiveFolder ?? 'Archive/T3 Code'},completionJobs:state?.completionJobs??(!Platform.isMobile?data?.completionJobs:[])??[],folderLinks:loadFolderLinks(data)};
    if(!Platform.isMobile && !this.settings.connection.native){
      const old=this.settings.connection;
      this.settings.connection=defaults;
      if(old.host!=='local')this.mode='direct';
    }
    // Version 1.4 delivery is retired. Preserve completion tracking for its
    // already accepted threads; never automatically resend an old queued note.
    for(const entry of state?.queued??[]){
      if(!entry.superseded && entry.completion?.action!=='keep' && entry.completion && !this.settings.completionJobs.some(j=>j.requestId===entry.id))
        this.settings.completionJobs.push({...entry.completion,requestId:entry.id,threadId:entry.threadId,projectId:entry.project.id,connection:entry.connection,status:'watching'});
    }
    const migrateConnection=(c:Connection):Connection=>!retiredConnection(c)&&c.transport!=='direct'&&!c.native?{...this.settings.connection,host:'local',transport:'desktop'}:c;
    for(const request of this.settings.pending)request.connection=migrateConnection(request.connection);
    for(const job of this.settings.completionJobs){job.connection=migrateConnection(job.connection);if(retiredConnection(job.connection)&&job.status==='watching'){job.status='kept';job.detail='Kept note: the companion mode was removed. Check the original thread in T3.';}}
    configureBridge({mobile:Platform.isMobile,pairedSession:id=>this.sessionFor(id),saveRequest:async request=>{if(!this.settings.pending.includes(request))throw Error('Saved request is missing. Nothing was sent.');await this.save();}});
    // Migrate unfinished desktop requests once; credentials and jobs never sync.
    await this.save();
    this.addSettingTab(new T3Settings(this.app,this));
    this.app.workspace.onLayoutReady(()=>{if(!this.stopped){if(this.nativeAccount)void this.refreshMachines().catch(e=>{this.cloudError=message(e);this.cloudChanged?.();});void this.monitorCompletions();this.registerInterval(window.setInterval(()=>{void this.monitorCompletions();},30_000));}});
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file,source) => {
      if(file instanceof TFolder){
        menu.addItem(item=>{item.setTitle('Link to T3 Code').setIcon('link');const submenu=(item as MenuItem&{setSubmenu?:()=>Menu}).setSubmenu?.();if(!submenu){item.onClick(()=>new FolderLinkProjectModal(this.app,this,file).open());return;}const selected=this.projects().filter(p=>this.selected().includes(projectKey(p)));for(const project of selected)submenu.addItem(i=>i.setTitle(`Link to ${projectLabel(project)}`).onClick(()=>void this.linkFolder(file,project,false)));submenu.addSeparator();submenu.addItem(i=>i.setTitle('Link to self (create T3 project)').setDisabled(Platform.isMobile).onClick(()=>void this.linkFolderToSelf(file)));if(!selected.length&&Platform.isMobile)submenu.addItem(i=>i.setTitle('Select a project in settings').setDisabled(true));});return;
      }
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md' || (!Platform.isMobile && source !== 'file-explorer-context-menu')) return;
      menu.addItem(item => {
        item.setTitle('Open in T3 Code').setIcon('send');
        if(Platform.isMobile){item.onClick(()=>new SendProjectModal(this.app,this,file).open());return;}
        const submenu = (item as MenuItem & {setSubmenu?:()=>Menu}).setSubmenu?.();
        if (!submenu) {item.onClick(()=>new SendProjectModal(this.app,this,file).open()); return;}
        const selected = this.projects().filter(p=>this.selected().includes(projectKey(p)));
        if (!selected.length) submenu.addItem(i=>i.setTitle('No projects selected — choose in settings').setDisabled(true));
        for (const project of selected) submenu.addItem(i=>i.setTitle(`New thread in ${projectLabel(project)}`).setIcon('message-square-plus').setDisabled(this.busy).onClick(()=>this.send(file,project)));
        submenu.addSeparator();
        submenu.addItem(i=>i.setTitle('Choose projects…').onClick(()=>new ProjectModal(this.app,this).open()));
      });
    }));
    this.addCommand({id:'send-current-note',name:'Send current note',checkCallback:checking=>{const file=this.app.workspace.getActiveFile();if(!file || file.extension.toLowerCase()!=='md')return false;if(!checking)new SendProjectModal(this.app,this,file).open();return true;}});
    this.addCommand({id:'choose-projects',name:'Choose projects',callback:()=>new ProjectModal(this.app,this).open()});
  }
  projects(){return this.mode==='direct'?this.settings.directProjects:this.settings.projects;}
  selected(){return this.mode==='direct'?this.settings.directSelected:this.settings.selected;}
  async select(project:Project,enabled:boolean){const key=projectKey(project);const selected=this.selected().filter(id=>id!==key);if(enabled)selected.push(key);if(this.mode==='direct')this.settings.directSelected=selected;else this.settings.selected=selected;await this.save();}
  connection(project?:Project):Connection {if(this.mode==='direct'){const c=this.settings.paired.find(c=>c.id===(project?.connectionId??this.settings.directScanId));if(!c)throw Error('Pair a T3 connection in settings first.');return {transport:'direct',url:c.url,connectionId:c.id,environmentId:c.environmentId,host:'direct',executable:''};}return {...this.settings.connection,transport:'desktop'};}
  async pairConnection(name:string,address:string,code:string,expectedEnvironmentId?:string){
    const result=await pair(address,code,undefined,expectedEnvironmentId);
    const existing=this.settings.paired.find(c=>c.environmentId===result.descriptor.environmentId&&c.url===result.session.url);
    const c:PairedConnection=existing??{id:randomId(),name:name.trim()||result.descriptor.label,url:result.session.url,environmentId:result.descriptor.environmentId};
    if(!existing)this.settings.paired.push(c);
    this.pairedSessions[c.id]=result.session;this.settings.directScanId=c.id;this.mode='direct';await this.save();
    await this.scan();
  }
  pairingStatus(c:PairedConnection){const s=this.pairedSessions[c.id];return !s?'Pair on this device':s.expiresAt<=Date.now()?'Pairing expired':`Paired on this device until ${new Date(s.expiresAt).toLocaleDateString()}`;}
  async startEmailSignIn(email:string){
    this.cancelCloudLogin();this.emailLogin=null;this.cloudError='';const generation=this.cloudGeneration;
    const login=await beginEmailLogin(email,nativeAccountFetch);
    if(this.stopped||generation!==this.cloudGeneration)return;
    this.emailLogin=login;this.cloudChanged?.();
  }
  async finishEmailSignIn(code:string){
    const login=this.emailLogin;if(!login)throw Error('Request a T3 email code first.');const generation=this.cloudGeneration;
    const account=await verifyEmailLogin(login,code,nativeAccountFetch);
    if(this.stopped||generation!==this.cloudGeneration){void revokeNativeAccount(account,nativeAccountFetch).catch(()=>{});return;}
    this.nativeAccount=account;this.nativeToken=undefined;this.emailLogin=null;this.cloudAccount=null;
    this.mode='direct';await this.save();await this.refreshMachines();
  }
  async nativeCredential():Promise<CloudAccount>{
    const account=this.nativeAccount;if(!account)throw Error('Sign in to T3 on this device first.');
    if(this.nativeToken&&this.nativeToken.expiresAt>Date.now()+10000)return this.nativeToken;
    if(this.nativeRefreshing)return this.nativeRefreshing;
    const generation=this.cloudGeneration;
    const active=()=>!this.stopped&&this.nativeAccount===account&&generation===this.cloudGeneration;
    const work=(async()=>{const token=await nativeRelayAccount(account,async()=>{if(!active())throw Error('Sign-in cancelled.');await this.save();},nativeAccountFetch);if(!active())throw Error('Sign-in cancelled.');this.nativeToken=token;return token;})();
    this.nativeRefreshing=work;try{return await work;}finally{if(this.nativeRefreshing===work)this.nativeRefreshing=undefined;}
  }
  async sessionFor(id:string):Promise<PairedSession|undefined>{
    const session=this.pairedSessions[id];const c=this.settings.paired.find(c=>c.id===id);
    if(session?.accountId&&session.accountId!==this.nativeAccount?.userId)throw Error('Sign in to the T3 account that owns this connection.');
    if(session&&session.expiresAt>Date.now()+60000)return session;
    if(!c?.managed||!this.nativeAccount)return session;
    const existing=this.sessionRefreshing.get(id);if(existing)return existing;
    const account=this.nativeAccount;const generation=this.cloudGeneration;
    const work=(async()=>{
      const credential=await this.nativeCredential();const machines=await discoverMachines(credential);
      const m=machines.find(m=>m.environmentId===c.environmentId&&m.url===c.url);
      if(!m)throw Error('This T3 connection is no longer available to your account. Refresh connections.');
      const next=await connectMachine(await this.nativeCredential(),m,this.deviceId+':'+account.userId);
      if(this.stopped||this.nativeAccount!==account||generation!==this.cloudGeneration||!this.settings.paired.includes(c))throw Error('Connection cancelled.');
      next.accountId=account.userId;this.pairedSessions[id]=next;await this.save();return next;
    })();this.sessionRefreshing.set(id,work);try{return await work;}finally{if(this.sessionRefreshing.get(id)===work)this.sessionRefreshing.delete(id);}
  }
  async connectAccountMachine(m:CloudMachine){
    const account=this.nativeAccount;if(!account)throw Error('Sign in with your T3 email first.');const generation=this.cloudGeneration;
    const session=await connectMachine(await this.nativeCredential(),m,this.deviceId+':'+account.userId);
    if(this.stopped||this.nativeAccount!==account||generation!==this.cloudGeneration)throw Error('Connection cancelled.');
    const c=this.settings.paired.find(c=>c.environmentId===m.environmentId&&c.url===m.url)??{id:randomId(),name:m.name,url:m.url,environmentId:m.environmentId};
    if(!this.settings.paired.includes(c))this.settings.paired.push(c);
    c.managed=true;session.accountId=account.userId;this.pairedSessions[c.id]=session;
    if(!this.settings.directScanId)this.settings.directScanId=c.id;this.mode='direct';await this.save();
    const projects=parseProjects(await readDirect({transport:'direct',host:'direct',executable:'',url:c.url,environmentId:c.environmentId,connectionId:c.id},['projects'],session));
    if(this.stopped||this.nativeAccount!==account||generation!==this.cloudGeneration||!this.settings.paired.includes(c))return;
    this.settings.directProjects=[...this.settings.directProjects.filter(p=>p.connectionId!==c.id),...projects.map(p=>({...p,connectionId:c.id,connectionName:c.name}))];
    delete this.machineErrors[m.environmentId];await this.save();
  }
  async startCloudLogin(){
    this.cancelCloudLogin();const generation=this.cloudGeneration;this.cloudError='';
    const login=await beginLogin();if(this.stopped||generation!==this.cloudGeneration)return;
    this.cloudLogin=login;this.cloudChanged?.();this.scheduleCloudPoll();
  }
  cancelCloudLogin(){this.cloudGeneration++;this.refreshRun++;this.connecting=false;if(this.cloudTimer)clearTimeout(this.cloudTimer);this.cloudLogin=null;this.emailLogin=null;this.cloudChanged?.();}
  private scheduleCloudPoll(){
    const login=this.cloudLogin;if(!login||this.stopped)return;const generation=this.cloudGeneration;
    this.cloudTimer=setTimeout(async()=>{try{
      const account=await pollLogin(login);if(this.stopped||generation!==this.cloudGeneration)return;
      if(account){this.cloudAccount=account;this.cloudLogin=null;await this.save();await this.refreshMachines();}
      else this.scheduleCloudPoll();
    }catch(e){if(generation!==this.cloudGeneration)return;this.cloudError=message(e);this.cloudLogin=null;}this.cloudChanged?.();},Math.max(1000,login.nextPollAt-Date.now()));
  }
  async currentCloudAccount():Promise<CloudAccount>{
    if(!this.cloudAccount)throw Error('Sign in to T3 Connect on this device first.');
    if(this.cloudRefreshing)return this.cloudRefreshing;
    const generation=this.cloudGeneration;const old=this.cloudAccount;
    const work=(async()=>{const next=await refreshAccount(old);if(generation!==this.cloudGeneration||this.stopped)throw Error('T3 sign-in was cancelled.');this.cloudAccount=next;if(next!==old)await this.save();return next;})();
    this.cloudRefreshing=work;try{return await work;}finally{if(this.cloudRefreshing===work)this.cloudRefreshing=undefined;}
  }
  async refreshMachines(){
    if(this.machineRefreshing)return this.machineRefreshing;
    const generation=this.cloudGeneration;const run=++this.refreshRun;this.connecting=true;this.connectionSyncComplete=false;this.cloudError='';this.cloudChanged?.();
    const work=(async()=>{let discovered=false;try{
      const list=await discoverMachines(this.nativeAccount?await this.nativeCredential():await this.currentCloudAccount());
      if(generation!==this.cloudGeneration||this.stopped)return;this.cloudMachines=list;this.machineErrors={};discovered=true;this.cloudChanged?.();
      if(this.nativeAccount)for(const m of list){
        if(generation!==this.cloudGeneration||this.stopped)return;
        try{await this.connectAccountMachine(m);}catch(e){if(generation===this.cloudGeneration)this.machineErrors[m.environmentId]=message(e);}
        if(generation===this.cloudGeneration)this.cloudChanged?.();
      }
    }finally{if(run===this.refreshRun){this.connecting=false;this.connectionSyncComplete=discovered;}if(generation===this.cloudGeneration)this.cloudChanged?.();}})();
    this.machineRefreshing=work;try{await work;}finally{if(this.machineRefreshing===work)this.machineRefreshing=undefined;}
  }
  directAccountReady(){
    if(!this.nativeAccount||this.connecting||!this.connectionSyncComplete||!this.cloudMachines.length)return false;
    return this.cloudMachines.some(machine=>!this.machineErrors[machine.environmentId]&&this.settings.paired.some(connection=>connection.managed&&connection.environmentId===machine.environmentId&&connection.url===machine.url));
  }
  async linkFolder(folder:TFolder,project:Project,self:boolean){
    this.settings.folderLinks=upsertFolderLink(this.settings.folderLinks,{id:randomId(),folderPath:folder.path,connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self});
    await this.save();new Notice(`${folder.path} linked to ${projectLabel(project)}.`);
  }
  async linkFolderToSelf(folder:TFolder){
    try{
      if(Platform.isMobile)throw Error('Link to self is available when Obsidian and T3 Code run on the same desktop computer.');
      const adapter=this.app.vault.adapter as any;if(typeof adapter.getFullPath!=='function')throw Error('This vault does not expose a local filesystem path.');
      const workspaceRoot=String(adapter.getFullPath(folder.path));const same=(a:string,b:string)=>a.replace(/\\/g,'/').replace(/\/$/,'').toLocaleLowerCase()===b.replace(/\\/g,'/').replace(/\/$/,'').toLocaleLowerCase();
      let project=this.settings.projects.find(item=>same(item.workspaceRoot,workspaceRoot));
      const localConnection={...this.settings.connection,host:'local',transport:'desktop' as const};
      if(!project){const id=await (await import('./desktop')).addDesktopProject(localConnection,workspaceRoot,folder.name);const result=await runBridge(localConnection,['projects']);this.settings.projects=parseProjects(result);project=this.settings.projects.find(item=>item.id===id)||this.settings.projects.find(item=>same(item.workspaceRoot,workspaceRoot));}
      if(!project)throw Error('T3 created the project, but it was not returned by project discovery.');
      if(!this.settings.selected.includes(project.id))this.settings.selected.push(project.id);
      await this.linkFolder(folder,project,true);
    }catch(e){new Notice(`Send to T3 Code: ${message(e)}`,12000);}
  }
  async signOutCloud(){
    const old=this.nativeAccount;this.cancelCloudLogin();this.nativeAccount=null;this.nativeToken=undefined;this.nativeRefreshing=undefined;this.sessionRefreshing.clear();
    for(const [id,s] of Object.entries(this.pairedSessions))if(s.accountId)delete this.pairedSessions[id];
    this.cloudAccount=null;this.cloudMachines=[];this.cloudError='';this.machineErrors={};this.connectionSyncComplete=false;this.machineRefreshing=undefined;this.cloudRefreshing=undefined;await this.save();this.cloudChanged?.();
    if(old)try{await revokeNativeAccount(old,nativeAccountFetch);}catch{new Notice('Signed out on this device. T3 could not be reached to revoke the account session; you can revoke it in your T3 account.');}
  }
  async forgetPairing(id:string){delete this.pairedSessions[id];await this.save();}
  async removeConnection(id:string){
    if(this.settings.pending.some(r=>r.connection.connectionId===id)||this.settings.completionJobs.some(j=>j.connection.connectionId===id&&j.status==='watching'))throw Error('This connection has an unconfirmed request or completion check. Resolve or stop it before removing the connection.');
    this.settings.paired=this.settings.paired.filter(c=>c.id!==id);this.settings.directProjects=this.settings.directProjects.filter(p=>p.connectionId!==id);this.settings.directSelected=this.settings.directSelected.filter(k=>!k.startsWith(id+':'));delete this.pairedSessions[id];if(this.settings.directScanId===id)this.settings.directScanId=this.settings.paired[0]?.id??'';await this.save();
  }
  save() {
    const {pending,completionJobs,connection,...shared}=this.settings;
    this.app.saveLocalStorage(this.localKey,JSON.parse(JSON.stringify({deviceId:this.deviceId,mode:this.mode,connection,pairedSessions:this.pairedSessions,cloudAccount:this.cloudAccount,nativeAccount:this.nativeAccount})));
    const snapshot=JSON.parse(JSON.stringify(shared));
    const state=JSON.parse(JSON.stringify({pending,completionJobs}));
    this.saving=this.saving.catch(()=>{}).then(async()=>{await deviceState(this.deviceId,state);await this.saveData(snapshot);});return this.saving;
  }
  async scan() {
    try {
      const connection = this.connection();
      const result=await runBridge(connection,['projects']);
      const projects = parseProjects(result);
      if (JSON.stringify(connection) !== JSON.stringify(this.connection())) return;
      if(connection.transport==='direct'){const c=this.settings.paired.find(c=>c.id===connection.connectionId)!;this.settings.directProjects=[...this.settings.directProjects.filter(p=>p.connectionId!==c.id),...projects.map(p=>({...p,connectionId:c.id,connectionName:c.name}))];}
      else this.settings.projects=projects;
      this.scanError=result.cached?(result.warning??'Destination offline. Showing saved projects; sending requires a connection.') : '';await this.save();
    } catch(e) {this.scanError = message(e); throw e;}
  }
  async send(file:TFile, project:Project, options?:{id?:string;quiet?:boolean;throwOnError?:boolean}) {
    if (this.busy) return;
    this.busy = true;
    let saved = false;
    const orchestration = {...this.settings.orchestration};
    const completion = {...this.settings.completion};
    try {
      if(completion.action==='archive') completion.archiveFolder=archiveFolder(completion.archiveFolder);
      const content = await this.app.vault.read(file);
      if (!content.trim()) {new Notice('This note is empty. Add Markdown before sending.'); return;}
      if(!options?.quiet)new Notice('Preparing note and embedded images…');
      const images = await collectImages(content, async embed => {
        if (/^https?:/i.test(embed.link)) return {bytes:await downloadImage(embed.link),name:new URL(embed.link).pathname.split('/').pop() || 'remote-image'};
        if (/^data:/i.test(embed.link)) {
          const match=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(embed.link);
          if(!match || match[2].length > 14_000_000) throw new Error('Invalid or oversized inline image data.');
          return {bytes:Buffer.from(match[2],'base64'),name:`inline.${match[1]}`};
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(embed.link)) throw new Error('Use a vault image, HTTPS URL, or image data URL.');
        let link=embed.link.split('#')[0]; try{link=decodeURIComponent(link);}catch{throw new Error('Invalid percent encoding in image path.');}
        const target=this.app.metadataCache.getFirstLinkpathDest(link,file.path);
        if(!target) throw new Error(`Embedded image not found: ${link}`);
        if(target.stat.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MiB.');
        return {bytes:Buffer.from(await this.app.vault.readBinary(target)),name:target.name};
      });
      const request:Request = {id:options?.id??randomId(),project:{...project},title:file.basename.slice(0,160),prompt:applyOrchestration(images.markdown,orchestration),attachments:images.attachments,context:images.context,completion:{notePath:file.path,contentHash:contentHash(content),ctime:file.stat.ctime,...completion},connection:this.connection(project)};
      if(request.prompt.length>120_000) throw new Error('The note and image context exceed T3’s 120,000-character limit. Split the note before sending.');
      this.settings.pending.push(request); await this.save(); saved = true;
      const threadId=await this.dispatch(request,options?.quiet);return {threadId,request};
    } catch(e) {if(options?.throwOnError)throw e;new Notice(`Send to T3 Code: ${message(e)} ${saved ? "See settings for saved requests." : "No thread was created."}`,12000);}
    finally {this.busy = false;}
  }
  rememberStarted(request:Pick<Request,'id'|'project'|'connection'|'completion'>,threadId:string) {
    if(request.completion){
      this.settings.completionJobs=this.settings.completionJobs.filter(j=>j.notePath!==request.completion!.notePath);
      if(request.completion.action!=='keep')this.settings.completionJobs.push({...request.completion,requestId:request.id,threadId,projectId:request.project.id,connection:{...request.connection},status:'watching'});
    }
  }
  async dispatch(request:Request,quiet=false) {
    if(!quiet)new Notice(`Sending to ${projectLabel(request.project)}…`);
    const result=await sendRequest(request);
    const before={jobs:this.settings.completionJobs,pending:this.settings.pending};
    this.rememberStarted(request,result.threadId);
    this.settings.pending=this.settings.pending.filter(r=>r.id!==request.id);
    try{await this.save();}catch(e){this.settings.pending=before.pending;this.settings.completionJobs=before.jobs;throw e;}
    if(!quiet)new Notice(`Thread created in ${projectLabel(request.project)}: ${result.threadId}`,12000);return result.threadId;
  }
  onunload(){this.stopped=true;this.cancelCloudLogin();this.cloudChanged=undefined;}
  async monitorCompletions() {
    if(this.monitoring || this.stopped || this.busy) return;
    this.monitoring=true;
    const snapshots=new Map<string,any>();
    try {
      for(const job of [...this.settings.completionJobs]) {
        const active=()=>!this.stopped && !this.busy && this.settings.completionJobs.includes(job) && job.status==='watching';
        if(!active()) continue;
        try {
          const key=JSON.stringify([job.connection,job.projectId]);
          if(!snapshots.has(key)) snapshots.set(key,await runBridge(job.connection,['threads','--project',job.projectId]));
          if(!active())continue;
          const threads=snapshots.get(key)?.threads;
          if(!Array.isArray(threads))throw new Error('Invalid T3 thread status response.');
          const thread=threads.find((t:any)=>t.id===job.threadId);
          if(!thread)throw new Error('Thread unavailable. Note will be kept until its status can be checked.');
          const state=completionState(thread,job);
          if(state==='wait'){if(job.detail){delete job.detail;await this.save();}continue;}
          if(state==='keep'){job.status='kept';job.detail='Kept note: thread failed or was interrupted.';await this.save();continue;}
          const full=await runBridge(job.connection,['read',job.threadId]);
          if(!active())continue;
          if(!isOriginalCompletedTurn(full,job)) {
            if(full.latestTurn?.state!=='completed' || full.session?.activeTurnId)continue;
            job.status='kept';job.detail='Kept note: the thread advanced or its original completed turn could not be verified.';await this.save();continue;
          }
          // Do not clean up while another send for this note is unresolved.
          if(this.settings.pending.some(r=>r.completion?.notePath===job.notePath))continue;
          const fileAt=(path:string)=>{const f=this.app.vault.getAbstractFileByPath(path);return f instanceof TFile?f:null;};
          const detail=await cleanCompletedNote(job,{
            find:path=>{const f=fileAt(path);return f?{path:f.path,ctime:f.stat.ctime}:null;},
            read:async f=>{const file=fileAt(f.path);if(!file || file.stat.ctime!==f.ctime)throw new Error('Note moved or replaced.');return this.app.vault.read(file);},
            hasUnsavedChanges:(f,hash)=>this.app.workspace.getLeavesOfType('markdown').some(leaf=>leaf.view instanceof MarkdownView && leaf.view.file?.path===f.path && contentHash(leaf.view.editor.getValue())!==hash),
            exists:path=>this.app.vault.getAbstractFileByPath(path)!==null,
            mkdir:async path=>{await this.app.vault.createFolder(path);},
            move:async(f,path)=>{const file=fileAt(f.path);if(!file || file.stat.ctime!==f.ctime)throw new Error('Note moved or replaced.');await this.app.fileManager.renameFile(file,path);},
            trash:async f=>{const file=fileAt(f.path);if(!file || file.stat.ctime!==f.ctime)throw new Error('Note moved or replaced.');await this.app.vault.trash(file,false);},
            save:()=>this.save(),active,
          });
          if(this.stopped)continue;
          job.status='kept';job.detail=detail;await this.save();
          new Notice(`Send to T3 Code: ${detail}`,10000);
        }catch(e){if(!this.stopped && job.detail!==message(e)){job.detail=message(e);try{await this.save();}catch{ /* Try again next poll. */ }}}
      }
    } finally {this.monitoring=false;}
  }
  async retry(request:Request) {
    if (this.busy) return;
    this.busy = true;
    try {await this.dispatch(request);} catch(e) {new Notice(message(e),12000);} finally {this.busy=false;}
  }
}
function randomId():string {
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Buffer.from(bytes).toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function message(e:unknown) {return e instanceof Error ? e.message : String(e);}
function projectsUI(container:HTMLElement, plugin:SendToT3, redraw:()=>void) {
  if(plugin.mode==='direct')new Setting(container).setName('Connection to scan').addDropdown(d=>{for(const c of plugin.settings.paired)d.addOption(c.id,c.name);d.setValue(plugin.settings.directScanId).onChange(async id=>{plugin.settings.directScanId=id;await plugin.save();});});
  new Setting(container).setName('Available T3 Code projects').setDesc('Scan the configured T3 environment, then select projects for the Files menu.').addButton(b=>b.setButtonText('Scan projects').onClick(async()=>{
    b.setDisabled(true).setButtonText('Scanning…');
    try {await plugin.scan();} catch(e) {new Notice(message(e),10000);} finally {redraw();}
  }));
  if (plugin.scanError) container.createEl('p',{text:`${plugin.scanError}`,cls:'t3-error'});
  if (!plugin.projects().length) container.createEl('p',{text:'No projects discovered. Start T3 Code, register a project there, and scan again.'});
  for(const p of plugin.projects())new Setting(container).setName(projectLabel(p)).setDesc(p.workspaceRoot).addToggle(t=>t.setValue(plugin.selected().includes(projectKey(p))).onChange(async enabled=>{await plugin.select(p,enabled);}));
  const missing=plugin.selected().filter(id=>!plugin.projects().some(p=>projectKey(p)===id));
  if (missing.length) container.createEl('p',{text:`${missing.length} selected project(s) are unavailable. They will reappear if discovered again.`});
}
class ProjectModal extends Modal {
  constructor(app:App,private plugin:SendToT3){super(app);}
  onOpen(){this.contentEl.empty(); this.titleEl.setText('Send to T3 Code projects'); projectsUI(this.contentEl,this.plugin,()=>this.onOpen());}
}
class SendProjectModal extends FuzzySuggestModal<Project> {
  constructor(app:App,private plugin:SendToT3,private file:TFile){super(app);this.setPlaceholder('Choose a T3 Code project');this.emptyStateText='No projects selected. Scan and select projects in Send to T3 Code settings.';}
  getItems(){return this.plugin.projects().filter(p=>this.plugin.selected().includes(projectKey(p)));}
  getItemText(project:Project){return `New thread in ${projectLabel(project)}`;}
  onChooseItem(project:Project){void this.plugin.send(this.file,project);}
}
type FolderLinkChoice=Project|{self:true;title:string};
class FolderLinkProjectModal extends FuzzySuggestModal<FolderLinkChoice>{
  constructor(app:App,private plugin:SendToT3,private folder:TFolder){super(app);this.setPlaceholder('Choose a T3 Code project');}
  getItems(){return [...this.plugin.projects().filter(p=>this.plugin.selected().includes(projectKey(p))),...(!Platform.isMobile?[{self:true as const,title:'Self (create this folder as a T3 project)'}]:[])];}
  getItemText(choice:FolderLinkChoice){return 'self' in choice?choice.title:`Link to ${projectLabel(choice)}`;}
  onChooseItem(choice:FolderLinkChoice){if('self' in choice)void this.plugin.linkFolderToSelf(this.folder);else void this.plugin.linkFolder(this.folder,choice,false);}
}
class T3Settings extends PluginSettingTab {
  constructor(app:App,private plugin:SendToT3){super(app,plugin);}
  private selectedMachine:CloudMachine|null=null;
  cloudUI(el:HTMLElement){
    const p=this.plugin;p.cloudChanged=()=>this.display();
    el.createEl('h3',{text:p.nativeAccount?'T3 connection on this device':'Sign in on this device'});
    el.createEl('p',{text:p.nativeAccount?'Your account is stored only on this device. Projects and saved folder links appear after T3 finishes connecting your computers.':'This device is not signed in to T3. Verify your T3 email once here before projects or saved folder links are shown.'});
    if(p.nativeAccount){
      new Setting(el).setName(p.nativeAccount.identity).setDesc(p.connecting?'Connecting computers and discovering projects…':'Signed in. Connections renew automatically.').addButton(b=>b.setButtonText('Refresh connections').setDisabled(p.connecting).onClick(async()=>{try{await p.refreshMachines();}catch(e){p.cloudError=message(e);}this.display();})).addButton(b=>b.setButtonText('Sign out').onClick(async()=>{await p.signOutCloud();this.display();}));
      if(p.connecting)el.createEl('p',{text:'Connecting to T3 and syncing project information…'});
      else if(!p.connectionSyncComplete)el.createEl('p',{text:'Connection setup has not completed. Refresh connections to try again.'});
      else if(!p.cloudMachines.length)el.createEl('p',{text:'No T3 computers are available yet. Enable T3 Connect on a computer, then refresh.'});
      else if(Object.keys(p.machineErrors).length)el.createEl('p',{text:'T3 could not finish connecting all computers. Refresh connections to retry.',cls:'t3-error'});
      if(p.directAccountReady())for(const m of p.cloudMachines){
        const c=p.settings.paired.find(c=>c.environmentId===m.environmentId&&c.url===m.url);
        const count=p.settings.directProjects.filter(project=>project.connectionId===c?.id).length;
        new Setting(el).setName(m.name).setDesc(p.machineErrors[m.environmentId]??(c?`${count} projects discovered`:'Connecting…'));
      }
    }else if(p.emailLogin){
      el.createEl('p',{text:`Enter the six-digit verification code sent by T3 to ${p.emailLogin.email}.`});
      let code='';new Setting(el).setName('Email verification code').addText(t=>{t.inputEl.type='password';t.inputEl.inputMode='numeric';t.inputEl.autocomplete='one-time-code';t.inputEl.maxLength=6;t.setPlaceholder('6-digit code').onChange(v=>code=v);});
      new Setting(el).addButton(b=>b.setButtonText('Verify and connect').setCta().onClick(async()=>{b.setDisabled(true);try{await p.finishEmailSignIn(code);}catch(e){p.cloudError=message(e);}this.display();})).addButton(b=>b.setButtonText('Cancel').onClick(()=>p.cancelCloudLogin()));
    }else{
      if(p.cloudAccount)el.createEl('p',{text:'Verify your email once to upgrade from address discovery to automatic connections. Existing manual pairings keep working.'});
      let email=p.cloudAccount?.identity.includes('@')?p.cloudAccount.identity:'';
      new Setting(el).setName('T3 account email').setDesc('Uses T3’s sign-in service. No password or per-computer pairing code is needed.').addText(t=>{t.inputEl.type='email';t.inputEl.autocomplete='email';t.setPlaceholder('you@example.com').setValue(email).onChange(v=>email=v);});
      new Setting(el).addButton(b=>b.setButtonText('Send sign-in code').setCta().onClick(async()=>{b.setDisabled(true);try{await p.startEmailSignIn(email);}catch(e){p.cloudError=message(e);}this.display();}));
    }
    if(p.cloudError)el.createEl('p',{text:p.cloudError,cls:'t3-error'});
  }
  display(){
    const el=this.containerEl; el.empty();
    el.createEl('p',{text:'Send full Markdown notes and embedded images to your T3 projects. Sending starts a turn using the project’s model and permission defaults.'});
    new Setting(el).setName('Connection on this device').setDesc('T3 Connect works on desktop and mobile. This computer only is available for local desktop use.').addDropdown(d=>{d.addOptions({...(!Platform.isMobile?{desktop:'This computer only (advanced)'}:{}),direct:'T3 Connect (recommended)'});d.setValue(this.plugin.mode).onChange(async value=>{this.plugin.mode=value as 'desktop'|'direct';this.plugin.scanError='';await this.plugin.save();this.display();});});
    if(this.plugin.mode==='direct'){
      this.cloudUI(el);
      if(!this.plugin.directAccountReady())return;
      const advanced=el.createEl('details');advanced.createEl('summary',{text:'Advanced: manual pairing'});
      advanced.createEl('p',{text:'In T3 Settings → Connections, create a fresh pairing link using an HTTPS address this device can reach. Paste it below. This connects to T3 itself, with no companion, Python, SSH, or Tailscale requirement in the plugin.'});
      let name=this.selectedMachine?.name??'',address=this.selectedMachine?.url??'',code='';
      new Setting(advanced).setName('Connection name').addText(t=>t.setPlaceholder('My laptop').setValue(name).onChange(v=>name=v));
      new Setting(advanced).setName('T3 address or pairing link').setDesc('Not the old companion URL. Pairing links contain a one-time secret and are never synced or retained.').addText(t=>{t.inputEl.type='password';t.inputEl.autocomplete='off';t.setValue(address).onChange(v=>address=v);});
      new Setting(advanced).setName('Pairing code (if separate)').addText(t=>{t.inputEl.type='password';t.inputEl.autocomplete='off';t.onChange(v=>code=v);});
      new Setting(advanced).addButton(b=>b.setButtonText('Pair and discover projects').setCta().onClick(async()=>{b.setDisabled(true);try{await this.plugin.pairConnection(name,address,code,this.selectedMachine?.environmentId);this.selectedMachine=null;new Notice('Paired directly with T3. Select projects below.');this.display();}catch(e){new Notice(message(e),12000);b.setDisabled(false);}}));
      for(const c of this.plugin.settings.paired){
        const status=c.managed?(this.plugin.nativeAccount?'T3 account connection · renews automatically':'Sign in on this device to connect automatically'):this.plugin.pairingStatus(c);
        const setting=new Setting(el).setName(c.name).setDesc(status);
        if(!c.managed)setting.addButton(b=>b.setButtonText('Forget pairing').onClick(async()=>{await this.plugin.forgetPairing(c.id);this.display();}));
        setting.addButton(b=>b.setButtonText('Remove connection').onClick(async()=>{try{await this.plugin.removeConnection(c.id);this.display();}catch(e){new Notice(message(e));}}));
      }
      el.createEl('p',{text:'Project choices sync. Sign in once on each device; credentials stay on that device. Computers must be online to receive a note. Unconfirmed sends require manual retry.'});
    } else {
    new Setting(el).setName('Official T3 executable').setDesc('Leave blank to discover t3 automatically. Otherwise enter the full path to the official T3 CLI executable, not a Fleet adapter or shell command.').addText(t=>t.setValue(this.plugin.settings.connection.executable).onChange(async value=>{this.plugin.settings.connection.executable=value.trim();await this.plugin.save();}));
    new Setting(el).setName('T3 data directory').setDesc('Usually your home directory followed by .t3. Must match the running T3 installation.').addText(t=>t.setValue(this.plugin.settings.connection.baseDir??'').onChange(async value=>{this.plugin.settings.connection.baseDir=value.trim();await this.plugin.save();}));

    }
    el.createEl('h3',{text:'Orchestration'});
    new Setting(el).setName('Wait for other threads').setDesc('Prepend an instruction to wait for all other active T3 Code threads in the destination project to finish before starting work.').addToggle(t=>t.setValue(this.plugin.settings.orchestration.waitForOtherThreads).onChange(async enabled=>{this.plugin.settings.orchestration.waitForOtherThreads=enabled;await this.plugin.save();}));
    new Setting(el).setName('When task completes').setDesc('After T3 reports the original turn completed successfully. Changed or renamed notes are kept. Applies to newly sent notes.').addDropdown(d=>d.addOptions({keep:'Keep note',archive:'Archive note',delete:'Delete note (vault trash)'}).setValue(this.plugin.settings.completion.action).onChange(async value=>{this.plugin.settings.completion.action=value as CompletionAction;await this.plugin.save();this.display();}));
    if(this.plugin.settings.completion.action==='archive') new Setting(el).setName('Archive folder').setDesc('Folder inside this vault. Original subfolders are preserved; existing notes are never overwritten.').addText(t=>t.setValue(this.plugin.settings.completion.archiveFolder).onChange(async value=>{this.plugin.settings.completion.archiveFolder=value;await this.plugin.save();}));
    el.createEl('h3',{text:'Linked folders'});
    el.createEl('p',{text:'Folder links are saved configuration for future integrations. They do not monitor notes or create threads. Link to self registers the folder as a project in the local T3 Code installation.'});
    if(!this.plugin.settings.folderLinks.length)el.createEl('p',{text:'No folders are linked.'});
    for(const link of this.plugin.settings.folderLinks){
      new Setting(el).setName(link.folderPath).setDesc(`${link.self?'Self · ':''}${link.projectTitle} · ${link.workspaceRoot}`).addButton(b=>b.setButtonText('Unlink').onClick(async()=>{this.plugin.settings.folderLinks=this.plugin.settings.folderLinks.filter(item=>item!==link);await this.plugin.save();this.display();}));
    }
    if(this.plugin.settings.completionJobs.length){
      el.createEl('h3',{text:'Task completion monitoring'});
      el.createEl('p',{text:'Checks every 30 seconds while Obsidian is active and resumes after restart or reopening on this device. Mobile background checks are not guaranteed. A completed T3 turn is the completion signal; this does not judge whether the answer fully solved the task.'});
      for(const job of this.plugin.settings.completionJobs) new Setting(el).setName(job.notePath).setDesc(`${job.action} · ${job.threadId} · ${job.detail || 'Waiting for successful completion'}`).addButton(b=>b.setButtonText(job.status==='watching'?'Stop monitoring':'Dismiss').onClick(async()=>{this.plugin.settings.completionJobs=this.plugin.settings.completionJobs.filter(j=>j!==job);await this.plugin.save();this.display();}));
      new Setting(el).addButton(b=>b.setButtonText('Check now').onClick(async()=>{b.setDisabled(true);await this.plugin.monitorCompletions();this.display();}));
    }
    el.createEl('h3',{text:'Projects'});
    projectsUI(el,this.plugin,()=>this.display());
    if(this.plugin.settings.pending.length) {
      el.createEl('h3',{text:'Unconfirmed requests'});
      el.createEl('p',{text:'T3 may already have started this request. Retry uses the same saved content and ID to avoid duplicates. Discard forgets local retry data; it does not cancel a T3 thread.'});
      for(const request of this.plugin.settings.pending) new Setting(el).setName(`${request.title} → ${request.project.title}`).setDesc(retiredConnection(request.connection)?RETIRED_MESSAGE+' Request: '+request.id:request.id).addButton(b=>b.setButtonText('Retry').setDisabled(this.plugin.busy||retiredConnection(request.connection)).onClick(async()=>{b.setDisabled(true);await this.plugin.retry(request);this.display();})).addButton(b=>b.setButtonText('Discard').onClick(async()=>{this.plugin.settings.pending=this.plugin.settings.pending.filter(r=>r.id!==request.id);await this.plugin.save();this.display();}));
    }
  }
}
