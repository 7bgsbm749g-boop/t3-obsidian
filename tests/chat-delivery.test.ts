import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {WAIT_FOR_OTHER_THREADS_INSTRUCTION} from '../orchestration';
import {modelConfig} from './rpc-fixture';
import {InlineLeaseAuthority,leasePaths} from '../inline-lease';
import {hostedRequestHash} from '../hosted-inline';
import {initialRegion,replaceRegion,regionBody} from '../inline-thread';
import {contentHash} from '../completion';

const project={id:'chat-project',title:'Personal notes',workspaceRoot:'/projects/notes',connectionId:'chat-connection',connectionName:'Laptop'};

async function waitForReply(check:()=>boolean,description:string,timeout=6000){
  const deadline=Date.now()+timeout;
  while(!check()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(check(),description);
}

async function chatHarness(onCommand?:(command:any)=>Promise<void>) {
  let local:any={mode:'direct',pairedSessions:{'chat-connection':{url:'https://chat.example',environmentId:'chat-env',token:'dummy-chat-session',expiresAt:Date.now()+600_000}}};
  const localStorage=new Map<string,any>();
  const rootLink={id:'root',folderPath:'/',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,self:true};
  let activeNote:any,activeEditor:any,activeEditorView=true;
  const initial={folderLinks:[rootLink,{...rootLink,id:'notes',folderPath:'Notes',self:false}],chatProjectKey:'old:unrelated-project',paired:[{id:'chat-connection',name:'Laptop',url:'https://chat.example',environmentId:'chat-env'}],directScanId:'chat-connection',directProjects:[project],directSelected:['chat-connection:chat-project'],completion:{action:'delete'}};
  const shared:any[]=[], commands:any[]=[], registered:any[]=[],modals:any[]=[],settingsControls:any[]=[],notices:string[]=[],workspaceEvents:Record<string,((...args:any[])=>void)[]>={};let threads:any[]=[],catalog:any[]=[project],focusedButton:any;
  let readOverride:((id:string)=>Response|undefined|Promise<Response|undefined>)|undefined;
  let vaultAccesses=0;
  const hostViews=new WeakMap<object,any>();
  const hostFiles=new Map<string,string>(),hostEditors=new Map<string,any>(),hostNotes=new Map<string,{path:string}>();
  const noteFile=(path:string)=>{let file=hostNotes.get(path);if(!file){file={path};hostNotes.set(path,file);}return file;};
  let authority:InlineLeaseAuthority|undefined;
  const hostTick=async()=>{
    authority??=new InlineLeaseAuthority({vaultId:shared.at(-1).vaultId,environmentId:'chat-env',workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1'},{
      read:async path=>hostFiles.get(path),write:async(path,bytes)=>{hostFiles.set(path,bytes);},
      list:async directory=>[...hostFiles.keys()].filter(path=>path.startsWith(directory+'/')),
      remove:async path=>{hostFiles.delete(path);},
    });
    await authority.tick();
  };
  let streaming=false;
  const snapshot=(threadId:string)=>{
    const turn=[...commands].reverse().find(command=>command.type==='thread.turn.start'&&command.threadId===threadId);
    if(!turn)return {thread:{id:threadId,projectId:project.id,messages:[],activities:[]}};
    const turnId='provider-turn-'+turn.commandId;
    return {snapshotSequence:5,thread:{id:threadId,projectId:project.id,messages:[
      {id:turn.message.messageId,role:'user',turnId:null,text:turn.message.text,streaming:false,createdAt:turn.createdAt},
      {id:'answer',role:'assistant',turnId,text:'Inline reply from T3.',streaming}],activities:[],
      latestTurn:{turnId,state:streaming?'running':'completed',requestedAt:turn.createdAt,assistantMessageId:'answer'},session:{status:streaming?'running':'ready',activeTurnId:streaming?turnId:null},hasPendingApprovals:false,hasPendingUserInput:false}};
  };
  class Base {}
  class Element {
    style={};value='';text='';disabled=false;children:Element[]=[];events:Record<string,Function>={};attr:Record<string,string>={};tag='';
    empty(){this.children=[];} setText(value:string){this.text=value;} addEventListener(name:string,callback:Function){this.events[name]=callback;} click(){return this.events.click?.();} focus(){}
    createEl(tag?:string,options?:{text?:string;attr?:Record<string,string>}){const child=new Element();child.tag=tag??'';child.text=options?.text??'';child.attr=options?.attr??{};this.children.push(child);return child;}
  }
  class Modal {
    contentEl=new Element();titleEl=new Element();closed=false;emptyStateText='';placeholder='';
    constructor(public app:any){}
    open(){this.closed=false;modals.push(this);(this as any).onOpen?.();if(this.constructor.name==='SendDestinationModal')focusedButton=(this as any).contentEl.children[0]?.children[0];}
    close(){this.closed=true;(this as any).onClose?.();}
    setPlaceholder(value:string){this.placeholder=value;}
  }
  class Setting {
    name='';buttons:any[]=[];
    constructor(_element:any){settingsControls.push(this);}
    setClass(_value:string){return this;}
    setName(text:string){this.name=text;return this;}setDesc(_text:string){return this;}setDisabled(_value:boolean){return this;}
    addToggle(callback:(toggle:any)=>void){const toggle={setValue:()=>toggle,onChange:()=>toggle};callback(toggle);return this;}
    addButton(callback:(button:any)=>void){const button:any={text:'',click:()=>{},buttonEl:{isConnected:true,focus:()=>{focusedButton=button;}},setButtonText:(text:string)=>{button.text=text;return button;},setCta:()=>button,setDisabled:(value:boolean)=>{button.buttonEl.disabled=value;return button;},onClick:(click:()=>void)=>{button.click=click;return button;}};callback(button);this.buttons.push(button);return this;}
    addDropdown(callback:(d:any)=>void){const d:any={options:{},value:'',disabled:false,change:()=>{},addOption:(key:string,label:string)=>{d.options[key]=label;return d;},setValue:(value:string)=>{d.value=value;return d;},setDisabled:(value:boolean)=>{d.disabled=value;return d;},onChange:(fn:any)=>{d.change=fn;return d;}};(this as any).dropdown=d;callback(d);return this;}
    addText(callback:(t:any)=>void){const t={setValue:()=>t,setPlaceholder:()=>t,setDisabled:()=>t,onChange:()=>t};callback(t);return this;}
  }
  class File {extension='md';constructor(public path:string){}}
  class MenuItem {
    title='';disabled=false;callback:()=>any=()=>{};
    setTitle(value:string){this.title=value;return this;}setIcon(_value:string){return this;}
    setDisabled(value:boolean){this.disabled=value;return this;}onClick(callback:()=>any){this.callback=callback;return this;}
  }
  class Menu {
    items:MenuItem[]=[];
    addItem(callback:(item:MenuItem)=>void){const item=new MenuItem();this.items.push(item);callback(item);return this;}
  }
  class Plugin {
    app={
      loadLocalStorage:(key:string)=>localStorage.get(key)??(key==='send-to-t3-code-device-v1'?local:undefined),
      saveLocalStorage:(key:string,value:any)=>{localStorage.set(key,value);if(key==='send-to-t3-code-device-v1')local=value;},
      workspace:{onLayoutReady:()=>{},on:(name:string,callback:(...args:any[])=>void)=>{(workspaceEvents[name]??=[]).push(callback);return {};},getActiveViewOfType:()=>activeEditorView&&activeNote?(activeEditor??{file:activeNote}):undefined,getActiveFile:()=>activeNote,getLeavesOfType:()=>[...hostEditors].map(([path,editor])=>{let view=hostViews.get(editor);if(!view){view={file:noteFile(path),editor,save:async()=>{}};hostViews.set(editor,view);}return {view};})},
      vault:{adapter:{},getFileByPath:(path:string)=>hostEditors.has(path)?noteFile(path):undefined,getName:()=> 'Notes',read:(file:any)=>{const editor=hostEditors.get(file.path);if(editor)return Promise.resolve(editor.getValue());vaultAccesses++;throw Error('Chat must not read note contents');},readBinary:()=>{vaultAccesses++;throw Error('Chat must not read attachments');}},
    };
    async loadData(){return shared.at(-1)??initial;}
    async saveData(value:any){shared.push(value);}
    addSettingTab(){}
    registerEvent(){}
    register(){}
    addCommand(command:any){registered.push(command);}
  }
  class Notice {constructor(text:string){notices.push(text);}}
  const api={Plugin,Platform:{isMobile:true},Modal,Menu,MenuItem,Setting,SuggestModal:Modal,FuzzySuggestModal:Modal,PluginSettingTab:Base,Notice,TFile:File,MarkdownView:Base};
  const fetcher=async(url:string,options:any)=>{
    assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');
    const response=(value:any)=>new Response(JSON.stringify(value));
    if(url.endsWith('/.well-known/t3/environment'))return response({environmentId:url.includes('second.example')?'second-env':'chat-env',label:'Laptop',orchestrationProtocolVersion:1});
    assert.equal(options.headers.Authorization,'Bearer dummy-chat-session');
    if(url.endsWith('/websocket-ticket'))return response({ticket:'short-ticket'});
    if(url.endsWith('/shell'))return response({projects:catalog.map(p=>({...p,defaultModelSelection:{instanceId:'codex',model:'default'}})),threads});
    if(url.includes('/threads/')){
      const id=decodeURIComponent(url.split('/threads/')[1].split('?')[0]);
      const overridden=await readOverride?.(id);if(overridden)return overridden;
      return response(commands.some(command=>command.threadId===id&&command.type==='thread.turn.start')?snapshot(id):{thread:threads.find(thread=>thread.id===id)??{id,projectId:project.id,runtimeMode:'approval-required',interactionMode:'default'}});
    }
    const command=JSON.parse(options.body);
    commands.push(command);
    if(command.type==='project.create')catalog.push({id:command.projectId,title:command.title,workspaceRoot:command.workspaceRoot});
    await onCommand?.(command);
    if(command.type==='thread.turn.start')setTimeout(()=>void hostTick(),20);
    return response({});
  };
  const sockets:any[]=[];
  class Socket {
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:any)=>void;
    closed=false;
    constructor(public url:string){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
    close(){this.closed=true;this.onclose?.();}
    send(raw:string){void this.respond(raw);}
    async respond(raw:string){
      const req=JSON.parse(raw);if(req._tag==='Ack'||req._tag==='Interrupt'||req._tag==='Pong')return;
      if(req.tag==='orchestration.subscribeThread'){
        setTimeout(()=>{if(!this.closed)this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:req.id,values:[{kind:'snapshot',snapshot:snapshot(req.payload.threadId)}]})});},40);
        return;
      }
      let value:any;
      if(req.tag==='server.getConfig')value=modelConfig();
      else if(req.tag==='filesystem.browse')value={parentPath:req.payload.partialPath==='~'?'/home/person':req.payload.partialPath.replace(/\/$/,''),entries:[]};
      else if(req.tag==='projects.writeFile'){hostFiles.set(req.payload.relativePath,req.payload.contents);value={};}
      else if(req.tag==='projects.readFile'&&req.payload.relativePath.startsWith('.obsidian/t3-code/inline/')){
        if(req.payload.relativePath.includes('/replies/'))await hostTick();
        const contents=hostFiles.get(req.payload.relativePath);
        if(contents===undefined){this.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'ProjectReadFileError'}}]}})});return;}
        value={contents,truncated:false};
      }
      else if(req.tag==='projects.readFile')value={contents:JSON.stringify(req.payload.cwd===project.workspaceRoot?{vaultId:shared.at(-1).vaultId}:{vaultId:'different-vault'}),truncated:false};
      else value={entries:['Notes/Draft.md','Notes/Send.md','Unlinked/draft.md','Fresh/deep/draft.md'].map(path=>({path,kind:'file'}))};
      queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Success',value}})}));
    }
  }
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{
    module,exports:module.exports,
    require:(name:string)=>{assert.equal(name,'obsidian','Mobile chat must never import Node APIs');return api;},
    window:{localStorage:{get length(){return localStorage.size;},key:(i:number)=>[...localStorage.keys()][i]??null},setInterval,clearInterval,setTimeout,clearTimeout},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    fetch:fetcher,WebSocket:Socket,Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,performance,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const start=async()=>{const plugin=new module.exports.default();await plugin.onload();const timer=setInterval(()=>plugin.deviceInline?.tick(),20);const unload=plugin.onunload.bind(plugin);plugin.onunload=()=>{clearInterval(timer);unload();};return plugin;};
  const plugin=await start();
  return {setReadOverride:(value:typeof readOverride)=>{readOverride=value;},notices,setStreaming:(value:boolean)=>{streaming=value;},plugin,start,commands,shared,hostFiles,registered,modals,settingsControls,sockets,focusedButton:()=>focusedButton,pressEnter:()=>focusedButton?.click(),setProjects:(value:any[])=>{catalog=value;},setThreads:(value:any[])=>{threads=value;},setActiveNote:(path?:string)=>{activeNote=path?{path,extension:'md'}:undefined;activeEditor=undefined;},setActiveEditorView:(value:boolean)=>{activeEditorView=value;},menuFor:(view:any)=>{const menu=new Menu();for(const listener of workspaceEvents['editor-menu']??[])listener(menu,view.editor,view);return menu;},editorMenu:(selection:string,path='Notes/Selected.md',structuralFile=false)=>{
    const menu=new Menu(),file=structuralFile?{path,extension:'md'}:new File(path);
    let value=selection+'\nTail';
    const offsetToPos=(offset:number)=>{const before=value.slice(0,offset).split('\n');return {line:before.length-1,ch:before.at(-1)!.length};};
    const posToOffset=(pos:{line:number;ch:number})=>value.split('\n').slice(0,pos.line).reduce((n,line)=>n+line.length+1,0)+pos.ch;
    const editor={getSelection:()=>selection,getValue:()=>value,getCursor:(side:string)=>offsetToPos(side==='from'?0:selection.length),posToOffset,offsetToPos,replaceRange:(text:string,from:any,to?:any)=>{value=value.slice(0,posToOffset(from))+text+value.slice(to?posToOffset(to):posToOffset(from));}};
    hostEditors.set(path,editor);
    for(const listener of workspaceEvents['editor-menu']??[])listener(menu,editor,{file});return {menu,file,editor,get value(){return value;}};
  },attachEditor:(path:string,initial:string)=>{
    const file=new File(path),view=Object.assign(new Base(),{file,editor:null as any,save:async()=>{}});
    let value=initial;
    const offsetToPos=(offset:number)=>{const lines=value.slice(0,offset).split('\n');return {line:lines.length-1,ch:lines.at(-1)!.length};};
    const posToOffset=(pos:{line:number;ch:number})=>value.split('\n').slice(0,pos.line).reduce((n,line)=>n+line.length+1,0)+pos.ch;
    view.editor={getValue:()=>value,getSelection:()=>'',getCursor:()=>offsetToPos(value.length),posToOffset,offsetToPos,replaceRange:(text:string,from:any,to?:any)=>{value=value.slice(0,posToOffset(from))+text+value.slice(to?posToOffset(to):posToOffset(from));}};
    hostEditors.set(path,view.editor);
    const leaf={view,openFile:async()=>{}};
    (plugin.app.workspace as any).getLeavesOfType=()=>[leaf];
    (plugin.app.workspace as any).getLeaf=()=>leaf;
    activeNote=file;activeEditor=view;
    return {file,view,editor:view.editor,get value(){return value;}};
  },vaultAccesses:()=>vaultAccesses};
}

for(const mode of ['untitled-only','always'])for(const name of ['Release plan','Untitled 1'])test(`Send and Ask share ${mode} naming for ${name}`,async()=>{
  const h=await chatHarness(),path=`Notes/${name}.md`;
  try{
    h.plugin.settings.threadTitleGeneration=mode;
    await h.plugin.sendChat('This question must not become the title',{path},{newThread:true});
    const expected=mode==='always'||name==='Untitled 1'?'New thread':name;
    assert.equal(h.commands[0].title,expected);
    h.plugin.app.vault.read=async()=> 'Bounded note contents';
    const sent=await h.plugin.send({path,basename:name,stat:{ctime:123}},project,{newThread:true,streamReply:false,throwOnError:true});
    assert.equal(sent.request.title,expected);assert.equal(h.commands[2].title,expected);
  }finally{h.plugin.onunload();}
});

test('existing Ask header uses the canonical name before a delayed turn acknowledgement',async()=>{
  let release!:()=>void,entered!:()=>void;
  const acknowledgement=new Promise<void>(resolve=>{release=resolve;}),dispatched=new Promise<void>(resolve=>{entered=resolve;});
  const h=await chatHarness(async command=>{if(command.type==='thread.turn.start'){entered();await acknowledgement;}});
  try{
    h.setStreaming(true);h.plugin.settings.threadTitleGeneration='always';
    h.setThreads([{id:'existing',projectId:project.id,title:'Canonical existing title',runtimeMode:'approval-required',interactionMode:'default'}]);
    const path='Notes/Untitled 1.md',note=h.attachEditor(path,'Ordinary content');
    const sending=h.plugin.sendInlineChat('implement',{path},{view:note.view,editor:note.editor},{threadId:'existing'});
    await dispatched;
    assert.match(note.value,/Canonical existing title · Working/);
    assert.doesNotMatch(note.value,/implement · Working|New thread · Working/);
    assert.equal(h.commands.length,1);assert.equal(h.commands[0].type,'thread.turn.start');
    release();await sending;
  }finally{release?.();h.plugin.onunload();}
});

