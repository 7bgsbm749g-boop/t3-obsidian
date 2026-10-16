import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {NoteCommandServer} from '../note-command-desktop';
import {existingPrivateStorage} from '../private-storage-desktop';
const cleanup=async(root:string,configDir='.obsidian')=>{const route=await existingPrivateStorage(root,configDir);if(route)await rm(route.storageRoot,{recursive:true,force:true});await rm(root,{recursive:true,force:true});};

const run=(args:string[])=>new Promise<{code:number|null;out:string}>(resolve=>{const child=spawn('python3',['scripts/obsidian-command.py',...args]);let out='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>out+=data);child.on('close',code=>resolve({code,out}));});
test('archived requests never execute or scan; direct requests replay and retry only their exact receipt',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-direct-idle-'));let calls=0;
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>({id:command.id,ok:++calls>1}),()=>true);
  try{
    const base=join((await existingPrivateStorage(root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1'),archived=randomUUID();
    await writeFile(join(base,'requests',archived+'.json'),JSON.stringify({version:1,id:archived,kind:'client-status'}));
    for(let i=0;i<100;i++)await server.tick();assert.equal(calls,0);
    const id=randomUUID(),args=['--vault',root,'--request-id',id,'client-status'];
    assert.equal((await run(args)).code,1);assert.equal(calls,1);
    assert.equal((await run(args)).code,1);assert.equal(calls,1);
    assert.equal((await run([...args,'--retry'])).code,0);assert.equal(calls,2);
    assert.equal((await run(args)).code,0);assert.equal(calls,2);
    assert.equal(server.status().transport,'direct');assert.equal(server.status().activeRequests,0);
    await assert.rejects(readFile(join(base,'results',archived+'.json')),/ENOENT/);
    const endpoint=JSON.parse(await readFile(join(base,'endpoint.json'),'utf8'));
    assert.equal((await fs.stat(join(base,'endpoint.json'))).mode&0o777,0o600);
    const denied=await fetch(endpoint.url,{method:'POST',body:JSON.stringify({command:{version:1,id:randomUUID(),kind:'client-status'}})});assert.equal(denied.status,403);
    assert.equal(calls,2);
  }finally{await server.dispose();await cleanup(root);}
});

test('only explicitly requested native reloads retain acknowledgement checks',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-direct-reload-'));let attempts=0,allow=false,calls=0;
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>{calls++;return {id:command.id,ok:true,reloadScheduled:true,client:{instanceId:'client',loadedVersion:'1.2.3'}};},()=>true,undefined,async()=>{attempts++;return allow;});
  try{
    const id=randomUUID(),args=['--vault',root,'--request-id',id,'reload-client','--release-version','1.2.4','--runtime-hashes',JSON.stringify({'main.js':'a'.repeat(64),'manifest.json':'b'.repeat(64),'styles.css':'c'.repeat(64)})];
    assert.equal((await run(args)).code,0);await server.tick();const before=attempts;
    await server.tick();assert.equal(attempts,before+1);assert.equal(calls,1);
    allow=true;await server.tick();assert.equal(attempts,before+2);assert.equal(calls,1);
    await server.tick();assert.equal(attempts,before+2);
  }finally{await server.dispose();await cleanup(root);}
});
test('agent CLI reaches the running plugin directly once, replays results, and rejects changed command IDs',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-note-command-'));let calls=0;
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>{calls++;return {id:command.id,ok:true,threadId:'created-thread',bindingIds:['binding-a','binding-b']};},()=>true);
  try{
    const id=randomUUID(),args=['--vault',root,'--request-id',id,'send-note','A.md','--destination','A.md','--destination','B.md'];
    const result=await run(args);assert.equal(result.code,0);assert.equal(JSON.parse(result.out).threadId,'created-thread');assert.equal(calls,1);
    assert.equal((await run(args)).code,0);assert.equal(calls,1);
    const changed=await run([...args,'--destination','C.md']);assert.notEqual(changed.code,0);assert.match(changed.out,/different input/);assert.equal(calls,1);
    const path=join((await existingPrivateStorage(root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1/requests',id+'.json');assert.equal(JSON.parse(await readFile(path,'utf8')).notePath,'A.md');
    const bad=await run(['--vault',root,'send-note','../secret.md']);assert.equal(bad.code,1);assert.match(bad.out,/Invalid Obsidian note command/);assert.equal(calls,1);
  }finally{await server.dispose();await cleanup(root);}
});

test('subscription CLI shares the direct endpoint and preserves typed property filters',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-subscription-command-'));const received:any[]=[];
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>{received.push(command);return {id:command.id,ok:true,monitoring:command.kind==='subscribe'};},()=>true);
  try{
    const id=randomUUID();const args=['--vault',root,'--request-id',id,'subscribe','--scope','Gym','--scope-kind','folder','--event','property','--property','completed','--equals','true','--thread-id','thread','--project-id','project','--environment-id','machine'];
    assert.equal((await run(args)).code,0);assert.equal(received.length,1);assert.deepEqual(received[0].filter,{events:['property'],property:'completed',equals:true});assert.deepEqual(received[0].scope,{path:'Gym',kind:'folder',recursive:true});
    assert.equal((await run(args)).code,0);assert.equal(received.length,1);
    assert.equal((await run(['--vault',root,'subscriptions'])).code,0);
    assert.equal((await run(['--vault',root,'pause-subscription','--subscription-id',id])).code,0);
    assert.equal((await run(['--vault',root,'update-subscription','--subscription-id',id,'--scope','Gym/A.md','--scope-kind','note'])).code,0);
    const bad=await run(['--vault',root,'subscribe','--scope','../secret','--scope-kind','folder','--thread-id','thread','--project-id','project','--environment-id','machine']);assert.equal(bad.code,1);assert.match(bad.out,/vault-relative/);
    const ambiguous=await run(['--vault',root,'subscribe','--scope','Gym','--scope-kind','folder','--event','property','--thread-id','thread','--project-id','project','--environment-id','machine']);assert.equal(ambiguous.code,1);assert.match(ambiguous.out,/property name/);
  }finally{await server.dispose();await cleanup(root);}
});

