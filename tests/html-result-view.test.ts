import {installDomFactories} from './dom-factories';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {createRequire} from 'node:module';
import {reference,tool} from './fixtures/html-result';

const runtime=createRequire(import.meta.url);
const bundled=build({stdin:{contents:"export * from './src/responses/html-result-view'; export * from './src/responses/html-result-store';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian','@codemirror/*']});
async function production(modal?:any){
 const module={exports:{} as any};
 runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal:modal??class{},MarkdownRenderChild:class{cleanup?:()=>void;register(cleanup:()=>void){this.cleanup=cleanup;}},setIcon:()=>{}}:runtime(id),TextEncoder,TextDecoder,URL,console,queueMicrotask});
 return module.exports;
}

// Small host-DOM fixture. Production store and view run
// unchanged; browser iframe execution still belongs to the native HTML lab.
class Element {
 children:Element[]=[];parent?:Element;dataset:Record<string,string>={};attrs:Record<string,string>={};events:Record<string,()=>void>={};
 style:Record<string,string>=new Proxy({height:'',colorScheme:''},{set:(target:Record<string,string>,key:string,value:string)=>{target[key]=value;this.attribute('style');return true;}});
 private classes='';hidden=false;disabled=false;clientWidth=728;loading='';messages:any[]=[];contentWindow={postMessage:(message:any)=>this.messages.push(message)};private text='';
 get className(){return this.classes;}set className(value:string){this.classes=value;this.attribute('class');}
 classList={
  add:(name:string)=>{if(!this.classList.contains(name))this.className=(this.className+' '+name).trim();},
  remove:(name:string)=>{this.className=this.className.split(' ').filter(value=>value!==name).join(' ');},
  contains:(name:string)=>this.className.split(' ').includes(name),
  toggle:(name:string,force:boolean)=>{if(force)this.classList.add(name);else if(this.classList.contains(name))this.classList.remove(name);},
 };
 private attribute(attributeName:string){this.ownerDocument.mutate?.({type:'attributes',target:this,attributeName});}
 get parentElement(){return this.parent;}
 get isConnected():boolean{return this===this.ownerDocument.documentElement||!!this.parent?.isConnected;}
 getBoundingClientRect(){return {top:100,bottom:300,height:200,width:728,left:0,right:728};}
 contains(element:Element):boolean{return this===element||this.children.some(child=>child.contains(element));}
 closest(selector:string):Element|null{return this.classList.contains(selector.slice(1))?this:this.parent?.closest(selector)??null;}
 constructor(readonly tagName:string,readonly ownerDocument:any){}
 set textContent(text:string){this.text=text;this.empty();}get textContent():string{return this.text+this.children.map(child=>child.textContent).join(' ');}
 setAttribute(key:string,value:string){this.attrs[key]=value;}
 append(...elements:Element[]){for(const element of elements){element.remove();element.parent=this;this.children.push(element);this.ownerDocument.mutate?.({type:'childList',target:this,addedNodes:[element],removedNodes:[]});}}
 empty(){for(const child of [...this.children])child.remove();}
 replaceChildren(...elements:Element[]){this.empty();this.append(...elements);}
 remove(){const parent=this.parent;if(parent){parent.children=parent.children.filter(child=>child!==this);this.parent=undefined;this.ownerDocument.mutate?.({type:'childList',target:parent,addedNodes:[],removedNodes:[this]});}}
 createEl(tag:string,options:any={}){const element=new Element(tag,this.ownerDocument);element.className=options.cls??'';element.textContent=options.text??'';for(const [key,value] of Object.entries(options.attr??{}))element.setAttribute(key,String(value));this.append(element);return element;}
 createDiv(options:any={}){return this.createEl('div',options);}createSpan(options:any={}){return this.createEl('span',options);}
 addEventListener(name:string,callback:()=>void){this.events[name]=callback;}
 click(){if(!this.disabled)this.events.click?.();}
 find(tag:string):Element|undefined{return this.children.find(child=>child.tagName===tag)??this.children.map(child=>child.find(tag)).find(Boolean);}
 button(text:string):Element|undefined{return this.children.find(child=>child.tagName==='button'&&child.textContent===text)??this.children.map(child=>child.button(text)).find(Boolean);}
}
function documentFixture(){
 const blobs=new Map<string,Blob>(),revoked:string[]=[],listeners=new Map();let created=0,parses=0,styleReads=0;
 const observers=new Set<Observer>();
 class Observer {
  targets=new Map<Element,any>();records:any[]=[];queued=false;
  constructor(readonly callback:(records:any[])=>void){observers.add(this);}
  observe(target:Element,options:any){this.targets.set(target,options);}
  disconnect(){this.targets.clear();this.records=[];}
  enqueue(record:any){
   const matches=[...this.targets].some(([target,options])=>(target===record.target||(options.subtree&&target.contains(record.target)))&&
    (record.type==='attributes'?options.attributes&&(!options.attributeFilter||options.attributeFilter.includes(record.attributeName)):options.childList));
   if(!matches)return;this.records.push(record);
   if(!this.queued){this.queued=true;queueMicrotask(()=>{this.queued=false;const records=this.records.splice(0);if(records.length)this.callback(records);});}
  }
 }
 const doc:any={createElement:(tag:string)=>new Element(tag,doc),mutate:(record:any)=>{for(const observer of observers)observer.enqueue(record);}};
 doc.documentElement=new Element('html',doc);doc.body=new Element('body',doc);doc.documentElement.append(doc.body);
 const inherited=(element:Element,name:string):string=>element.style[name]||(element.parent?inherited(element.parent,name):'');
 doc.defaultView={getComputedStyle:(element:Element)=>{styleReads++;return {backgroundColor:element.style.backgroundColor||'rgba(0, 0, 0, 0)',getPropertyValue:(name:string)=>inherited(element,name),fontFamily:inherited(element,'fontFamily')||'sans-serif'};},navigator:{},addEventListener:(type:string,handler:any)=>listeners.set(type,handler),removeEventListener:(type:string)=>listeners.delete(type),
  MutationObserver:Observer,ResizeObserver:class{observe(){}disconnect(){}},Blob,URL:{createObjectURL:(blob:Blob)=>{const url='blob:html-test-'+ ++created;blobs.set(url,blob);return url;},revokeObjectURL:(url:string)=>{blobs.delete(url);revoked.push(url);}},
  DOMParser:class{parseFromString(html:string){parses++;return {head:{children:[],prepend(){}},documentElement:{outerHTML:html}};}}};
 installDomFactories(doc);return {doc,blobs,revoked,listeners,observers,get parses(){return parses;},get styleReads(){return styleReads;}};
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

test('selected HTML preparation verifies and caches inert bytes without starting a frame',async()=>{
 const module=await production(),receiver=device(module),document=documentFixture(),views=new module.HtmlResultViews({},receiver.store);
 await views.prefetch(reference,document.doc);assert.equal(receiver.downloads,1);assert.equal(document.blobs.size,0);assert.equal(document.listeners.size,0);const parses=document.parses;assert.ok(parses>0);
 const mounted=views.mount(reference,document.doc);await loaded(mounted.root);assert.equal(receiver.downloads,1);assert.equal(document.parses,parses);assert.equal(document.blobs.size,1);views.dispose();assert.equal(document.blobs.size,0);
});

test('disposing during selected HTML preparation prevents late document preparation',async()=>{
 const module=await production(),document=documentFixture();let finish!:(html:string)=>void;
 const views=new module.HtmlResultViews({},{get:()=>new Promise<string>(resolve=>{finish=resolve;}),dispose(){}}),pending=views.prefetch(reference,document.doc);views.dispose();finish(page);await pending;
 assert.equal(document.parses,0);assert.equal(document.blobs.size,0);
});

test('visible HTML frames start eagerly while off-screen and unattached result runtimes stay lazy',async()=>{
 const module=await production();
 for(const [position,connected,eager] of [[100,true,true],[1000,true,false],[100,false,false]] as const){
  const receiver=device(module),document=documentFixture();document.doc.defaultView.innerHeight=800;document.doc.defaultView.innerWidth=1200;
  const views=new module.HtmlResultViews({},receiver.store),mounted=views.mount(reference,document.doc),root=mounted.root as Element;
  Object.defineProperty(root,'isConnected',{value:connected});Object.assign(root,{getBoundingClientRect:()=>({top:position,bottom:position+200,height:200,width:728,left:0,right:728})});
  await loaded(root);assert.equal(root.find('iframe')!.loading,eager?'eager':'lazy');views.dispose();
 }
});

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

test('inline frames grow and shrink to live content beyond saved caps without needing focus',async()=>{
 const module=await production(),document=documentFixture();
 const views=new module.HtmlResultViews({},{get:async()=>page,dispose(){}});
 const mounted=views.mount({...reference,height:200,heights:undefined},document.doc),root=mounted.root as Element;
 await loaded(root);const frame=root.find('iframe')!,receive=document.listeners.get('message');
 const report=(height:number,source:any=frame.contentWindow)=>receive({source,data:{jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height}}});
 assert.equal(root.style.height,'200px');
 report(6000,{});assert.equal(root.style.height,'200px','other frames cannot resize this result');
 report(6000.2);assert.equal(root.style.height,'6001px');
 report(1200);assert.equal(root.style.height,'1200px','shorter content releases the extra note space');
 for(const invalid of [0,-1,NaN,Infinity]){report(invalid);assert.equal(root.style.height,'1200px');}
 mounted.dispose();
 const expanded=views.mount(reference,document.doc,true);await loaded(expanded.root);
 document.listeners.get('message')({source:expanded.root.find('iframe').contentWindow,data:{jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:9000}}});
 assert.equal(expanded.root.style.height,'100%','the separate expanded viewer retains its viewport');
 views.dispose();
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
 const second=views.mount(reference,document.doc);await loaded(second.root);assert.equal(document.parses,2);assert.notEqual(second.root.find('iframe').src,firstUrl);assert.equal(document.blobs.size,1);
 html=page+'<p>New bytes</p>';const changed=views.mount(reference,document.doc);await loaded(changed.root);assert.equal(document.parses,4,'Changed verified bytes cannot reuse a different document');
 views.dispose();assert.equal(document.blobs.size,0);
});
test('passive previews cannot take focus, submit forms, open links or expand the viewer',async()=>{
 const module=await production(),document=documentFixture(),receiver=device(module);
 const views=new module.HtmlResultViews({},receiver.store),mounted=views.mount(reference,document.doc,false,undefined,{passive:true}),root=mounted.root as Element;
 await loaded(root);const frame=root.find('iframe') as any;
 assert.equal(frame.attrs.sandbox,'allow-scripts');assert.equal(frame.inert,true);assert.equal(frame.tabIndex,-1);assert.equal(frame.loading,'eager');
 assert.equal(root.find('button'),undefined);assert.equal(root.dataset.t3HtmlPainted,undefined,'mounting is not paint evidence');
 document.listeners.get('message')({source:frame.contentWindow,data:{jsonrpc:'2.0',method:'t3/notifications/preview-painted'}});
 assert.equal(root.dataset.t3HtmlPainted,'true');views.dispose();assert.equal(document.blobs.size,0);assert.equal(document.listeners.size,0);
});
test('passive crops bound live full-page sizing without changing ordinary note viewers',async()=>{
 const module=await production(),document=documentFixture(),receiver=device(module);
 const views=new module.HtmlResultViews({},receiver.store),mounted=views.mount(reference,document.doc,false,undefined,{passive:true}),root=mounted.root as Element;
 await loaded(root);const frame=root.find('iframe')!;
 document.listeners.get('message')({source:frame.contentWindow,data:{jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:25_000}}});
 assert.ok(parseInt(root.style.height)<=reference.height);views.dispose();
});

