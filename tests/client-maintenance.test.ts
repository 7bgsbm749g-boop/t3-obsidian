import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DesktopClientMaintenance} from '../client-maintenance-desktop';
import {validateClientCommand,type ClientCommand} from '../client-command';
import {NoteCommandServer} from '../note-command-desktop';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'t3-native-reload-')),directory=join(root,'.obsidian/plugins/send-to-t3-code');await mkdir(directory,{recursive:true});
  const runtime={'main.js':'immutable bundle','manifest.json':JSON.stringify({version:'3.4.5'}),'styles.css':'immutable styles'},hashes:any={};
  for(const [name,bytes] of Object.entries(runtime)){await writeFile(join(directory,name),bytes);hashes[name]=createHash('sha256').update(bytes).digest('hex');}
  let reloads=0;const file={path:'Ordinary.md'},view={file,getViewData:()=> 'saved note'};
  const app:any={workspace:{getLeavesOfType:()=>[{view}]},vault:{read:async()=> 'saved note'},commands:{commands:{'app:reload':{name:'Reload app without saving'}},executeCommandById:(id:string)=>{assert.equal(id,'app:reload');reloads++;return true;}}};
  const command:ClientCommand={version:1,id:randomUUID(),kind:'reload-client',releaseVersion:'3.4.5',runtimeSha256:hashes};
  return {root,directory,app,view,command,maintenance:new DesktopClientMaintenance(app,root,'.obsidian','3.4.4'),reloads:()=>reloads,close:()=>rm(root,{recursive:true,force:true})};
}
test('private mailbox saves the reload acknowledgement before native dispatch and never repeats it across instances',async()=>{
  const h=await fixture();let server:NoteCommandServer|undefined;
  try{
    server=await NoteCommandServer.open(h.root,'.obsidian',command=>h.maintenance.execute(validateClientCommand(command)),()=>true,undefined,async(command,result)=>{
      const stored=JSON.parse(await readFile(join(h.root,'.obsidian/t3-code/commands/v1/results',command.id+'.json'),'utf8'));
      assert.deepEqual(stored,result);return h.maintenance.acknowledged(validateClientCommand(command),result);
    });
    await writeFile(join(h.root,'.obsidian/t3-code/commands/v1/requests',h.command.id+'.json'),JSON.stringify(h.command));
    await server.tick();assert.equal(h.reloads(),1);await server.tick();assert.equal(h.reloads(),1);
    const result=JSON.parse(await readFile(join(h.root,'.obsidian/t3-code/commands/v1/results',h.command.id+'.json'),'utf8'));
    const fresh=new DesktopClientMaintenance(h.app,h.root,'.obsidian','3.4.5');
    assert.equal(await fresh.acknowledged(h.command,result),false);assert.equal(h.reloads(),1);
    const status=await fresh.execute({version:1,id:randomUUID(),kind:'client-status'});
    assert.equal(status.client?.loadedVersion,'3.4.5');assert.notEqual(status.client?.instanceId,result.client.instanceId);
  }finally{await server?.dispose();await h.close();}
});
test('reload waits for exact Sync bytes and ordinary saved edits, and rechecks both after acknowledgement',async()=>{
  const h=await fixture();try{
    h.view.getViewData=()=> 'unsaved user edit';await assert.rejects(h.maintenance.execute(h.command),/ordinary note edits/);assert.equal(h.reloads(),0);
    h.view.getViewData=()=> 'saved note';const result=await h.maintenance.execute(h.command);
    await writeFile(join(h.directory,'styles.css'),'another release');await assert.rejects(h.maintenance.acknowledged(h.command,result),/exact release files/);assert.equal(h.reloads(),0);
  }finally{await h.close();}
});
test('native client commands require a complete immutable release and cannot request arbitrary app actions',()=>{
  const id=randomUUID();
  for(const value of [{version:1,id,kind:'reload-client'},{version:1,id,kind:'client-status',releaseVersion:'3.4.5'},{version:1,id,kind:'app:save'}])assert.throws(()=>validateClientCommand(value));
});
