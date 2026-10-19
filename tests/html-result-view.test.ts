import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {EditorState,StateEffect,StateField} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {reference,tool} from './fixtures/html-result';
import {renderHtmlResult,type HtmlResultReference} from '../html-results';

const runtime=createRequire(import.meta.url),setLive=StateEffect.define<boolean>();
const live=StateField.define({create:()=>true,update:(value,tr)=>{for(const effect of tr.effects)if(effect.is(setLive))value=effect.value;return value;}});
const bundled=build({stdin:{contents:"export * from './html-result-view'; export * from './html-result-store';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian','@codemirror/*']});
async function production(){
 const module={exports:{} as any};
 runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal:class{},MarkdownRenderChild:class{},editorLivePreviewField:live,setIcon:()=>{}}:runtime(id),TextEncoder,TextDecoder,URL,console});
 return module.exports;
}

// Small host-DOM fixture. Production store, view and CodeMirror state field run
// unchanged; browser iframe execution still belongs to the native HTML lab.
class Element {
 children:Element[]=[];parent?:Element;dataset:Record<string,string>={};attrs:Record<string,string>={};events:Record<string,()=>void>={};
 style={height:'',colorScheme:''};className='';hidden=false;disabled=false;clientWidth=728;contentWindow={postMessage(){}};private text='';
 constructor(readonly tagName:string,readonly ownerDocument:any){}
 set textContent(text:string){this.text=text;this.empty();}get textContent():string{return this.text+this.children.map(child=>child.textContent).join(' ');}
 setAttribute(key:string,value:string){this.attrs[key]=value;}
 append(...elements:Element[]){for(const element of elements){element.parent=this;this.children.push(element);}}
 empty(){for(const child of this.children)child.parent=undefined;this.children=[];}
 replaceChildren(...elements:Element[]){this.empty();this.append(...elements);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=undefined;}
 createEl(tag:string,options:any={}){const element=new Element(tag,this.ownerDocument);element.className=options.cls??'';element.textContent=options.text??'';for(const [key,value] of Object.entries(options.attr??{}))element.setAttribute(key,String(value));this.append(element);return element;}
 createDiv(options:any={}){return this.createEl('div',options);}createSpan(options:any={}){return this.createEl('span',options);}
 addEventListener(name:string,callback:()=>void){this.events[name]=callback;}
 click(){if(!this.disabled)this.events.click?.();}
 find(tag:string):Element|undefined{return this.children.find(child=>child.tagName===tag)??this.children.map(child=>child.find(tag)).find(Boolean);}
 button(text:string):Element|undefined{return this.children.find(child=>child.tagName==='button'&&child.textContent===text)??this.children.map(child=>child.button(text)).find(Boolean);}
}
function documentFixture(){
 const blobs=new Map<string,Blob>(),revoked:string[]=[],listeners=new Map();let created=0;
 const doc:any={createElement:(tag:string)=>new Element(tag,doc),body:{classList:{contains:()=>false}}};
 doc.defaultView={getComputedStyle:()=>({getPropertyValue:()=>'',fontFamily:'sans-serif'}),navigator:{},addEventListener:(type:string,handler:any)=>listeners.set(type,handler),removeEventListener:(type:string)=>listeners.delete(type),
  ResizeObserver:class{observe(){}disconnect(){}},Blob,URL:{createObjectURL:(blob:Blob)=>{const url='blob:html-test-'+ ++created;blobs.set(url,blob);return url;},revokeObjectURL:(url:string)=>{blobs.delete(url);revoked.push(url);}},
  DOMParser:class{parseFromString(html:string){return {head:{prepend(){}},createElement:()=>({}),documentElement:{outerHTML:html}};}}};
 return {doc,blobs,revoked,listeners};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function loaded(root:Element){for(let i=0;root.dataset.t3HtmlState==='loading'&&i<30;i++)await flush();assert.notEqual(root.dataset.t3HtmlState,'loading');}
const page='<!doctype html><button>Page control</button>',bytes=new TextEncoder().encode(page).buffer;
function device(module:any){
 const cache=new Map();let online=true,attempts=0,downloads=0,invalid=false,signIn=false;
 class SignInRequired extends Error {}
 const store=new module.HtmlResultStore({read:async(key:string)=>cache.get(key),write:async(key:string,value:any)=>{cache.set(key,value);}},async()=>{
  attempts++;if(signIn)throw new SignInRequired('private account session');if(!online)throw Error('private connection URL');
  return {origin:'https://fixture.test',api:async(route:string)=>route==='/api/orchestration/turn-item'?(invalid?{...tool(),runId:'wrong'}:tool()):{relativeUrl:'/api/assets/page',expiresAt:Date.now()+60_000}};
 },async()=>{downloads++;return {status:200,mimeType:'text/html',bytes};},{isSignInError:(error:unknown)=>error instanceof SignInRequired});
 return {store,cache,get attempts(){return attempts;},get downloads(){return downloads;},online(value:boolean){online=value;},signIn(value:boolean){signIn=value;},invalid(){invalid=true;}};
}

test('a cold receiver shows a compact connection state and recovers once after host access returns',async()=>{
 const module=await production(),sender=device(module),receiver=device(module),document=documentFixture();
 await sender.store.get(reference);receiver.online(false);
 const views=new module.HtmlResultViews({},receiver.store),mounted=views.mount({...reference,height:2000,heights:undefined},document.doc),root=mounted.root as Element;
 assert.equal(root.style.height,'auto');assert.equal(root.dataset.t3HtmlState,'loading');assert.match(root.textContent,/on this device/);assert.equal(root.attrs['aria-busy'],'true');
 await loaded(root);assert.equal(root.dataset.t3HtmlState,'failed');assert.equal(root.dataset.t3HtmlError,'connection');assert.equal(root.style.height,'auto');assert.match(root.textContent,/Cannot connect/);assert.equal(root.button('Retry')?.disabled,false);
 assert.equal(root.find('iframe'),undefined);assert.equal(receiver.cache.size,0);assert.equal(sender.downloads,1);
 for(let i=0;i<3;i++)await flush();assert.equal(receiver.attempts,1,'failed viewers must not poll');
 await views.recover('another-environment');assert.equal(receiver.attempts,1);
 await Promise.all([views.recover(reference.environmentId),views.recover(reference.environmentId)]);assert.equal(receiver.attempts,2,'concurrent recovery attempts share one load');
 assert.equal(root.dataset.t3HtmlState,'failed');receiver.online(true);
 await views.recover(reference.environmentId);assert.equal(root.dataset.t3HtmlState,'ready');assert.equal(root.style.height,'2000px');
 const frame=root.find('iframe');assert.ok(frame);assert.equal(frame.attrs.sandbox,'allow-scripts allow-forms');assert.equal(root.attrs['aria-busy'],'false');assert.equal(root.dataset.t3HtmlError,undefined);
 assert.equal(receiver.downloads,1);assert.notEqual(receiver.cache,sender.cache);
 await views.recover();assert.equal(root.find('iframe'),frame);assert.equal(receiver.downloads,1);
 mounted.dispose();assert.equal(document.blobs.size,0);assert.equal(document.revoked.length,1);assert.equal(document.listeners.size,0);views.dispose();
});

test('two mounted viewers share recovery; sign-in uses only the explicit host callback',async()=>{
 const module=await production(),receiver=device(module),document=documentFixture();receiver.signIn(true);const signIns:string[]=[];
 const views=new module.HtmlResultViews({},receiver.store,{onSignIn:async(environmentId:string)=>{signIns.push(environmentId);receiver.signIn(false);await views.recover(environmentId);}});
 const reading=views.mount(reference,document.doc),editor=views.mount(reference,document.doc),roots=[reading.root,editor.root] as Element[];
 await Promise.all(roots.map(loaded));assert.equal(receiver.attempts,1);assert.equal(receiver.downloads,0);
 for(const root of roots){assert.equal(root.style.height,'auto');assert.equal(root.dataset.t3HtmlError,'sign-in');assert.match(root.textContent,/Sign in to T3/);assert.doesNotMatch(root.textContent,/private/);assert.ok(root.button('Sign in'));}
 roots[0].button('Sign in')!.click();roots[0].button('Sign in')!.click();await flush();await Promise.all(roots.map(loaded));
 assert.deepEqual(signIns,[reference.environmentId]);assert.equal(receiver.attempts,2);assert.equal(receiver.downloads,1);assert.ok(roots.every(root=>root.dataset.t3HtmlState==='ready'));
 views.dispose();assert.equal(document.blobs.size,0);
});

test('manual Retry works without a sign-in callback and verification failures never auto-retry',async()=>{
 const module=await production(),receiver=device(module),document=documentFixture();receiver.signIn(true);
 const views=new module.HtmlResultViews({},receiver.store),mounted=views.mount(reference,document.doc),root=mounted.root as Element;
 await loaded(root);assert.equal(root.button('Sign in'),undefined);receiver.signIn(false);receiver.invalid();root.button('Retry')!.click();await loaded(root);
 assert.equal(root.dataset.t3HtmlError,'verification');assert.equal(root.style.height,'auto');assert.match(root.textContent,/could not verify/);
 const attempts=receiver.attempts;await views.recover();assert.equal(receiver.attempts,attempts);assert.equal(receiver.downloads,0);views.dispose();
});

test('disposed viewers cannot publish a pending download or respond to recovery',async()=>{
 const module=await production(),document=documentFixture();let finish!:(value:string)=>void,gets=0;
 const views=new module.HtmlResultViews({},{get:()=>{gets++;return new Promise<string>(resolve=>{finish=resolve;});},dispose(){}}),mounted=views.mount(reference,document.doc);
 mounted.dispose();finish(page);await flush();await views.recover();assert.equal(gets,1);assert.equal(document.blobs.size,0);assert.equal(mounted.root.find('iframe'),undefined);views.dispose();
});

test('access recovery during a pending cold load retries its later auth failure once across mounts',async()=>{
 const module=await production(),document=documentFixture();let reject!:(error:unknown)=>void,attempts=0,downloads=0;
 const oldAccess=new Promise<never>((_,fail)=>{reject=fail;});
 const store=new module.HtmlResultStore({read:async()=>undefined,write:async()=>{}},async()=>{
  if(++attempts===1)return oldAccess;
  return {origin:'https://fixture.test',api:async(route:string)=>route==='/api/orchestration/turn-item'?tool():{relativeUrl:'/api/assets/page',expiresAt:Date.now()+60_000}};
 },async()=>{downloads++;return {status:200,mimeType:'text/html',bytes};});
 const views=new module.HtmlResultViews({},store),mounts=[views.mount(reference,document.doc),views.mount(reference,document.doc)];
 await flush();assert.equal(attempts,1);
 const recoveries=[views.recover(reference.environmentId),views.recover(reference.environmentId)];
 await flush();assert.equal(attempts,1,'recovery waits for the old pending request');
 reject(new module.HtmlResultError('sign-in','access'));await Promise.all(recoveries);await flush();
 assert.equal(attempts,2);assert.equal(downloads,1);assert.ok(mounts.every(mounted=>mounted.root.dataset.t3HtmlState==='ready'));
 const frames=mounts.map(mounted=>mounted.root.find('iframe'));await views.recover();assert.equal(attempts,2);
 assert.deepEqual(mounts.map(mounted=>mounted.root.find('iframe')),frames);views.dispose();
});

test('pending recovery is bounded and cannot retry a success, a verification failure, or a disposed view',async()=>{
 const module=await production();
 for(const outcome of ['ready','sign-in','connection','http','verification','disposed']){
  const document=documentFixture();let resolve!:(html:string)=>void,reject!:(error:unknown)=>void,gets=0;
  const pending=new Promise<string>((pass,fail)=>{resolve=pass;reject=fail;});
  const views=new module.HtmlResultViews({},{get:()=>{gets++;return gets===1?pending:gets===2?Promise.reject(new module.HtmlResultError('sign-in','access')):Promise.resolve(page);},dispose(){}});
  const mounted=views.mount(reference,document.doc),recoveries=[views.recover(),views.recover()];
  if(outcome==='disposed')mounted.dispose();
  if(outcome==='ready')resolve(page);else reject(new module.HtmlResultError(outcome==='disposed'?'sign-in':outcome,'access'));
  await Promise.all(recoveries);for(let i=0;i<3;i++)await flush();
  const retries=['sign-in','connection','http'].includes(outcome);
  assert.equal(gets,retries?2:1,outcome+' must consume at most one queued recovery');
  if(retries){
   assert.equal(mounted.root.dataset.t3HtmlState,'failed');assert.equal(mounted.root.dataset.t3HtmlError,'sign-in');assert.ok(mounted.root.button('Retry'));
   await views.recover();assert.equal(gets,3,'a later access transition can recover a failed one-shot retry');assert.equal(mounted.root.dataset.t3HtmlState,'ready');
  }
  views.dispose();assert.equal(document.blobs.size,0);
 }
});

async function editorFixture(){
 const module=await production(),views=new module.HtmlResultViews({workspace:{on:()=>({})}},{dispose(){}});let extension:any;
 views.install({registerMarkdownCodeBlockProcessor(){},registerEditorExtension:(value:any)=>{extension=value;},registerEvent(){},register(){}});
 const state=(text:string)=>EditorState.create({doc:text,extensions:[live,extension]});
 const ranges=(state:EditorState)=>{const sets=state.facet(EditorView.decorations),rows:Array<{from:number;to:number;widget:any}>=[];for(const set of sets)if(typeof set!=='function')set.between(0,state.doc.length,(from,to,value)=>{rows.push({from,to,widget:value.spec.widget});});return rows;};
 return {state,ranges};
}

test('production state field removes and restores an HTML widget when a plain line becomes a list',async()=>{
 const f=await editorFixture(),text='abc\n\n   '+renderHtmlResult(reference)+'\n\nAfter';
 let state=f.state(text);assert.equal(f.ranges(state).length,1);
 state=state.update({changes:{from:0,to:3,insert:'- a'}}).state;assert.equal(f.ranges(state).length,0,'the indented fence now belongs to a list');
 state=state.update({changes:{from:0,to:3,insert:'abc'}}).state;assert.equal(f.ranges(state).length,1,'the fence is top-level again');
});

test('production state field handles plain letters changing an HTML block separator',async()=>{
 const f=await editorFixture();let state=f.state('<div>\n\n'+renderHtmlResult(reference)+'\n\nAfter');assert.equal(f.ranges(state).length,1);
 state=state.update({changes:{from:6,insert:'word'}}).state;assert.equal(f.ranges(state).length,0,'the reference is inside the HTML block');
 state=state.update({changes:{from:6,to:10,insert:''}}).state;assert.equal(f.ranges(state).length,1);
});

test('production state field preserves equivalent widgets through normal typing, newline, mode changes and restoration',async()=>{
 const f=await editorFixture(),text='Before\n\n'+renderHtmlResult(reference)+'\n\nAfter';let state=f.state(text);
 const original=f.ranges(state)[0];assert.equal(original.widget.estimatedHeight,80);
 for(const insert of ['Normal text. ','\n']){state=state.update({changes:{from:0,insert}}).state;const next=f.ranges(state)[0];assert.ok(next.widget.eq(original.widget));assert.equal(state.doc.sliceString(next.from,next.to),renderHtmlResult(reference));}
 state=state.update({effects:setLive.of(false)}).state;assert.equal(f.ranges(state).length,0);assert.match(state.doc.toString(),/```t3-html/);
 state=state.update({effects:setLive.of(true)}).state;assert.equal(f.ranges(state).length,1);
 const range=f.ranges(state)[0];state=state.update({changes:{from:range.from,to:range.to,insert:'Plain text'}}).state;assert.equal(f.ranges(state).length,0);
 state=state.update({changes:{from:range.from,to:range.from+'Plain text'.length,insert:renderHtmlResult(reference)}}).state;assert.equal(f.ranges(state).length,1);
});

test('production state field does not mount literal, nested or incomplete references',async()=>{
 const f=await editorFixture(),block=renderHtmlResult(reference);
 for(const text of ['````md\n'+block+'\n````','> '+block.split('\n').join('\n> '),'```t3-html\n'+JSON.stringify(reference),'```t3-html\n{}\n```'])assert.equal(f.ranges(f.state(text)).length,0);
 const changed:HtmlResultReference={...reference,revision:'2026-10-19T01:00:00Z'},state=f.state(block),updated=state.update({changes:{from:0,to:block.length,insert:renderHtmlResult(changed)}}).state;
 assert.equal(f.ranges(updated).length,1);assert.equal(f.ranges(updated)[0].widget.eq(f.ranges(state)[0].widget),false,'revision changes cannot reuse a different immutable page');
});