const bootstrapTheme=(frame:any)=>JSON.parse(decodeURIComponent(frame.src.split('#t3-theme=')[1]));
const latestTheme=(frame:Element)=>frame.messages.at(-1).params;
function noteSurface(doc:any,mode='reading'){
 const leaf=doc.body.createDiv({cls:'workspace-leaf-content'});
 const view=leaf.createDiv({cls:mode==='reading'?'markdown-reading-view':'markdown-source-view mod-cm6'});
 const surface=view.createDiv({cls:mode==='reading'?'markdown-preview-view':'cm-editor'});
 const host=surface.createDiv({cls:mode==='reading'?'block-language-t3-html':'cm-preview-code-block'});
 return {leaf,view,surface,host};
}

test('HTML bootstrap uses each mounted note surface through transparent wrappers in both native processor modes',async()=>{
 const module=await production();
 for(const mode of ['reading','live-preview'])for(const dark of [false,true])for(const colored of [false,true]){
  const document=documentFixture(),doc=document.doc,body=doc.body as Element;
  body.classList.toggle('theme-dark',dark);body.style['--background-primary']=dark?'#181818':'#ffffff';body.style['--text-normal']=dark?'#dddddd':'#222222';body.style.fontFamily='Theme font';
  const {leaf,host,view,surface}=noteSurface(doc,mode);
  leaf.style.backgroundColor=colored?'color(srgb 0.45 1 1)':dark?'rgb(24, 24, 24)':'rgb(255, 255, 255)';
  leaf.style['--text-normal']='#123456';view.style.backgroundColor='transparent';surface.style.backgroundColor='rgb(10 20 30 / 0%)';host.style.backgroundColor='rgba(10, 20, 30, 0)';
  const views=new module.HtmlResultViews({},{get:async()=>page,dispose(){}}),mounted=views.mount(reference,doc);host.append(mounted.root);await loaded(mounted.root);
  const frame=mounted.root.find('iframe'),theme=bootstrapTheme(frame);
  assert.equal(theme.variables['--background'],leaf.style.backgroundColor,`${mode}/${dark}/${colored}`);
  assert.equal(theme.variables['--foreground'],'#123456');assert.equal(theme.variables['--font-sans'],'Theme font');
  assert.equal(theme.appearance,dark?'dark':'light');assert.equal(frame.style.colorScheme,theme.appearance);
  assert.equal(body.style['--background-primary'],dark?'#181818':'#ffffff','host theme tokens are unchanged');
  assert.equal(frame.attrs.sandbox,'allow-scripts allow-forms');
  assert.equal(host.classList.contains('send-to-t3-html-code-block'),mode==='live-preview');
  views.dispose();assert.equal(host.classList.contains('send-to-t3-html-code-block'),false);
 }
});