test('failed requests freeze their chosen title across setting changes and reload',async()=>{
  let lose=true;
  const h=await chatHarness(async command=>{if(command.type==='thread.create'&&lose){lose=false;throw Error('lost reply');}});
  let plugin=h.plugin;
  try{
    await assert.rejects(plugin.sendChat('Ask text',{path:'Notes/Release plan.md'},{newThread:true}));
    const create=h.commands[0];assert.equal(create.title,'Release plan');
    plugin.settings.threadTitleGeneration='always';await plugin.save();
    plugin.onunload();plugin=await h.start();
    await plugin.retry(plugin.settings.pending[0]);
    assert.deepEqual(h.commands[1],create);assert.equal(plugin.settings.pending.length,0);
  }finally{plugin.onunload();}
});

test('disabled logging leaves failed-send recovery and original-ID retries intact across reload',async()=>{
  let lose=true;
  const h=await chatHarness(async command=>{if(command.type==='thread.turn.start'&&lose){lose=false;throw Error('lost reply');}});
  let plugin=h.plugin;
  try{
    assert.equal(plugin.diagnostics,undefined);
    await assert.rejects(plugin.sendChat('Private diagnostic regression prompt'),/Unconfirmed requests/);
    const request=plugin.settings.pending[0];assert.ok(request);
    plugin.onunload();plugin=await h.start();
    assert.equal(plugin.diagnostics,undefined);
    assert.equal(plugin.settings.pending[0].id,request.id);
    await plugin.retry(plugin.settings.pending[0]);assert.equal(plugin.settings.pending.length,0);
    assert.equal(h.commands.filter(c=>c.type==='thread.turn.start').at(-1).commandId,h.commands.find(c=>c.type==='thread.turn.start').commandId);
    await assert.rejects(plugin.exportDiagnostics(),/logging is disabled/);
  }finally{plugin.onunload();}
});

test('mobile chat without a note uses the root link, preserves the prompt, advertises event queries, and never enrolls note cleanup',async()=>{
  const h=await chatHarness();
  const prompt='\n\n  Plan\tmy   café 🧪 notes  \n\nKeep **Markdown**, "quotes", and [[links]] exactly.\n';
  try {
    assert.deepEqual(h.registered.map(command=>command.id),['export-diagnostics','send-or-ask','resolve-native-response-conflict','send-note-to-multiple-notes','answer-t3-question'],'Manual send and multi-destination commands are available');
    await h.plugin.sendChat(prompt);
    assert.equal(h.commands.length,2);
    assert.equal(h.commands[0].type,'thread.create');
    assert.equal(h.commands[0].projectId,project.id);
    assert.equal(h.commands[0].title,'New thread');
    assert.equal(h.commands[1].type,'thread.turn.start');
    assert.ok(h.commands[1].message.text.startsWith(prompt));
    assert.doesNotMatch(h.commands[1].message.text,/T3 EVENT HISTORY CAPABILITY/);
    assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(h.plugin.settings.completionJobs.length,0,'Delete-note preference must not apply to free text');
    assert.equal(h.vaultAccesses(),0);
    assert.equal(h.shared.at(-1).chatProjectKey,undefined,'Retired chat preference must not override folder routing');
    h.plugin.onunload();
    const restarted=await h.start();
    assert.equal(restarted.settings.folderLinks[0].folderPath,'/');
    assert.equal(h.commands.length,2,'Restart must not submit another chat');
    restarted.onunload();
    for(const snapshot of h.shared){
      assert.ok(!('pending' in snapshot),'Chat retry data stays on the sending device');
      assert.doesNotMatch(JSON.stringify(snapshot),/dummy-chat-session/);
    }
  } finally {h.plugin.onunload();}
});

test('a locally paired session authorizes a synced managed connection without account sign-in',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.paired[0].managed=true;
    await h.plugin.sendChat('Use the existing device session.');
    assert.equal(h.commands.at(-1).type,'thread.turn.start');
  }finally{h.plugin.onunload();}
});

test('a confirmed note chat remembers its thread, routes the next question there, and survives restart',async()=>{
  const h=await chatHarness();
  try{
    const note={path:'Notes/Linked.md'};
    await h.plugin.sendChat('First question',note);
    const firstThread=h.commands[0].threadId;
    assert.equal(h.plugin.settings.noteThreads.length,1);
    assert.equal(h.plugin.settings.noteThreads[0].threadId,firstThread);
    h.setThreads([{id:firstThread,projectId:project.id,title:'First question',updatedAt:new Date().toISOString(),runtimeMode:'approval-required',interactionMode:'default'}]);
    await h.plugin.sendChat('Follow up',note);
    assert.equal(h.commands.length,3,'The second question starts a turn without creating another thread');
    assert.equal(h.commands[2].threadId,firstThread);
    h.plugin.onunload();
    const restarted=await h.start();
    await restarted.sendChat('After restart',note);
    assert.equal(h.commands[3].threadId,firstThread);
    restarted.onunload();
  }finally{h.plugin.onunload();}
});

test('every confirmed note send updates the default thread even with a legacy opt-out',async()=>{
  const h=await chatHarness();
  try{
    const note={path:'Notes/Always.md'};
    await h.plugin.onExternalSettingsChange({...h.shared.at(-1),threadLinking:false});
    await h.plugin.sendChat('First',note);
    const first=h.plugin.settings.noteThreads[0].threadId;
    h.setThreads([{id:first,projectId:project.id,title:'First',updatedAt:new Date().toISOString(),runtimeMode:'approval-required',interactionMode:'default'}]);
    await h.plugin.sendChat('Follow up',note);
    assert.equal(h.commands.at(-1).threadId,first);
    await h.plugin.sendChat('Separate branch',note,{newThread:true});
    const latest=h.commands.at(-1).threadId;
    assert.notEqual(latest,first);
    h.setThreads([{id:latest,projectId:project.id,title:'Separate branch',updatedAt:new Date().toISOString(),runtimeMode:'approval-required',interactionMode:'default'}]);
    await h.plugin.sendChat('Continue the new thread',note);
    assert.equal(h.commands.at(-1).threadId,latest);
    assert.equal(h.plugin.settings.noteThreads.length,2);
    assert.equal(h.shared.at(-1).threadLinking,undefined);
  }finally{h.plugin.onunload();}
});

test('stale synced settings preserve confirmed history while newer remote removals win',async()=>{
  const h=await chatHarness();
  try{
    const stale=JSON.parse(JSON.stringify(h.shared.at(-1)));
    await h.plugin.sendChat('Remember this', {path:'Notes/Sync.md'});
    const entry={...h.plugin.settings.noteThreads[0]};
    h.shared.push(stale);
    await h.plugin.onExternalSettingsChange(stale);
    assert.equal(h.plugin.settings.noteThreads[0].threadId,entry.threadId);
    assert.equal(h.shared.at(-1).noteThreads[0].threadId,entry.threadId,'Recovered history is saved back for other devices');
    const removed={...h.shared.at(-1),noteThreads:[{...entry,deletedAt:'2099-01-01T00:00:00.000Z'}]};
    h.shared.push(removed);
    await h.plugin.onExternalSettingsChange(removed);
    assert.equal(h.plugin.settings.noteThreads[0].deletedAt,removed.noteThreads[0].deletedAt);
  }finally{h.plugin.onunload();}
});

test('a full-note send keeps its note with a remembered thread and reuses the confirmed thread',async()=>{
  const h=await chatHarness();
  try{
    (h.plugin.app.vault as any).read=async()=> 'Full note content';
    const file={path:'Notes/Whole.md',basename:'Whole',extension:'md',stat:{ctime:123}};
    const first=await h.plugin.send(file,project,{throwOnError:true});
    assert.equal(first.request.completion.action,'keep','Remembering must prevent configured delete cleanup');
    assert.equal(h.plugin.settings.noteThreads[0].threadId,first.threadId);
    h.setThreads([{id:first.threadId,projectId:project.id,title:'Whole',updatedAt:new Date().toISOString(),runtimeMode:'approval-required',interactionMode:'default'}]);
    const second=await h.plugin.send(file,project,{throwOnError:true});
    assert.equal(second.request.threadId,first.threadId);
    assert.equal(second.request.completion.action,'keep');
    assert.equal(h.commands.filter(command=>command.type==='thread.create').length,1);
  }finally{h.plugin.onunload();}
});

test('an uncertain chat survives restart and retries the original immutable commands manually',async()=>{
  let loseResponse=true;
  const h=await chatHarness(async command=>{
    if(command.type==='thread.turn.start'&&loseResponse){loseResponse=false;throw Error('Connection lost after accepting turn');}
  });
  const prompt='Draft a short project plan.\nPreserve this second line.';
  try {
    await assert.rejects(h.plugin.sendChat(prompt),(error:any)=>{
      assert.match(error.message,/unconfirmed requests|saved|retry/i);
      assert.equal(error.requestSaved,true,'The prompt UI must distinguish saved sends from safe-to-resubmit validation failures');
      return true;
    });
    assert.equal(h.plugin.busy,false);
    assert.equal(h.plugin.settings.pending.length,1);
    const pending=h.plugin.settings.pending[0];
    assert.ok(pending.prompt.startsWith(prompt));
    assert.doesNotMatch(pending.prompt,/T3 EVENT HISTORY CAPABILITY/);
    assert.equal(pending.completion,undefined);
    assert.equal(pending.directPlan.phase,'created');
    assert.equal(h.plugin.settings.completionJobs.length,0);
    h.plugin.onunload();
    const restarted=await h.start();
    assert.equal(h.commands.length,2,'Reload must leave an uncertain send for manual retry');
    restarted.settings.orchestration.waitForOtherThreads=true;
    restarted.settings.folderLinks=[];
    await restarted.retry(restarted.settings.pending[0]);
    assert.equal(h.commands.length,3);
    assert.deepEqual(h.commands[1],h.commands[2],'Retry preserves the command ID, thread ID, model, project and original text');
    assert.equal(h.commands.filter(command=>command.type==='thread.create').length,1);
    assert.equal(restarted.settings.pending.length,0);
    assert.equal(restarted.settings.completionJobs.length,0);
    assert.equal(h.vaultAccesses(),0);
    restarted.onunload();
  } finally {h.plugin.onunload();}
});

test('chat validates text before creating a thread and applies enabled orchestration within the size limit',async()=>{
  const h=await chatHarness();
  try {
    await assert.rejects(h.plugin.sendChat(' \t\r\n '),/empty|type|enter|prompt/i);
    await assert.rejects(h.plugin.sendChat('x'.repeat(120_001)),/120,?000|limit|long/i);
    h.plugin.settings.orchestration.waitForOtherThreads=true;
    await assert.rejects(h.plugin.sendChat('x'.repeat(120_000)),/120,?000|limit|long/i);
    assert.equal(h.commands.length,0,'Invalid input must not create a thread');
    assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(h.plugin.busy,false);
    const firstLine='A'.repeat(180), prompt='\n'+firstLine+'\nContinue with this line.';
    await h.plugin.sendChat(prompt);
    assert.equal(h.commands[0].title,'New thread');
    assert.ok(h.commands[1].message.text.startsWith(WAIT_FOR_OTHER_THREADS_INSTRUCTION+'\n\n'+prompt));
    assert.doesNotMatch(h.commands[1].message.text,/T3 EVENT HISTORY CAPABILITY/);
    assert.equal(h.plugin.settings.completionJobs.length,0);
  } finally {h.plugin.onunload();}
});

test('a concurrent chat is rejected while the first send is in progress',{timeout:5000},async()=>{
  let release!:()=>void,entered!:()=>void;
  const enteredTurn=new Promise<void>(resolve=>{entered=resolve;});
  const h=await chatHarness(async command=>{
    if(command.type==='thread.turn.start')await new Promise<void>(resolve=>{release=resolve;entered();});
  });
  try {
    const first=h.plugin.sendChat('First request');
    await enteredTurn;
    assert.equal(h.plugin.busy,true);
    await assert.rejects(h.plugin.sendChat('Second request'),/busy|progress|sending|wait/i);
    assert.equal(h.commands.length,2);
    release();
    await first;
    assert.equal(h.plugin.busy,false);
    assert.equal(h.plugin.settings.pending.length,0);
  } finally {release?.();h.plugin.onunload();}
});

test('palette chat sends the visible note path through its nearest link without selected projects or note content',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.directSelected=[];
    h.plugin.settings.folderLinks.push({...h.plugin.settings.folderLinks[0],id:'inner',folderPath:'Notes/Inner',self:false});
    h.setActiveNote('Notes/Inner/café "draft".md');
    const prompt='  Work on this note.\nKeep these spaces.  ';
    await h.plugin.openChat(prompt);
    assert.equal(h.commands.length,0,'Selecting the live palette row must ask for a destination before sending');
    await h.modals.at(-1).choose(false);
    assert.equal(h.commands[0].projectId,project.id);
    assert.equal(h.commands[0].title,'café "draft"');
    assert.ok(h.commands[1].message.text.startsWith(prompt+'\n\nSent from Obsidian.\nObsidian vault: "Notes"\nDestination note path: "/projects/notes/Notes/Inner/café \\"draft\\".md"'));
    assert.doesNotMatch(h.commands[1].message.text,/T3 EVENT HISTORY CAPABILITY/);
    assert.equal(h.commands[1].message.attachments.length,0);
    assert.equal(h.plugin.settings.completionJobs.length,0);
    assert.equal(h.vaultAccesses(),0);
  }finally{h.plugin.onunload();}
});

test('palette chat can target an existing thread and labels active and idle conversations',async()=>{
  const h=await chatHarness();
  try{
    h.setThreads([
      {id:'active',projectId:project.id,title:'Working now',updatedAt:'2026-09-19T12:00:00Z',latestTurn:{state:'running'},session:{status:'running',activeTurnId:'turn'}},
      {id:'idle',projectId:project.id,title:'Finished earlier',updatedAt:'2026-09-19T11:00:00Z',latestTurn:{state:'completed'},session:{status:'ready',activeTurnId:null}},
    ]);
    await h.plugin.openChat('Add this context');
    const destination=h.modals.at(-1);await destination.choose(true);
    const picker=h.modals.at(-1),items=picker.getItems();
    assert.equal(items.map((thread:any)=>thread.status).join(','),'Active,Idle');
    assert.match(picker.getItemText(items[0]),/Working now · Active/);
    assert.match(picker.getItemText(items[1]),/Finished earlier · Idle/);
    await picker.choose(items[0]);
    assert.equal(h.commands.length,1,'Existing-thread chat must not create a thread');
    assert.equal(h.commands[0].type,'thread.turn.start');assert.equal(h.commands[0].threadId,'active');
  }finally{h.plugin.onunload();}
});

test('the manual hotkey checks availability without opening a dialog and cancellation sends nothing',async()=>{
  const h=await chatHarness();
  try{
    const command=h.registered.find(command=>command.id==='send-or-ask');
    const opened=h.attachEditor('Notes/Hotkey.md','Full note');
    const before=h.modals.length;
    assert.equal(command.editorCheckCallback(true,opened.editor,opened.view),true);
    assert.equal(h.modals.length,before);
    assert.equal(command.editorCheckCallback(true,opened.editor,{file:null}),false);
    assert.equal(command.editorCheckCallback(true,opened.editor,{file:{extension:'png'}}),false);
    h.plugin.busy=true;
    assert.equal(command.editorCheckCallback(false,opened.editor,opened.view),false);
    h.plugin.busy=false;
    command.editorCheckCallback(false,opened.editor,opened.view);
    h.modals.at(-1).close();
    assert.equal(h.commands.length,0);
    assert.equal(opened.value,'Full note');
  }finally{h.plugin.onunload();}
});

