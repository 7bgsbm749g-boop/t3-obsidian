import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';

const runtime=createRequire(import.meta.url);
const bundled=build({entryPoints:['src/responses/image-result-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']});
const reference={version:1,environmentId:'env',threadId:'thread',runId:'run',itemId:'tool',source:{kind:'file',path:'/evidence/capture.png'}};
class Element {
 children:Element[]=[];text='';attrs:Record<string,string>={};events:Record<string,()=>void>={};
 constructor(public tag='div',public ownerDocument:any={defaultView:{URL}}){}
 addClass(){}empty(){this.children=[];}createEl(tag:string,options:any={}){const element=new Element(tag,this.ownerDocument);element.text=options.text??'';element.attrs=options.attr??{};this.children.push(element);return element;}
 addEventListener(event:string,callback:()=>void){this.events[event]=callback;}
}
async function fixture(get:(value:any)=>Promise<any>){
 const cleanups:Array<()=>void>=[],children:any[]=[],revoked:string[]=[],created:string[]=[],modals:any[]=[];
 let processor:any;
 class Child {callbacks:Array<()=>void>=[];register(callback:()=>void){this.callbacks.push(callback);}unload(){for(const callback of this.callbacks)callback();}}
 class Modal {contentEl=new Element();opened=false;closed=false;constructor(){modals.push(this);}setTitle(){}open(){this.opened=true;}close(){this.closed=true;}}
 const module={exports:{} as any};runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{MarkdownRenderChild:Child,Modal}:runtime(id),URL,Blob,TextEncoder,TextDecoder});
 const document={defaultView:{URL:{createObjectURL:()=>{const url='blob:image-'+created.length;created.push(url);return url;},revokeObjectURL:(url:string)=>revoked.push(url)}}};
 const root=new Element('div',document);let disposed=false;
 module.exports.installImageResults({}, {register:(callback:()=>void)=>cleanups.push(callback),registerMarkdownCodeBlockProcessor:(language:string,callback:any)=>{assert.equal(language,'t3-image');processor=callback;}},{get,dispose:()=>{disposed=true;}});
 processor(JSON.stringify(reference),root,{addChild:(child:any)=>children.push(child)});
 return {root,children,revoked,created,modals,unload:()=>{children.forEach(child=>child.unload());cleanups.forEach(cleanup=>cleanup());},get disposed(){return disposed;}};
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('native processor displays a tool image, opens it, and releases its modal and URL',async()=>{
 const f=await fixture(async value=>{assert.deepEqual(JSON.parse(JSON.stringify(value)),reference);return {bytes:new ArrayBuffer(8),mimeType:'image/png'};});await flush();
 assert.equal(f.root.children[0].tag,'button');const button=f.root.children[0];assert.equal(button.children[0].attrs.src,'blob:image-0');assert.equal(button.children[0].attrs.alt,'capture.png');
 button.events.click();assert.equal(f.modals[0].opened,true);assert.equal(f.modals[0].contentEl.children[0].attrs.src,'blob:image-0');
 f.unload();assert.deepEqual(f.revoked,['blob:image-0']);assert.equal(f.modals[0].closed,true);assert.equal(f.disposed,true);
});
test('a failed image offers retry without rendering private errors',async()=>{
 let attempts=0;const f=await fixture(async()=>{if(++attempts===1)throw Error('private-token https://private.example');return {bytes:new ArrayBuffer(8),mimeType:'image/png'};});await flush();
 assert.doesNotMatch(f.root.children[0].text,/private/);assert.equal(f.root.children[1].text,'Retry image');f.root.children[1].events.click();await flush();assert.equal(f.root.children[0].tag,'button');assert.equal(attempts,2);f.unload();
});
test('a render disposed during download never creates a URL or changes the removed view',async()=>{
 let resolve!:(result:any)=>void;const pending=new Promise(done=>{resolve=done;});const f=await fixture(()=>pending);f.unload();resolve({bytes:new ArrayBuffer(8),mimeType:'image/png'});await flush();assert.equal(f.created.length,0);assert.equal(f.root.children[0].text,'Loading image…');
});