test('transparent notes fall back to the local background-primary; a rendered host background takes precedence',async()=>{
 const module=await production(),document=documentFixture(),doc=document.doc;
 doc.body.style['--background-primary']='#ffffff';const {host}=noteSurface(doc);host.style['--background-primary']='#eeeeee';
 const views=new module.HtmlResultViews({},{get:async()=>page,dispose(){}}),mounted=views.mount(reference,doc);host.append(mounted.root);await loaded(mounted.root);
 const frame=mounted.root.find('iframe');assert.equal(bootstrapTheme(frame).variables['--background'],'#eeeeee');
 mounted.root.style.backgroundColor='rgb(0, 0, 0)';await flush();assert.equal(latestTheme(frame).styles.variables['--background'],'rgb(0, 0, 0)','opaque black is not mistaken for zero alpha');
 mounted.root.style.backgroundColor='color(srgb 1 0 0 / 0)';await flush();assert.equal(latestTheme(frame).styles.variables['--background'],'#eeeeee');views.dispose();
});

test('late attachment and host moves refresh the existing frame and rebind local observers',async()=>{
 const module=await production(),document=documentFixture(),doc=document.doc;
 doc.body.style['--background-primary']='#ffffff';
 const first=noteSurface(doc,'live-preview'),second=noteSurface(doc);first.leaf.style.backgroundColor='rgb(200, 240, 240)';second.leaf.style.backgroundColor='rgb(240, 200, 240)';
 const views=new module.HtmlResultViews({},{get:async()=>page,dispose(){}}),mounted=views.mount(reference,doc),root=mounted.root as Element;
 await loaded(root);const frame=root.find('iframe')!;assert.equal(bootstrapTheme(frame).variables['--background'],'#ffffff');
 first.host.append(root);await flush();assert.equal(latestTheme(frame).styles.variables['--background'],first.leaf.style.backgroundColor);
 second.host.append(root);await flush();assert.equal(root.find('iframe'),frame);assert.equal(latestTheme(frame).styles.variables['--background'],second.leaf.style.backgroundColor);
 assert.equal(first.host.classList.contains('send-to-t3-html-code-block'),false);
 const count=frame.messages.length,reads=document.styleReads;first.leaf.style.backgroundColor='red';await flush();assert.equal(document.styleReads,reads);assert.equal(frame.messages.length,count);
 second.view.remove();await flush();doc.body.append(second.view);await flush();assert.equal(latestTheme(frame).styles.variables['--background'],'#ffffff','reattaching a whole surface uses its new chain');
 views.dispose();assert.ok([...document.observers].every(observer=>observer.targets.size===0));
});

