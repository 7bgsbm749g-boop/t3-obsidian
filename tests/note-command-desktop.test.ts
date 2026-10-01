import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {NoteCommandServer} from '../note-command-desktop';

const run=(args:string[])=>new Promise<{code:number|null;out:string}>(resolve=>{const child=spawn('python3',['scripts/obsidian-command.py',...args]);let out='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>out+=data);child.on('close',code=>resolve({code,out}));});
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
