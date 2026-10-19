import {Plugin,MarkdownView} from 'obsidian';
import {HtmlResultViews} from '../html-result-view';
import {HtmlResultStore} from '../html-result-store';
import {renderHtmlResult,htmlResultKey} from '../html-results';
import {deviceState} from '../device-state';
import {reference,tool} from '../tests/fixtures/html-result';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const page=`<!doctype html><html><head><style id="t3-theme">html{font:16px system-ui;color:var(--foreground);background:var(--background)}body{margin:0}button{padding:12px}</style><script>
function theme(t){if(t&&t.variables)for(const k in t.variables)document.documentElement.style.setProperty(k,t.variables[k])}
try{theme(JSON.parse(decodeURIComponent(location.hash.split('t3-theme=')[1])))}catch(e){}
window.addEventListener('message',e=>{if(e.data?.method==='ui/notifications/host-context-changed'){theme({variables:e.data.params.styles.variables});report()}if(e.data?.type==='lab-ping')report()});
var count=0;function report(){var isolated=false;try{window.parent.document.body}catch(e){isolated=true}window.parent.postMessage({type:'html-lab-report',count,isolated,node:typeof require,foreground:getComputedStyle(document.documentElement).color},'*');var r=document.documentElement;window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height)}},'*')}
document.addEventListener('DOMContentLoaded',()=>{document.querySelector('button').onclick=()=>{count++;document.querySelector('output').textContent=String(count);report()};report()});
</script></head><body><p>Native HTML result</p><button>Increase count</button><p>Count: <output>0</output></p></body></html>`;

