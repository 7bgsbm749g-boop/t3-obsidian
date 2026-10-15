import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {setTimeout as pause} from 'node:timers/promises';
import lockfile from 'proper-lockfile';
import {promises as fs} from 'node:fs';
import {InlineLeaseClient} from '../inline-lease';
import {localInlineFiles} from '../hosted-inline-desktop';
import {existingPrivateStorage,ensurePrivateStorage} from '../private-storage-desktop';
import {contentHash} from '../completion';
import {responseAnchor} from '../native-response-projection';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'t3-host-lifecycle-')),module={exports:{} as any};
  class Base{}
  const obsidian={Plugin:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile:false}},require=createRequire(import.meta.url);
  runInNewContext(await readFile(process.env.T3_HOST_LIFECYCLE_BUNDLE??'dist/main.js','utf8'),{module,exports:module.exports,require:(id:string)=>id==='obsidian'?obsidian:require(id),global:{},process,console,Buffer,URL,TextEncoder,TextDecoder,AbortController,crypto:webcrypto,performance,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,document:{createElement:()=>({})}});
  const plugin=new module.exports.default(),directory='.obsidian/t3-code/inline/v1',vaultId=randomUUID();
  plugin.app={workspace:{getLeavesOfType:()=>[]},vault:{configDir:'.obsidian',adapter:{getFullPath:()=>root},getFileByPath:()=>undefined}};
  plugin.settings={vaultId,paired:[],connection:{host:'local'}};plugin.localInlineEnvironment=async()=> 'fixture';
  return {root,directory,vaultId,plugin,async close(){plugin.stopped=true;await plugin.inlineHostService?.dispose();await plugin.noteCommandServer?.dispose();const route=await existingPrivateStorage(root,".obsidian");if(route)await rm(route.storageRoot,{recursive:true,force:true});await rm(root,{recursive:true,force:true});}};
}

test('packaged legacy discovery leaves completed history inactive until explicit maintenance',async()=>{
  const h=await fixture();
  try{
    await h.plugin.refreshInlineHost();const host=h.plugin.inlineHostService.coordinated,files=host.files,read=files.read;
    const id=randomUUID(),path=`${h.directory}/leases/${id}.json`,record={request:{id,notePath:'Original.md',version:4},epoch:1,revision:1,state:{status:'conflict',body:'Large retained reply '.repeat(10000),hashes:[],updatedAt:''}};
    await files.write(path,JSON.stringify(record));let freshReads=0,versionChecks=0;const version=files.version;
    files.read=async(p:string)=>{if(p===path)freshReads++;return read(p);};
    files.version=async(p:string)=>{if(p===path)versionChecks++;return version(p);};
    for(let i=0;i<100;i++)await host.scanRecords(true);
    assert.equal(freshReads,1,'unchanged historical bodies need one fresh source read');assert.equal(versionChecks,2,'completed history needs only its cold index identity check');
    assert.equal(host.leaseCacheStatus().parses,1);assert.equal(host.leaseCacheStatus().versionHits,0);
    await files.write(path,JSON.stringify({...record,state:{...record.state,body:'Fresh same-revision replacement'}}));
    await host.scanRecords(true);assert.equal(freshReads,1);await host.scanRecords();assert.equal(host.records.get(id).state.body,'Fresh same-revision replacement');assert.equal(freshReads,2);
    await files.remove(path);await host.scanRecords();assert.equal(host.leaseCacheStatus().entries,0);
    await h.plugin.inlineHostService.dispose();assert.equal(host.leaseCacheStatus().characters,0);assert.equal(host.leaseCacheStatus().versionEntries,0);
  }finally{await h.close();}
});

