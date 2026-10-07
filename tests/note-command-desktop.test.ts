import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {NoteCommandServer} from '../note-command-desktop';

const run=(args:string[])=>new Promise<{code:number|null;out:string}>(resolve=>{const child=spawn('python3',['scripts/obsidian-command.py',...args]);let out='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>out+=data);child.on('close',code=>resolve({code,out}));});
test('unchanged mailbox history does not repeat result access; new commands and result deletion remain immediate',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-mailbox-idle-'));let calls=0,accesses=0;
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>{calls++;return {id:command.id,ok:calls>1};},()=>true);
  const originalAccess=fs.access;
  fs.access=(async(...args:Parameters<typeof fs.access>)=>{if(String(args[0]).startsWith(root))accesses++;return originalAccess(...args);}) as typeof fs.access;
  try{
    const base=join(root,'.obsidian/t3-code/commands/v1'),id=randomUUID();
    await writeFile(join(base,'requests',id+'.json'),JSON.stringify({version:1,id,kind:'client-status'}));
    await server.tick();await server.tick();
    const warm=accesses;
    for(let i=0;i<100;i++)await server.tick();
    assert.equal(accesses,warm);assert.equal(calls,1);assert.ok(server.status().skippedScans>=100);
    await rm(join(base,'results',id+'.json'));await server.tick();assert.equal(calls,2);
    const next=randomUUID();await writeFile(join(base,'requests',next+'.json'),JSON.stringify({version:1,id:next,kind:'client-status'}));
    await server.tick();assert.equal(calls,3);assert.equal(JSON.parse(await readFile(join(base,'results',next+'.json'),'utf8')).ok,true);
    // The periodic full audit remains a separate fallback, even if directory
    // metadata is restored by a filesystem or the system clock changes.
    await server.tick();(server as any).unchanged.until=-1;
    const before=accesses;await server.tick();assert.ok(accesses>before);assert.equal(calls,3);
  }finally{fs.access=originalAccess;await server.dispose();await rm(root,{recursive:true,force:true});}
});

test('unchanged mailbox scans retain pending native reload acknowledgement checks',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-mailbox-reload-'));let attempts=0,allow=false,calls=0;
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>{calls++;return {id:command.id,ok:true,reloadScheduled:true,client:{instanceId:'client',loadedVersion:'1.2.3'}};},()=>true,undefined,async()=>{attempts++;return allow;});
  try{
    const base=join(root,'.obsidian/t3-code/commands/v1'),id=randomUUID();
    await writeFile(join(base,'requests',id+'.json'),JSON.stringify({version:1,id,kind:'reload-client',releaseVersion:'1.2.4',runtimeSha256:{'main.js':'a'.repeat(64),'manifest.json':'b'.repeat(64),'styles.css':'c'.repeat(64)}}));
    await server.tick();await server.tick();const before=attempts;
    await server.tick();assert.ok(server.status().skippedScans>0);assert.equal(attempts,before+1);assert.equal(calls,1);
    allow=true;await server.tick();assert.equal(attempts,before+2);assert.equal(calls,1);
  }finally{await server.dispose();await rm(root,{recursive:true,force:true});}
});
test('agent CLI reaches the running plugin mailbox once, replays results, and rejects changed command IDs',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-note-command-'));let calls=0;
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>{calls++;return {id:command.id,ok:true,threadId:'created-thread',bindingIds:['binding-a','binding-b']};},()=>true);
  try{
    const id=randomUUID(),args=['--vault',root,'--request-id',id,'send-note','A.md','--destination','A.md','--destination','B.md'];
    const result=await run(args);assert.equal(result.code,0);assert.equal(JSON.parse(result.out).threadId,'created-thread');assert.equal(calls,1);
    assert.equal((await run(args)).code,0);assert.equal(calls,1);
    const changed=await run([...args,'--destination','C.md']);assert.notEqual(changed.code,0);assert.match(changed.out,/different input/);assert.equal(calls,1);
    const path=join(root,'.obsidian/t3-code/commands/v1/requests',id+'.json');assert.equal(JSON.parse(await readFile(path,'utf8')).notePath,'A.md');
    const bad=randomUUID();await writeFile(join(root,'.obsidian/t3-code/commands/v1/requests',bad+'.json'),JSON.stringify({version:1,id:bad,kind:'send-note',notePath:'../secret.md',destinations:[],streamReply:true}));
    await server.tick();const rejected=JSON.parse(await readFile(join(root,'.obsidian/t3-code/commands/v1/results',bad+'.json'),'utf8'));assert.equal(rejected.ok,false);assert.equal(calls,1);
  }finally{await server.dispose();await rm(root,{recursive:true,force:true});}
});

test('subscription CLI shares the private mailbox and preserves typed property filters',{timeout:10000},async()=>{
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
  }finally{await server.dispose();await rm(root,{recursive:true,force:true});}
});

test('a second mailbox consumer cannot acquire authority and stop callbacks revoke delivery',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-event-authority-'));let stopped=false;
  const server=await NoteCommandServer.open(root,'.obsidian',async command=>({id:command.id,ok:true}),()=>true,()=>{stopped=true;});
  try{await assert.rejects(NoteCommandServer.open(root,'.obsidian',async command=>({id:command.id,ok:true}),()=>true),/lock/i);await server.dispose();assert.equal(stopped,true);}
  finally{await server.dispose();await rm(root,{recursive:true,force:true});}
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
  }finally{await server.dispose();await rm(root,{recursive:true,force:true});}
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
  }finally{await server.dispose();await rm(root,{recursive:true,force:true});}
});
