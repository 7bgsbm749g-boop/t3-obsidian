import {Plugin,MarkdownView,TFile} from 'obsidian';
import {HtmlResultViews} from '../../src/responses/html-result-view';
import {renderHtmlResult} from '../../src/responses/html-results';
import {reference} from '../fixtures/html-result';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const page=`<!doctype html><html><head><style>
html{font:16px system-ui;color:#ddd;background:#242424}body{margin:0}
button{margin:16px;padding:12px}p{margin:0;padding:16px;box-sizing:border-box;height:64px;border-bottom:1px solid #555}
</style><script>
let clicks=0,wheels=0;function report(){const body=document.body,r=document.documentElement;
 window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:Math.ceil(body.getBoundingClientRect().height)}},'*');
 window.parent.postMessage({type:'html-height-lab',height:body.getBoundingClientRect().height,clientHeight:r.clientHeight,scrollHeight:r.scrollHeight,scrollY,clicks,wheels},'*');}
function fill(count){document.querySelector('main').innerHTML=Array.from({length:count},(_,i)=>'<p>HTML row '+(i+1)+'</p>').join('');requestAnimationFrame(report)}
window.addEventListener('message',e=>{if(e.data?.type==='lab-rows')fill(e.data.count);if(e.data?.type==='lab-measure')report()});
window.addEventListener('resize',()=>requestAnimationFrame(report));
window.addEventListener('wheel',e=>{if(e.isTrusted)wheels++;requestAnimationFrame(report)},{passive:true});
document.addEventListener('DOMContentLoaded',()=>{document.querySelector('button').onclick=()=>{clicks++;document.querySelector('output').textContent=String(clicks);report()};new ResizeObserver(()=>requestAnimationFrame(report)).observe(document.body);fill(64)});
</script></head><body><button>HTML focus check <output>0</output></button><main></main></body></html>`;

/** Unsynced native regression fixture. No T3 dispatch or real-vault writes. */
export default class HtmlHeightLab extends Plugin {
 private root='';private report:any;private frame?:HTMLIFrameElement;private view?:MarkdownView;private views?:HtmlResultViews;private finishing=false;
 private evidence:any={checks:{},samples:{},temporaryThreads:[],temporaryNotes:[]};
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated vault is required.');
  this.registerDomEvent(window,'message',e=>{if(e.source===this.frame?.contentWindow&&e.data?.type==='html-height-lab'){this.report=e.data;void this.finishWhenScrolled();}});
  this.app.workspace.onLayoutReady(()=>void this.run().catch(e=>this.write('ERROR.json',{error:String(e),stack:e.stack})));
 }
 private write(name:string,value:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
 private async waitFor(check:()=>boolean){for(let i=0;i<120;i++){if(check())return;await pause(50);}throw Error('Native HTML height check timed out.');}
 private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,name),image.toPNG());}
 private sample(){const frame=this.frame!,root=frame.closest<HTMLElement>('.send-to-t3-html-result')!,scroller=this.view!.contentEl.querySelector<HTMLElement>('.cm-scroller')!;return {...this.report,frameHeight:frame.getBoundingClientRect().height,rootHeight:root.getBoundingClientRect().height,noteScrollTop:scroller.scrollTop,noteScrollHeight:scroller.scrollHeight,focused:document.activeElement===frame};}
 private fits(){const s=this.sample();return Math.abs(s.frameHeight-s.height)<=1&&s.scrollHeight<=s.clientHeight+1&&s.scrollY===0;}
 private async rows(count:number){this.frame!.contentWindow!.postMessage({type:'lab-rows',count},'*');await this.waitFor(()=>this.report?.height>0&&Math.abs(this.report.height-(count*64+78))<10&&this.fits());}
 private async run(){
  this.views=new HtmlResultViews(this.app,{get:async()=>page,dispose(){}} as any);this.views.install(this);
  const file=await this.app.vault.create('HTML-height.md','# Full-height HTML\n\n'+renderHtmlResult({...reference,height:200,heights:undefined})+'\n\nAfter the HTML.\n');
  this.evidence.temporaryNotes=['HTML-height.md','Reference.md','Virtual.md'];
  const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);this.view=leaf.view as MarkdownView;
  await this.waitFor(()=>!!this.view!.contentEl.querySelector('iframe.send-to-t3-html-frame'));
  this.frame=this.view.contentEl.querySelector<HTMLIFrameElement>('iframe.send-to-t3-html-frame')!;
  this.frame.contentWindow!.postMessage({type:'lab-measure'},'*');
  await this.waitFor(()=>this.report?.height>4000&&this.fits());
  this.evidence.samples.initial=this.sample();this.evidence.checks.fullHeightBeforeClick=this.fits()&&this.report.clicks===0;
  await this.capture('initial-full-height.png');
  await this.rows(96);this.evidence.samples.grown=this.sample();this.evidence.checks.dynamicGrowth=this.fits()&&this.report.height>6000;
  await this.rows(8);this.evidence.samples.shrunk=this.sample();this.evidence.checks.dynamicShrink=this.fits()&&this.report.height<1000;
  await this.rows(64);this.evidence.checks.saved200PixelCapIgnored=this.fits();
  this.registerDomEvent(this.view.contentEl.querySelector<HTMLElement>('.cm-scroller')!,'scroll',()=>void this.finishWhenScrolled());
  this.write('READY.json',{status:'Click HTML focus check, then scroll down over the HTML.',...this.evidence,sample:this.sample()});
 }
 private async finishWhenScrolled(){
  if(this.finishing||!fs.existsSync(path.join(this.root,'READY.json'))||!this.report?.clicks||!this.report?.wheels||this.sample().noteScrollTop<80)return;
  this.finishing=true;await pause(200);this.frame!.contentWindow!.postMessage({type:'lab-measure'},'*');await pause(100);
  const sample=this.sample();this.evidence.samples.afterTrustedClickAndWheel=sample;
  this.evidence.checks.clickReachesHtml=sample.clicks>0;
  this.evidence.checks.trustedWheelScrollsNote=sample.wheels>0&&sample.noteScrollTop>80;
  this.evidence.checks.noInnerVerticalScroll=this.fits();
  await this.capture('note-scroll-after-html-click.png');
  this.views!.dispose();await this.view!.leaf.setViewState({type:'empty'});
  for(const name of this.evidence.temporaryNotes){const file=this.app.vault.getAbstractFileByPath(name);if(file instanceof TFile)await this.app.vault.delete(file);}
  this.evidence.checks.temporaryNotesDeleted=this.evidence.temporaryNotes.every((name:string)=>!this.app.vault.getAbstractFileByPath(name));
  this.evidence.pass=Object.values(this.evidence.checks).every(Boolean);
  this.write('RESULT.json',this.evidence);
 }
}