test('lost host lock is reacquired and an original registration is acknowledged without redispatch',async()=>{
  const h=await fixture();
  try{
    await h.plugin.refreshInlineHost();const old=h.plugin.inlineHostService;
    // Only this synthetic test lock is removed to reproduce compromise.
    await rm(join((await existingPrivateStorage(h.root,'.obsidian'))!.storageRoot,h.directory)+'.lock',{recursive:true});
    for(let n=0;n<65&&!old.stopped;n++)await pause(100);
    assert.equal(old.stopped,true,'actual lock compromise stops the old host');
    await Promise.all([h.plugin.refreshInlineHost(),h.plugin.refreshInlineHost()]);
    const id=randomUUID(),actor=randomUUID(),request:any={version:2,nativeProjection:true,id,initialOwner:actor,vaultId:h.vaultId,host:{workspaceRoot:h.root,directory:h.directory,environmentId:'fixture'},notePath:'Original.md',threadId:randomUUID(),messageId:randomUUID(),projectId:'fixture',threadEnvironmentId:'fixture',initialHash:contentHash('original'),createdAt:new Date().toISOString()};
    const client=new InlineLeaseClient(actor,localInlineFiles(h.root,h.directory),h.directory);
    const reply=await client.command({kind:'register',jobId:id,request});client.dispose();
    assert.equal(reply.ok,true);assert.deepEqual(reply.record?.request,request);
    assert.equal(reply.record?.coordinated,true,'registration remains independent and host-owned');
    assert.notEqual(h.plugin.inlineHostService,old);assert.equal(h.plugin.inlineHostService.active,true);
  }finally{await h.close();}
});