test('local class/style updates and resets keep split HTML hosts independent without workspace css-change',async()=>{
 const module=await production(),document=documentFixture(),doc=document.doc;
 doc.body.style['--background-primary']='#ffffff';
 const first=noteSurface(doc),second=noteSurface(doc,'live-preview');first.leaf.style.backgroundColor='rgb(200, 240, 240)';second.leaf.style.backgroundColor='rgb(240, 200, 240)';
 const compute=doc.defaultView.getComputedStyle;
 doc.defaultView.getComputedStyle=(element:Element)=>({...compute(element),...(element.classList.contains('tinted')?{backgroundColor:'rgb(200, 200, 240)'}:{})});
 const views=new module.HtmlResultViews({},{get:async()=>page,dispose(){}}),mounts=[views.mount(reference,doc),views.mount(reference,doc)];
 first.host.append(mounts[0].root);second.host.append(mounts[1].root);await Promise.all(mounts.map(mounted=>loaded(mounted.root)));await flush();
 const frames=mounts.map(mounted=>mounted.root.find('iframe')),secondCount=frames[1].messages.length;
 first.leaf.classList.add('tinted');await flush();assert.equal(latestTheme(frames[0]).styles.variables['--background'],'rgb(200, 200, 240)');assert.equal(frames[1].messages.length,secondCount);
 first.leaf.classList.remove('tinted');first.leaf.style.backgroundColor='';await flush();assert.equal(latestTheme(frames[0]).styles.variables['--background'],'#ffffff');assert.equal(frames[1].messages.length,secondCount);
 // Ordinary note edits below the host are not theme events, and resize writes
 // do not send duplicate themes or reload the authored page.
 const reads=document.styleReads,count=frames[0].messages.length;
 first.host.createDiv({text:'Unrelated note edit'}).style.backgroundColor='red';second.host.createDiv();await flush();assert.equal(document.styleReads,reads);
 mounts[0].root.style.height='300px';await flush();assert.equal(frames[0].messages.length,count);assert.equal(mounts[0].root.find('iframe'),frames[0]);
 views.dispose();
});