test('a second direct command server cannot acquire authority and stop callbacks revoke delivery',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-event-authority-'));let stopped=false;
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>({id:command.id,ok:true}),()=>true,()=>{stopped=true;});
  try{await assert.rejects(NoteCommandServer.open(root,'.obsidian',async command=>({id:command.id,ok:true}),()=>true),/lock/i);await server.dispose();assert.equal(stopped,true);}
  finally{await server.dispose();await cleanup(root);}
});

test('folder CLI requires exact identities, preserves modes, and replays immutable requests',{timeout:15000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-folder-command-'));const received:any[]=[];
  const server=await NoteCommandServer.open(root,'.custom',async command=>{received.push(command);return {id:command.id,ok:true};},()=>true);
  const base=['--vault',root,'--config-dir','.custom'];
  try{
    const id=randomUUID(),args=[...base,'--request-id',id,'link-folder','Projects/Side/handoff','--project-id','repo','--connection-id','c','--environment-id','env','--mode','self','--relink'];
    assert.equal((await run(args)).code,0);assert.equal(received[0].folderPath,'Projects/Side/handoff');assert.equal(received[0].mode,'self');assert.equal(received[0].relink,true);
    assert.equal((await run(args)).code,0);assert.equal(received.length,1);
    const changed=await run([...args.slice(0,-1)]);assert.notEqual(changed.code,0);assert.match(changed.out,/different input/);
    for(const kind of ['inspect-folder','unlink-folder'])assert.equal((await run([...base,kind,'Projects'])).code,0);
    for(const args of [['link-folder','Projects','--project-id','repo'],['inspect-folder','Projects','--project-id','repo'],['link-folder','Projects','--project-id','repo','--connection-id','c','--environment-id','env','--thread-id','thread'],['subscriptions','--relink']])assert.notEqual((await run([...base,...args])).code,0);
    const invalid=await run([...base,'inspect-folder','../private']);assert.equal(invalid.code,1);assert.match(invalid.out,/vault-relative/);
  }finally{await server.dispose();await cleanup(root,'.custom');}
});

