import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {WAIT_FOR_OTHER_THREADS_INSTRUCTION} from '../orchestration';

const project={id:'chat-project',title:'Personal notes',workspaceRoot:'/projects/notes',connectionId:'chat-connection',connectionName:'Laptop'};

async function chatHarness(onCommand?:(command:any)=>Promise<void>) {
  let local:any={mode:'direct',pairedSessions:{'chat-connection':{url:'https://chat.example',environmentId:'chat-env',token:'dummy-chat-session',expiresAt:Date.now()+600_000}}};
  const initial={paired:[{id:'chat-connection',name:'Laptop',url:'https://chat.example',environmentId:'chat-env'}],directScanId:'chat-connection',directProjects:[project],directSelected:['chat-connection:chat-project'],completion:{action:'delete'}};
  const shared:any[]=[], commands:any[]=[], registered:any[]=[];
  let vaultAccesses=0;
  class Base {}
  class Plugin {
    app={
      loadLocalStorage:()=>local,
      saveLocalStorage:(_:string,value:any)=>{local=value;},
      workspace:{onLayoutReady:()=>{},on:()=>{},getActiveFile:()=>{throw Error('Chat must not read the active note');}},
      vault:new Proxy({}, {get:()=>{vaultAccesses++;throw Error('Chat must not access the vault');}}),
    };
    async loadData(){return shared.at(-1)??initial;}
    async saveData(value:any){shared.push(value);}
    addSettingTab(){}
    registerEvent(){}
    register(){}
    addCommand(command:any){registered.push(command);}
  }
  const api={Plugin,Platform:{isMobile:true},Modal:Base,SuggestModal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:Base};
  const fetcher=async(url:string,options:any)=>{
    assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');
    const response=(value:any)=>new Response(JSON.stringify(value));
    if(url.endsWith('/.well-known/t3/environment'))return response({environmentId:'chat-env',label:'Laptop',orchestrationProtocolVersion:1});
    assert.equal(options.headers.Authorization,'Bearer dummy-chat-session');
    if(url.endsWith('/shell'))return response({projects:[{...project,defaultModelSelection:{instanceId:'codex',model:'default'}}],threads:[]});
    const command=JSON.parse(options.body);
    commands.push(command);
    await onCommand?.(command);
    return response({});
  };
  const module={exports:{} as any};
  runInNewContext(await readFile('main.js','utf8'),{
    module,exports:module.exports,
    require:(name:string)=>{assert.equal(name,'obsidian','Mobile chat must never import Node APIs');return api;},
    indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    fetch:fetcher,Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const start=async()=>{const plugin=new module.exports.default();await plugin.onload();return plugin;};
  return {plugin:await start(),start,commands,shared,registered,vaultAccesses:()=>vaultAccesses};
}

test('mobile chat sends the exact typed prompt, remembers its destination, and never enrolls note cleanup',async()=>{
  const h=await chatHarness();
  const prompt='\n\n  Plan\tmy   café 🧪 notes  \n\nKeep **Markdown**, "quotes", and [[links]] exactly.\n';
  try {
    assert.ok(h.registered.some(command=>command.id==='new-chat'),'A normal command remains available without palette internals');
    await h.plugin.sendChat(prompt,project);
    assert.equal(h.commands.length,2);
    assert.equal(h.commands[0].type,'thread.create');
    assert.equal(h.commands[0].projectId,project.id);
    assert.equal(h.commands[0].title,'Plan my café 🧪 notes');
    assert.equal(h.commands[1].type,'thread.turn.start');
    assert.equal(h.commands[1].message.text,prompt);
    assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(h.plugin.settings.completionJobs.length,0,'Delete-note preference must not apply to free text');
    assert.equal(h.vaultAccesses(),0);
    assert.equal(h.shared.at(-1).chatProjectKey,'chat-connection:chat-project');
    h.plugin.onunload();
    const restarted=await h.start();
    assert.equal(restarted.settings.chatProjectKey,'chat-connection:chat-project');
    assert.equal(h.commands.length,2,'Restart must not submit another chat');
    restarted.onunload();
    for(const snapshot of h.shared){
      assert.ok(!('pending' in snapshot),'Chat retry data stays on the sending device');
      assert.doesNotMatch(JSON.stringify(snapshot),/dummy-chat-session/);
    }
  } finally {h.plugin.onunload();}
});

test('an uncertain chat survives restart and retries the original immutable commands manually',async()=>{
  let loseResponse=true;
  const h=await chatHarness(async command=>{
    if(command.type==='thread.turn.start'&&loseResponse){loseResponse=false;throw Error('Connection lost after accepting turn');}
  });
  const prompt='Draft a short project plan.\nPreserve this second line.';
  try {
    await assert.rejects(h.plugin.sendChat(prompt,project),(error:any)=>{
      assert.match(error.message,/unconfirmed requests|saved|retry/i);
      assert.equal(error.requestSaved,true,'The prompt UI must distinguish saved sends from safe-to-resubmit validation failures');
      return true;
    });
    assert.equal(h.plugin.busy,false);
    assert.equal(h.plugin.settings.pending.length,1);
    const pending=h.plugin.settings.pending[0];
    assert.equal(pending.prompt,prompt);
    assert.equal(pending.completion,undefined);
    assert.equal(pending.directPlan.phase,'created');
    assert.equal(h.plugin.settings.completionJobs.length,0);
    h.plugin.onunload();
    const restarted=await h.start();
    assert.equal(h.commands.length,2,'Reload must leave an uncertain send for manual retry');
    restarted.settings.orchestration.waitForOtherThreads=true;
    restarted.settings.chatProjectKey='another:project';
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
    await assert.rejects(h.plugin.sendChat(' \t\r\n ',project),/empty|type|enter|prompt/i);
    await assert.rejects(h.plugin.sendChat('x'.repeat(120_001),project),/120,?000|limit|long/i);
    h.plugin.settings.orchestration.waitForOtherThreads=true;
    await assert.rejects(h.plugin.sendChat('x'.repeat(120_000),project),/120,?000|limit|long/i);
    assert.equal(h.commands.length,0,'Invalid input must not create a thread');
    assert.equal(h.plugin.settings.pending.length,0);
    assert.equal(h.plugin.busy,false);
    const firstLine='A'.repeat(180), prompt='\n'+firstLine+'\nContinue with this line.';
    await h.plugin.sendChat(prompt,project);
    assert.equal(h.commands[0].title,'A'.repeat(160));
    assert.equal(h.commands[1].message.text,WAIT_FOR_OTHER_THREADS_INSTRUCTION+'\n\n'+prompt);
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
    const first=h.plugin.sendChat('First request',project);
    await enteredTurn;
    assert.equal(h.plugin.busy,true);
    await assert.rejects(h.plugin.sendChat('Second request',project),/busy|progress|sending|wait/i);
    assert.equal(h.commands.length,2);
    release();
    await first;
    assert.equal(h.plugin.busy,false);
    assert.equal(h.plugin.settings.pending.length,0);
  } finally {release?.();h.plugin.onunload();}
});