for(const streaming of [false,true])for(const selected of [false,true])test(`one hotkey routes ${selected?'Ask':'Send'} with streaming ${streaming} and ignores palette drafts`,async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.inlineStreaming.enabled=streaming;
    const opened=h.attachEditor('Notes/Hotkey.md','Selected question\nPrivate remainder');
    Object.assign(opened.file,{basename:'Hotkey',stat:{ctime:123}});
    opened.editor.getSelection=()=>selected?'Selected question':'';
    opened.editor.getCursor=(side:string)=>opened.editor.offsetToPos(side==='from'?0:17);
    h.plugin.app.saveLocalStorage('send-to-t3-code-chat-draft-v1','Unrelated palette draft');
    h.registered.find(command=>command.id==='send-or-ask').editorCheckCallback(false,opened.editor,opened.view);
    assert.equal(h.commands.length,0,'The hotkey opens the chooser before delivery');
    if(selected)h.setActiveNote('Notes/Different.md');
    await h.modals.at(-1).choose('new');
    const sent=h.commands.find(command=>command.type==='thread.turn.start');
    assert.ok(sent);
    assert.match(sent.message.text,/^Selected question/);
    if(selected)assert.doesNotMatch(sent.message.text,/Private remainder/);
    else assert.match(sent.message.text,/Private remainder/);
    assert.match(sent.message.text,/Destination note path: "\/projects\/notes\/Notes\/Hotkey.md"$/);
    assert.doesNotMatch(sent.message.text,/Different.md|Unrelated palette draft/);
    assert.equal(h.plugin.app.loadLocalStorage('send-to-t3-code-chat-draft-v1'),'Unrelated palette draft');
    if(streaming){
      for(let attempt=0;attempt<80&&!opened.value.includes('Inline reply from T3.');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
      assert.match(opened.value,/Inline reply from T3\./);
      assert.equal(opened.value.indexOf('Inline reply from T3.')<opened.value.indexOf('Private remainder'),selected);
    }else assert.equal(opened.value,'Selected question\nPrivate remainder');
  }finally{h.plugin.onunload();}
});

test('a typed palette question sends only the question and streams at the note end',async()=>{
  const h=await chatHarness();
  try{
    const editor=h.attachEditor('Notes/Palette.md','# Private note\nBody not sent.');
    h.plugin.app.saveLocalStorage('send-to-t3-code-chat-draft-v1','Why does this matter?');
    await h.plugin.openPaletteAction('Why does this matter?','');
    assert.equal(h.modals.at(-1).titleEl.text,'Send to T3 Code');
    await h.modals.at(-1).choose(false);
    assert.match(editor.value,/> \[!t3-steering\] You\n> Why does this matter\?/);
    const text=h.commands[1].message.text;
    assert.match(text,/^Why does this matter\?/);
    assert.doesNotMatch(text,/Private note|Body not sent|Vault-relative note path/);
    assert.match(text,/Sent from Obsidian\.\nObsidian vault: "Notes"\nDestination note path: "\/projects\/notes\/Notes\/Palette.md"$/);
    assert.equal(h.plugin.app.loadLocalStorage('send-to-t3-code-chat-draft-v1'),'');
    for(let attempt=0;attempt<200&&!editor.value.includes('Inline reply from T3.');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(editor.value,/> Why does this matter\?[\s\S]*> Inline reply from T3\./);
    assert.equal(editor.value.split('> Why does this matter?').length-1,1);
  }finally{h.plugin.onunload();}
});

test('an empty palette action uses the full note send path',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.folderLinks=[];
    const editor=h.attachEditor('Notes/Send.md','# Send this note');
    Object.assign(editor.file,{basename:'Send',stat:{ctime:123}});
    await h.plugin.openPaletteAction('','');
    const chooser=h.modals.at(-1);
    assert.equal(chooser.constructor.name,'SendDestinationModal');
    h.plugin.settings.folderLinks.push({id:'root',folderPath:'/',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,self:true});
    h.plugin.settings.folderLinks.push({id:'notes',folderPath:'Notes',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,self:false});
    await chooser.choose('new');
    for(let attempt=0;attempt<120&&(h.commands.length<2||h.plugin.busy);attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(h.commands[1].message.text,/# Send this note/);
    assert.match(h.commands[1].message.text,/Sent from Obsidian\./);
    assert.doesNotMatch(h.commands[1].message.text,/Vault-relative note path/);
  }finally{h.plugin.onunload();}
});

test('an empty palette action on a note with history opens a destination modal',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Notes/Linked.md');
    h.plugin.settings.noteThreads.push(
      {notePath:'Notes/Linked.md',threadId:'older',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-01T00:00:00Z'},
      {notePath:'Notes/Linked.md',threadId:'current',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-02T00:00:00Z'},
    );
    await h.plugin.openPaletteAction('','');
    const modal=h.modals.at(-1);
    await modal.ready;
    assert.equal(modal.constructor.name,'SendDestinationModal');
    assert.equal(modal.titleEl.text,'Send to T3 Code');
    assert.equal(modal.contentEl.children[0].children[0].text,project.title);
    assert.deepEqual(h.settingsControls.at(-1).buttons.map((button:any)=>button.text),['Continue thread','New thread','Existing thread…']);
    assert.equal(h.commands.length,0);
    modal.close();
    assert.equal(h.commands.length,0,'Dismissing the destination modal must not send');
  }finally{h.plugin.onunload();}
});

test('a palette question about selected text includes both parts and inserts below the selection',async()=>{
  const h=await chatHarness();
  try{
    const editor=h.attachEditor('Notes/Selected.md','Claim\nOther note text stays private.');
    editor.editor.getSelection=()=> 'Claim';
    editor.editor.getCursor=(side:string)=>editor.editor.offsetToPos(side==='from'?0:5);
    h.plugin.app.saveLocalStorage('send-to-t3-code-chat-draft-v1','Why?');
    await h.plugin.openPaletteAction('Why?','Claim');
    await h.modals.at(-1).choose(false);
    const text=h.commands[1].message.text;
    assert.match(text,/^Selected text:\nClaim\n\nQuestion:\nWhy\?/);
    assert.doesNotMatch(text,/Other note text stays private/);
    assert.equal(h.plugin.app.loadLocalStorage('send-to-t3-code-chat-draft-v1'),'');
    for(let attempt=0;attempt<200&&(editor.value.includes('t3-inline:start:')||!editor.value.includes('Inline reply from T3.'));attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(editor.value.replace(/<!-- t3-response:(?:start|end):[0-9a-f-]+ -->\n/g,''),/Claim\n\n\n> \[!t3-steering\] You\n> Why\?\n\n> Inline reply from T3\./);
    assert.equal(editor.value.split('> Why?').length-1,1);
    assert.doesNotMatch(editor.value,/> Selected text:|> Question:|> Sent from Obsidian/);
  }finally{h.plugin.onunload();}
});

test('project picker changes this send without reusing the note’s last used thread',async()=>{
  const h=await chatHarness();
  try{
    const other={id:'other-project',title:'Other work',workspaceRoot:'/projects/other',connectionId:project.connectionId,connectionName:'Laptop'};
    h.plugin.settings.directProjects.push(other);
    h.setProjects([project,other]);
    const path='Notes/Linked.md';h.setActiveNote(path);
    h.plugin.settings.noteThreads.push({notePath:path,threadId:'old-thread',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-28T00:00:00Z'});
    await h.plugin.openChat('Send to other work');
    const destination=h.modals.at(-1);
    const change=destination.contentEl.children[0].children[0];
    assert.equal(change.text,project.title);
    change.click();
    const picker=h.modals.at(-1),choice=picker.getItems().find((item:any)=>item.key==='chat-connection:other-project');
    assert.ok(choice);
    picker.onChooseItem(choice);
    assert.match(destination.contentEl.children[0].children[0].attr.title,/Other work/);
    assert.equal(destination.host.getDefaultThread(choice.key),undefined);
    await destination.choose(false);
    assert.equal(h.commands[0].type,'thread.create');
    assert.equal(h.commands[0].projectId,other.id);
    assert.notEqual(h.commands[0].threadId,'old-thread');
  }finally{h.plugin.onunload();}
});

test('Enter on the destination dialog uses the purple new or last used thread button',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Notes/New.md');
    await h.plugin.openChat('Start here');
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(h.focusedButton()?.text,'New thread');
    h.pressEnter();
    for(let attempt=0;attempt<120&&(h.commands.length<2||h.plugin.busy);attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(h.commands[0].type,'thread.create');

    const path='Notes/Linked.md';
    h.setActiveNote(path);
    h.plugin.settings.noteThreads.push({notePath:path,threadId:'previous-thread',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-28T00:00:00Z'});
    h.setThreads([{id:'previous-thread',projectId:project.id,title:'Previous',updatedAt:'2026-09-28T00:00:00Z',runtimeMode:'approval-required',interactionMode:'default'}]);
    await h.plugin.openChat('Continue here');
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(h.focusedButton()?.text,'Continue thread');
    h.pressEnter();
    for(let attempt=0;attempt<120&&(h.commands.length<3||h.plugin.busy);attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(h.commands[2].type,'thread.turn.start');
    assert.equal(h.commands[2].threadId,'previous-thread');
  }finally{h.plugin.onunload();}
});

test('existing-thread picker uses the nested folder project even when the note remembers a vault thread',async()=>{
  const h=await chatHarness();
  try{
    const nested={id:'nested-project',title:'Nested project',workspaceRoot:'/projects/nested',connectionId:project.connectionId};
    h.plugin.settings.directProjects.push(nested);
    h.plugin.settings.folderLinks.push({id:'nested-link',folderPath:'Notes/Inner',projectId:nested.id,projectTitle:nested.title,workspaceRoot:nested.workspaceRoot,connectionId:nested.connectionId,self:false});
    const path='Notes/Inner/Subfolder/Draft.md';
    h.plugin.settings.noteThreads.push({notePath:path,threadId:'vault-thread',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-28T00:00:00Z'});
    h.setActiveNote(path);
    h.setActiveEditorView(false);
    h.setThreads([{id:'vault-thread',projectId:project.id,title:'Vault thread',updatedAt:'2026-09-28T01:00:00Z'},
      {id:'nested-thread',projectId:nested.id,title:'Nested thread',updatedAt:'2026-09-28T01:00:00Z',runtimeMode:'approval-required',interactionMode:'default'}]);
    await h.plugin.openChat('Continue in the nested project');
    await h.modals.at(-1).choose(true);
    const picker=h.modals.at(-1);
    assert.equal(picker.getItems().map((thread:any)=>thread.id).join(','),'nested-thread');
    h.plugin.settings.folderLinks.at(-1).projectId=project.id;
    await assert.rejects(picker.choose(picker.getItems()[0]),/linked project changed/i);
    assert.equal(h.commands.length,0);
    h.plugin.settings.folderLinks.at(-1).projectId=nested.id;
    await picker.choose(picker.getItems()[0]);
    assert.equal(h.commands.length,1);
    assert.equal(h.commands[0].threadId,'nested-thread');
    assert.match(h.commands[0].message.text,/Destination note path: "\/projects\/notes\/Notes\/Inner\/Subfolder\/Draft.md"/);
  }finally{h.plugin.onunload();}
});

test('editor selection menu streams a T3 reply into its original note for new and existing threads',async()=>{
  const h=await chatHarness();
  try{
    assert.equal(h.editorMenu('   ').menu.items.length,0,'Whitespace-only selections do not add an action');
    assert.ok(h.editorMenu('Cross-window selection','Notes/Popout.md',true).menu.items.some(item=>item.title==='Ask T3 Code'),'Editor menu accepts Obsidian file objects from another window realm');
    const selection='Explain why **this claim** follows.\nKeep [[source links]].';
    const first=h.editorMenu(selection,'Notes/Original.md');let entry=first.menu.items.find(item=>item.title==='Ask T3 Code');assert.ok(entry);
    await entry!.callback();
    const destination=h.modals.at(-1);assert.equal(destination.constructor.name,'SendDestinationModal');
    h.setActiveNote('Notes/Different.md');await destination.choose(false);
    assert.equal(h.commands[0].type,'thread.create');assert.equal(h.commands[0].title,'Original');
    const newThreadText=h.commands[1].message.text;
    assert.ok(newThreadText.startsWith(selection));assert.match(newThreadText,/Answer in the T3 thread\. The Obsidian plugin will insert your reply\./);assert.doesNotMatch(newThreadText,/Do not edit the Obsidian note|Reply in the Obsidian note itself/);
    assert.match(newThreadText,/Destination note path: "\/projects\/notes\/Notes\/Original.md"/);assert.doesNotMatch(newThreadText,/Different.md/);
    for(let attempt=0;attempt<80&&(first.value.includes('t3-inline:start:')||!first.value.includes('Inline reply from T3.'));attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(first.value,/Inline reply from T3\./);
    assert.doesNotMatch(first.value,/\*\*T3 answer\*\*/);
    h.setThreads([{id:h.commands[1].threadId,projectId:project.id,title:'Selection reply',updatedAt:new Date().toISOString()}]);
    await h.plugin.monitorCompletions();
    assert.equal(h.commands.at(-1).type,'thread.settle','The response is settled after the final note insertion');

    h.setThreads([{id:'old-thread',projectId:project.id,title:'Earlier work',updatedAt:'2026-09-19T11:00:00Z',latestTurn:{state:'completed'}}]);
    const followup='Add the selected evidence to the conclusion.';
    const second=h.editorMenu(followup,'Notes/Original.md');entry=second.menu.items.find(item=>item.title==='Ask T3 Code');assert.ok(entry);
    await entry!.callback();await h.modals.at(-1).choose(true);
    const picker=h.modals.at(-1);await picker.choose(picker.getItems()[0]);
    const secondTurn=h.commands.filter(command=>command.type==='thread.turn.start').at(-1);
    assert.equal(secondTurn.type,'thread.turn.start');assert.equal(secondTurn.threadId,'old-thread');
    assert.ok(secondTurn.message.text.startsWith(followup));assert.doesNotMatch(secondTurn.message.text,/Reply in the Obsidian note itself/);
    for(let attempt=0;attempt<80&&(second.value.includes('t3-inline:start:')||!second.value.includes('Inline reply from T3.'));attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(second.value,/Inline reply from T3\./);
    assert.equal(h.vaultAccesses(),0,'Selection chat sends the selection and note path without reading the note body');
  }finally{h.plugin.onunload();}
});

test('stopping a local editor response removes both tracking tags and the Stop menu action',async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/Stop.md',region=initialRegion(id);
  try{
    const changed=replaceRegion(region.text,id,region.bodyHash,'**T3 · Working**\n\n> Partial answer')!;
    const opened=h.attachEditor(path,'Before'+region.text.slice(0,changed.from)+changed.text+region.text.slice(changed.to)+'After');
    const job={id,path,requestId:id,bodyHash:region.bodyHash,phase:'running',createdAt:new Date().toISOString(),threadId:'old-thread',turnId:'old-turn',messageId:webcrypto.randomUUID(),projectId:project.id,connection:{transport:'direct',host:'direct',url:'https://chat.example',connectionId:'chat-connection',environmentId:'chat-env',executable:''}};
    const manager=(h.plugin as any).inlineChat;
    manager.jobs.push(job);
    const runtime=manager.runtime(job);runtime.sequence=1;
    runtime.state={messages:[{id:'partial',role:'assistant',turnId:'old-turn',text:'Partial answer',streaming:true}],activities:[]};
    assert.ok(h.menuFor(opened.view).items.some(item=>item.title==='Stop T3 response'));
    await h.menuFor(opened.view).items.find(item=>item.title==='Stop T3 response')!.callback();
    for(let n=0;n<20&&opened.value.includes('t3-inline:');n++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.doesNotMatch(opened.value,/t3-inline:(?:start|end)/);
    assert.doesNotMatch(opened.value,/T3 · (?:Working|Stopped)/);assert.match(opened.value,/Partial answer/);
    assert.match(opened.value,/Before/);assert.match(opened.value,/After/);
    assert.equal(manager.activeFor(path).length,0);
    assert.ok(!h.menuFor(opened.view).items.some(item=>item.title==='Stop T3 response'));
    for(let n=0;n<20&&!h.commands.some(command=>command.type==='thread.turn.interrupt');n++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(h.commands.filter(command=>command.type==='thread.turn.interrupt').length,1);
  }finally{h.plugin.onunload();}
});

test('a failed editor response offers recovery and a new saved turn reuses its block and thread',async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/Recovery.md',region=initialRegion(id);
  const body='**T3 · Error**\n\nCodex usage limit reached.',change=replaceRegion(region.text,id,region.bodyHash,body)!;
  const document=region.text.slice(0,change.from)+change.text+region.text.slice(change.to);
  try{
    const opened=h.attachEditor(path,document);
    const job={id,path,requestId:id,bodyHash:contentHash(body),phase:'error',createdAt:new Date().toISOString(),threadId:'old-thread',turnId:'old-turn',messageId:webcrypto.randomUUID(),projectId:project.id,connection:{transport:'direct',host:'direct',url:'https://chat.example',connectionId:'chat-connection',environmentId:'chat-env',executable:''}};
    (h.plugin as any).inlineChat.jobs.push(job);
    const menu=h.menuFor(opened.view);
    assert.ok(menu.items.some(item=>item.title==='Continue T3 response'));
    assert.ok(menu.items.some(item=>item.title==='Attach latest T3 continuation'));
    assert.ok(menu.items.some(item=>item.title==='Stop T3 response'),'failed blocks also support local cleanup');
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Earlier work',updatedAt:new Date().toISOString(),session:{status:'error',activeTurnId:null,lastError:'Usage limit'},latestTurn:{turnId:'old-turn',state:'error'}}]);
    await menu.items.find(item=>item.title==='Continue T3 response')!.callback();
    assert.equal(h.commands.length,1,'continuation creates one turn in the existing thread');
    assert.equal(h.commands[0].threadId,'old-thread');
    assert.equal(h.commands[0].message.text,'Continue.');
    assert.equal(h.modals.length,0,'a single menu click dispatches without opening a modal');
    assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(job.messageId,h.commands[0].message.messageId);
  }finally{h.plugin.onunload();}
});

test('an explicit T3 continuation attaches only a newer turn in the same thread',async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/Attach.md',region=initialRegion(id);
  const body='**T3 · Error**',change=replaceRegion(region.text,id,region.bodyHash,body)!;
  try{
    h.attachEditor(path,region.text.slice(0,change.from)+change.text+region.text.slice(change.to));
    const oldMessage=webcrypto.randomUUID(),newMessage=webcrypto.randomUUID(),job={id,path,requestId:id,bodyHash:contentHash(body),phase:'error',createdAt:new Date().toISOString(),threadId:'old-thread',turnId:'old-turn',messageId:oldMessage,projectId:project.id,connection:{transport:'direct',host:'direct',url:'https://chat.example',connectionId:'chat-connection',environmentId:'chat-env',executable:''}};
    (h.plugin as any).inlineChat.jobs.push(job);
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Earlier work',latestTurn:{turnId:'old-turn',requestedAt:'old'},messages:[{id:oldMessage,role:'user',createdAt:'old'}]}]);
    await assert.rejects((h.plugin as any).attachInline(id,path),/No newer T3 turn/);
    assert.equal(job.messageId,oldMessage);
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Earlier work',latestTurn:{turnId:'next-turn',requestedAt:'new'},messages:[{id:oldMessage,role:'user',createdAt:'old'},{id:newMessage,role:'user',createdAt:'new'}]}]);
    await (h.plugin as any).attachInline(id,path);
    assert.equal(job.messageId,newMessage);assert.equal(job.phase,'reconnecting');assert.equal(h.commands.length,0,'attaching an existing turn does not send another one');
  }finally{h.plugin.onunload();}
});

test('a failed response in a moved note reaches the newer-turn check',async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),oldPath='Notes/Old.md',path='Notes/Moved.md',region=initialRegion(id);
  const body='**T3 · Error**',change=replaceRegion(region.text,id,region.bodyHash,body)!;
  try{
    h.attachEditor(path,region.text.slice(0,change.from)+change.text+region.text.slice(change.to));
    const host={environmentId:'chat-env',workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1',connectionId:'chat-connection'};
    const messageId=webcrypto.randomUUID(),request={version:2 as const,initialOwner:webcrypto.randomUUID(),id,vaultId:h.plugin.settings.vaultId,host,notePath:oldPath,threadId:'old-thread',messageId,projectId:project.id,threadEnvironmentId:'chat-env',initialHash:region.bodyHash,createdAt:new Date().toISOString()};
    h.hostFiles.set(leasePaths(host.directory,id).record,JSON.stringify({request,owner:request.initialOwner,epoch:1,revision:1,expiresAt:Date.now()+15_000,state:{requestHash:hostedRequestHash(request),accepted:true,notePath:oldPath,status:'error',hashes:[region.bodyHash,contentHash(body)],turnId:'old-turn',updatedAt:new Date().toISOString()}}));
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Earlier work',latestTurn:{turnId:'old-turn',requestedAt:'old'},messages:[{id:messageId,role:'user',createdAt:'old'}]}]);
    await assert.rejects((h.plugin as any).attachInline(id,path),/No newer T3 turn/);
    assert.equal(h.commands.length,0);
  }finally{h.plugin.onunload();}
});

test('Ask T3 refuses a switched editor before dispatching or inserting',async()=>{
  const h=await chatHarness();
  try{
    const context=h.editorMenu('What changed?','Notes/Original.md');
    const item=context.menu.items.find(entry=>entry.title==='Ask T3 Code');assert.ok(item);
    await item.callback();
    context.file.path='Notes/Another.md';
    await h.modals.at(-1).choose(false);
    assert.equal(h.commands.length,0);
    assert.doesNotMatch(context.value,/t3-inline:start/);
  }finally{h.plugin.onunload();}
});

test('editor Ask opens the inline chooser without changing the note',async()=>{
  const h=await chatHarness();
  try{
    const context=h.editorMenu('Explain this sentence.','Notes/Original.md');
    await context.menu.items.find(item=>item.title==='Ask T3 Code')!.callback();
    assert.equal(h.modals.at(-1).constructor.name,'SendDestinationModal');
    assert.equal(h.commands.length,0,'Opening the chooser does not dispatch or edit the note');
    assert.doesNotMatch(context.value,/t3-inline:start/);
  }finally{h.plugin.onunload();}
});

test('unlinked mobile sends choose an external workspace and descendants inherit its confirmed link',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.pickFolderProject=async()=>{const location=await h.plugin.projectLocation({id:project.connectionId,name:'Laptop'});try{return await location.create('/workspaces/unlinked','Unlinked');}finally{location.close();}};
    h.setActiveNote('Unlinked/draft.md');await h.plugin.openChat('Edit draft');
    const modal=h.modals.at(-1);
    assert.equal(modal.contentEl.children[0].children[0].text,'New project: Unlinked');
    assert.equal(h.commands.length,0);
    assert.equal(modal.host.getProjectChoices()[0].key,'folder:new');
    assert.equal(modal.host.getProjectChoices()[1].key,'vault:root');
    await modal.choose('new');
    assert.deepEqual(h.commands.map(c=>c.type),['project.create','thread.create','thread.turn.start']);
    assert.equal(h.commands[0].title,'Unlinked');
    assert.equal(h.commands[0].workspaceRoot,'/workspaces/unlinked');
    assert.equal(h.commands[1].projectId,h.commands[0].projectId);
    assert.match(h.commands[2].message.text,/Destination note path: "\/projects\/notes\/Unlinked\/draft.md"/);
    const link=h.plugin.settings.folderLinks.find((link:any)=>link.folderPath==='Unlinked');
    assert.equal(link.self,false);assert.equal(link.projectTitle,'Unlinked');
    await h.plugin.sendChat('Use the child folder',{path:'Unlinked/deeper/child.md'},{newThread:true});
    assert.equal(h.commands.filter(c=>c.type==='project.create').length,1);
    assert.equal(h.commands.at(-2).projectId,link.projectId);
    h.setActiveNote('root.md');await h.plugin.openChat('Edit root');await h.modals.at(-1).choose('new');
    assert.equal(h.commands.at(-2).projectId,project.id);
    assert.equal(h.vaultAccesses(),0);
  }finally{h.plugin.onunload();}
});

test('a remote folder without a vault-root mapping labels its unmapped destination',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.folderLinks=[{...h.plugin.settings.folderLinks[0],folderPath:'Notes',self:false}];
    await h.plugin.sendChat('Review this',{path:'Notes/Only once.md'});
    assert.match(h.commands[1].message.text,/Destination note path: "\(unmapped on destination\)"$/);
    assert.doesNotMatch(h.commands[1].message.text,/Vault-relative note path/);
  }finally{h.plugin.onunload();}
});

test('an unavailable inner link cannot silently fall back to root or a remembered project',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.folderLinks=h.plugin.settings.folderLinks.filter((link:any)=>link.folderPath!=='Notes');
    h.plugin.settings.folderLinks.push({...h.plugin.settings.folderLinks[0],id:'missing',folderPath:'Notes',projectId:'deleted'});
    await assert.rejects(h.plugin.sendChat('Edit',{path:'Notes/note.md'}),/linked.*unavailable/i);
    assert.equal(h.commands.length,0);assert.equal(h.plugin.settings.pending.length,0);
  }finally{h.plugin.onunload();}
});

test('mobile missing-root setup offers machines, resumes the exact chat, and syncs the chosen association',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.folderLinks=[];
    const second={id:'second-connection',name:'Travel laptop',url:'https://second.example',environmentId:'second-env'};
    h.plugin.settings.paired.push(second);
    h.plugin.pairedSessions[second.id]={...h.plugin.pairedSessions['chat-connection'],url:second.url,environmentId:second.environmentId};
    const prompt='  Edit this note\nPreserve my message.  ';
    const sending=h.plugin.sendChat(prompt,{path:'Notes/Draft.md'},{projectOverrideKey:'vault:root'});
    for(let attempt=0;attempt<20&&!h.modals.length;attempt++)await new Promise(resolve=>setTimeout(resolve,0));
    const setup=h.modals.at(-1);
    assert.equal(setup.constructor.name,'VaultSetupModal');
    assert.deepEqual(Array.from(h.plugin.vaultMachines(),(m:any)=>m.name),['Laptop','Travel laptop']);
    assert.equal(h.commands.length,0);
    setup.machineId=second.id;await setup.find();
    assert.equal(setup.roots.length,1);
    await setup.use(project.workspaceRoot);await sending;
    const root=h.shared.at(-1).folderLinks.find((l:any)=>l.folderPath==='/');
    assert.equal(root.connectionId,second.id);assert.equal(root.environmentId,second.environmentId);
    assert.equal(root.vaultId,h.shared.at(-1).vaultId);
    assert.equal(h.shared.at(-1).vaultLocations[0].environmentId,second.environmentId);
    assert.ok(h.sockets.every(s=>new URL(s.url).host==='second.example'),'Only the chosen machine receives vault requests');
    assert.equal(h.commands.length,2,'Reuses the discovered project');
    assert.ok(h.commands[1].message.text.startsWith(prompt));
    assert.match(h.commands[1].message.text,/Destination note path: "\/projects\/notes\/Notes\/Draft.md"/);
    assert.equal(h.vaultAccesses(),0);assert.equal(h.plugin.settings.completionJobs.length,0);
    assert.ok(h.sockets.every(s=>s.closed),'Setup and preflight sockets close');
    assert.ok(!JSON.stringify(h.shared).includes('dummy-chat-session'));
  }finally{h.plugin.onunload();}
});

