import type {Extension,StateField} from '@codemirror/state';
import type {EditorView,ViewUpdate} from '@codemirror/view';
import type {MarkdownFileInfo} from 'obsidian';
import {replyReferences} from './reply-assets';
const sourceCache=new Map<string,ReturnType<typeof replyReferences>>();
let cachedCharacters=0,sourceParses=0;
const maxSourceCharacters=1_048_576;
export function mediaSourceCacheStatus(){return {entries:sourceCache.size,characters:cachedCharacters,sourceParses,maxCharacters:maxSourceCharacters};}

export function originalMediaSource(markdown:string,alt:string|null,section?:{lineStart:number;lineEnd:number}){
  if(section){let start=0,end=0;for(let line=0;line<=section.lineEnd;line++){if(line===section.lineStart)start=end;const next=markdown.indexOf('\n',end);end=next<0?markdown.length:next+1;if(next<0)break;}markdown=markdown.slice(start,end);}
  if(markdown.length>8192||!markdown.includes('!['))return;
  let references=sourceCache.get(markdown);
  if(references){sourceCache.delete(markdown);sourceCache.set(markdown,references);}
  else{
    sourceParses++;references=replyReferences(markdown).filter(reference=>reference.image);sourceCache.set(markdown,references);cachedCharacters+=markdown.length;
    while(sourceCache.size>128||cachedCharacters>maxSourceCharacters){const first=sourceCache.keys().next().value!;sourceCache.delete(first);cachedCharacters-=first.length;}
  }
  const matching=references.filter(reference=>reference.label===alt);
  return (matching.length===1?matching[0]:references.length===1?references[0]:undefined)?.source;
}

/** Recover a native file reference on desktop, iOS and Android. Web images stay web images. */
export function nativeMediaSource(rendered:string,vaultResourceRoot?:string):{link:string;vaultRelative?:string}|undefined {
  const root=vaultResourceRoot?.replace(/\/$/,'');
  try{
    if(root&&rendered.startsWith(root+'/')){const link=decodeURIComponent(rendered.slice(root.length+1).split(/[?#]/)[0]);return {link,vaultRelative:link};}
    if(/^app:\/\//i.test(rendered)){new URL(rendered);return {link:decodeURIComponent(rendered.replace(/^app:\/\/[^/]+/i,'').split('?')[0])};}
    const url=/^[a-z][a-z0-9+.-]*:/i.test(rendered)&&! /^[a-z]:[\\/]/i.test(rendered)?new URL(rendered):undefined;
    if(url&&['capacitor:','ionic:','http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1'].includes(url.hostname)){
      const match=/^\/_(?:capacitor|app)_file_(\/.*)$/.exec(url.pathname);
      if(match)return {link:decodeURIComponent(match[1])+url.hash};
    }
    if(url&&!['file:','sandbox:'].includes(url.protocol))return undefined;
    return {link:rendered};
  }catch{return undefined;}
}

type MediaRender=(root:HTMLElement,source:string,original:(image:Element)=>string|undefined,current:()=>boolean)=>Promise<void>;
/** Observe only this editor's rendered viewport; never the vault or document body. */
export function codebaseMediaExtension(info:StateField<MarkdownFileInfo>,render:MediaRender):Extension {
  const {ViewPlugin}=require('@codemirror/view') as typeof import('@codemirror/view');
  return ViewPlugin.fromClass(class {
    private stopped=false;
    private queued=false;
    private rendering=false;
    private again=false;
    private observer:MutationObserver;
    constructor(private view:EditorView){
      const Observer=view.dom.ownerDocument.defaultView!.MutationObserver;
      this.observer=new Observer((records=[])=>{if(!records.length||records.some(record=>record.type!=='attributes'||nativeMediaSource((record.target as Element).getAttribute('src')??'')))this.schedule();});
      this.observer.observe(view.contentDOM,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
      this.schedule();
    }
    update(update:ViewUpdate){if(update.docChanged||update.viewportChanged||update.startState.field(info,false)?.file?.path!==update.state.field(info,false)?.file?.path)this.schedule();}
    private schedule(){
      if(this.stopped)return;if(this.rendering){this.again=true;return;}if(this.queued)return;this.queued=true;
      queueMicrotask(()=>{
        this.queued=false;if(this.stopped)return;
        const source=this.view.state.field(info,false)?.file?.path,document=this.view.state.doc;if(!source)return;
        const current=()=>!this.stopped&&this.view.state.doc===document&&this.view.state.field(info,false)?.file?.path===source;
        const original=(image:Element)=>{try{
          const line=this.view.state.doc.lineAt(this.view.posAtDOM(image)).text;
          return originalMediaSource(line,image.getAttribute('alt'));
        }catch{return undefined;}};
        this.rendering=true;
        void render(this.view.contentDOM,source,original,current).catch(()=>{}).finally(()=>{this.rendering=false;if(this.again){this.again=false;this.schedule();}});
      });
    }
    destroy(){this.stopped=true;this.observer.disconnect();}
  });
}
