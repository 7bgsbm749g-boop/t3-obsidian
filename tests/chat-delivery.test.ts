import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {WAIT_FOR_OTHER_THREADS_INSTRUCTION} from '../orchestration';
import {modelConfig} from './rpc-fixture';

const project={id:'chat-project',title:'Personal notes',workspaceRoot:'/projects/notes',connectionId:'chat-connection',connectionName:'Laptop'};

async function chatHarness(onCommand?:(command:any)=>Promise<void>) {
  let local:any={mode:'direct',pairedSessions:{'chat-connection':{url:'https://chat.example',environmentId:'chat-env',token:'dummy-chat-session',expiresAt:Date.now()+600_000}}};
  const localStorage=new Map<string,any>();
  const rootLink={id:'root',folderPath:'/',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId,self:true};
  let activeNote:any;
  const initial={folderLinks:[rootLink],chatProjectKey:'old:unrelated-project',paired:[{id:'chat-connection',name:'Laptop',url:'https://chat.example',environmentId:'chat-env'}],directScanId:'chat-connection',directProjects:[project],directSelected:['chat-connection:chat-project'],completion:{action:'delete'}};
  const shared:any[]=[], commands:any[]=[], registered:any[]=[],modals:any[]=[],workspaceEvents:Record<string,((...args:any[])=>void)[]>={};let threads:any[]=[],catalog:any[]=[project];
  let vaultAccesses=0;
  class Base {}
  class Element {
    style={};value='';disabled=false;
    empty(){} setText(_text:string){} addEventListener(){} focus(){}
    createEl(){return new Element();}
  }
  class Modal {
    contentEl=new Element();titleEl=new Element();closed=false;emptyStateText='';placeholder='';
    constructor(public app:any){}
    open(){modals.push(this);(this as any).onOpen?.();}
    close(){this.closed=true;(this as any).onClose?.();}
    setPlaceholder(value:string){this.placeholder=value;}
  }
  class Setting {
    constructor(_element:any){}
    setName(_text:string){return this;}setDesc(_text:string){return this;}setDisabled(_value:boolean){return this;}
    addButton(callback:(button:any)=>void){const button={setButtonText:()=>button,setCta:()=>button,setDisabled:()=>button,onClick:()=>button};callback(button);return this;}
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
      workspace:{onLayoutReady:()=>{},on:(name:string,callback:(...args:any[])=>void)=>{(workspaceEvents[name]??=[]).push(callback);return {};},getActiveViewOfType:()=>activeNote?{file:activeNote}:undefined,getLeavesOfType:()=>[]},
      vault:{adapter:{},getName:()=> 'Notes',read:()=>{vaultAccesses++;throw Error('Chat must not read note contents');},readBinary:()=>{vaultAccesses++;throw Error('Chat must not read attachments');}},
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
      return response({thread:threads.find(thread=>thread.id===id)??{id:'existing',projectId:project.id,runtimeMode:'approval-required',interactionMode:'default'}});
    }
    const command=JSON.parse(options.body);
    commands.push(command);
    if(command.type==='project.create')catalog.push({id:command.projectId,title:command.title,workspaceRoot:command.workspaceRoot});
    await onCommand?.(command);
    return response({});
  };
  const sockets:any[]=[];
  class Socket {
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:any)=>void;
    closed=false;
    constructor(public url:string){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
    close(){this.closed=true;this.onclose?.();}
    send(raw:string){
      const req=JSON.parse(raw);if(req._tag==='Ack'||req._tag==='Interrupt'||req._tag==='Pong')return;
      if(req.tag==='orchestration.subscribeThread'){
        const turn=commands.at(-1),turnId='provider-turn-'+turn.commandId,requestedAt=turn.createdAt;
        queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:req.id,values:[{kind:'snapshot',snapshot:{snapshotSequence:5,thread:{id:req.payload.threadId,messages:[{id:turn.message.messageId,role:'user',turnId:null,text:turn.message.text,streaming:false,createdAt:requestedAt},{id:'answer',role:'assistant',turnId,text:'Inline reply from T3.',streaming:false}],activities:[],latestTurn:{turnId,state:'completed',requestedAt},session:{status:'ready',activeTurnId:null}}}}]})}));
        return;
      }
      let value:any;
      if(req.tag==='server.getConfig')value=modelConfig();
      else if(req.tag==='filesystem.browse')value={parentPath:req.payload.partialPath==='~'?'/home/person':req.payload.partialPath.replace(/\/$/,''),entries:[]};
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
    fetch:fetcher,WebSocket:Socket,Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const start=async()=>{const plugin=new module.exports.default();await plugin.onload();return plugin;};
  const plugin=await start();
  return {plugin,start,commands,shared,registered,modals,sockets,setProjects:(value:any[])=>{catalog=value;},setThreads:(value:any[])=>{threads=value;},setActiveNote:(path?:string)=>{activeNote=path?{path,extension:'md'}:undefined;},editorMenu:(selection:string,path='Notes/Selected.md',structuralFile=false)=>{
    const menu=new Menu(),file=structuralFile?{path,extension:'md'}:new File(path);
    let value=selection+'\nTail';
    const offsetToPos=(offset:number)=>{const before=value.slice(0,offset).split('\n');return {line:before.length-1,ch:before.at(-1)!.length};};
    const posToOffset=(pos:{line:number;ch:number})=>value.split('\n').slice(0,pos.line).reduce((n,line)=>n+line.length+1,0)+pos.ch;
    const editor={getSelection:()=>selection,getValue:()=>value,getCursor:(side:string)=>offsetToPos(side==='from'?0:selection.length),posToOffset,offsetToPos,replaceRange:(text:string,from:any,to?:any)=>{value=value.slice(0,posToOffset(from))+text+value.slice(to?posToOffset(to):posToOffset(from));}};
    for(const listener of workspaceEvents['editor-menu']??[])listener(menu,editor,{file});return {menu,file,editor,get value(){return value;}};
  },attachEditor:(path:string,initial:string)=>{
    const file=new File(path),view=Object.assign(new Base(),{file,editor:null as any});
    let value=initial;
    const offsetToPos=(offset:number)=>{const lines=value.slice(0,offset).split('\n');return {line:lines.length-1,ch:lines.at(-1)!.length};};
    const posToOffset=(pos:{line:number;ch:number})=>value.split('\n').slice(0,pos.line).reduce((n,line)=>n+line.length+1,0)+pos.ch;
    view.editor={getValue:()=>value,getSelection:()=>'',getCursor:()=>offsetToPos(value.length),posToOffset,offsetToPos,replaceRange:(text:string,from:any,to?:any)=>{value=value.slice(0,posToOffset(from))+text+value.slice(to?posToOffset(to):posToOffset(from));}};
    const leaf={view,openFile:async()=>{}};
    (plugin.app.workspace as any).getLeavesOfType=()=>[leaf];
    (plugin.app.workspace as any).getLeaf=()=>leaf;
    return {file,view,editor:view.editor,get value(){return value;}};
  },vaultAccesses:()=>vaultAccesses};
}