test('mobile can register a synced folder as a remote project and keeps the binding after restart',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.folderLinks=[];h.setProjects([]);
    const sending=h.plugin.sendChat('Start a new conversation');
    for(let attempt=0;attempt<20&&!h.modals.length;attempt++)await new Promise(resolve=>setTimeout(resolve,0));
    const setup=h.modals.at(-1);await setup.find();
    assert.equal(setup.roots.length,0);assert.equal(h.commands.length,0);
    await setup.use(project.workspaceRoot);await sending;
    assert.deepEqual(h.commands.map(c=>c.type),['project.create','thread.create','thread.turn.start']);
    assert.equal(h.commands[0].workspaceRoot,project.workspaceRoot);
    assert.equal(h.commands[1].projectId,h.commands[0].projectId);
    assert.equal(h.commands[0].createdAt,h.plugin.vaultRegistrations[h.commands[0].commandId].createdAt);
    h.plugin.onunload();const restarted=await h.start();
    await restarted.sendChat('Continue from the saved vault association');
    assert.equal(h.commands.filter(c=>c.type==='project.create').length,1);
    assert.equal(h.commands[3].projectId,h.commands[0].projectId);
    assert.equal(h.shared.at(-1).vaultRegistrations,undefined,'Registration retry commands stay device-local');
    restarted.onunload();
  }finally{h.plugin.onunload();}
});

test('changing the default machine retains note path mapping for folders linked to another machine',async()=>{
  const h=await chatHarness();
  try{
    const oldRoot=h.plugin.settings.folderLinks[0];
    h.plugin.settings.folderLinks=[{...oldRoot,connectionId:'other-machine',workspaceRoot:'/other/root'},{...oldRoot,id:'inner',folderPath:'Notes',self:false}];
    h.plugin.settings.vaultLocations=[{environmentId:'chat-env',workspaceRoot:project.workspaceRoot}];
    await h.plugin.sendChat('Edit on the folder’s machine',{path:'Notes/Draft.md'});
    assert.equal(h.commands[0].projectId,project.id);
    assert.match(h.commands[1].message.text,/Destination note path: "\/projects\/notes\/Notes\/Draft.md"/);
    assert.ok(h.sockets.every(s=>new URL(s.url).host==='chat.example'));
  }finally{h.plugin.onunload();}
});

test('cancelling mobile root setup preserves the original chat and creates no project or thread',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.folderLinks=[];
    await h.plugin.openChat('Keep this draft');
    const chat=h.modals.at(-1),sending=chat.choose(false);
    for(let attempt=0;attempt<20&&h.modals.at(-1)===chat;attempt++)await new Promise(resolve=>setTimeout(resolve,0));
    const setup=h.modals.at(-1);assert.notEqual(chat,setup);setup.close();await sending;
    assert.equal(chat.closed,false);assert.equal(chat.prompt,'Keep this draft');
    assert.equal(h.plugin.busy,false);assert.equal(h.commands.length,0);
    assert.equal(h.plugin.settings.folderLinks.length,0);
  }finally{h.plugin.onunload();}
});

test('mobile root setup rejects an unrelated folder and remains open to retry',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.folderLinks=[];
    const work=h.plugin.configureVaultRoot();
    const setup=h.modals.at(-1);await setup.find();await setup.use('/another/vault');
    assert.match(setup.status,/another vault/);assert.equal(setup.closed,false);assert.equal(h.commands.length,0);
    setup.close();await assert.rejects(work,/setup closed/);
  }finally{h.plugin.onunload();}
});

test('chat retry retains its original note path even after the active note and links change',async()=>{
  let lose=true;
  const h=await chatHarness(async command=>{if(command.type==='thread.turn.start'&&lose){lose=false;throw Error('Lost response');}});
  try{
    await assert.rejects(h.plugin.sendChat('Edit this',{path:'Draft.md'}),/Unconfirmed/);
    const original=h.commands[1];
    assert.match(original.message.text,/Draft.md/);
    h.setActiveNote('Different.md');h.plugin.settings.folderLinks=[];
    await h.plugin.retry(h.plugin.settings.pending[0]);
    assert.deepEqual(h.commands[2],original);
    assert.equal(h.plugin.settings.completionJobs.length,0);
  }finally{h.plugin.onunload();}
});

test('note context counts toward the prompt limit and a synced local root can resolve to a paired project',async()=>{
  const h=await chatHarness();
  try{
    await assert.rejects(h.plugin.sendChat('x'.repeat(119_990),{path:'long/path/note.md'}),/120,000/);
    assert.equal(h.commands.length,0);
    h.plugin.settings.folderLinks[0].connectionId='';
    await h.plugin.sendChat('Use synced root',{path:'note.md'});
    assert.equal(h.commands[0].projectId,project.id);
    assert.match(h.commands[1].message.text,/\/projects\/notes\/note.md/);
  }finally{h.plugin.onunload();}
});

test('the question composer captures the note before it opens',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Original.md');
    await h.plugin.openChat();
    const modal=h.modals.at(-1);assert.ok(modal);
    assert.equal(h.commands.length,0,'Opening the composer must not send or create a project');
    h.setActiveNote('Different.md');modal.field.value='Edit the original';
    await modal.choose();
    assert.equal(modal.closed,true);
    assert.match(h.commands[1].message.text,/Original.md/);
    assert.doesNotMatch(h.commands[1].message.text,/Different.md/);
  }finally{h.plugin.onunload();}
});

test('sending a note into an existing thread retains Markdown and images and clears older cleanup',async()=>{
  const h=await chatHarness();
  try{
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
    h.plugin.app.vault.read=async()=> '# Note\nBefore\n![image](data:image/png;base64,'+png+')\nAfter';
    h.plugin.settings.completionJobs=[{notePath:'note.md',status:'watching'}];
    const result=await h.plugin.send({path:'note.md',basename:'note',stat:{ctime:123}},project,{threadId:'existing',throwOnError:true});
    assert.equal(result.threadId,'existing');assert.equal(h.commands.length,1);
    assert.equal(h.commands[0].type,'thread.turn.start');assert.equal(h.commands[0].threadId,'existing');
    assert.match(h.commands[0].message.text,/# Note\nBefore/);assert.match(h.commands[0].message.text,/t3-context:\/\//);
    assert.match(h.commands[0].message.text,/\nAfter\n\nSent from Obsidian\./);
    assert.match(h.commands[0].message.text,/Obsidian vault: "Notes"\nDestination note path: "\/projects\/notes\/note.md"$/);
    assert.doesNotMatch(h.commands[0].message.text,/Vault-relative note path/);
    assert.equal(h.commands[0].message.attachments[0].dataUrl,'data:image/png;base64,'+png);
    assert.equal(result.request.completion.action,'keep');
    assert.equal(h.plugin.settings.completionJobs.length,0);
    assert.equal(h.plugin.settings.pending.length,0);
  }finally{h.plugin.onunload();}
});

test('inline streaming switches default on and persist independently',async()=>{
  const h=await chatHarness();
  try{
    assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.inlineStreaming)),{enabled:true,keepIntermediate:false,finalAnswerFormat:'formatted'});
    h.plugin.settings.inlineStreaming.enabled=false;
    h.plugin.settings.inlineStreaming.keepIntermediate=true;
    await h.plugin.save();
    h.plugin.onunload();
    const restarted=await h.start();
    assert.deepEqual(JSON.parse(JSON.stringify(restarted.settings.inlineStreaming)),{enabled:false,keepIntermediate:true,finalAnswerFormat:'formatted'});
    restarted.onunload();
  }finally{h.plugin.onunload();}
});

