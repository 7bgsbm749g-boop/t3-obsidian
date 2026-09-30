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
import {initialRegion,replaceRegion} from '../inline-thread';
import {contentHash} from '../completion';

const project={id:'chat-project',title:'Personal notes',workspaceRoot:'/projects/notes',connectionId:'chat-connection',connectionName:'Laptop'};

async function chatHarness(onCommand?:(command:any)=>Promise<void>) {
  let local:any={mode:'direct',pairedSessions:{'chat-connection':{url:'https://chat.example',environmentId:'chat-env',token:'dummy-chat-session',expiresAt:Date.now()+600_000}}};
  const localStorage=new Map<string,any>();
  const rootLink={id:'root',folderPath:'/',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,self:true};
  let activeNote:any,activeEditor:any,activeEditorView=true;
  const initial={folderLinks:[rootLink],chatProjectKey:'old:unrelated-project',paired:[{id:'chat-connection',name:'Laptop',url:'https://chat.example',environmentId:'chat-env'}],directScanId:'chat-connection',directProjects:[project],directSelected:['chat-connection:chat-project'],completion:{action:'delete'}};
  const shared:any[]=[], commands:any[]=[], registered:any[]=[],modals:any[]=[],settingsControls:any[]=[],workspaceEvents:Record<string,((...args:any[])=>void)[]>={};let threads:any[]=[],catalog:any[]=[project],focusedButton:any;
  let vaultAccesses=0;
  const hostFiles=new Map<string,string>(),hostEditors=new Map<string,any>();
  let authority:InlineLeaseAuthority|undefined;
  const hostTick=async()=>{
    authority??=new InlineLeaseAuthority({vaultId:shared.at(-1).vaultId,environmentId:'chat-env',workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1'},{
      read:async path=>hostFiles.get(path),write:async(path,bytes)=>{hostFiles.set(path,bytes);},
      list:async directory=>[...hostFiles.keys()].filter(path=>path.startsWith(directory+'/')),
      remove:async path=>{hostFiles.delete(path);},
    });
    await authority.tick();
  };
  const snapshot=(threadId:string)=>{
    const turn=[...commands].reverse().find(command=>command.type==='thread.turn.start'&&command.threadId===threadId);
    if(!turn)return {thread:{id:threadId,projectId:project.id,messages:[],activities:[]}};
    const turnId='provider-turn-'+turn.commandId;
    return {snapshotSequence:5,thread:{id:threadId,projectId:project.id,messages:[
      {id:turn.message.messageId,role:'user',turnId:null,text:turn.message.text,streaming:false,createdAt:turn.createdAt},
      {id:'answer',role:'assistant',turnId,text:'Inline reply from T3.',streaming:false}],activities:[],
      latestTurn:{turnId,state:'completed',requestedAt:turn.createdAt,assistantMessageId:'answer'},session:{status:'ready',activeTurnId:null},hasPendingApprovals:false,hasPendingUserInput:false}};
  };
  class Base {}
  class Element {
    style={};value='';text='';disabled=false;children:Element[]=[];
    empty(){this.children=[];} setText(value:string){this.text=value;} addEventListener(){} focus(){}
    createEl(_tag?:string,options?:{text?:string}){const child=new Element();child.text=options?.text??'';this.children.push(child);return child;}
  }
  class Modal {
    contentEl=new Element();titleEl=new Element();closed=false;emptyStateText='';placeholder='';
    constructor(public app:any){}
    open(){this.closed=false;modals.push(this);(this as any).onOpen?.();if(this.constructor.name==='ChatDestinationModal')focusedButton=[...settingsControls].reverse().find(setting=>setting.buttons.some((button:any)=>button.text==='Change project for this send'))?.buttons[0];}
    close(){this.closed=true;(this as any).onClose?.();}
    setPlaceholder(value:string){this.placeholder=value;}
  }
  class Setting {
    name='';buttons:any[]=[];
    constructor(_element:any){settingsControls.push(this);}
    setName(text:string){this.name=text;return this;}setDesc(_text:string){return this;}setDisabled(_value:boolean){return this;}
    addToggle(callback:(toggle:any)=>void){const toggle={setValue:()=>toggle,onChange:()=>toggle};callback(toggle);return this;}
    addButton(callback:(button:any)=>void){const button:any={text:'',click:()=>{},buttonEl:{isConnected:true,focus:()=>{focusedButton=button;}},setButtonText:(text:string)=>{button.text=text;return button;},setCta:()=>button,setDisabled:()=>button,onClick:(click:()=>void)=>{button.click=click;return button;}};callback(button);this.buttons.push(button);return this;}
    addDropdown(callback:(d:any)=>void){const d={addOption:()=>d,setValue:()=>d,setDisabled:()=>d,onChange:()=>d};callback(d);return this;}
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
      workspace:{onLayoutReady:()=>{},on:(name:string,callback:(...args:any[])=>void)=>{(workspaceEvents[name]??=[]).push(callback);return {};},getActiveViewOfType:()=>activeEditorView&&activeNote?(activeEditor??{file:activeNote}):undefined,getActiveFile:()=>activeNote,getLeavesOfType:()=>[...hostEditors].map(([path,editor])=>({view:{file:{path},editor}}))},
      vault:{adapter:{},getFileByPath:(path:string)=>hostEditors.has(path)?{path}:undefined,getName:()=> 'Notes',read:(file:any)=>{const editor=hostEditors.get(file.path);if(editor)return Promise.resolve(editor.getValue());vaultAccesses++;throw Error('Chat must not read note contents');},readBinary:()=>{vaultAccesses++;throw Error('Chat must not read attachments');}},
    };
    async loadData(){return shared.at(-1)??initial;}
    async saveData(value:any){shared.push(value);}
    addSettingTab(){}
    registerEvent(){}
    register(){}
    addCommand(command:any){registered.push(command);}
  }
  const api={Plugin,Platform:{isMobile:true},Modal,Menu,MenuItem,Setting,SuggestModal:Modal,FuzzySuggestModal:Modal,PluginSettingTab:Base,Notice:Base,TFile:File,MarkdownView:Base};
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
      else value={entries:[{path:'Notes/Draft.md',kind:'file'}]};
      queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Success',value}})}));
    }
  }
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{
    module,exports:module.exports,
    require:(name:string)=>{assert.equal(name,'obsidian','Mobile chat must never import Node APIs');return api;},
    indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    fetch:fetcher,WebSocket:Socket,Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,performance,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const start=async()=>{const plugin=new module.exports.default();await plugin.onload();const timer=setInterval(()=>plugin.deviceInline?.tick(),20);const unload=plugin.onunload.bind(plugin);plugin.onunload=()=>{clearInterval(timer);unload();};return plugin;};
  const plugin=await start();
  return {plugin,start,commands,shared,hostFiles,registered,modals,settingsControls,sockets,focusedButton:()=>focusedButton,pressEnter:()=>focusedButton?.click(),setProjects:(value:any[])=>{catalog=value;},setThreads:(value:any[])=>{threads=value;},setActiveNote:(path?:string)=>{activeNote=path?{path,extension:'md'}:undefined;activeEditor=undefined;},setActiveEditorView:(value:boolean)=>{activeEditorView=value;},menuFor:(view:any)=>{const menu=new Menu();for(const listener of workspaceEvents['editor-menu']??[])listener(menu,view.editor,view);return menu;},editorMenu:(selection:string,path='Notes/Selected.md',structuralFile=false)=>{
    const menu=new Menu(),file=structuralFile?{path,extension:'md'}:new File(path);
    let value=selection+'\nTail';
    const offsetToPos=(offset:number)=>{const before=value.slice(0,offset).split('\n');return {line:before.length-1,ch:before.at(-1)!.length};};
    const posToOffset=(pos:{line:number;ch:number})=>value.split('\n').slice(0,pos.line).reduce((n,line)=>n+line.length+1,0)+pos.ch;
    const editor={getSelection:()=>selection,getValue:()=>value,getCursor:(side:string)=>offsetToPos(side==='from'?0:selection.length),posToOffset,offsetToPos,replaceRange:(text:string,from:any,to?:any)=>{value=value.slice(0,posToOffset(from))+text+value.slice(to?posToOffset(to):posToOffset(from));}};
    hostEditors.set(path,editor);
    for(const listener of workspaceEvents['editor-menu']??[])listener(menu,editor,{file});return {menu,file,editor,get value(){return value;}};
  },attachEditor:(path:string,initial:string)=>{
    const file=new File(path),view=Object.assign(new Base(),{file,editor:null as any});
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

test('mobile chat without a note uses the root link, preserves the prompt, advertises event queries, and never enrolls note cleanup',async()=>{
  const h=await chatHarness();
  const prompt='\n\n  Plan\tmy   café 🧪 notes  \n\nKeep **Markdown**, "quotes", and [[links]] exactly.\n';
  try {
    assert.deepEqual(h.registered.map(command=>command.id),['answer-t3-question'],'Question answering has its own palette command');
    await h.plugin.sendChat(prompt);
    assert.equal(h.commands.length,2);
    assert.equal(h.commands[0].type,'thread.create');
    assert.equal(h.commands[0].projectId,project.id);
    assert.equal(h.commands[0].title,'Plan my café 🧪 notes');
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

test('a confirmed note chat links its thread, routes the next question there, and survives restart',async()=>{
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

test('thread linking switch controls first-link creation while explicit new threads remain available',async()=>{
  const h=await chatHarness();
  try{
    const note={path:'Notes/OptOut.md'};
    h.plugin.settings.threadLinking=false;
    await h.plugin.sendChat('One',note);
    await h.plugin.sendChat('Two',note);
    assert.equal(h.commands.filter(command=>command.type==='thread.create').length,2);
    assert.equal(h.plugin.settings.noteThreads.length,0);
    await h.plugin.sendChat('Remember this one',note,{rememberLink:true});
    const linked=h.plugin.settings.noteThreads[0].threadId;
    h.setThreads([{id:linked,projectId:project.id,title:'Remember this one',updatedAt:new Date().toISOString(),runtimeMode:'approval-required',interactionMode:'default'}]);
    await h.plugin.sendChat('Use the link',note);
    assert.equal(h.commands.at(-1).threadId,linked);
    await h.plugin.sendChat('Separate branch',note,{newThread:true,rememberLink:false});
    assert.equal(h.plugin.settings.noteThreads[0].threadId,linked);
  }finally{h.plugin.onunload();}
});

test('a full-note send keeps its linked note and reuses the confirmed thread',async()=>{
  const h=await chatHarness();
  try{
    (h.plugin.app.vault as any).read=async()=> 'Full note content';
    const file={path:'Notes/Whole.md',basename:'Whole',extension:'md',stat:{ctime:123}};
    const first=await h.plugin.send(file,project,{throwOnError:true});
    assert.equal(first.request.completion.action,'keep','Linking must prevent configured delete cleanup');
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
    assert.equal(h.commands[0].title,'A'.repeat(160));
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
    assert.equal(h.commands[0].title,'Work on this note.');
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

test('a typed palette question sends only the question and streams at the note end',async()=>{
  const h=await chatHarness();
  try{
    const editor=h.attachEditor('Notes/Palette.md','# Private note\nBody not sent.');
    h.plugin.app.saveLocalStorage('send-to-t3-code-chat-draft-v1','Why does this matter?');
    await h.plugin.openPaletteAction('Why does this matter?','');
    assert.equal(h.modals.at(-1).titleEl.text,'Ask T3 Code');
    await h.modals.at(-1).choose(false);
    const text=h.commands[1].message.text;
    assert.match(text,/^Why does this matter\?/);
    assert.doesNotMatch(text,/Private note|Body not sent|Vault-relative note path/);
    assert.match(text,/Sent from Obsidian\.\nObsidian vault: "Notes"\nDestination note path: "\/projects\/notes\/Notes\/Palette.md"$/);
    assert.equal(h.plugin.app.loadLocalStorage('send-to-t3-code-chat-draft-v1'),'');
    for(let attempt=0;attempt<40&&!editor.value.includes('Inline reply from T3.');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(editor.value,/Inline reply from T3\./);
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
    assert.equal(chooser.constructor.name,'SendProjectModal');
    h.plugin.settings.folderLinks.push({id:'root',folderPath:'/',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,self:true});
    chooser.onChooseItem(project);
    for(let attempt=0;attempt<120&&(h.commands.length<2||h.plugin.busy);attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(h.commands[1].message.text,/# Send this note/);
    assert.match(h.commands[1].message.text,/Sent from Obsidian\./);
    assert.doesNotMatch(h.commands[1].message.text,/Vault-relative note path/);
  }finally{h.plugin.onunload();}
});

test('an empty palette action on a linked note opens a destination modal',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Notes/Linked.md');
    h.plugin.settings.noteThreads.push(
      {notePath:'Notes/Linked.md',threadId:'older',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-01T00:00:00Z'},
      {notePath:'Notes/Linked.md',threadId:'current',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-02T00:00:00Z'},
    );
    await h.plugin.openPaletteAction('','');
    const modal=h.modals.at(-1);
    assert.equal(modal.constructor.name,'LinkedNoteDestinationModal');
    assert.equal(modal.titleEl.text,'Send to T3 Code');
    assert.equal(modal.contentEl.children[0].text,'Notes/Linked.md');
    assert.deepEqual(h.settingsControls.at(-1).buttons.map((button:any)=>button.text),['Linked thread','New thread','Existing thread…','Previous threads…']);
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
    for(let attempt=0;attempt<40&&(editor.value.includes('t3-inline:start:')||!editor.value.includes('Inline reply from T3.'));attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(editor.value,/Claim\n\n\n> Inline reply from T3\./);
  }finally{h.plugin.onunload();}
});

test('project picker changes this send without reusing the note’s linked thread',async()=>{
  const h=await chatHarness();
  try{
    const other={id:'other-project',title:'Other work',workspaceRoot:'/projects/other',connectionId:project.connectionId,connectionName:'Laptop'};
    h.plugin.settings.directProjects.push(other);
    h.setProjects([project,other]);
    const path='Notes/Linked.md';h.setActiveNote(path);
    h.plugin.settings.noteThreads.push({notePath:path,threadId:'old-thread',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-28T00:00:00Z'});
    await h.plugin.openChat('Send to other work');
    const destination=h.modals.at(-1);
    const change=[...h.settingsControls].reverse().find((control:any)=>control.buttons.some((button:any)=>button.text==='Change project for this send'));
    assert.ok(change);
    change.buttons[0].click();
    const picker=h.modals.at(-1),choice=picker.getItems().find((item:any)=>item.key==='chat-connection:other-project');
    assert.ok(choice);
    picker.onChooseItem(choice);
    assert.ok(h.settingsControls.some(control=>control.name.includes('Other work')));
    assert.equal(destination.host.getLinkedThread(choice.key),undefined);
    await destination.choose(false);
    assert.equal(h.commands[0].type,'thread.create');
    assert.equal(h.commands[0].projectId,other.id);
    assert.notEqual(h.commands[0].threadId,'old-thread');
  }finally{h.plugin.onunload();}
});

test('Enter on the destination dialog uses the purple new or linked thread button',async()=>{
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
    h.plugin.settings.noteThreads.push({notePath:path,threadId:'linked-thread',projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,selectedAt:'2026-09-28T00:00:00Z'});
    h.setThreads([{id:'linked-thread',projectId:project.id,title:'Linked',updatedAt:'2026-09-28T00:00:00Z',runtimeMode:'approval-required',interactionMode:'default'}]);
    await h.plugin.openChat('Continue here');
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(h.focusedButton()?.text,'Linked thread');
    h.pressEnter();
    for(let attempt=0;attempt<120&&(h.commands.length<3||h.plugin.busy);attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(h.commands[2].type,'thread.turn.start');
    assert.equal(h.commands[2].threadId,'linked-thread');
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
    const destination=h.modals.at(-1);assert.equal(destination.constructor.name,'ChatDestinationModal');
    h.setActiveNote('Notes/Different.md');await destination.choose(false);
    assert.equal(h.commands[0].type,'thread.create');assert.equal(h.commands[0].title,'Explain why **this claim** follows.');
    const newThreadText=h.commands[1].message.text;
    assert.ok(newThreadText.startsWith(selection));assert.match(newThreadText,/Answer in the T3 thread\. The Obsidian plugin will insert your reply\./);assert.doesNotMatch(newThreadText,/Do not edit the Obsidian note|Reply in the Obsidian note itself/);
    assert.match(newThreadText,/Destination note path: "\/projects\/notes\/Notes\/Original.md"/);assert.doesNotMatch(newThreadText,/Different.md/);
    await new Promise(resolve=>setTimeout(resolve,500));
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
    await new Promise(resolve=>setTimeout(resolve,500));assert.match(second.value,/Inline reply from T3\./);
    assert.equal(h.vaultAccesses(),0,'Selection chat sends the selection and note path without reading the note body');
  }finally{h.plugin.onunload();}
});

test('stopping a local editor response removes both tracking tags and the Stop menu action',async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/Stop.md',region=initialRegion(id);
  try{
    const opened=h.attachEditor(path,'Before'+region.text+'After');
    const job={id,path,requestId:id,bodyHash:region.bodyHash,phase:'running',createdAt:new Date().toISOString(),threadId:'old-thread',turnId:'old-turn',messageId:webcrypto.randomUUID(),projectId:project.id,connection:{transport:'direct',host:'direct',url:'https://chat.example',connectionId:'chat-connection',environmentId:'chat-env',executable:''}};
    const manager=(h.plugin as any).inlineChat;
    manager.jobs.push(job);
    const runtime=manager.runtime(job);runtime.sequence=1;
    runtime.state={messages:[{id:'partial',role:'assistant',turnId:'old-turn',text:'Partial answer',streaming:true}],activities:[]};
    assert.ok(h.menuFor(opened.view).items.some(item=>item.title==='Stop T3 response'));
    await h.menuFor(opened.view).items.find(item=>item.title==='Stop T3 response')!.callback();
    for(let n=0;n<20&&opened.value.includes('t3-inline:');n++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.doesNotMatch(opened.value,/t3-inline:(?:start|end)/);
    assert.match(opened.value,/T3 · Stopped/);assert.match(opened.value,/Partial answer/);
    assert.match(opened.value,/Before/);assert.match(opened.value,/After/);
    assert.equal(manager.activeFor(path).length,0);
    assert.ok(!h.menuFor(opened.view).items.some(item=>item.title==='Stop T3 response'));
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
    assert.ok(!menu.items.some(item=>item.title==='Stop T3 response'));
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
    assert.equal(h.modals.at(-1).constructor.name,'ChatDestinationModal');
    assert.equal(h.commands.length,0,'Opening the chooser does not dispatch or edit the note');
    assert.doesNotMatch(context.value,/t3-inline:start/);
  }finally{h.plugin.onunload();}
});

test('unlinked and root-level notes use the root link and a self link resolves the destination note path',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Unlinked/draft.md');await h.plugin.openChat('Edit draft');await h.modals.at(-1).choose(false);
    assert.match(h.commands[1].message.text,/Destination note path: "\/projects\/notes\/Unlinked\/draft.md"/);
    h.setActiveNote('root.md');await h.plugin.openChat('Edit root');await h.modals.at(-1).choose(false);
    assert.match(h.commands[3].message.text,/Destination note path: "\/projects\/notes\/root.md"/);
    h.plugin.settings.folderLinks.push({...h.plugin.settings.folderLinks[0],id:'inner',folderPath:'Linked'});
    h.setActiveNote('Linked/nested/task.md');await h.plugin.openChat('Edit linked');await h.modals.at(-1).choose(false);
    assert.match(h.commands[5].message.text,/Destination note path: "\/projects\/notes\/nested\/task.md"/);
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
    const sending=h.plugin.sendChat(prompt,{path:'Notes/Draft.md'});
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
    await modal.submit();
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
    assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.inlineStreaming)),{enabled:true,keepIntermediate:false});
    h.plugin.settings.inlineStreaming.enabled=false;
    h.plugin.settings.inlineStreaming.keepIntermediate=true;
    await h.plugin.save();
    h.plugin.onunload();
    const restarted=await h.start();
    assert.deepEqual(JSON.parse(JSON.stringify(restarted.settings.inlineStreaming)),{enabled:false,keepIntermediate:true});
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
    for(let attempt=0;attempt<40&&!editor.value.includes('Inline reply from T3.');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(editor.value,/Inline reply from T3\./);
    for(let attempt=0;attempt<40&&editor.value.includes('t3-inline:start');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.doesNotMatch(editor.value,/t3-inline:(?:start|end)/,'a finished response has no tracking lines');
    const continued=await h.plugin.send(file,project,{threadId:'existing',throwOnError:true});
    assert.equal(continued.threadId,'existing');
    assert.equal((editor.value.match(/t3-inline:start/g)??[]).length,1,'the new response is guarded while streaming');
    for(let attempt=0;attempt<40&&(editor.value.match(/Inline reply from T3\./g)??[]).length<2;attempt++)await new Promise(resolve=>setTimeout(resolve,25));
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
    const sending=composer?modal.submit():modal.choose(false);
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

test('a synced running response accepts palette steering without a new block and retains its transcript',async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/Steering.md',region=initialRegion(id);
  try{
    const body='**T3 · Working**\n\n> Earlier progress.\n',edit=replaceRegion(region.text,id,region.bodyHash,body)!;
    const opened=h.attachEditor(path,'Before'+region.text.slice(0,edit.from)+edit.text+region.text.slice(edit.to)+'After');
    const host={environmentId:'chat-env',workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1',connectionId:'chat-connection'};
    const initialMessage=webcrypto.randomUUID(),request={version:2 as const,initialOwner:webcrypto.randomUUID(),id,vaultId:h.plugin.settings.vaultId,host,notePath:path,threadId:'old-thread',messageId:initialMessage,projectId:project.id,threadEnvironmentId:'chat-env',initialHash:region.bodyHash,createdAt:'original-time'};
    h.hostFiles.set(leasePaths(host.directory,id).record,JSON.stringify({request,owner:request.initialOwner,epoch:1,revision:1,expiresAt:Date.now()+15_000,state:{requestHash:hostedRequestHash(request),accepted:true,notePath:path,status:'running',hashes:[region.bodyHash,contentHash(body)],turnId:'old-turn',prose:[{id:'old-progress',role:'assistant',text:'Earlier progress.',turnId:'old-turn',streaming:false}],updatedAt:''}}));
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Working',session:{status:'running',activeTurnId:'old-turn'},latestTurn:{turnId:'old-turn',state:'running',requestedAt:'original-time'},messages:[{id:initialMessage,role:'user',createdAt:'original-time'}]}]);
    await (h.plugin as any).sendInlineChat('Change the approach.',{path},{editor:opened.editor,view:opened.view});
    assert.equal(h.commands.length,1);assert.equal(h.commands[0].threadId,'old-thread');assert.equal(h.commands[0].type,'thread.turn.start');
    assert.equal((opened.value.match(/t3-inline:start:/g)??[]).length,1);
    const record=JSON.parse(h.hostFiles.get(leasePaths(host.directory,id).record)!);
    assert.equal(record.state.steering.length,1);assert.equal(record.state.steering[0].text,'Change the approach.');
    assert.equal(record.owner,request.initialOwner,'another device can send without preempting the writer');
    const settlement=h.plugin.settings.settlementJobs[0];assert.equal(settlement.inlineJobId,id);assert.deepEqual(JSON.parse(JSON.stringify(settlement.inlineHost)),host);
  }finally{h.plugin.onunload();}
});

test('Ask remains enabled during local streaming and selection steering moves only the captured text',async()=>{
  const h=await chatHarness(),id=webcrypto.randomUUID(),path='Notes/SelectedSteering.md',region=initialRegion(id);
  try{
    const selected='Use a simpler approach.',opened=h.attachEditor(path,selected+'\n'+region.text+'Tail');
    opened.editor.getSelection=()=>selected;
    opened.editor.getCursor=(side:string)=>opened.editor.offsetToPos(side==='from'?0:selected.length);
    const job={id,path,requestId:id,bodyHash:region.bodyHash,phase:'running',createdAt:'original-time',threadId:'old-thread',turnId:'old-turn',messageId:webcrypto.randomUUID(),projectId:project.id,connection:{transport:'direct',host:'direct',url:'https://chat.example',connectionId:'chat-connection',environmentId:'chat-env',executable:''}};
    const manager=(h.plugin as any).inlineChat;manager.jobs.push(job);
    const runtime=manager.runtime(job);runtime.sequence=1;runtime.state={messages:[{id:'progress',role:'assistant',turnId:'old-turn',text:'Earlier progress.',streaming:false}],activities:[]};
    const ask=h.menuFor(opened.view).items.find(item=>item.title==='Ask T3 Code');assert.ok(ask);assert.equal(ask.disabled,false);
    h.setThreads([{id:'old-thread',projectId:project.id,title:'Working',session:{status:'running',activeTurnId:'old-turn'},latestTurn:{turnId:'old-turn',state:'running',requestedAt:'original-time'}}]);
    await ask.callback();await h.modals.at(-1).choose(false);
    assert.equal(h.commands.length,1);assert.ok(opened.value.startsWith(selected),'text remains until T3 confirms its message');
    const command=h.commands[0];
    manager.receive(job,{kind:'snapshot',snapshot:{snapshotSequence:3,thread:{messages:[{id:command.message.messageId,role:'user',text:command.message.text,streaming:false,createdAt:command.createdAt},{id:'final',role:'assistant',turnId:'next-turn',text:'Changed approach.',streaming:false}],activities:[],latestTurn:{turnId:'next-turn',state:'completed',requestedAt:command.createdAt,assistantMessageId:'final'},session:{status:'ready',activeTurnId:null}}}});
    manager.flush(job);
    assert.equal((opened.value.match(/Use a simpler approach\./g)??[]).length,1);assert.ok(!opened.value.startsWith(selected));
    assert.match(opened.value,/Earlier progress\.[\s\S]*\[!t3-steering\] You[\s\S]*Use a simpler approach\.[\s\S]*Changed approach\./);
    assert.doesNotMatch(opened.value,/t3-inline:/);assert.match(opened.value,/Tail/);
  }finally{h.plugin.onunload();}
});