/** Synthetic, unsynced native-client coverage. Never installs in a real vault. */
export default class HtmlResultsLab extends Plugin {
  private root='';private views?:HtmlResultViews;private reports=new Map<Window,any>();private downloads=0;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated vault is required.');
    this.registerDomEvent(window,'message',event=>{if(event.data?.type==='html-lab-report'){this.reports.set(event.source as Window,event.data);this.write('LATEST.json',{reports:[...this.reports.values()]});}});
    this.views=this.makeViews(()=>true);this.views.install(this);
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})));
  }
  private makeViews(online:()=>boolean,scope='sender'){return new HtmlResultViews(this.app,new HtmlResultStore({read:key=>deviceState('html-lab:'+scope+':'+key),write:async(key,value)=>{await deviceState('html-lab:'+scope+':'+key,value);}},async()=>{if(!online())throw Error('Offline fixture');return {origin:'https://fixture.test',api:async route=>route==='/api/orchestration/turn-item'?tool():{relativeUrl:'/api/assets/result',expiresAt:Date.now()+60_000}};},async()=>{this.downloads++;return {status:200,mimeType:'text/html',bytes:new TextEncoder().encode(page).buffer};}));}
  private write(name:string,value:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,name),image.toPNG());}
  async run(){
    await pause(700);const file=await this.app.vault.create('HTML.md','# HTML integration\n\nBefore the result.\n\n'+renderHtmlResult(reference)+'\n\nAfter the result.\n');
    const first=this.app.workspace.getLeaf(false);await first.openFile(file);await pause(800);
    const view=first.view as MarkdownView,frame=view.contentEl.querySelector<HTMLIFrameElement>('iframe.send-to-t3-html-frame');
    if(!frame)throw Error('Live Preview did not mount its HTML frame.');
    await pause(400);const liveReport=this.reports.get(frame.contentWindow!),nativeWidget=!!frame.closest('[data-t3-html-editor-widget]');
    view.editor.replaceRange('Native edit. ',{line:2,ch:0});await pause(500);
    const stable=frame===view.contentEl.querySelector('iframe.send-to-t3-html-frame');
    await this.capture('live-preview.png');
    const original=view.editor.getValue(),block=renderHtmlResult(reference);
    view.editor.setValue('abc\n\n   '+block+'\n\nAfter');await pause(300);
    const beforeList=!!view.contentEl.querySelector('[data-t3-html-editor-widget]');
    view.editor.replaceRange('- a',{line:0,ch:0},{line:0,ch:3});await pause(300);
    const inList=!view.contentEl.querySelector('[data-t3-html-editor-widget]');
    view.editor.replaceRange('abc',{line:0,ch:0},{line:0,ch:3});await pause(300);
    const afterList=!!view.contentEl.querySelector('[data-t3-html-editor-widget]');
    view.editor.setValue('<div>\n\n'+block+'\n\nAfter');await pause(300);
    view.editor.replaceRange('word',{line:1,ch:0});await pause(300);
    const inHtml=!view.contentEl.querySelector('[data-t3-html-editor-widget]');
    view.editor.replaceRange('',{line:1,ch:0},{line:1,ch:4});await pause(300);
    const afterHtml=!!view.contentEl.querySelector('[data-t3-html-editor-widget]');
    view.editor.setValue(original);await pause(300);
    await first.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});await pause(700);
    const reading=(first.view as MarkdownView).contentEl.querySelector<HTMLIFrameElement>('iframe.send-to-t3-html-frame');const readingReport=reading&&this.reports.get(reading.contentWindow!);await this.capture('reading-mode.png');
    await first.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:true}});await pause(500);
    const source=(first.view as MarkdownView).contentEl.querySelectorAll('.markdown-source-view iframe.send-to-t3-html-frame').length===0;await this.capture('source-mode.png');
    const onlineDownloads=this.downloads;const offline=this.makeViews(()=>false),mounted=offline.mount(reference,document),offlineLeaf=this.app.workspace.getLeaf(true);await offlineLeaf.setViewState({type:'empty'});offlineLeaf.view.containerEl.replaceChildren(mounted.root);await pause(1200);
    const offlineFrame=mounted.root.querySelector<HTMLIFrameElement>('iframe'),offlineReport=offlineFrame&&this.reports.get(offlineFrame.contentWindow!);await this.capture('offline-cache.png');mounted.dispose();offlineLeaf.detach();offline.dispose();
    const saved=await deviceState('html-lab:sender:'+htmlResultKey(reference)),singleSenderDownload=onlineDownloads===1&&this.downloads===1;
    let receiverOnline=false;const receiver=this.makeViews(()=>receiverOnline,'receiver'),receiverLeaf=this.app.workspace.getLeaf(true);await receiverLeaf.setViewState({type:'empty'});
    const receiverEmpty=!await deviceState('html-lab:receiver:'+htmlResultKey(reference)),cold=receiver.mount({...reference,height:2000,heights:undefined},document);receiverLeaf.view.containerEl.replaceChildren(cold.root);await pause(500);
    const failedHeight=cold.root.getBoundingClientRect().height,compactReceiver=failedHeight>0&&failedHeight<=180&&cold.root.dataset.t3HtmlState==='failed'&&cold.root.dataset.t3HtmlError==='connection'&&!cold.root.querySelector('iframe');await this.capture('receiver-failed.png');
    receiverOnline=true;await Promise.all([receiver.recover(reference.environmentId),receiver.recover(reference.environmentId)]);await pause(500);
    const receiverFrame=cold.root.querySelector<HTMLIFrameElement>('iframe'),receiverReport=receiverFrame&&this.reports.get(receiverFrame.contentWindow!);await receiver.recover(reference.environmentId);
    const recoveredReceiver=cold.root.dataset.t3HtmlState==='ready'&&!!receiverReport&&receiverFrame===cold.root.querySelector('iframe')&&this.downloads===onlineDownloads+1;
    await this.capture('receiver-recovered.png');cold.dispose();receiver.dispose();receiverLeaf.detach();
    const checks={livePreview:!!liveReport,nativeWidget,readingMode:!!readingReport,sourceMode:source,stableFrameWhileTyping:stable,listContext:beforeList&&inList&&afterList,htmlContext:inHtml&&afterHtml,isolated:liveReport?.isolated===true&&readingReport?.isolated===true,nodeUnavailable:liveReport?.node==='undefined',offline:!!offlineReport,persistentBytes:!!saved?.html,singleSenderDownload,receiverEmpty,compactReceiver,recoveredReceiver};
    this.write('RESULT.json',{checks,pass:Object.values(checks).every(Boolean),failedHeight,reports:{liveReport,readingReport,offlineReport,receiverReport}});
    await first.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
  }
}