test('completed Obsidian turns settle, and a later note question reuses the same thread',async()=>{
  const h=await chatHarness();
  let restarted:any;
  try{
    h.plugin.settings.inlineStreaming.enabled=false;
    await h.plugin.sendChat('First question',{path:'Notes/Q.md'});
    const first=h.commands.find(command=>command.type==='thread.turn.start');
    assert.equal(h.plugin.settings.settlementJobs.length,1);
    h.setThreads([{id:first.threadId,projectId:project.id,title:'First question',updatedAt:new Date().toISOString()}]);
    h.plugin.onunload();
    restarted=await h.start();
    assert.equal(restarted.settings.settlementJobs.length,1,'The settle check survives an Obsidian restart');
    await restarted.monitorCompletions();
    assert.equal(h.commands.at(-1).type,'thread.settle');
    assert.equal(h.commands.at(-1).threadId,first.threadId);
    assert.equal(restarted.settings.settlementJobs.length,0);
    h.setThreads([{id:first.threadId,projectId:project.id,title:'First question',updatedAt:new Date().toISOString(),settledOverride:'settled'}]);
    await restarted.sendChat('Follow up',{path:'Notes/Q.md'});
    const turns=h.commands.filter(command=>command.type==='thread.turn.start');
    assert.equal(turns.length,2);
    assert.equal(turns[1].threadId,first.threadId,'A settled thread remains the note’s destination');
    assert.equal(restarted.settings.settlementJobs.length,1);
  }finally{restarted?.onunload();h.plugin.onunload();}
});

test('Ask T3 keeps the answer in the T3 thread when its streaming switch is off',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.inlineStreaming.enabled=false;
    const context=h.editorMenu('Why is this here?');
    await context.menu.items.find(item=>item.title==='Ask T3 Code')!.callback();
    await h.modals.at(-1).choose(false);
    assert.doesNotMatch(context.value,/t3-inline:start/);
    assert.match(h.commands.at(-1).message.text,/Answer in the T3 thread\./);
    assert.doesNotMatch(h.commands.at(-1).message.text,/Do not edit the Obsidian note/);
  }finally{h.plugin.onunload();}
});