test('body and document theme changes plus workspace CSS events update appearance, tokens and frame color scheme',async()=>{
 const module=await production(),document=documentFixture(),doc=document.doc;let cssChange!:()=>void;
 const views=new module.HtmlResultViews({workspace:{on:(name:string,callback:()=>void)=>{assert.equal(name,'css-change');cssChange=callback;return {};}}},{get:async()=>page,dispose(){}});
 views.install({registerMarkdownCodeBlockProcessor(){},registerEvent(){},register(){}});
 doc.body.style['--background-primary']='#ffffff';doc.body.style['--text-normal']='#222222';
 const {host}=noteSurface(doc),mounted=views.mount(reference,doc);host.append(mounted.root);await loaded(mounted.root);const frame=mounted.root.find('iframe');
 doc.body.classList.add('theme-dark');doc.body.style['--background-primary']='#181818';doc.body.style['--text-normal']='#dddddd';await flush();
 assert.equal(latestTheme(frame).theme,'dark');assert.equal(latestTheme(frame).styles.variables['--background'],'#181818');assert.equal(latestTheme(frame).styles.variables['--foreground'],'#dddddd');assert.equal(frame.style.colorScheme,'dark');
 doc.body.classList.remove('theme-dark');doc.documentElement.style['--background-primary']='#fafafa';doc.body.style['--background-primary']='';await flush();
 assert.equal(latestTheme(frame).theme,'light');assert.equal(latestTheme(frame).styles.variables['--background'],'#fafafa');assert.equal(frame.style.colorScheme,'light');
 // A stylesheet can change without a class/style mutation. Preserve the native
 // workspace CSS event route for theme and snippet reloads.
 const compute=doc.defaultView.getComputedStyle;doc.defaultView.getComputedStyle=(element:Element)=>({...compute(element),getPropertyValue:(name:string)=>name==='--background-primary'?'#abcdef':compute(element).getPropertyValue(name)});
 cssChange();assert.equal(latestTheme(frame).styles.variables['--background'],'#abcdef');
 frame.events.load();assert.equal(latestTheme(frame).styles.variables['--background'],'#abcdef','frame load always receives the latest theme');
 views.dispose();const reads=document.styleReads,count=frame.messages.length;doc.body.classList.add('theme-dark');cssChange();frame.events.load();await flush();assert.equal(document.styleReads,reads);assert.equal(frame.messages.length,count);
});

