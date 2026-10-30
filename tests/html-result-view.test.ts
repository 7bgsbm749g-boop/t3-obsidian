import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {reference,tool} from './fixtures/html-result';

const runtime=createRequire(import.meta.url);
const bundled=build({stdin:{contents:"export * from './html-result-view'; export * from './html-result-store';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian','@codemirror/*']});
async function production(){
 const module={exports:{} as any};
 runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal:class{},MarkdownRenderChild:class{cleanup?:()=>void;register(cleanup:()=>void){this.cleanup=cleanup;}},setIcon:()=>{}}:runtime(id),TextEncoder,TextDecoder,URL,console});
 return module.exports;
}

// Small host-DOM fixture. Production store and view run
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
 const blobs=new Map<string,Blob>(),revoked:string[]=[],listeners=new Map();let created=0,parses=0;
 const doc:any={createElement:(tag:string)=>new Element(tag,doc),body:{classList:{contains:()=>false}}};
 doc.defaultView={getComputedStyle:()=>({getPropertyValue:()=>'',fontFamily:'sans-serif'}),navigator:{},addEventListener:(type:string,handler:any)=>listeners.set(type,handler),removeEventListener:(type:string)=>listeners.delete(type),
  ResizeObserver:class{observe(){}disconnect(){}},Blob,URL:{createObjectURL:(blob:Blob)=>{const url='blob:html-test-'+ ++created;blobs.set(url,blob);return url;},revokeObjectURL:(url:string)=>{blobs.delete(url);revoked.push(url);}},
  DOMParser:class{parseFromString(html:string){parses++;return {head:{prepend(){}},createElement:()=>({}),documentElement:{outerHTML:html}};}}};
 return {doc,blobs,revoked,listeners,get parses(){return parses;}};
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

test('HTML uses one native code processor with the same page identity and lifecycle',async()=>{
 const module=await production(),document=documentFixture(),views=new module.HtmlResultViews({workspace:{on:()=>({})}},{dispose(){}});
 let processor:any,extensions=0,mounts=0,disposed=0;const children:any[]=[];
 views.mount=(value:any,doc:any)=>{mounts++;assert.deepEqual(JSON.parse(JSON.stringify(value)),reference);assert.equal(doc,document.doc);return {root:new Element('div',doc),dispose:()=>{disposed++;}};};
 views.install({registerMarkdownCodeBlockProcessor:(language:string,callback:any)=>{assert.equal(language,'t3-html');assert.equal(processor,undefined);processor=callback;},registerEditorExtension:()=>{extensions++;},registerEvent(){},register(){}});
 assert.equal(extensions,0,'Native viewport and height caching must not compete with a second whole-note decoration field');
 const root=new Element('div',document.doc);processor(JSON.stringify(reference),root,{addChild:(child:any)=>children.push(child)});
 assert.equal(mounts,1);assert.equal(root.children.length,1);assert.equal(children.length,1);children[0].cleanup();assert.equal(disposed,1);
 const invalid=new Element('div',document.doc);processor('{}',invalid,{addChild:()=>assert.fail('Invalid references have no renderer')});assert.equal(mounts,1);assert.match(invalid.textContent,/Invalid T3 HTML reference/);
});

test('remounting a verified page reuses its prepared document and retains separate sandbox lifetimes',async()=>{
 const module=await production(),document=documentFixture();let html=page;
 const views=new module.HtmlResultViews({},{get:async()=>html,dispose(){}});
 const first=views.mount(reference,document.doc);await loaded(first.root);const firstUrl=first.root.find('iframe').src;first.dispose();
 const second=views.mount(reference,document.doc);await loaded(second.root);assert.equal(document.parses,1);assert.notEqual(second.root.find('iframe').src,firstUrl);assert.equal(document.blobs.size,1);
 html=page+'<p>New bytes</p>';const changed=views.mount(reference,document.doc);await loaded(changed.root);assert.equal(document.parses,2,'Changed verified bytes cannot reuse a different document');
 views.dispose();assert.equal(document.blobs.size,0);
});