test('manual Send to T3 streams into the source editor but disabled and automatic sends do not',async()=>{
  const h=await chatHarness();
  try{
    const editor=h.attachEditor('Manual.md','# Manual\nPlease explain this.');
    const file=Object.assign(editor.file,{basename:'Manual',stat:{ctime:123}});
    const first=await h.plugin.send(file,project,{throwOnError:true});
    assert.equal(first.request.completion.action,'keep');
    assert.match(first.request.prompt,/Answer in the T3 thread\. The Obsidian plugin will insert your reply\./);
    assert.doesNotMatch(first.request.prompt,/Do not edit the Obsidian note/);
    assert.doesNotMatch(first.request.prompt,/t3-inline:start/);
    assert.match(editor.value,/t3-inline:start/);
    for(let attempt=0;attempt<200&&!editor.value.includes('Inline reply from T3.');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(editor.value,/Inline reply from T3\./);
    for(let attempt=0;attempt<40&&editor.value.includes('t3-inline:start');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.doesNotMatch(editor.value,/t3-inline:(?:start|end)/,'a finished response has no tracking lines');
    const continued=await h.plugin.send(file,project,{threadId:'existing',throwOnError:true});
    assert.equal(continued.threadId,'existing');
    assert.equal((editor.value.match(/t3-inline:start/g)??[]).length,1,'the new response is guarded while streaming');
    for(let attempt=0;attempt<200&&(editor.value.match(/Inline reply from T3\./g)??[]).length<2;attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal((editor.value.match(/Inline reply from T3\./g)??[]).length,2);
    for(let attempt=0;attempt<40&&editor.value.includes('t3-inline:start');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.doesNotMatch(editor.value,/t3-inline:(?:start|end)/,'both completed responses are plain Markdown');
    assert.doesNotMatch(editor.value,/\*\*T3 answer\*\*|`existing`/);
    h.plugin.settings.inlineStreaming.enabled=false;
    const before=editor.value;
    h.plugin.app.vault.read=async()=> '# Manual\nPlease explain this.';
    await h.plugin.send(file,project,{throwOnError:true});
    assert.equal(editor.value,before,'A disabled stream leaves the editor unchanged');
    h.plugin.settings.inlineStreaming.enabled=true;
    h.plugin.app.vault.read=async()=> '# Automatic tag note';
    await h.plugin.send(file,project,{quiet:true,throwOnError:true});
    assert.equal(editor.value,before,'An automatic tag send cannot append an inline reply');
  }finally{h.plugin.onunload();}
});

for(const composer of [false,true])test(`the ${composer?'composer':'destination'} closes before background delivery completes`,async()=>{
  let release!:()=>void,entered!:()=>void;
  const enteredTurn=new Promise<void>(resolve=>{entered=resolve;});
  const h=await chatHarness(async command=>{if(command.type==='thread.turn.start')await new Promise<void>(resolve=>{release=resolve;entered();});});
  try{
    await h.plugin.openChat(composer?undefined:'Background send');
    const modal=h.modals.at(-1);if(composer)modal.field.value='Background send';
    const sending=composer?modal.choose():modal.choose(false);
    assert.equal(modal.closed,true,'The editor is usable before any network response');
    await enteredTurn;
    assert.equal(h.plugin.settings.pending.length,1,'Retry is durable while sending');
    release();await sending;
    assert.equal(modal.closed,true);assert.equal(h.plugin.settings.pending.length,0);
  }finally{release?.();h.plugin.onunload();}
});

test('a background delivery failure keeps its saved request without opening settings',async()=>{
  const h=await chatHarness(async command=>{if(command.type==='thread.turn.start')throw Error('Disconnected');});
  try{
    h.plugin.openSettings=()=>assert.fail('A background send must not take over the editor');
    await h.plugin.openChat('Keep this request');const modal=h.modals.at(-1);await modal.choose(false);
    assert.equal(modal.closed,true);assert.equal(h.plugin.settings.pending.length,1);
  }finally{h.plugin.onunload();}
});


test('new inline responses capture the retention setting in their immutable hosted request',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.inlineStreaming.keepIntermediate=true;
    h.attachEditor('Notes/Retention.md','Question');
    await h.plugin.openPaletteAction('Explain this.','');
    await h.modals.at(-1).choose(false);
    // The durable handoff is created before dispatch and retains its preference.
    const job=h.plugin.inlineChat.activeFor('Notes/Retention.md')[0]??h.plugin.inlineChat.jobs.at(-1);
    assert.equal(job.keepIntermediate,true);
    const record=JSON.parse(h.hostFiles.get(leasePaths(job.hostTarget.directory,job.id).record)!);
    assert.equal(record.request.keepIntermediate,true);
    h.plugin.settings.inlineStreaming.keepIntermediate=false;
    assert.equal(job.keepIntermediate,true);
  }finally{h.plugin.onunload();}
});

function seedResponse(h:any,path:string,threadId:string,status='running'){
  const id=webcrypto.randomUUID(),region=initialRegion(id);
  const opened=h.attachEditor(path,'Synthetic selection\n'+region.text+'Tail');
  const host={environmentId:'chat-env',workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1',connectionId:'chat-connection'};
  const request={version:2,initialOwner:webcrypto.randomUUID(),id,vaultId:h.plugin.settings.vaultId,host,notePath:path,threadId,messageId:webcrypto.randomUUID(),projectId:project.id,threadEnvironmentId:'chat-env',initialHash:region.bodyHash,createdAt:'original-time'};
  const record={request,owner:request.initialOwner,epoch:1,revision:1,expiresAt:Date.now()+15_000,state:{accepted:true,notePath:path,status,turnId:status==='running'?'old-turn':null,hashes:[region.bodyHash],updatedAt:''}};
  const recordPath=leasePaths(host.directory,id).record;
  h.hostFiles.set(recordPath,JSON.stringify(record));
  return {id,opened,recordPath,originalRecord:h.hostFiles.get(recordPath)};
}

test('an accepted but undispatched response cannot advertise running or override an explicit existing thread',async()=>{
  const h=await chatHarness(),path='Notes/Orphan.md';
  try{
    const {opened,recordPath,originalRecord}=seedResponse(h,path,'never-created','waiting');
    h.plugin.settings.inlineStreaming.enabled=false;
    h.plugin.settings.noteThreads.push({notePath:path,threadId:'real-thread',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-10-05T00:00:00Z'});
    h.setThreads([{id:'real-thread',projectId:project.id,title:'Real conversation',updatedAt:'2026-10-05T00:00:00Z',session:{status:'ready'}}]);
    h.setReadOverride(id=>id==='never-created'?new Response('{}',{status:404}):undefined);
    await h.plugin.openPaletteAction('Follow up.','');
    const modal=h.modals.at(-1),button=h.settingsControls.at(-1).buttons[0];
    assert.equal(button.text,'Thread unavailable');assert.equal(button.buttonEl.disabled,true);
    assert.match(modal.contentEl.children.map((e:any)=>e.text).join('\n'),/does not exist/);
    await modal.choose('default');
    assert.equal(h.commands.length,0);assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(h.hostFiles.get(recordPath),originalRecord);assert.ok(opened.value.includes('Synthetic selection'));
    await modal.choose('existing');
    const picker=h.modals.at(-1);await picker.onChooseItem(picker.getItems()[0]);
    await waitForReply(()=>h.commands.some(c=>c.type==='thread.turn.start'),'explicit existing thread received the message');
    assert.deepEqual(h.commands.map(c=>c.threadId),['real-thread']);
    assert.equal(h.hostFiles.get(recordPath),originalRecord,'the orphan must not receive steering or cleanup');
  }finally{h.plugin.onunload();}
});

for(const active of [false,true])test(`selection and whole-note chooser agree on authenticated ${active?'running':'idle'} thread state`,async()=>{
  const h=await chatHarness(),path='Notes/StateLabels.md';
  try{
    const {opened}=seedResponse(h,path,'same-thread');
    h.plugin.settings.noteThreads.push({notePath:path,threadId:'same-thread',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-10-05T00:00:00Z'});
    h.setThreads([{id:'same-thread',projectId:project.id,title:'Same conversation',session:{status:active?'running':'ready',activeTurnId:active?'old-turn':null}}]);
    await h.plugin.openPaletteAction('Question.','');
    const selection=h.modals.at(-1),resolved=await selection.ready,label=h.settingsControls.at(-1).buttons[0].text;
    assert.equal(label,active?'Send to running thread':'Continue thread');
    assert.equal(resolved.responseId!==undefined,active,'idle stale headers do not extend the old binding');
    selection.close();h.plugin.openNoteSend(opened.file);await h.modals.at(-1).ready;
    assert.equal(h.settingsControls.at(-1).buttons[0].text,label);
    assert.equal(h.commands.length,0,'opening either chooser is read-only');
  }finally{h.plugin.onunload();}
});

test('the chooser freezes its response identity across subsequent editor projection changes',async()=>{
  const h=await chatHarness(),path='Notes/FrozenTarget.md';
  try{
    const {id,opened,recordPath}=seedResponse(h,path,'original-thread');
    h.setThreads([{id:'original-thread',projectId:project.id,title:'Original',session:{status:'running',activeTurnId:'old-turn'}}]);
    h.plugin.settings.inlineStreaming.enabled=false;
    await h.plugin.openPaletteAction('Keep this target.','');const modal=h.modals.at(-1);
    const before=opened.value,other=initialRegion(webcrypto.randomUUID()).text;
    opened.editor.replaceRange(other,opened.editor.offsetToPos(0),opened.editor.offsetToPos(before.length));
    // Keep the selected original anchor available but place a different response at the cursor.
    opened.editor.replaceRange(before,opened.editor.offsetToPos(0));
    await modal.choose('default');
    assert.deepEqual(h.commands.map(c=>c.threadId),['original-thread']);
    const record=JSON.parse(h.hostFiles.get(recordPath)!);assert.equal(record.request.id,id);
    assert.equal(record.state.steering[0].text,'Keep this target.');
  }finally{h.plugin.onunload();}
});

test('a stale response cannot steer a different active provider turn in the same thread',async()=>{
  const h=await chatHarness(),path='Notes/DifferentTurn.md';
  try{
    const {recordPath,originalRecord}=seedResponse(h,path,'same-thread');
    h.setThreads([{id:'same-thread',projectId:project.id,title:'Same thread',session:{status:'running',activeTurnId:'unrelated-turn'}}]);
    await h.plugin.openPaletteAction('Stay scoped.','');const modal=h.modals.at(-1);
    assert.equal(h.settingsControls.at(-1).buttons[0].text,'Thread unavailable');
    await modal.choose('default');
    assert.equal(h.commands.length,0);assert.equal(h.hostFiles.get(recordPath),originalRecord);
  }finally{h.plugin.onunload();}
});

test('a thread disappearing after validation does not save, dispatch, move text or suggest retrying an unsaved request',async()=>{
  const h=await chatHarness(),path='Notes/Disappear.md';
  try{
    const {opened,recordPath,originalRecord}=seedResponse(h,path,'gone-thread');
    h.setThreads([{id:'gone-thread',projectId:project.id,title:'Temporary',session:{status:'running',activeTurnId:'old-turn'}}]);
    await h.plugin.openPaletteAction('Preserve this.','');const modal=h.modals.at(-1),document=opened.value;
    h.setReadOverride(()=>new Response('{}',{status:404}));await modal.choose('default');
    assert.equal(h.commands.length,0);assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(opened.value,document);assert.equal(h.hostFiles.get(recordPath),originalRecord);
    assert.doesNotMatch(h.notices.at(-1)!,/Retry the saved request/);
    await assert.rejects(h.plugin.sendChat('Also preserve.',{path},{threadId:'gone-thread'}),(e:any)=>e.requestSaved===false&&/No message was sent or queued/.test(e.message)&&!/Retry the saved request/.test(e.message));
  }finally{h.plugin.onunload();}
});

test('closing a chooser during thread validation cannot deliver a queued Enter action',async()=>{
  const h=await chatHarness(),path='Notes/CancelledCheck.md';let release!:(r:Response)=>void;
  try{
    const {opened}=seedResponse(h,path,'slow-thread');
    h.setReadOverride(()=>new Promise<Response>(resolve=>{release=resolve;}));
    const opening=h.plugin.openPaletteAction('Cancelled question.','');
    await waitForReply(()=>!!release,'read-only validation started');const modal=h.modals.at(-1),document=opened.value;
    const sending=modal.choose('default');modal.close();
    release(new Response(JSON.stringify({thread:{id:'slow-thread',projectId:project.id,session:{status:'running'}}})));
    await opening;await sending;
    assert.equal(h.commands.length,0);assert.equal(h.plugin.settings.pending.length,0);assert.equal(opened.value,document);
  }finally{h.plugin.onunload();}
});

for(const streamingDefault of [false,true])for(const destination of ['default','new'])test(`a synced running response accepts palette ${destination} with streaming default ${streamingDefault} and no local thread history`,async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/Steering.md',region=initialRegion(id);
  try{
    const body='**T3 · Working**\n\n> Earlier progress.\n',edit=replaceRegion(region.text,id,region.bodyHash,body)!;
    const opened=h.attachEditor(path,'Before'+region.text.slice(0,edit.from)+edit.text+region.text.slice(edit.to)+'After');
    const host={environmentId:'chat-env',workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1',connectionId:'chat-connection'};
    h.plugin.settings.inlineStreaming.enabled=streamingDefault;
    const initialMessage=webcrypto.randomUUID(),request={version:2 as const,initialOwner:webcrypto.randomUUID(),id,vaultId:h.plugin.settings.vaultId,host,notePath:path,threadId:'old-thread',messageId:initialMessage,projectId:project.id,threadEnvironmentId:'chat-env',initialHash:region.bodyHash,createdAt:'original-time',intermediateMode:'collapse' as const,keepIntermediate:true,finalAnswerFormat:'raw-markdown' as const};
    h.hostFiles.set(leasePaths(host.directory,id).record,JSON.stringify({request,owner:request.initialOwner,epoch:1,revision:1,expiresAt:Date.now()+15_000,state:{requestHash:hostedRequestHash(request),accepted:true,notePath:path,status:'running',hashes:[region.bodyHash,contentHash(body)],turnId:'old-turn',prose:[{id:'old-progress',role:'assistant',text:'Earlier progress.',turnId:'old-turn',streaming:false}],updatedAt:''}}));
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Working',session:{status:'running',activeTurnId:'old-turn'},latestTurn:{turnId:'old-turn',state:'running',requestedAt:'original-time'},messages:[{id:initialMessage,role:'user',createdAt:'original-time'}]}]);
    await h.plugin.openPaletteAction('Change the approach.','');
    assert.deepEqual(h.settingsControls.at(-1).buttons.map((button:any)=>button.text),['Send to running thread','New thread','Existing thread…']);
    const destinationModal=h.modals.at(-1);
    editOverrides(h,destinationModal,{'Stream replies into the editor':'on','Intermediate agent responses':'remove','Final answer format':'formatted'});
    if(destination==='default')editOverrides(h,destinationModal,{'Stream replies into the editor':'off'});
    if(destination==='new')h.setStreaming(true);
    await destinationModal.choose(destination);
    if(destination==='new'){
      assert.equal(h.commands[0].type,'thread.create');
      assert.notEqual(h.commands[0].threadId,'old-thread');
      assert.equal(h.commands[1].threadId,h.commands[0].threadId);
      assert.equal((opened.value.match(/t3-inline:start:/g)??[]).length,2);
      assert.equal(JSON.parse(h.hostFiles.get(leasePaths(host.directory,id).record)!).state.steering,undefined);
      return;
    }
    assert.equal(h.commands.length,1);assert.equal(h.commands[0].threadId,'old-thread');assert.equal(h.commands[0].type,'thread.turn.start');
    assert.equal((opened.value.match(/t3-inline:start:/g)??[]).length,1);
    const record=JSON.parse(h.hostFiles.get(leasePaths(host.directory,id).record)!);
    assert.equal(record.state.steering.length,1);assert.equal(record.state.steering[0].text,'Change the approach.');
    assert.equal(record.request.intermediateMode,'collapse');assert.equal(record.request.finalAnswerFormat,'raw-markdown');
    assert.equal(record.owner,request.initialOwner,'another device can send without preempting the writer');
    const settlement=h.plugin.settings.settlementJobs[0];assert.equal(settlement.inlineJobId,id);assert.deepEqual(JSON.parse(JSON.stringify(settlement.inlineHost)),host);
  }finally{h.plugin.onunload();}
});

for(const surface of ['editor','ordinary-ask','palette','explicit-target'])test(`Targeted Ask via ${surface} remains enabled during local streaming and moves only the captured text`,async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/SelectedSteering.md',region=initialRegion(id);
  try{
    const selected='Use a simpler approach.',opened=h.attachEditor(path,selected+'\n'+region.text+'Tail');
    opened.editor.getSelection=()=>selected;
    opened.editor.getCursor=(side:string)=>opened.editor.offsetToPos(side==='from'?0:selected.length);
    const job={id,path,requestId:id,bodyHash:region.bodyHash,phase:'running',createdAt:'original-time',threadId:'old-thread',turnId:'old-turn',messageId:webcrypto.randomUUID(),projectId:project.id,connection:{transport:'direct',host:'direct',url:'https://chat.example',connectionId:'chat-connection',environmentId:'chat-env',executable:''}};
    const manager=(h.plugin as any).inlineChat;manager.jobs.push(job);
    const runtime=manager.runtime(job);runtime.sequence=1;runtime.state={messages:[{id:'progress',role:'assistant',turnId:'old-turn',text:'Earlier progress.',streaming:false}],activities:[]};
    const ask=h.menuFor(opened.view).items.find(item=>item.title==='Ask T3 in this response');assert.ok(ask);assert.equal(ask.disabled,false);
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Working',session:{status:'running',activeTurnId:'old-turn'},latestTurn:{turnId:'old-turn',state:'running',requestedAt:'original-time'}}]);
    if(surface==='editor')await ask.callback();
    else if(surface==='ordinary-ask')await h.menuFor(opened.view).items.find(item=>item.title==='Ask T3 Code')!.callback();
    else if(surface==='palette')await h.plugin.openPaletteAction('',selected);
    else h.plugin.openEditorChat(selected,opened.file,{editor:opened.editor,view:opened.view,anchor:{text:selected,start:0,end:selected.length,before:'',after:'\n'+region.text.slice(0,23)},responseId:id});
    await h.modals.at(-1).ready;
    assert.equal(h.settingsControls.at(-1).buttons[0].text,'Send to running thread');
    await h.modals.at(-1).choose(false);
    assert.equal(h.commands.length,1);assert.ok(opened.value.startsWith(selected),'text remains until T3 confirms its message');
    const command=h.commands[0];
    manager.receive(job,{kind:'snapshot',snapshot:{snapshotSequence:3,thread:{messages:[{id:command.message.messageId,role:'user',text:command.message.text,streaming:false,createdAt:command.createdAt},{id:'final',role:'assistant',turnId:'next-turn',text:'Changed approach.',streaming:false}],activities:[],latestTurn:{turnId:'next-turn',state:'completed',requestedAt:command.createdAt,assistantMessageId:'final'},session:{status:'ready',activeTurnId:null}}}});
    manager.flush(job);
    assert.equal((opened.value.match(/Use a simpler approach\./g)??[]).length,1);assert.ok(!opened.value.startsWith(selected));
    assert.match(opened.value,/Earlier progress\.[\s\S]*\[!t3-steering\] You[\s\S]*Use a simpler approach\.[\s\S]*Changed approach\./);
    assert.doesNotMatch(opened.value,/t3-inline:/);assert.match(opened.value,/Tail/);
  }finally{h.plugin.onunload();}
});

test('the full-note modal changes project for one send without reusing another project’s last thread or changing folder links',async()=>{
  const h=await chatHarness();
  try{
    const other={id:'other-project',title:'Other work',workspaceRoot:'/projects/other',connectionId:project.connectionId,connectionName:'Laptop'};
    h.plugin.settings.directProjects.push(other);h.setProjects([project,other]);
    h.plugin.settings.inlineStreaming.enabled=false;
    h.plugin.app.vault.read=async()=> '# Complete note\nKeep this full-note payload.';
    const path='Notes/Whole.md',file={path,basename:'Whole',extension:'md',stat:{ctime:123}};
    h.plugin.settings.noteThreads.push({notePath:path,threadId:'old-thread',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-28T00:00:00Z'});
    const links=JSON.stringify(h.plugin.settings.folderLinks);
    h.plugin.openNoteSend(file);
    const destination=h.modals.at(-1);
    await destination.ready;
    assert.equal(destination.constructor.name,'SendDestinationModal');
    assert.deepEqual(h.settingsControls.at(-1).buttons.map((button:any)=>button.text),['Continue thread','New thread','Existing thread…']);
    const pathButton=destination.contentEl.children[0].children[0];
    assert.equal(pathButton.tag,'button');assert.equal(pathButton.text,project.title);
    pathButton.click();
    const picker=h.modals.at(-1);picker.onChooseItem(picker.getItems().find((item:any)=>item.key==='chat-connection:other-project'));
    assert.deepEqual(h.settingsControls.at(-1).buttons.map((button:any)=>button.text),['New thread','Existing thread…']);
    assert.equal(destination.contentEl.children[0].children[0].text,other.title,'The project button follows the selected destination');
    await destination.choose('new');
    assert.equal(h.commands[0].projectId,other.id);
    assert.notEqual(h.commands[0].threadId,'old-thread');
    assert.match(h.commands[1].message.text,/# Complete note\nKeep this full-note payload\./);
    assert.equal(JSON.stringify(h.plugin.settings.folderLinks),links);
    assert.equal(h.plugin.settings.noteThreads.length,2,'Both previous and newly confirmed destinations remain in history');
  }finally{h.plugin.onunload();}
});

test('changing project in the typed composer preserves the draft and uses the compact destination controls',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Notes/Draft.md');
    await h.plugin.openChat();
    const composer=h.modals.at(-1);
    composer.field.value='Keep my unsent question.';
    composer.contentEl.children[0].children[0].click();
    const picker=h.modals.at(-1);picker.onChooseItem(picker.getItems()[0]);
    assert.equal(composer.field.value,'Keep my unsent question.');
    assert.equal(composer.contentEl.children[0].children[0].text,project.title);
    assert.deepEqual(h.settingsControls.at(-1).buttons.map((button:any)=>button.text),['New thread','Existing thread…']);
    assert.equal(h.commands.length,0);
    composer.close();assert.equal(h.commands.length,0);
  }finally{h.plugin.onunload();}
});

test('legacy saved send requests still remember their confirmed note thread',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.rememberStarted({id:webcrypto.randomUUID(),project,connection:{executable:'',host:'direct',connectionId:project.connectionId},title:'Old request',prompt:'Old payload',noteLink:{notePath:'Notes/Legacy.md',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId}},'confirmed-legacy-thread');
    assert.equal(h.plugin.settings.noteThreads[0].threadId,'confirmed-legacy-thread');
  }finally{h.plugin.onunload();}
});

for(const streaming of [false,true])test(`selection questions attach local images through editor and palette (streaming ${streaming})`,async()=>{
  const h=await chatHarness();
  try{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64');
    const resolved:any[]=[];
    h.plugin.app.metadataCache={getFirstLinkpathDest:(link:string,source:string)=>{resolved.push({link,source});return {path:'Attachments/picture.png',name:'picture.png',stat:{size:png.length}};}};
    h.plugin.app.vault.readBinary=async()=>png;
    h.plugin.settings.inlineStreaming.enabled=streaming;
    const selected='Before\n![[picture.png|300]]\n![again](picture.png)\nAfter';
    const context=h.editorMenu(selected,'Notes/Image selection.md');
    await context.menu.items.find(item=>item.title==='Ask T3 Code')!.callback();
    await h.modals.at(-1).choose(false);
    const first=h.commands.find(command=>command.type==='thread.turn.start');
    assert.equal(first.message.attachments.length,1,'Repeated embeds share the same native attachment');
    assert.equal(first.message.attachments[0].dataUrl,'data:image/png;base64,'+png.toString('base64'));
    assert.equal(first.message.context.records[0].attachmentId,first.message.attachments[0].id);
    assert.match(first.message.text,/Before\n\[.*\]\(t3-context:\/\/.*\)\n\[.*\]\(t3-context:\/\/.*\)\nAfter/);
    assert.doesNotMatch(first.message.text,/Tail/,'Unselected text stays out of the request');
    assert.equal(resolved[0].source,'Notes/Image selection.md');
    if(streaming)await waitForReply(()=>context.value.includes('Inline reply from T3.')&&!context.value.includes('t3-inline:start:'),'Selected-image reply completes');
    const palette=h.attachEditor('Notes/Palette images.md',selected+'\nUnselected ![[outside.png]]');
    await h.plugin.openPaletteAction('Describe it.',selected);
    await h.modals.at(-1).choose(false);
    const next=h.commands.filter(command=>command.type==='thread.turn.start').at(-1);
    assert.equal(next.message.attachments.length,1);
    assert.match(next.message.text,/Selected text:\nBefore/);
    assert.match(next.message.text,/Question:\nDescribe it\./);
    assert.equal(resolved.at(-1).source,'Notes/Palette images.md');
    if(streaming)await waitForReply(()=>palette.value.includes('Inline reply from T3.')&&!palette.value.includes('t3-inline:start:'),'Palette-image reply completes');
    const hotkey=h.attachEditor('Notes/Hotkey images.md',selected+'\nUnselected ![[outside.png]]');
    hotkey.editor.getSelection=()=>selected;
    hotkey.editor.getCursor=(side:string)=>hotkey.editor.offsetToPos(side==='from'?0:selected.length);
    h.registered.find(command=>command.id==='send-or-ask').editorCheckCallback(false,hotkey.editor,hotkey.view);
    await h.modals.at(-1).choose('new');
    const last=h.commands.filter(command=>command.type==='thread.turn.start').at(-1);
    assert.equal(last.message.attachments.length,1);
    assert.match(last.message.text,/^Before/);
    assert.doesNotMatch(last.message.text,/Unselected|outside.png/);
    assert.equal(resolved.at(-1).source,'Notes/Hotkey images.md');
  }finally{h.plugin.onunload();}
});

test('selection image failures stop delivery before creating a thread or saving a pending request',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.app.metadataCache={getFirstLinkpathDest:()=>null};
    await assert.rejects(h.plugin.sendChat('![[missing.png]]',{path:'Notes/Image.md'}),/Embedded image not found/);
    await assert.rejects(h.plugin.sendChat('![bad](data:image/png;base64,AAAA)',{path:'Notes/Image.md'}),/Unsupported or invalid image/);
    assert.equal(h.commands.length,0);
    assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(h.plugin.busy,false);
  }finally{h.plugin.onunload();}
});

test('selected reference images resolve definitions elsewhere in the note without sending other content',async()=>{
  const h=await chatHarness();
  try{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64');
    h.attachEditor('Notes/Reference.md','Selected ![figure][shot]\n\nUnselected content ![[outside.png]]\n\n[shot]: picture.png');
    h.plugin.app.metadataCache={getFirstLinkpathDest:(link:string,source:string)=>{assert.equal(link,'picture.png');assert.equal(source,'Notes/Reference.md');return {name:'picture.png',stat:{size:png.length}};}};
    h.plugin.app.vault.readBinary=async()=>png;
    await h.plugin.sendChat('Selected ![figure][shot]',{path:'Notes/Reference.md'},{threadId:'existing'});
    assert.equal(h.commands[0].threadId,'existing');
    assert.equal(h.commands[0].message.attachments.length,1);
    assert.match(h.commands[0].message.text,/Selected \[.*\]\(t3-context:\/\//);
    assert.doesNotMatch(h.commands[0].message.text,/Unselected|outside.png|\[shot\]:/);
  }finally{h.plugin.onunload();}
});


test('cancelling unlinked dialogs or browsing existing threads creates no project or folder link',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Unlinked/draft.md');
    const before=JSON.stringify(h.plugin.settings.folderLinks);
    await h.plugin.openChat('Keep this unsent');
    h.modals.at(-1).close();
    assert.equal(h.commands.length,0);
    await h.plugin.openChat('Look for threads');await h.modals.at(-1).choose('existing');
    assert.equal(h.modals.at(-1).getItems().length,0);
    assert.equal(h.commands.length,0);assert.equal(JSON.stringify(h.plugin.settings.folderLinks),before);
  }finally{h.plugin.onunload();}
});

test('choosing the vault project sends there without linking the containing folder',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Unlinked/draft.md');await h.plugin.openChat('Use vault notes');
    const modal=h.modals.at(-1);modal.contentEl.children[0].children[0].click();
    const picker=h.modals.at(-1);picker.onChooseItem(picker.getItems()[1]);
    assert.equal(modal.contentEl.children[0].children[0].text,project.title);
    await modal.choose('new');
    assert.deepEqual(h.commands.map(c=>c.type),['thread.create','thread.turn.start']);
    assert.equal(h.commands[0].projectId,project.id);
    assert.equal(h.plugin.settings.folderLinks.some((link:any)=>link.folderPath==='Unlinked'),false);
  }finally{h.plugin.onunload();}
});

test('mobile reuses a chosen external project and links only after confirmed delivery',async()=>{
  let lose=true;
  const h=await chatHarness(async command=>{if(command.type==='thread.turn.start'&&lose){lose=false;throw Error('Lost response');}});
  try{
    const folder={...project,id:'existing-folder',title:'Unlinked',workspaceRoot:'/workspaces/unlinked'};
    h.setProjects([project,folder]);
    h.plugin.pickFolderProject=async()=>folder;
    await assert.rejects(h.plugin.sendChat('Use existing project',{path:'Unlinked/draft.md'},{newThread:true}),/Unconfirmed/);
    assert.equal(h.commands[0].projectId,folder.id);
    assert.equal(h.commands.some(c=>c.type==='project.create'),false);
    assert.equal(h.plugin.settings.folderLinks.some((link:any)=>link.folderPath==='Unlinked'),false);
    const pending=h.plugin.settings.pending[0];assert.equal(pending.folderLinkIntent.projectId,folder.id);
    await h.plugin.retry(pending);
    assert.equal(h.plugin.settings.folderLinks.find((link:any)=>link.folderPath==='Unlinked').projectId,folder.id);
    assert.equal(h.commands.filter(c=>c.type==='thread.create').length,1);
  }finally{h.plugin.onunload();}
});

test('mobile project creation uses the chosen external location and reuses its project',async()=>{
  const h=await chatHarness();
  try{
    const location=await h.plugin.projectLocation({id:project.connectionId,name:'Laptop'});
    try{
      assert.equal((await location.browse('/workspaces/app')).parentPath,'/workspaces/app');
      const created=await location.create('/workspaces/app','App');
      assert.deepEqual(h.commands.map(c=>c.type),['project.create']);
      assert.equal(h.commands[0].workspaceRoot,'/workspaces/app');
      assert.equal(h.commands[0].title,'App');assert.equal(created.connectionId,project.connectionId);
      assert.equal((await location.create('/workspaces/app','App')).id,created.id);
      assert.equal(h.commands.length,1);
      assert.equal(h.plugin.settings.folderLinks.some((link:any)=>link.workspaceRoot==='/workspaces/app'),false);
    }finally{location.close();}
  }finally{h.plugin.onunload();}
});


test('disabled diagnostics create no journal or diagnostic threads',async()=>{
  const h=await chatHarness();try{
    assert.equal(h.plugin.diagnostics,undefined);
    assert.equal(h.commands.length,0);assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(h.registered.some(command=>command.id==='report-plugin-problem'),false);
    assert.equal(h.plugin.sendDiagnosticIncident,undefined);assert.equal(h.plugin.diagnosticPreferences,undefined);
  }finally{h.plugin.onunload();}
});

test('agent note commands combine many threads per note, mirrored responses, attachment, and idempotent replay',{timeout:15000},async()=>{
  const h=await chatHarness();
  try{
    h.setStreaming(true);
    const a=h.attachEditor('Notes/Combined-A.md','Source A: explain alpha.\n');
    const b=h.attachEditor('Notes/Combined-B.md','Source B: explain beta.\n');
    h.plugin.app.workspace.getLeavesOfType=()=>[{view:a.view},{view:b.view}];
    Object.assign(a.file,{basename:'Combined-A',extension:'md',stat:{ctime:123}});
    Object.assign(b.file,{basename:'Combined-B',extension:'md',stat:{ctime:124}});
    h.plugin.app.vault.getFileByPath=(path:string)=>path===a.file.path?a.file:path===b.file.path?b.file:undefined;
    const first={version:1,id:webcrypto.randomUUID(),kind:'send-note',notePath:a.file.path,destinations:[a.file.path,b.file.path],streamReply:true};
    const x=await h.plugin.executeNoteCommand(first);
    assert.equal(x.ok,true);assert.equal(x.bindingIds.length,2);
    const receipt=h.plugin.app.loadLocalStorage(`send-to-t3-code-device-v1-note-command-${first.id}`);
    assert.equal(receipt.request,undefined,'Terminal receipt must not retain prepared prompt or attachments');
    const y=await h.plugin.executeNoteCommand({...first,id:webcrypto.randomUUID(),notePath:b.file.path});
    assert.notEqual(x.threadId,y.threadId);assert.equal(y.bindingIds.length,2);
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal((a.value.match(/t3-inline:start:/g)??[]).length,2);
    assert.equal((b.value.match(/t3-inline:start:/g)??[]).length,2);
    const turns=h.commands.filter(command=>command.type==='thread.turn.start');
    assert.equal(turns.length,2,'Four destinations dispatch exactly two prompts');
    assert.ok(turns[0].message.text.startsWith('Source A: explain alpha.'));
    assert.ok(turns[1].message.text.startsWith('Source B: explain beta.'));
    const count=h.commands.length;
    assert.deepEqual(JSON.parse(JSON.stringify(await h.plugin.executeNoteCommand(first))),JSON.parse(JSON.stringify(x)));
    assert.equal(h.commands.length,count,'Replay creates no additional turns or blocks');
    await assert.rejects(h.plugin.executeNoteCommand({...first,notePath:b.file.path}),/different input/);
    // Attach the first response again, using its exact original user message.
    const attached=await h.plugin.executeNoteCommand({version:1,id:webcrypto.randomUUID(),kind:'attach-response',notePath:a.file.path,destinations:[a.file.path],threadId:x.threadId,messageId:x.messageId,streamReply:true});
    assert.equal(attached.bindingIds.length,1);assert.equal(h.commands.length,count,'Attachment never sends a prompt');
    assert.equal((a.value.match(/t3-inline:start:/g)??[]).length,3);
    h.setStreaming(false);
    await waitForReply(()=>!a.value.includes('t3-inline:start:')&&!b.value.includes('t3-inline:start:'),'All independent mirror destinations complete');
    assert.equal((a.value.match(/Inline reply from T3\./g)??[]).length,3);
    assert.equal((b.value.match(/Inline reply from T3\./g)??[]).length,2,b.value);
    assert.doesNotMatch(a.value,/t3-response:(?:start|end):/);
    assert.doesNotMatch(b.value,/t3-response:(?:start|end):/);
    assert.doesNotMatch(a.value,/t3-inline:start:|T3 · Working/);
    assert.doesNotMatch(b.value,/t3-inline:start:|T3 · Working/);
    assert.ok(a.value.startsWith('Source A: explain alpha.'));
    assert.ok(b.value.startsWith('Source B: explain beta.'));
    const jobs=h.plugin.settings.settlementJobs;
    assert.equal(jobs.length,2);
    for(const job of jobs)assert.equal(await h.plugin.inlineSettlementStatus(job),'ready');
  }finally{h.plugin.onunload();}
});

test('reload compacts legacy terminal receipts while preserving unresolved payloads',async()=>{
  const h=await chatHarness();let restarted:any;
  try{
    const command={version:1,id:webcrypto.randomUUID(),kind:'send-note',notePath:'Notes/Old.md',destinations:[],streamReply:false};
    const terminalKey=`send-to-t3-code-device-v1-note-command-${command.id}`,pendingKey=`send-to-t3-code-device-v1-note-command-${webcrypto.randomUUID()}`;
    h.plugin.app.saveLocalStorage(terminalKey,{command,request:{prompt:'OLD_PRIVATE_BODY',attachments:[{dataUrl:'PRIVATE_IMAGE'}]},result:{id:command.id,ok:true,threadId:'thread',messageId:'message',bindingIds:[]}});
    h.plugin.app.saveLocalStorage(pendingKey,{command:{...command,id:pendingKey.slice(-36)},request:{prompt:'UNRESOLVED_PRIVATE_BODY'}});
    h.plugin.onunload();restarted=await h.start();
    assert.equal(restarted.app.loadLocalStorage(terminalKey).request,undefined);
    assert.equal(restarted.app.loadLocalStorage(pendingKey).request.prompt,'UNRESOLVED_PRIVATE_BODY');
  }finally{restarted?.onunload();h.plugin.onunload();}
});

test('discarding an unconfirmed agent command compacts its payload and refuses replay',async()=>{
  const h=await chatHarness(async command=>{if(command.type==='thread.turn.start')throw Error('lost acknowledgement');});
  try{
    const note=h.attachEditor('Notes/Discard.md','Private note body.');Object.assign(note.file,{basename:'Discard',stat:{ctime:123}});h.plugin.app.vault.getFileByPath=()=>note.file;
    const command={version:1,id:webcrypto.randomUUID(),kind:'send-note',notePath:note.file.path,destinations:[],streamReply:false};
    await assert.rejects(h.plugin.executeNoteCommand(command));
    const request=h.plugin.settings.pending.find((r:any)=>r.id===command.id);assert.ok(request);
    await h.plugin.discardRequest(request);
    const receipt=h.plugin.app.loadLocalStorage(`send-to-t3-code-device-v1-note-command-${command.id}`);
    assert.equal(receipt.request,undefined);assert.equal(receipt.discarded,true);
    const count=h.commands.length;await assert.rejects(h.plugin.executeNoteCommand(command),/discarded/);assert.equal(h.commands.length,count);
  }finally{h.plugin.onunload();}
});

test('an agent send retries a lost delivery acknowledgement with the exact durable commands',{timeout:10000},async()=>{
  let fail=true,restarted:any;
  const h=await chatHarness(async command=>{if(fail&&command.type==='thread.turn.start'){fail=false;throw Error('lost acknowledgement');}});
  try{
    const note=h.attachEditor('Notes/AgentRetry.md','Retry this exact source.');
    Object.assign(note.file,{basename:'AgentRetry',stat:{ctime:123}});
    h.plugin.app.vault.getFileByPath=()=>note.file;
    const command={version:1,id:webcrypto.randomUUID(),kind:'send-note',notePath:note.file.path,destinations:[note.file.path],streamReply:true};
    await assert.rejects(h.plugin.executeNoteCommand(command),/lost acknowledgement|retry|Cannot reach T3/i);
    const original=h.commands.filter(item=>item.type==='thread.turn.start')[0];assert.ok(original);
    h.plugin.onunload();restarted=await h.start();
    const result=await restarted.executeNoteCommand(command);
    assert.equal(result.ok,true);
    const repeated=h.commands.filter(item=>item.type==='thread.turn.start');assert.equal(repeated.length,2);
    assert.deepEqual(JSON.parse(JSON.stringify(repeated[1])),JSON.parse(JSON.stringify(original)),'Replay includes original timestamps, prompt and command IDs');
    assert.equal((note.value.match(/t3-inline:start:/g)??[]).length,1);
    assert.equal(h.commands.filter(item=>item.type==='thread.create').length,1,'An acknowledged thread creation is not repeated');
  }finally{restarted?.onunload();h.plugin.onunload();}
});

for(const hosted of [false,true])for(const surface of ['editor','targeted','palette','boundary','other-response'])test(`response selection is copied through ${surface} steering on the ${hosted?'hosted':'local'} writer after streaming changes`,async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/ResponseSelection.md',initial=initialRegion(id);
  try{
    const body='**T3 · Working**\n\n> Captured claim.',change=replaceRegion(initial.text,id,initial.bodyHash,body)!;
    const original='Before'+initial.text.slice(0,change.from)+change.text+initial.text.slice(change.to)+'Tail';
    const other=webcrypto.randomUUID(),otherRegion=initialRegion(other),otherChange=replaceRegion(otherRegion.text,other,otherRegion.bodyHash,'**T3 · Working**\n\n> Other claim.')!;
    const opened=h.attachEditor(path,original+(surface==='other-response'?otherRegion.text.slice(0,otherChange.from)+otherChange.text+otherRegion.text.slice(otherChange.to):''));
    const start=surface==='boundary'?0:opened.value.indexOf(surface==='other-response'?'Other claim.':'Captured claim.');
    const end=surface==='other-response'?start+'Other claim.'.length:opened.value.indexOf('Captured claim.')+'Captured claim.'.length;
    const selected=opened.value.slice(start,end);
    opened.editor.getSelection=()=>selected;opened.editor.getCursor=(side:string)=>opened.editor.offsetToPos(side==='from'?start:end);
    const messageId=webcrypto.randomUUID(),prose=[{id:'progress',role:'assistant',turnId:'old-turn',text:'Captured claim.',streaming:false}];
    h.plugin.settings.inlineStreaming.enabled=false;
    const manager=h.plugin.inlineChat;
    const job:any={id,path,requestId:id,bodyHash:contentHash(body),phase:'running',createdAt:'original-time',threadId:'old-thread',turnId:'old-turn',messageId,projectId:project.id,prose,connection:{transport:'direct',host:'direct',url:'https://chat.example',connectionId:'chat-connection',environmentId:'chat-env',executable:''}};
    const host={environmentId:'chat-env',workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1',connectionId:'chat-connection'};
    if(hosted){
      const request={version:2,initialOwner:webcrypto.randomUUID(),id,vaultId:h.plugin.settings.vaultId,host,notePath:path,threadId:'old-thread',messageId,projectId:project.id,threadEnvironmentId:'chat-env',initialHash:initial.bodyHash,createdAt:'original-time'};
      h.hostFiles.set(leasePaths(host.directory,id).record,JSON.stringify({request,owner:request.initialOwner,epoch:1,revision:1,expiresAt:Date.now()+15_000,state:{requestHash:hostedRequestHash(request as any),accepted:true,notePath:path,status:'running',hashes:[contentHash(body)],turnId:'old-turn',prose,updatedAt:''}}));
    }else {manager.jobs.push(job);const runtime=manager.runtime(job);runtime.sequence=1;runtime.state={messages:prose,activities:[]};}
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Working',session:{status:'running',activeTurnId:'old-turn'},latestTurn:{turnId:'old-turn',state:'running',requestedAt:'original-time'}}]);
    if(surface==='palette')await h.plugin.openPaletteAction('Explain this claim.',selected);
    else if(surface==='editor'||surface==='targeted')await h.menuFor(opened.view).items.find(item=>item.title===(surface==='editor'?'Ask T3 Code':'Ask T3 in this response'))!.callback();
    else h.plugin.openEditorChat(selected,opened.file,{editor:opened.editor,view:opened.view,anchor:{text:selected,start,end,before:opened.value.slice(Math.max(0,start-24),start),after:opened.value.slice(end,end+24)},responseId:id});
    const expanded=body+' More streamed text.',region=regionBody(opened.value,id)!;
    opened.editor.replaceRange(expanded,opened.editor.offsetToPos(region.from),opened.editor.offsetToPos(region.to));
    if(hosted){const record=JSON.parse(h.hostFiles.get(leasePaths(host.directory,id).record)!);record.state.hashes.push(contentHash(expanded));h.hostFiles.set(leasePaths(host.directory,id).record,JSON.stringify(record));}
    else job.bodyHash=contentHash(expanded);
    await h.modals.at(-1).choose(false);
    assert.equal(h.commands.length,1);assert.equal(h.commands[0].threadId,'old-thread');assert.ok(h.commands[0].message.text.includes(selected));
    const input=hosted?JSON.parse(h.hostFiles.get(leasePaths(host.directory,id).record)!).state.steering[0]:job.steering[0];
    assert.equal(input.selection,undefined,'generated context must never become a removal anchor');
    assert.ok(opened.value.includes('Captured claim. More streamed text.'));
    if(surface==='palette')assert.match(input.text,/Question:\nExplain this claim\./);
    if(!hosted){
      const command=h.commands[0];
      manager.receive(job,{kind:'snapshot',snapshot:{snapshotSequence:3,thread:{messages:[{id:command.message.messageId,role:'user',text:command.message.text,streaming:false,createdAt:command.createdAt},{id:'final',role:'assistant',turnId:'next-turn',text:'Changed approach.',streaming:false}],activities:[],latestTurn:{turnId:'next-turn',state:'completed',requestedAt:command.createdAt,assistantMessageId:'final'},session:{status:'ready',activeTurnId:null}}}});
      manager.flush(job);
      assert.match(opened.value,/Captured claim\.[\s\S]*\[!t3-steering\] You[\s\S]*Changed approach\./);
      assert.ok(opened.value.startsWith('Before'));assert.match(opened.value,/Tail/);
      if(surface==='other-response')assert.ok(opened.value.endsWith(otherRegion.text.slice(0,otherChange.from)+otherChange.text+otherRegion.text.slice(otherChange.to)));
    }
  }finally{h.plugin.onunload();}
});

 test('project creation rejects remote vault paths before registering anything',async()=>{
  const h=await chatHarness();
  try{
    const location=await h.plugin.projectLocation({id:project.connectionId,name:'Laptop'});
    try{
      for(const path of ['/projects/notes','/projects/notes/Build','/projects/other/../notes/Build'])await assert.rejects(location.create(path,'Forbidden'),/outside the Obsidian vault/);
      assert.equal(h.commands.length,0);
      assert.equal(h.plugin.settings.folderLinks.some((link:any)=>link.folderPath==='Build'),false);
    }finally{location.close();}
  }finally{h.plugin.onunload();}
});

function editOverrides(h:Awaited<ReturnType<typeof chatHarness>>,destination:any,choices:Record<string,string>){
  destination.contentEl.children[0].children[1].click();
  const modal=h.modals.at(-1);
  for(const [name,value] of Object.entries(choices)){
    const control=h.settingsControls.filter((setting:any)=>setting.name===name).at(-1) as any;
    assert.ok(control?.dropdown);assert.equal(control.dropdown.disabled,false);control.dropdown.change(value);
  }
  h.settingsControls.at(-1).buttons.find((b:any)=>b.text==='Apply').click();
  return modal;
}

for(const surface of ['editor','palette','hotkey','full-note'])for(const enabled of [true,false])test(`${surface} overrides streaming ${enabled?'On against default Off':'Off against default On'} without changing settings`,async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.inlineStreaming.enabled=!enabled;
    const original=JSON.stringify(h.plugin.settings.inlineStreaming);
    const opened=h.attachEditor('Notes/Overrides.md','Selected question\nPrivate remainder');
    Object.assign(opened.file,{basename:'Overrides',stat:{ctime:1}});
    opened.editor.getSelection=()=>surface==='full-note'?'':'Selected question';
    opened.editor.getCursor=(side:string)=>opened.editor.offsetToPos(side==='from'?0:17);
    if(surface==='editor')await h.menuFor(opened.view).items.find(item=>item.title==='Ask T3 Code')!.callback();
    else if(surface==='palette')await h.plugin.openPaletteAction('Explain.','Selected question');
    else h.registered.find(command=>command.id==='send-or-ask').editorCheckCallback(false,opened.editor,opened.view);
    const destination=h.modals.at(-1);
    editOverrides(h,destination,{'Stream replies into the editor':enabled?'on':'off',...(enabled?{'Intermediate agent responses':'collapse','Final answer format':'raw-markdown'}:{})});
    assert.equal(destination.contentEl.children[0].children[1].text,`Overrides · ${enabled?3:1}`);
    await destination.choose('new');
    const sent=h.commands.find(command=>command.type==='thread.turn.start');assert.ok(sent);
    assert.equal(JSON.stringify(h.plugin.settings.inlineStreaming),original);
    assert.match(sent.message.text,/Selected question/);
    if(surface!=='full-note')assert.doesNotMatch(sent.message.text,/Private remainder/);
    if(enabled){
      assert.match(opened.value,/t3-inline:start:/);
      const records=[...h.hostFiles].filter(([path])=>path.includes('/leases/')&&path.endsWith('.json')).map(([,bytes])=>JSON.parse(bytes));
      assert.equal(records.length,1);assert.equal(records[0].request.intermediateMode,'collapse');assert.equal(records[0].request.finalAnswerFormat,'raw-markdown');
    }else{assert.equal(opened.value,'Selected question\nPrivate remainder');assert.doesNotMatch(sent.message.text,/plugin will insert/);}
    await h.plugin.openPaletteAction('Later.','');
    assert.equal(h.modals.at(-1).contentEl.children[0].children[1].text,'Overrides','A later send starts from defaults');h.modals.at(-1).close();
  }finally{h.plugin.onunload();}
});