test('mobile chat without a note uses the root link, preserves the prompt, advertises event queries, and never enrolls note cleanup',async()=>{
  const h=await chatHarness();
  const prompt='\n\n  Plan\tmy   café 🧪 notes  \n\nKeep **Markdown**, "quotes", and [[links]] exactly.\n';
  try {
    assert.ok(h.registered.some(command=>command.id==='new-chat'),'A normal command remains available without palette internals');
    await h.plugin.sendChat(prompt);
    assert.equal(h.commands.length,2);
    assert.equal(h.commands[0].type,'thread.create');
    assert.equal(h.commands[0].projectId,project.id);
    assert.equal(h.commands[0].title,'Plan my café 🧪 notes');
    assert.equal(h.commands[1].type,'thread.turn.start');
    assert.ok(h.commands[1].message.text.startsWith(prompt));
    assert.match(h.commands[1].message.text,/T3 EVENT HISTORY CAPABILITY/);
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
    assert.match(pending.prompt,/T3 EVENT HISTORY CAPABILITY/);
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
    assert.match(h.commands[1].message.text,/T3 EVENT HISTORY CAPABILITY/);
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
    assert.ok(h.commands[1].message.text.startsWith(prompt+'\n\nObsidian vault: "Notes"\nDestination note path: "/projects/notes/Notes/Inner/café \\"draft\\".md"\nVault-relative note path: "Notes/Inner/café \\"draft\\".md"'));
    assert.match(h.commands[1].message.text,/T3 EVENT HISTORY CAPABILITY/);
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

test('editor selection menu streams a T3 reply into its original note for new and existing threads',async()=>{
  const h=await chatHarness();
  try{
    assert.equal(h.editorMenu('   ').menu.items.length,0,'Whitespace-only selections do not add an action');
    assert.ok(h.editorMenu('Cross-window selection','Notes/Popout.md',true).menu.items.some(item=>item.title==='Ask T3'),'Editor menu accepts Obsidian file objects from another window realm');
    const selection='Explain why **this claim** follows.\nKeep [[source links]].';
    const first=h.editorMenu(selection,'Notes/Original.md');let entry=first.menu.items.find(item=>item.title==='Ask T3');assert.ok(entry);
    await entry!.callback();
    const destination=h.modals.at(-1);assert.equal(destination.constructor.name,'ChatDestinationModal');
    h.setActiveNote('Notes/Different.md');await destination.choose(false);
    assert.equal(h.commands[0].type,'thread.create');assert.equal(h.commands[0].title,'Explain why **this claim** follows.');
    const newThreadText=h.commands[1].message.text;
    assert.ok(newThreadText.startsWith(selection));assert.match(newThreadText,/Answer in the T3 thread\. Do not edit the Obsidian note/);assert.doesNotMatch(newThreadText,/Reply in the Obsidian note itself/);
    assert.match(newThreadText,/Vault-relative note path: "Notes\/Original.md"/);assert.doesNotMatch(newThreadText,/Different.md/);
    await new Promise(resolve=>setTimeout(resolve,180));
    assert.match(first.value,/\*\*T3 answer\*\*[\s\S]*Inline reply from T3\./);

    h.setThreads([{id:'old-thread',projectId:project.id,title:'Earlier work',updatedAt:'2026-09-19T11:00:00Z',latestTurn:{state:'completed'}}]);
    const followup='Add the selected evidence to the conclusion.';
    const second=h.editorMenu(followup,'Notes/Original.md');entry=second.menu.items.find(item=>item.title==='Ask T3');assert.ok(entry);
    await entry!.callback();await h.modals.at(-1).choose(true);
    const picker=h.modals.at(-1);await picker.choose(picker.getItems()[0]);
    assert.equal(h.commands[2].type,'thread.turn.start');assert.equal(h.commands[2].threadId,'old-thread');
    assert.ok(h.commands[2].message.text.startsWith(followup));assert.doesNotMatch(h.commands[2].message.text,/Reply in the Obsidian note itself/);
    await new Promise(resolve=>setTimeout(resolve,180));assert.match(second.value,/Inline reply from T3\./);
    assert.equal(h.vaultAccesses(),0,'Selection chat sends the selection and note path without reading the note body');
  }finally{h.plugin.onunload();}
});

test('Ask T3 refuses a switched editor before dispatching or inserting',async()=>{
  const h=await chatHarness();
  try{
    const context=h.editorMenu('What changed?','Notes/Original.md');
    const item=context.menu.items.find(entry=>entry.title==='Ask T3');assert.ok(item);
    await item.callback();
    context.file.path='Notes/Another.md';
    await h.modals.at(-1).choose(false);
    assert.equal(h.commands.length,0);
    assert.doesNotMatch(context.value,/t3-inline:start/);
  }finally{h.plugin.onunload();}
});

test('Ask T3 selection command opens the inline chooser without changing the note',async()=>{
  const h=await chatHarness();
  try{
    const command=h.registered.find((entry:any)=>entry.id==='ask-selection');assert.ok(command);
    const context=h.editorMenu('Explain this sentence.','Notes/Original.md');
    assert.equal(command.editorCheckCallback(true,context.editor,{file:context.file}),true);
    assert.equal(command.editorCheckCallback(false,context.editor,{file:context.file}),true);
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

test('a remote folder without a vault-root mapping reports vault and relative path once',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.folderLinks=[{...h.plugin.settings.folderLinks[0],folderPath:'Notes',self:false}];
    await h.plugin.sendChat('Review this',{path:'Notes/Only once.md'});
    const text=h.commands[1].message.text;
    assert.match(text,/Obsidian vault: "Notes"/);assert.doesNotMatch(text,/Destination note path:/);
    assert.equal(text.split('Notes/Only once.md').length-1,1);
    assert.match(text,/Vault-relative note path: "Notes\/Only once.md"/);
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

test('the regular chat command captures the note before the composer opens',async()=>{
  const h=await chatHarness();
  try{
    h.setActiveNote('Original.md');
    await h.registered.find(command=>command.id==='new-chat').callback();
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
    assert.match(h.commands[0].message.text,/\nAfter\n\nT3 EVENT HISTORY CAPABILITY/);
    assert.equal(h.commands[0].message.attachments[0].dataUrl,'data:image/png;base64,'+png);
    assert.equal(result.request.completion.action,'keep');
    assert.equal(h.plugin.settings.completionJobs.length,0);
    assert.equal(h.plugin.settings.pending.length,0);
  }finally{h.plugin.onunload();}
});

test('inline streaming switches default on and persist independently',async()=>{
  const h=await chatHarness();
  try{
    assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.inlineStreaming)),{askT3:true,sendToT3:true});
    h.plugin.settings.inlineStreaming.askT3=false;
    await h.plugin.save();
    h.plugin.onunload();
    const restarted=await h.start();
    assert.deepEqual(JSON.parse(JSON.stringify(restarted.settings.inlineStreaming)),{askT3:false,sendToT3:true});
    restarted.onunload();
  }finally{h.plugin.onunload();}
});

test('Ask T3 keeps the answer in the T3 thread when its streaming switch is off',async()=>{
  const h=await chatHarness();
  try{
    h.plugin.settings.inlineStreaming.askT3=false;
    const context=h.editorMenu('Why is this here?');
    await context.menu.items.find(item=>item.title==='Ask T3')!.callback();
    await h.modals.at(-1).choose(false);
    assert.doesNotMatch(context.value,/t3-inline:start/);
    assert.match(h.commands.at(-1).message.text,/Answer in the T3 thread\. Do not edit the Obsidian note\./);
  }finally{h.plugin.onunload();}
});

test('manual Send to T3 streams into the source editor but disabled and automatic sends do not',async()=>{
  const h=await chatHarness();
  try{
    const editor=h.attachEditor('Manual.md','# Manual\nPlease explain this.');
    const file=Object.assign(editor.file,{basename:'Manual',stat:{ctime:123}});
    const first=await h.plugin.send(file,project,{throwOnError:true});
    assert.equal(first.request.completion.action,'keep');
    assert.match(first.request.prompt,/Answer in the T3 thread\. Do not edit the Obsidian note; the Obsidian plugin will insert your reply\./);
    assert.doesNotMatch(first.request.prompt,/t3-inline:start/);
    assert.match(editor.value,/t3-inline:start/);
    for(let attempt=0;attempt<40&&!editor.value.includes('Inline reply from T3.');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(editor.value,/Inline reply from T3\./);
    const continued=await h.plugin.send(file,project,{threadId:'existing',throwOnError:true});
    assert.equal(continued.threadId,'existing');
    assert.equal((editor.value.match(/t3-inline:start/g)??[]).length,2,'An existing-thread send receives its own guarded response');
    h.plugin.settings.inlineStreaming.sendToT3=false;
    const before=editor.value;
    h.plugin.app.vault.read=async()=> '# Manual\nPlease explain this.';
    await h.plugin.send(file,project,{throwOnError:true});
    assert.equal(editor.value,before,'A disabled stream leaves the editor unchanged');
    h.plugin.settings.inlineStreaming.sendToT3=true;
    h.plugin.app.vault.read=async()=> '# Automatic tag note';
    await h.plugin.send(file,project,{quiet:true,throwOnError:true});
    assert.equal(editor.value,before,'An automatic tag send cannot append an inline reply');
  }finally{h.plugin.onunload();}
});
