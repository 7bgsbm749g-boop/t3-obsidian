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
import {InlineLeaseClient} from '../inline-lease';
import {localInlineFiles} from '../hosted-inline-desktop';
import {contentHash} from '../completion';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'t3-host-lifecycle-')),module={exports:{} as any};
  class Base{}
  const obsidian={Plugin:Base,Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile:false}},require=createRequire(import.meta.url);
  runInNewContext(await readFile(process.env.T3_HOST_LIFECYCLE_BUNDLE??'dist/main.js','utf8'),{module,exports:module.exports,require:(id:string)=>id==='obsidian'?obsidian:require(id),global:{},process,console,Buffer,URL,TextEncoder,TextDecoder,AbortController,crypto:webcrypto,performance,setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,document:{createElement:()=>({})}});
  const plugin=new module.exports.default(),directory='.obsidian/t3-code/inline/v1',vaultId=randomUUID();
  plugin.app={workspace:{getLeavesOfType:()=>[]},vault:{configDir:'.obsidian',adapter:{getFullPath:()=>root},getFileByPath:()=>undefined}};
  plugin.settings={vaultId,paired:[],connection:{host:'local'}};plugin.localInlineEnvironment=async()=> 'fixture';
  return {root,directory,vaultId,plugin,async close(){plugin.stopped=true;await plugin.inlineHostService?.dispose();await plugin.noteCommandServer?.dispose();await rm(root,{recursive:true,force:true});}};
}

test('lost host lock is reacquired and an original registration is acknowledged without redispatch',async()=>{
  const h=await fixture();
  try{
    await h.plugin.refreshInlineHost();const old=h.plugin.inlineHostService;
    // Only this synthetic test lock is removed to reproduce compromise.
    await rm(join(h.root,h.directory)+'.lock',{recursive:true});
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

test('command bridge retries a startup lock refusal and processes the same retained command once',async()=>{
  const h=await fixture(),base=join(h.root,'.obsidian/t3-code/commands/v1');let calls=0;
  await mkdir(base,{recursive:true});let release:()=>Promise<void>=await lockfile.lock(base,{realpath:true});
  try{
    h.plugin.executeAgentCommand=async(command:any)=>{calls++;return {id:command.id,ok:true};};
    await assert.rejects(h.plugin.refreshNoteCommandHost(),/already being held/);
    const id=randomUUID(),command={version:1,id,kind:'inspect-folder',folderPath:'/'};
    await mkdir(join(base,'requests'),{recursive:true});await writeFile(join(base,'requests',id+'.json'),JSON.stringify(command));
    await release();release=async()=>{};
    await Promise.all([h.plugin.refreshNoteCommandHost(),h.plugin.refreshNoteCommandHost()]);
    await h.plugin.noteCommandServer.tick();
    assert.equal(JSON.parse(await readFile(join(base,'results',id+'.json'),'utf8')).id,id);assert.equal(calls,1);
    await h.plugin.refreshNoteCommandHost();await h.plugin.noteCommandServer.tick();assert.equal(calls,1);
    await h.plugin.noteCommandServer.dispose();await h.plugin.refreshNoteCommandHost();
    assert.equal(h.plugin.noteCommandServer.active,true);await h.plugin.noteCommandServer.tick();assert.equal(calls,1,'restart retains the acknowledgement and never repeats a command');
  }finally{await release();await h.close();}
});

test('response host releases ownership even when closing a cached connection fails',async()=>{
  const h=await fixture();
  try{
    await h.plugin.refreshInlineHost();const old=h.plugin.inlineHostService;
    old.accesses.set('broken',{access:{close:async()=>{throw Error('Connection already gone');}},expires:0});
    await old.dispose();assert.equal(old.active,false);
    await h.plugin.refreshInlineHost();assert.notEqual(h.plugin.inlineHostService,old);assert.equal(h.plugin.inlineHostService.active,true);
  }finally{await h.close();}
});