test('child Cancel and reset are isolated; Off disables dependent controls without losing their drafts',async()=>{
  const h=await chatHarness();
  try{
    h.attachEditor('Notes/Overrides.md','Question');await h.plugin.openPaletteAction('Explain.','');const destination=h.modals.at(-1);
    editOverrides(h,destination,{'Intermediate agent responses':'keep','Final answer format':'raw-markdown','Stream replies into the editor':'off'});
    destination.contentEl.children[0].children[1].click();
    const child=h.modals.at(-1),controls=h.settingsControls.slice(-4);
    assert.equal((controls[1] as any).dropdown.disabled,true);assert.equal((controls[2] as any).dropdown.disabled,true);
    assert.equal((controls[1] as any).dropdown.value,'keep');assert.equal((controls[2] as any).dropdown.value,'raw-markdown');
    controls[3].buttons.find((b:any)=>b.text==='Reset overrides').click();
    h.settingsControls.at(-1).buttons.find((b:any)=>b.text==='Cancel').click();assert.equal(child.closed,true);
    assert.equal(destination.contentEl.children[0].children[1].text,'Overrides · 3');
    destination.contentEl.children[0].children[1].click();h.settingsControls.at(-1).buttons.find((b:any)=>b.text==='Reset overrides').click();h.settingsControls.at(-1).buttons.find((b:any)=>b.text==='Apply').click();
    assert.equal(destination.contentEl.children[0].children[1].text,'Overrides');destination.close();assert.equal(h.commands.length,0);assert.equal(h.plugin.settings.pending.length,0);
  }finally{h.plugin.onunload();}
});

