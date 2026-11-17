/** Synthetic upstream, real product banner, vault adapter and Obsidian plugin
 * reload. Installs only this fixture's own runtime, never a real release. */
import {Plugin,Platform,Notice} from 'obsidian';
import {PluginUpdates,readRelease,RELEASE_REPOSITORY,type ReleaseFile} from '../../src/app/plugin-updates';
import {updatePlugin,installedVersion,updateStorage} from '../../src/app/update-install';
import {UpdateBanner} from '../../src/app/update-banner';
declare const UPDATE_LAB_REPORT:string;
export default class UpdateLab extends Plugin {
 private updates!:PluginUpdates;private dismissed:string|null=null;private version='0.0.2';private failure=false;private calls:string[]=[];private busy=false;private stopped=false;
 async onload(){
  this.addCommand({id:'show',name:'Update validation: show available release',callback:()=>{this.version='0.0.2';void this.updates.check(true);}});
  this.addCommand({id:'next',name:'Update validation: show next release',callback:()=>{this.version='0.0.3';void this.updates.check(true);}});
  this.addCommand({id:'fail',name:'Update validation: show failing update',callback:()=>{this.failure=true;void this.updates.check(true);}});
  this.addCommand({id:'retry',name:'Update validation: allow successful retry',callback:()=>{this.failure=false;}});
  this.addCommand({id:'finish',name:'Update validation: remove banner',callback:()=>{this.updates.dispose();void this.report({finished:true});}});
  this.app.workspace.onLayoutReady(()=>void this.start());
 }
 private async start(){
  const banner=new UpdateBanner(this.app.workspace.containerEl,()=>void this.updates.update(),()=>this.updates.dismiss());
  this.updates=new PluginUpdates({installed:()=>installedVersion(updateStorage(this.app,this.manifest),this.manifest.id),latest:async()=>readRelease({tag_name:this.version,draft:false,prerelease:false,assets:(['main.js','styles.css','manifest.json'] as ReleaseFile[]).map(name=>({name,size:100,browser_download_url:`https://github.com/${RELEASE_REPOSITORY}/releases/download/${this.version}/${name}`}))}),dismissed:()=>this.dismissed,dismiss:version=>{this.dismissed=version;void this.report({dismissed:version});},render:state=>{banner.render(state);void this.report({state});},report:text=>new Notice(text),install:async release=>{
   if(this.busy)throw Error('Duplicate update');this.busy=true;
   try{await updatePlugin(this.app,this.manifest,release,async()=>{},()=>!this.stopped,async url=>{
    const name=url.split('/').at(-1) as ReleaseFile;this.calls.push(name);
    if(this.failure&&name==='main.js')return {status:503,text:'Synthetic outage'};
    if(name==='manifest.json')return {status:200,text:JSON.stringify({...this.manifest,version:release.version})};
    return {status:200,text:await this.app.vault.adapter.read(`${this.manifest.dir}/${name}`)};
   });}finally{this.busy=false;}
  }});
  this.register(()=>this.updates.dispose());
  await this.report({loaded:true});

 }
 private async report(extra:Record<string,unknown>){if(!Platform.isDesktop)return;const fs=await import('node:fs/promises');await fs.appendFile(UPDATE_LAB_REPORT,JSON.stringify({at:new Date().toISOString(),version:this.manifest.version,fixture:'synthetic GitHub release; real adapter writes and plugin reload',calls:this.calls,...extra})+'\n');}
 onunload(){this.stopped=true;void this.report({unloaded:true});}
}
