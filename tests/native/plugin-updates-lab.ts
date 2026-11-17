/** Synthetic upstream and install outcomes for the real product banner. Real
 * host installation is tested separately by plugin-update-install-lab.ts. */
import {Plugin,Platform,Notice} from 'obsidian';
import {PluginUpdates,readRelease,RELEASE_REPOSITORY,type ReleaseFile} from '../../src/app/plugin-updates';
import {UpdateBanner} from '../../src/app/update-banner';
declare const UPDATE_LAB_REPORT:string;
export default class UpdateLab extends Plugin {
 private updates!:PluginUpdates;private dismissed:string|null=null;private version='0.0.2';private installed='0.0.1';private long=false;private failure=false;
 async onload(){
  this.addCommand({id:'show',name:'Update validation: show available release',callback:()=>{this.version='0.0.2';void this.updates.check(true);}});
  this.addCommand({id:'next',name:'Update validation: show next release',callback:()=>{this.version='0.0.3';void this.updates.check(true);}});
  this.addCommand({id:'long',name:'Update validation: show long release notes',callback:()=>{this.long=true;void this.updates.check(true);}});
  this.addCommand({id:'empty',name:'Update validation: show missing release notes',callback:()=>{this.long=false;this.version='0.0.4';void this.updates.check(true);}});
  this.addCommand({id:'fail',name:'Update validation: show failing update',callback:()=>{this.failure=true;void this.updates.check(true);}});
  this.addCommand({id:'retry',name:'Update validation: allow successful retry',callback:()=>{this.failure=false;}});
  this.addCommand({id:'finish',name:'Update validation: remove banner',callback:()=>{this.updates.dispose();void this.report({finished:true});}});
  this.app.workspace.onLayoutReady(()=>void this.start());
 }
 private async start(){
  const banner=new UpdateBanner(this.app.workspace.containerEl,()=>void this.updates.update(),()=>this.updates.dismiss());
  this.updates=new PluginUpdates({installed:async()=>this.installed,latest:async()=>readRelease({tag_name:this.version,draft:false,prerelease:false,body:this.version==='0.0.4'?'':this.long?Array.from({length:60},(_,i)=>`- Release change ${i+1}: keep notes and settings when updating.`).join('\n'):'## What’s Changed\n- Show the GitHub release description below the update title.\n- Keep **Update** and **Dismiss** available while reading changes.\n- Preserve settings when the plugin updates.\n\n[Full changelog](https://github.com/7bgsbm749g-boop/t3-obsidian/releases)',assets:(['main.js','styles.css','manifest.json'] as ReleaseFile[]).map(name=>({name,size:100,browser_download_url:`https://github.com/${RELEASE_REPOSITORY}/releases/download/${this.version}/${name}`}))}),dismissed:()=>this.dismissed,dismiss:version=>{this.dismissed=version;void this.report({dismissed:version});},render:state=>{banner.render(state);void this.report({state});},report:text=>new Notice(text),install:async release=>{
   if(this.failure)throw Error('GitHub returned 503. Try again later.');
   this.installed=release.version;await this.report({simulatedInstall:release.version});
  }});
  this.register(()=>this.updates.dispose());
  await this.report({loaded:true});

 }
 private async report(extra:Record<string,unknown>){if(!Platform.isDesktop)return;const fs=await import('node:fs/promises');const element=this.app.workspace.containerEl.querySelector<HTMLElement>('.t3-update-banner');const bounds=(node:Element|null|undefined)=>{const rect=node?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height,bottom:rect.bottom}:null;};const notes=element?.querySelector<HTMLElement>('.t3-update-banner-notes');const geometry=element?{viewport:{width:element.ownerDocument.defaultView!.innerWidth,height:element.ownerDocument.defaultView!.innerHeight},banner:bounds(element),notes:bounds(notes),actions:bounds(element.querySelector('.t3-update-banner-actions')),gridRows:element.ownerDocument.defaultView!.getComputedStyle(element).gridTemplateRows,notesClientHeight:notes?.clientHeight,notesScrollHeight:notes?.scrollHeight}:null;await fs.appendFile(UPDATE_LAB_REPORT,JSON.stringify({at:new Date().toISOString(),version:this.manifest.version,fixture:'synthetic GitHub release and install outcome; real product banner',geometry,...extra})+'\n');}
 onunload(){void this.report({unloaded:true});}
}