test('direct action CLI registers without a thread, preserves JSON values and rejects mixed targets',{timeout:15000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-action-command-')),received:any[]=[];
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>{received.push(command);return {id:command.id,ok:true};},()=>true);
  try{
    const base=['--vault',root,'subscribe','--scope','Jobs','--scope-kind','folder','--action','{"kind":"set-property","property":"done","value":true}'];
    assert.equal((await run(base)).code,0);assert.equal(received[0].target,undefined);assert.deepEqual(received[0].action,{kind:'set-property',property:'done',value:true});
    assert.equal((await run([...base,'--thread-id','t','--project-id','p','--environment-id','e'])).code,2);
    assert.equal((await run([...base.slice(0,-1),'null'])).code,2);
    assert.equal((await run([...base.slice(0,-1),'{"kind":"move-note","folder":"../private"}'])).code,1);
    const job=['--vault',root,'subscribe-job','--job-id','j','--job-request-id','r','--message-id','m','--job-thread-id','worker','--job-project-id','p','--job-environment-id','e','--job-state','failed','--action','{"kind":"set-property","notePath":"Jobs/A.md","property":"status","value":"failed"}'];
    assert.equal((await run(job)).code,0);assert.deepEqual(received.at(-1).jobStates,['failed']);assert.equal(received.at(-1).target,undefined);
  }finally{await server.dispose();await cleanup(root);}
});

test('a slow direct command does not block reads and concurrent retries execute once',{timeout:10000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'t3-direct-concurrent-'));let release!:()=>void,started!:()=>void,calls=0;
 const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const id=randomUUID(),command={version:1,id,kind:'inspect-folder',folderPath:'Nested/Ä note'};
 const server=await NoteCommandServer.open(root,'.obsidian',async input=>{calls++;if(input.id===id){started();await gate;}return {id:input.id,ok:true};},()=>true);
 try{
  const endpoint=JSON.parse(await readFile(join((await existingPrivateStorage(root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1/endpoint.json'),'utf8'));
  const post=(input:any,headers:any={})=>fetch(endpoint.url,{method:'POST',headers:{Authorization:'Bearer '+endpoint.token,...headers},body:JSON.stringify({command:input})});
  const first=post(command);await entered;
  const retry=post(command),changed=await post({...command,folderPath:'Different'});assert.equal(changed.status,400);assert.match((await changed.json()).error,/different input/);
  const read=await post({version:1,id:randomUUID(),kind:'client-status'});assert.equal(read.status,200);assert.equal((await read.json()).ok,true);assert.equal(calls,2);
  const origin=await post({version:1,id:randomUUID(),kind:'client-status'},{Origin:'https://untrusted.example'});assert.equal(origin.status,403);assert.equal(calls,2);
  release();assert.equal((await (await first).json()).ok,true);assert.equal((await (await retry).json()).ok,true);assert.equal(calls,2);
  await server.dispose();const closed=await run(['--vault',root,'client-status']);assert.equal(closed.code,1);assert.match(closed.out,/No request was queued/);assert.equal(calls,2);
 }finally{release();await server.dispose();await cleanup(root);}
});


test('context CLI preserves exact source and T3 filters through the authenticated endpoint',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-note-context-')),received:any[]=[];
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>{received.push(command);return {id:command.id,ok:true};},()=>true);
  try{
    const messageId=randomUUID(),id=randomUUID(),args=['--vault',root,'--request-id',id,'note-context','Source.md','--thread-id','thread','--message-id',messageId,'--environment-id','env'];
    assert.equal((await run(args)).code,0);assert.deepEqual(received[0],{version:1,id,kind:'note-context',notePath:'Source.md',threadId:'thread',messageId,environmentId:'env'});
    assert.equal((await run(args)).code,0);assert.equal(received.length,1);
    assert.notEqual((await run(['--vault',root,'note-context','../secret.md'])).code,0);assert.equal(received.length,1);
    assert.notEqual((await run([...args,'--destination','Other.md'])).code,0);assert.equal(received.length,1);
  }finally{await server.dispose();await cleanup(root);}
});
