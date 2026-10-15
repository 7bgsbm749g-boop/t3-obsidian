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