test('direct command bridge retries a startup lock refusal without replaying a retained request',async()=>{
  const h=await fixture(),base=join(h.root,'.obsidian/t3-code/commands/v1');let calls=0;
  await mkdir(base,{recursive:true});let release:()=>Promise<void>=await lockfile.lock(base,{realpath:true});
  try{
    h.plugin.executeAgentCommand=async(command:any)=>{calls++;return {id:command.id,ok:true};};
    await assert.rejects(h.plugin.refreshNoteCommandHost(),/already being held/);
    const id=randomUUID(),command={version:1,id,kind:'inspect-folder',folderPath:'/'};
    await mkdir(join(base,'requests'),{recursive:true});await writeFile(join(base,'requests',id+'.json'),JSON.stringify(command));
    await release();release=async()=>{};
    await Promise.all([h.plugin.refreshNoteCommandHost(),h.plugin.refreshNoteCommandHost()]);
    await h.plugin.noteCommandServer.tick();assert.equal(calls,0,'startup does not execute request files');
    const privateBase=join((await existingPrivateStorage(h.root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1');
    const endpoint=JSON.parse(await readFile(join(privateBase,'endpoint.json'),'utf8'));
    const response=await fetch(endpoint.url,{method:'POST',headers:{Authorization:'Bearer '+endpoint.token},body:JSON.stringify({command})});assert.equal(response.status,200);await response.json();
    assert.equal(JSON.parse(await readFile(join((await existingPrivateStorage(h.root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1/results',id+'.json'),'utf8')).id,id);assert.equal(calls,1);
    await h.plugin.refreshNoteCommandHost();await h.plugin.noteCommandServer.tick();assert.equal(calls,1);
    await h.plugin.noteCommandServer.dispose();await h.plugin.refreshNoteCommandHost();
    assert.equal(h.plugin.noteCommandServer.active,true);await h.plugin.noteCommandServer.tick();assert.equal(calls,1,'restart retains the acknowledgement and never repeats a command');
  }finally{await release();await h.close();}
});

test('response host releases ownership even when closing a cached connection fails',async()=>{
  const h=await fixture();
  try{
    await h.plugin.refreshInlineHost();const old=h.plugin.inlineHostService;
    old.accessCache.createAccess=async()=>({origin:'https://fixture',api:async()=>({}),close:async()=>{throw Error('Connection already gone');}});
    await old.accessCache.get('broken');
    await old.dispose();assert.equal(old.active,false);
    await h.plugin.refreshInlineHost();assert.notEqual(h.plugin.inlineHostService,old);assert.equal(h.plugin.inlineHostService.active,true);
  }finally{await h.close();}
});

test('packaged authority abandons a lost read and acknowledges an immutable registration and replay',async()=>{
  const h=await fixture(),read=fs.readFile;let late!:(value:string)=>void,lose=true;
  try{
    // Missing files now return after a fresh metadata check. Supply a real
    // catalog so this fault stalls a byte read rather than nonexistent IO.
    await mkdir(join(h.root,h.directory),{recursive:true});await writeFile(join(h.root,h.directory,'lease-catalog.json'),'[]');
    const route=await ensurePrivateStorage(h.root,'.obsidian');
    fs.readFile=((path:any,...args:any[])=>{
      if(lose&&String(path)===join(route.storageRoot,h.directory,'lease-catalog.json')){lose=false;return new Promise(resolve=>{late=resolve;});}
      return (read as any)(path,...args);
    }) as typeof read;
    await h.plugin.refreshInlineHost();
    const actor=randomUUID(),id=randomUUID(),command={id:randomUUID(),actor};
    const request:any={version:2,nativeProjection:true,id,initialOwner:actor,vaultId:h.vaultId,host:{workspaceRoot:h.root,directory:h.directory,environmentId:'fixture'},notePath:'Synthetic.md',threadId:randomUUID(),messageId:randomUUID(),projectId:'fixture',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:new Date().toISOString()};
    const storage=localInlineFiles(h.root,h.directory),client=new InlineLeaseClient(actor,storage,h.directory);
    const input={kind:'register' as const,jobId:id,request};
    assert.equal((await client.command(input,command)).ok,true,'the packaged host must clear the stuck read before the existing registration deadline');
    const record=await storage.read(`${h.directory}/leases/${id}.json`);
    late('invalid abandoned bytes');await pause(10);
    assert.equal((await client.command(input,command)).ok,true);
    assert.equal(await storage.read(`${h.directory}/leases/${id}.json`),record,'late read and exact replay cannot mutate request identity or ownership');
    client.dispose();
  }finally{fs.readFile=read;late?.('');await h.close();}
});

test('shutdown cancels a lost authority read before reacquiring ownership',async()=>{
  const h=await fixture(),read=fs.readFile;let entered!:()=>void,lose=true;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  try{
    await mkdir(join(h.root,h.directory),{recursive:true});await writeFile(join(h.root,h.directory,'lease-catalog.json'),'[]');
    const route=await ensurePrivateStorage(h.root,'.obsidian');
    fs.readFile=((path:any,...args:any[])=>{
      if(lose&&String(path)===join(route.storageRoot,h.directory,'lease-catalog.json')){lose=false;entered();return new Promise(()=>{});}
      return (read as any)(path,...args);
    }) as typeof read;
    await h.plugin.refreshInlineHost();const host=h.plugin.inlineHostService;
    await Promise.race([started,pause(1000).then(()=>{throw Error('Authority did not enter the synthetic read');})]);
    await Promise.race([host.dispose(),pause(500).then(()=>{throw Error('Stopped authority retained a lost read and its lock');})]);
    await h.plugin.refreshInlineHost();assert.notEqual(h.plugin.inlineHostService,host);assert.equal(h.plugin.inlineHostService.active,true);
  }finally{fs.readFile=read;await h.close();}
});

test('packaged desktop host delivers a renamed response while an older journal read is stalled',async()=>{
  const h=await fixture();let release!:()=>void;const pending:Promise<void>[]=[];
  try{
    const notes=new Map<string,string>(),files=new Map<string,{path:string}>();
    const getFile=(path:string)=>files.get(path);
    Object.assign(h.plugin.app.vault,{
      getFileByPath:getFile,getMarkdownFiles:()=>[...files.values()],
      read:async(file:{path:string})=>notes.get(file.path),
      process:async(file:{path:string},change:(value:string)=>string)=>{const next=change(notes.get(file.path)!);notes.set(file.path,next);return next;},
    });
    await h.plugin.refreshInlineHost();const host=h.plugin.inlineHostService;
    const actor=randomUUID(),client=new InlineLeaseClient(actor,localInlineFiles(h.root,h.directory),h.directory);
    const register=async(path:string)=>{
      const id=randomUUID(),request={version:2 as const,nativeProjection:true,independent:true,id,initialOwner:actor,vaultId:h.vaultId,host:{workspaceRoot:h.root,directory:h.directory,environmentId:'fixture'},notePath:path,threadId:randomUUID(),messageId:randomUUID(),projectId:'fixture',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:new Date().toISOString()};
      notes.set(path,responseAnchor(id));files.set(path,{path});
      assert.equal((await client.command({kind:'register',jobId:id,request})).ok,true);return request;
    };
    const old=await register('Older.md'),read=host.coordinated.journal.read.bind(host.coordinated.journal);
    let entered!:()=>void,calls=0;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    host.coordinated.journal.read=async(id:string)=>{if(id===old.id){calls++;entered();await gate;}return read(id);};
    pending.push(host.tick());await started;
    const fresh=await register('Untitled.md'),file=files.get('Untitled.md')!;
    const text=notes.get('Untitled.md')!;notes.delete('Untitled.md');files.delete('Untitled.md');
    file.path='Renamed.md';files.set(file.path,file);notes.set(file.path,text);host.renamed('Untitled.md',file.path);
    const access={origin:'https://fixture',api:async()=>({thread:{id:fresh.threadId,projectId:'fixture',title:'Canonical renamed thread',messages:[{id:fresh.messageId,role:'user',text:'Reply',streaming:false,createdAt:fresh.createdAt},{id:'answer',role:'assistant',text:'Healthy reply delivered.',turnId:'healthy-turn',streaming:false}],activities:[],latestTurn:{turnId:'healthy-turn',messageId:fresh.messageId,state:'completed',requestedAt:fresh.createdAt,assistantMessageId:'answer'},session:{status:'ready',activeTurnId:null}}}),close:async()=>{}};
    host.accessCache.createAccess=async()=>access;
    const deadline=Date.now()+1500,recordPath=`${h.directory}/leases/${fresh.id}.json`,storage=localInlineFiles(h.root,h.directory);
    while(Date.now()<deadline){
      if(JSON.parse((await storage.read(recordPath))!).state?.cleanupComplete)break;
      pending.push(host.tick());await pause(10);
    }
    client.dispose();
    const record=JSON.parse((await storage.read(recordPath))!);
    assert.match(notes.get('Renamed.md')!,/Healthy reply delivered\./,'outer host must keep discovery and writers ticking before the older scan resolves: '+JSON.stringify({record,failures:[...host.coordinated.failures]}));
    assert.equal(record.state.cleanupComplete,true);assert.equal(record.state.notePath,'Renamed.md');assert.equal(record.request.notePath,'Untitled.md');
    assert.equal(calls,1,'repeated desktop ticks cannot duplicate the blocked response worker');
  }finally{release?.();await Promise.allSettled(pending);await h.close();}
});

test('packaged client status exposes only numeric code-range counters even without a response host',async()=>{
 const h=await fixture();try{
  const id=randomUUID();h.plugin.refreshNoteCommandHost=async()=>{};
  h.plugin.clientMaintenance={execute:async()=>({id,ok:true,client:{instanceId:randomUUID(),loadedVersion:'fixture'}})};
  const result=await h.plugin.executeAgentCommand({version:1,id,kind:'client-status'});
  assert.equal(result.ok,true);assert.equal(result.responseHost,undefined);
  assert.ok(Object.values(result.codeRangeCache).every(value=>typeof value==='number'&&Number.isFinite(value)));
  assert.equal(result.codeRangeCache.maxCharacters,8_000_000);assert.equal(result.codeRangeCache.maxEntries,128);
  assert.equal(typeof result.codeRangeCache.skippedTextGroups,'number');
 }finally{await h.close();}
});
test('packaged SSH log command reads only the current device failure key and returns loaded client identity',async()=>{
 const h=await fixture();try{
  const id=randomUUID(),saved=[{at:'2026-10-09T17:40:15Z',stage:'response-registration',elapsedMs:5,delivery:'not-started',error:{message:'Duplicate response boundaries'}}];
  h.plugin.refreshNoteCommandHost=async()=>{};h.plugin.deviceId='this-device';
  h.plugin.app.loadLocalStorage=(key:string)=>{assert.equal(key,`t3-send-failures-v1:${h.plugin.settings.vaultId}`);return saved;};
  h.plugin.clientMaintenance={execute:async()=>({id,ok:true,client:{instanceId:'this-instance',loadedVersion:'loaded-release'}})};
  const result=await h.plugin.executeAgentCommand({version:1,id,kind:'send-failure-log',since:'2026-10-09T17:40:00Z'});
  assert.equal(result.failureLog.pluginVersion,'loaded-release');assert.equal(result.failureLog.deviceId,'this-device');assert.deepEqual(JSON.parse(JSON.stringify(result.failureLog.failures)),saved);
  assert.equal(result.reloadScheduled,undefined);assert.equal(result.responseHost,undefined);
 }finally{await h.close();}
});
