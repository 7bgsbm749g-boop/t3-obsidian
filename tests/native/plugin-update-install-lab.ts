/** Real GitHub release downloads through Obsidian's native installer. Stage an
 * older released T3 Code build in the isolated test vault before using this lab.
 * The final command installs the source candidate, without replacing settings. */
import {Plugin,Platform,Notice,MarkdownView,type PluginManifest} from 'obsidian';
import {latestRelease,PluginUpdates,type Release} from '../../src/app/plugin-updates';
import {installedVersion,requestRelease,updatePlugin,updateStorage} from '../../src/app/update-install';
import {UpdateBanner} from '../../src/app/update-banner';
declare const UPDATE_INSTALL_REPORT:string;
declare const UPDATE_INSTALL_CANDIDATE:string;
const targetId='t-three-code';
interface Manager {
 plugins:Record<string,Plugin|undefined>;
 disablePlugin(id:string):Promise<void>;
 loadManifests():Promise<void>;
 enablePlugin(id:string):Promise<void>;
 installPlugin(...args:unknown[]):Promise<unknown>;
}
export default class NativeInstallLab extends Plugin {
 private updates?:PluginUpdates;private release?:Release;private fail=true;private blockReload=false;private stopped=false;
 private manager(){return (this.app as typeof this.app&{plugins:Manager}).plugins;}
 private target(){const target=this.manager().plugins[targetId];if(!target)throw Error('The released target plugin is not loaded.');return target;}
 private running(){const plugin=this.target() as Plugin&{clientMaintenance?:{client:{loadedVersion:string}}};return plugin.clientMaintenance?.client.loadedVersion??plugin.manifest.version;}
 async onload(){
  this.addCommand({id:'retry',name:'Native update validation: allow successful retry',callback:()=>{this.fail=false;this.blockReload=false;new Notice('Native update retry is ready.');}});
  this.addCommand({id:'block-reload',name:'Native update validation: block reload after installation',callback:()=>{this.fail=false;this.blockReload=true;new Notice('Native reload block is ready.');}});
  this.addCommand({id:'check',name:'Native update validation: check again',callback:()=>void this.check()});
  this.addCommand({id:'retain',name:'Native update validation: retain candidate',callback:()=>void this.retain().catch(error=>void this.report({retainError:String(error)}))});
  this.app.workspace.onLayoutReady(()=>void this.start().catch(error=>void this.report({startError:String(error)})));
 }
 private async start(){
  await this.report({starting:true});
  this.release=await latestRelease(requestRelease);
  const banner=new UpdateBanner(this.app.workspace.containerEl,()=>void this.updates?.update(),()=>this.updates?.dismiss());
  this.updates=new PluginUpdates({installed:()=>installedVersion(updateStorage(this.app,this.target().manifest),targetId),running:()=>this.running(),latest:async()=>this.release!,dismissed:()=>null,dismiss:()=>{},render:state=>{banner.render(state);void this.report({state});},report:text=>{new Notice(text);void this.report({notice:text});},install:async release=>{
   const before=this.target().manifest.version;
   try{
    // A missing GitHub tag exercises a real native download failure/no-op.
    await updatePlugin(this.app,this.target().manifest,this.fail?{...release,tag:'0.0.0-native-validation-missing'}:release,async()=>{
     if(this.blockReload&&await installedVersion(updateStorage(this.app,this.target().manifest),targetId)===release.version){await this.report({reloadBlocked:true,installed:release.version,running:this.running()});throw Error('Synthetic note save in progress. Try again when it finishes.');}
     const views:MarkdownView[]=[];this.app.workspace.iterateAllLeaves(leaf=>{if(leaf.view instanceof MarkdownView)views.push(leaf.view);});
     for(const view of views)if(view.file&&view.getMode()!=='preview')await view.save();
     await this.report({prepared:true,before});
    },()=>!this.stopped);
    await this.report({nativeSuccess:true,before,installed:await installedVersion(updateStorage(this.app,this.target().manifest),targetId),loaded:this.running()});
   }catch(error){await this.report({nativeFailure:String(error),before,installed:await installedVersion(updateStorage(this.app,this.target().manifest),targetId),loaded:this.running()});throw error;}
  }});
  this.register(()=>{this.updates?.dispose();banner.dispose();});
  await this.report({ready:true,nativeInstallerAvailable:typeof this.manager().installPlugin==='function',baseline:this.target().manifest.version});
  await this.updates.check(true);
 }
 private async check(){await this.updates?.check(true);await this.report({manualCheck:true,installed:await installedVersion(updateStorage(this.app,this.target().manifest),targetId),running:this.running(),bannerVisible:!!this.app.workspace.containerEl.querySelector('.t3-update-banner')});}
 private async retain(){
  if(!Platform.isDesktop)throw Error('Candidate staging requires the desktop test lab.');
  const fs=await import('node:fs/promises'),path=await import('node:path');
  const manifest=JSON.parse(await fs.readFile(path.join(UPDATE_INSTALL_CANDIDATE,'manifest.json'),'utf8')) as PluginManifest;
  if(manifest.id!==targetId||!manifest.version.endsWith('-native-installer'))throw Error('Unexpected source candidate.');
  const manager=this.manager(),directory=this.target().manifest.dir!;
  await manager.disablePlugin(targetId);
  for(const name of ['main.js','styles.css','manifest.json'])await this.app.vault.adapter.write(`${directory}/${name}`,await fs.readFile(path.join(UPDATE_INSTALL_CANDIDATE,name),'utf8'));
  await manager.loadManifests();await manager.enablePlugin(targetId);
  const plugin=this.target() as Plugin&{clientMaintenance?:{client:{loadedVersion:string}}};
  const loaded=plugin.clientMaintenance?.client.loadedVersion;
  await this.report({retained:true,installed:plugin.manifest.version,compiledVersion:loaded,expected:manifest.version});
  new Notice(`Candidate loaded: ${loaded??plugin.manifest.version}`);
 }
 private async report(extra:Record<string,unknown>){if(!Platform.isDesktop)return;const fs=await import('node:fs/promises');await fs.appendFile(UPDATE_INSTALL_REPORT,JSON.stringify({at:new Date().toISOString(),fixture:'real GitHub assets and native Obsidian installer; isolated test vault',...extra})+'\n');}
 onunload(){this.stopped=true;}
}