test('project changes, existing-picker cancellation and safe errors preserve the draft; inheritance freezes at thread confirmation',async()=>{
  const h=await chatHarness();
  try{
    h.attachEditor('Notes/Overrides.md','Question');h.plugin.settings.inlineStreaming.enabled=true;
    h.setThreads([{id:'existing',projectId:project.id,title:'Existing',latestTurn:{state:'completed'},session:{status:'ready',activeTurnId:null}}]);
    await h.plugin.openPaletteAction('Explain.','');const destination=h.modals.at(-1);
    editOverrides(h,destination,{'Intermediate agent responses':'collapse'});h.plugin.settings.inlineStreaming.enabled=false;
    destination.contentEl.children[0].children[0].click();h.modals.at(-1).onChooseItem(h.modals.at(-1).getItems().find((item:any)=>item.key==='vault:root'));
    assert.equal(destination.contentEl.children[0].children[1].text,'Overrides · 1');
    await destination.choose('existing');h.modals.at(-1).close();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(destination.closed,false);assert.equal(h.commands.length,0);
    h.plugin.prepareImages=async()=>{throw Error('recoverable image failure');};await destination.choose('new');assert.equal(destination.closed,false);assert.equal(destination.contentEl.children[0].children[1].text,'Overrides · 1');
    delete h.plugin.prepareImages;
    await destination.choose('existing');const picker=h.modals.at(-1);
    h.plugin.settings.inlineStreaming.enabled=true;h.plugin.settings.inlineStreaming.finalAnswerFormat='raw-markdown';
    await picker.onChooseItem(picker.getItems()[0]);
    assert.equal(h.commands.filter(command=>command.type==='thread.create').length,0);
    const binding=JSON.parse([...h.hostFiles].find(([path])=>path.includes('/leases/')&&path.endsWith('.json'))![1]).request;
    assert.equal(binding.intermediateMode,'collapse');assert.equal(binding.finalAnswerFormat,'raw-markdown');
  }finally{h.plugin.onunload();}
});

test('an overridden uncertain job replays its saved options, prompt and bindings across reload and opposite defaults',async()=>{
  let lose=true;const h=await chatHarness(async command=>{if(command.type==='thread.turn.start'&&lose){lose=false;throw Error('lost response');}});let restarted:any;
  try{
    h.attachEditor('Notes/Overrides.md','Question');h.plugin.settings.inlineStreaming.enabled=false;
    await h.plugin.openPaletteAction('Explain.','');const destination=h.modals.at(-1);
    editOverrides(h,destination,{'Stream replies into the editor':'on','Intermediate agent responses':'collapse','Final answer format':'raw-markdown'});await destination.choose('new');
    assert.equal(destination.closed,true);const pending=h.plugin.settings.pending[0];assert.ok(pending);
    assert.deepEqual(JSON.parse(JSON.stringify(pending.jobOptions)),{version:1,inline:{enabled:true,intermediateMode:'collapse',finalAnswerFormat:'raw-markdown'}});
    const bytes=JSON.stringify(pending),binding=JSON.stringify(pending.inlineHost);h.plugin.onunload();restarted=await h.start();
    assert.equal(JSON.stringify(restarted.settings.pending[0]),bytes);
    restarted.settings.inlineStreaming={enabled:false,keepIntermediate:false,intermediateMode:'remove',finalAnswerFormat:'formatted'};
    await restarted.retry(restarted.settings.pending[0]);assert.deepEqual(h.commands[1],h.commands[2]);assert.equal(JSON.stringify(pending.inlineHost),binding);
  }finally{restarted?.onunload();h.plugin.onunload();}
});

test('all new response mirrors inherit the resolved snapshot even after defaults change',async()=>{
  const h=await chatHarness();
  try{
    const a=h.attachEditor('Notes/MirrorA.md','A'),b=h.attachEditor('Notes/MirrorB.md','B');
    h.plugin.app.workspace.getLeavesOfType=()=>[{view:a.view},{view:b.view}];
    const request:any={id:webcrypto.randomUUID(),title:'Mirrored',project,connection:{environmentId:'chat-env'},jobOptions:{version:1,inline:{enabled:true,intermediateMode:'collapse',finalAnswerFormat:'raw-markdown'}}};
    h.plugin.settings.inlineStreaming={enabled:false,keepIntermediate:false,intermediateMode:'remove',finalAnswerFormat:'formatted'};
    await h.plugin.prepareStreamBindings(request,['Notes/MirrorA.md','Notes/MirrorB.md']);
    assert.equal(request.inlineBindings.length,2);
    for(const binding of request.inlineBindings){assert.equal(binding.intermediateMode,'collapse');assert.equal(binding.finalAnswerFormat,'raw-markdown');assert.equal(binding.keepIntermediate,true);}
  }finally{h.plugin.onunload();}
});

for(const picker of ['project','existing'])test(`an override preserves the captured source and selection while the ${picker} picker changes editor state`,async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.inlineStreaming.enabled=false;
    const opened=h.attachEditor('Notes/Original.md','Original selection\nTail');
    opened.editor.getSelection=()=> 'Original selection';opened.editor.getCursor=(side:string)=>opened.editor.offsetToPos(side==='from'?0:18);
    h.setThreads([{id:'existing',projectId:project.id,title:'Existing',latestTurn:{state:'completed'},session:{status:'ready',activeTurnId:null}}]);
    await h.menuFor(opened.view).items.find(item=>item.title==='Ask T3 Code')!.callback();const destination=h.modals.at(-1);
    editOverrides(h,destination,{'Stream replies into the editor':'on'});
    if(picker==='project')destination.contentEl.children[0].children[0].click();else await destination.choose('existing');
    const chooser=h.modals.at(-1);h.setActiveNote('Notes/Other.md');opened.editor.getSelection=()=> 'Tail';opened.editor.getCursor=()=>opened.editor.offsetToPos(opened.value.length);
    if(picker==='project'){chooser.onChooseItem(chooser.getItems().find((item:any)=>item.key==='vault:root'));await destination.choose('new');}else await chooser.onChooseItem(chooser.getItems()[0]);
    const sent=h.commands.find(command=>command.type==='thread.turn.start');assert.ok(sent);assert.match(sent.message.text,/^Original selection/);assert.match(sent.message.text,/Notes\/Original.md/);assert.doesNotMatch(sent.message.text,/Other.md/);
    assert.match(opened.value,/Original selection\n[\s\S]*t3-inline:start:[\s\S]*Tail/);
  }finally{h.plugin.onunload();}
});

test('Missing 3 expands the captured snapshot before insertion, saves exact retry bytes and records only confirmed coverage',{timeout:15000},async()=>{
  let fail=true;
  const h=await chatHarness(async command=>{if(command.type==='thread.turn.start'&&fail){fail=false;throw Error('lost acknowledgement');}});
  const path='Notes/Missing-three.md',id='31111111-1111-4111-8111-111111111111',body='> Verified response 2';
  const seed=()=>{
    const host={environmentId:'chat-env',workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1',connectionId:'chat-connection'};
    const request={version:2,id,vaultId:h.plugin.settings.vaultId,host,notePath:path,threadId:'missing-thread',messageId:'31111111-1111-4111-8111-111111111112',projectId:project.id,threadEnvironmentId:'chat-env',initialHash:contentHash(body),createdAt:new Date().toISOString(),independent:true};
    const state={status:'complete',turnId:'exact-turn',bindingCheckpoint:{bindings:{[request.messageId]:{turnId:'exact-turn',kind:'explicit'}}},finalBody:body,responseAnchor:{length:8,hash:contentHash('Idea 1\n\n')},finalSaved:true,cleanupComplete:true,notePath:path};
    h.hostFiles.set(`${host.directory}/explorer-responses.json`,JSON.stringify([{id,notePath:path,epoch:1,revision:1,active:false,input:false,complete:true}]));
    h.hostFiles.set(leasePaths(host.directory,id).record,JSON.stringify({request,state,epoch:1,revision:1,owner:'fixture',expiresAt:0}));
    h.plugin.settings.noteThreads.push({notePath:path,threadId:request.threadId,projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:'chat-connection',environmentId:'chat-env',selectedAt:new Date().toISOString()});
  };
  try{
    seed();
    const document=`Idea 1\n\n${body}\n\nMISSING-CAPTURED-CONTEXT\n\nImplement`;
    const view=h.attachEditor(path,document),start=document.lastIndexOf('Implement');
    const context={editor:view.editor,view:view.view,anchor:{text:'Implement',start,end:start+9,before:document.slice(start-24,start),after:''},snapshot:document};
    await assert.rejects(h.plugin.sendResolvedChat('Implement',{path},context,true,{jobOptions:{inline:{enabled:false,intermediateMode:'remove',finalAnswerFormat:'formatted'}}}),/Unconfirmed requests/);
    const pending=h.plugin.settings.pending[0];assert.ok(pending);
    assert.match(pending.prompt,/Additional context preceding your selection:\nMISSING-CAPTURED-CONTEXT\n\nYour selected request:\nImplement/);
    assert.doesNotMatch(pending.prompt,/Idea 1|Verified response 2/);
    assert.equal(h.plugin.settings.noteDeliveries.length,0);
    const prompt=pending.prompt;
    await h.plugin.retry(pending);
    assert.equal(h.commands.filter(command=>command.type==='thread.turn.start').at(-1).message.text,prompt);
    assert.equal(h.plugin.settings.noteDeliveries.length,1);
    await h.plugin.onExternalSettingsChange({...h.shared.at(-1),noteDeliveries:[]});
    assert.equal(h.plugin.settings.noteDeliveries.length,1,'Stale synced settings retain confirmed coverage');
    assert.equal(h.shared.at(-1).noteDeliveries.length,1);
    const prepared=await h.plugin.prepareMissingThree('Implement',path,context,'missing-thread',project,h.plugin.connection(project));
    assert.equal(prepared.prompt,'Implement');
    const edited=document.replace('MISSING-CAPTURED-CONTEXT','EDITED-CAPTURED-CONTEXT'),editedStart=edited.lastIndexOf('Implement');
    const changed=await h.plugin.prepareMissingThree('Implement',path,{...context,snapshot:edited,anchor:{...context.anchor,start:editedStart,end:editedStart+9}},'missing-thread',project,h.plugin.connection(project));
    assert.match(changed.prompt,/EDITED-CAPTURED-CONTEXT/);
    await h.plugin.save();h.plugin.onunload();const restored=await h.start();
    try{assert.equal(restored.settings.noteDeliveries.length,1);}finally{restored.onunload();}
  }finally{h.plugin.onunload();}
});

test('Missing 3 review shows context, cancellation dispatches nothing, and explicit selection-only skips expansion',{timeout:10000},async()=>{
  const h=await chatHarness();
  try{
    const body='> Verified response',document=`${body}\n\n# Another topic\n\nIdea 3\n\nImplement`,path='Notes/Review.md';
    const view=h.attachEditor(path,document),start=document.lastIndexOf('Implement');
    const context={view:view.view,editor:view.editor,snapshot:document,anchor:{text:'Implement',start,end:start+9,before:document.slice(start-24,start),after:''}};
    h.plugin.missingThreeResponses=async()=>({responses:[{id:'response',threadId:'thread',projectId:project.id,environmentId:'chat-env',body}],unavailable:false});
    const work=h.plugin.sendChat('Implement',{path},{threadId:'thread',sourceContext:context});
    for(let i=0;i<30&&h.modals.at(-1)?.constructor.name!=='MissingThreeModal';i++)await new Promise(resolve=>setTimeout(resolve,10));
    const modal=h.modals.at(-1);assert.equal(modal.constructor.name,'MissingThreeModal');
    assert.ok(modal.contentEl.children.some((child:any)=>child.tag==='pre'&&child.text.includes('Idea 3')));
    modal.close();await assert.rejects(work,/Context review cancelled/);assert.equal(h.commands.length,0);
    const next=h.plugin.sendChat('Implement',{path},{threadId:'thread',sourceContext:context});
    for(let i=0;i<30&&h.modals.at(-1)===modal;i++)await new Promise(resolve=>setTimeout(resolve,10));
    [...h.settingsControls].reverse().find((setting:any)=>setting.buttons.some((button:any)=>button.text==='Send selected request only')).buttons[0].click();
    await next;assert.ok(h.commands.at(-1).message.text.startsWith('Implement'));assert.doesNotMatch(h.commands.at(-1).message.text,/Idea 3/);
    assert.equal(h.plugin.settings.noteDeliveries.length,0);
  }finally{h.plugin.onunload();}
});

test('a real completed writer retains marker-free positional provenance usable by Missing 3',{timeout:12000},async()=>{
  const h=await chatHarness();
  try{
    const path='Notes/AnchorProof.md',note=h.attachEditor(path,'Baseline prompt.');
    Object.assign(note.file,{basename:'AnchorProof',stat:{ctime:123}});
    const result=await h.plugin.send(note.file,project,{newThread:true,streamReply:true,throwOnError:true});
    const binding=result.request.inlineBindings[0];
    let record:any;
    for(let i=0;i<100;i++){
      const bytes=h.hostFiles.get(leasePaths(binding.host.directory,binding.id).record);
      if(bytes)record=JSON.parse(bytes);
      if(record?.state?.cleanupComplete)break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(record.state.cleanupComplete,true);assert.doesNotMatch(note.value,/t3-(?:inline|response):/);
    const body=record.state.finalBody.replace(/\n+$/,'');
    const offset=note.value.indexOf(body);
    assert.equal(record.state.responseAnchor.length,offset);
    assert.equal(record.state.responseAnchor.hash,contentHash(note.value.slice(0,offset)));
    const document=note.value+'\n\nFresh idea 3\n\nImplement',start=document.lastIndexOf('Implement');
    const prepared=await h.plugin.prepareMissingThree('Implement',path,{editor:note.editor,view:note.view,snapshot:document,anchor:{text:'Implement',start,end:start+9,before:document.slice(start-24,start),after:''}},result.threadId,project,h.plugin.connection(project));
    assert.match(prepared.prompt,/Additional context preceding your selection:\nFresh idea 3\n\nYour selected request:\nImplement/);
  }finally{h.plugin.onunload();}
});