test('expanded HTML uses the modal surface rather than the opening note and releases observers on close',async()=>{
 const document=documentFixture(),doc=document.doc;let modal:any;
 class TestModal {
  modalEl=doc.body.createDiv({cls:'modal'});contentEl=this.modalEl.createDiv({cls:'modal-content'});
  constructor(){modal=this;this.modalEl.style.backgroundColor='rgb(30, 30, 30)';this.modalEl.addClass=(name:string)=>this.modalEl.classList.add(name);}
  setTitle(){}open(){(this as any).onOpen();}close(){(this as any).onClose();this.modalEl.remove();}
 }
 const module=await production(TestModal),{leaf,host}=noteSurface(doc);leaf.style.backgroundColor='rgb(200, 240, 240)';
 const views=new module.HtmlResultViews({},{get:async()=>page,dispose(){}}),mounted=views.mount(reference,doc);host.append(mounted.root);await loaded(mounted.root);
 mounted.root.find('button').click();await loaded(modal.contentEl.children[1].children[0]);
 await flush();const expanded=modal.contentEl.find('iframe')!;assert.ok(expanded);assert.equal(bootstrapTheme(expanded).variables['--background'],'rgb(30, 30, 30)');
 const count=expanded.messages.length;leaf.style.backgroundColor='red';await flush();assert.equal(expanded.messages.length,count);
 modal.modalEl.style.backgroundColor='rgb(40, 40, 40)';await flush();assert.equal(latestTheme(expanded).styles.variables['--background'],'rgb(40, 40, 40)');
 modal.close();const closedCount=expanded.messages.length;doc.body.classList.add('theme-dark');await flush();assert.equal(expanded.messages.length,closedCount);assert.equal(document.blobs.size,1);
 views.dispose();assert.equal(document.blobs.size,0);assert.ok([...document.observers].every(observer=>observer.targets.size===0));
});

test('disposal before attachment drops queued theme work and the temporary document observer',async()=>{
 const module=await production(),document=documentFixture(),doc=document.doc,views=new module.HtmlResultViews({},{get:async()=>page,dispose(){}});
 const mounted=views.mount(reference,doc);await loaded(mounted.root);const frame=mounted.root.find('iframe'),count=frame.messages.length;
 doc.body.append(mounted.root);mounted.dispose();await flush();doc.body.style.backgroundColor='red';await flush();
 assert.equal(frame.messages.length,count);assert.ok([...document.observers].every(observer=>observer.targets.size===0));assert.equal(document.blobs.size,0);views.dispose();
});
