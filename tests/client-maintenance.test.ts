import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DesktopClientMaintenance} from '../client-maintenance-desktop';
import {validateClientCommand,type ClientCommand} from '../client-command';
import {NoteCommandServer} from '../note-command-desktop';
import {existingPrivateStorage} from '../private-storage-desktop';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'t3-native-reload-')),directory=join(root,'.obsidian/plugins/send-to-t3-code');await mkdir(directory,{recursive:true});
  const runtime={'main.js':'immutable bundle','manifest.json':JSON.stringify({version:'3.4.5'}),'styles.css':'immutable styles'},hashes:any={};
  for(const [name,bytes] of Object.entries(runtime)){await writeFile(join(directory,name),bytes);hashes[name]=createHash('sha256').update(bytes).digest('hex');}
  let reloads=0;const file={path:'Ordinary.md'},view={file,getViewData:()=> 'saved note'};
  const app:any={workspace:{getLeavesOfType:()=>[{view}]},vault:{read:async()=> 'saved note'},commands:{commands:{'app:reload':{name:'Reload app without saving'}},executeCommandById:(id:string)=>{assert.equal(id,'app:reload');reloads++;return true;}}};
  const command:ClientCommand={version:1,id:randomUUID(),kind:'reload-client',releaseVersion:'3.4.5',runtimeSha256:hashes};
  return {root,directory,app,view,command,maintenance:new DesktopClientMaintenance(app,root,'.obsidian','3.4.4'),reloads:()=>reloads,close:async()=>{const route=await existingPrivateStorage(root,'.obsidian');if(route)await rm(route.storageRoot,{recursive:true,force:true});await rm(root,{recursive:true,force:true});}};
}
test('private mailbox saves the reload acknowledgement before native dispatch and never repeats it across instances',async()=>{
  const h=await fixture();let server:NoteCommandServer|undefined;
  try{
    server=await NoteCommandServer.open(h.root,'.obsidian',command=>h.maintenance.execute(validateClientCommand(command)),()=>true,undefined,async(command,result)=>{
      const stored=JSON.parse(await readFile(join((await existingPrivateStorage(h.root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1/results',command.id+'.json'),'utf8'));
      assert.deepEqual(stored,result);return h.maintenance.acknowledged(validateClientCommand(command),result);
    });
    await writeFile(join((await existingPrivateStorage(h.root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1/requests',h.command.id+'.json'),JSON.stringify(h.command));
    await server.tick();assert.equal(h.reloads(),1);await server.tick();assert.equal(h.reloads(),1);
    const result=JSON.parse(await readFile(join((await existingPrivateStorage(h.root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1/results',h.command.id+'.json'),'utf8'));
    const fresh=new DesktopClientMaintenance(h.app,h.root,'.obsidian','3.4.5');
    assert.equal(await fresh.acknowledged(h.command,result),false);assert.equal(h.reloads(),1);
    const status=await fresh.execute({version:1,id:randomUUID(),kind:'client-status'});
    assert.equal(status.client?.loadedVersion,'3.4.5');assert.notEqual(status.client?.instanceId,result.client.instanceId);
  }finally{await server?.dispose();await h.close();}
});
test('failure log command validates its timestamp and performs no reload or document read',async()=>{
 const h=await fixture();try{
  const command:ClientCommand={version:1,id:randomUUID(),kind:'send-failure-log',since:'2026-10-09T17:40:00Z'};
  h.app.vault.read=()=>{throw Error('must not read a note');};
  assert.equal((await h.maintenance.execute(command)).ok,true);assert.equal(h.reloads(),0);
  for(const value of [{...command,since:'yesterday'},{...command,kind:'client-status'},{...command,releaseVersion:'3.4.5'}])assert.throws(()=>validateClientCommand(value));
 }finally{await h.close();}
});
test('reload waits for exact Sync bytes and ordinary saved edits, and rechecks both after acknowledgement',async()=>{
  const h=await fixture();try{
    h.view.getViewData=()=> 'unsaved user edit';await assert.rejects(h.maintenance.execute(h.command),/unsaved edits/);assert.equal(h.reloads(),0);
    h.view.getViewData=()=> 'saved note';const result=await h.maintenance.execute(h.command);
    await writeFile(join(h.directory,'styles.css'),'another release');await assert.rejects(h.maintenance.acknowledged(h.command,result),/exact release files/);assert.equal(h.reloads(),0);
  }finally{await h.close();}
});
test('native client commands require a complete immutable release and cannot request arbitrary app actions',()=>{
  const id=randomUUID();
  for(const value of [{version:1,id,kind:'reload-client'},{version:1,id,kind:'client-status',releaseVersion:'3.4.5'},{version:1,id,kind:'app:save'}])assert.throws(()=>validateClientCommand(value));
});
test('automatic recovery uses the running release and persists its decision before native reload',async()=>{
 const h=await fixture();try{
  const current=new DesktopClientMaintenance(h.app,h.root,'.obsidian','3.4.5');let recorded=false;
  const execute=h.app.commands.executeCommandById;h.app.commands.executeCommandById=(id:string)=>{assert.equal(recorded,true);return execute(id);};
  h.view.getViewData=()=> 'unsaved edit';await assert.rejects(current.reloadCurrent(()=>{recorded=true;return true;}),/unsaved edits/);assert.equal(recorded,false);
  h.view.getViewData=()=> 'saved note';assert.equal(await current.reloadCurrent(()=>false),false);assert.equal(h.reloads(),0);
  assert.equal(await current.reloadCurrent(()=>{recorded=true;return true;}),true);assert.equal(h.reloads(),1);
 }finally{await h.close();}
});
test('automatic recovery cannot load newly synced bytes under the old running version',async()=>{
 const h=await fixture();try{
  const current=new DesktopClientMaintenance(h.app,h.root,'.obsidian','3.4.5');
  await (current as any).runtime;
  await writeFile(join(h.directory,'main.js'),'another release');
  await assert.rejects(current.reloadCurrent(()=>true),/exact release/);assert.equal(h.reloads(),0);
 }finally{await h.close();}
});
test('checked reload includes owned code views and rechecks a code edit after acknowledgement',async()=>{
  const h=await fixture();try{
    const code={file:{path:'Code.ts'},getMode:()=> 'source',getViewData:()=> 'const saved = 1;'};
    h.app.workspace.getLeavesOfType=(type:string)=>type==='typescript'?[{view:code}]:[];
    h.app.vault.read=async()=> 'const saved = 1;';
    const maintenance=new DesktopClientMaintenance(h.app,h.root,'.obsidian','3.4.4',()=>['typescript']);
    const result=await maintenance.execute(h.command);
    code.getViewData=()=> 'const unsaved = 2;';
    await assert.rejects(maintenance.acknowledged(h.command,result),/unsaved edits/);assert.equal(h.reloads(),0);
    await assert.rejects(maintenance.execute(h.command),/unsaved edits/);assert.equal(h.reloads(),0);
    code.getViewData=()=> 'const saved = 1;';assert.equal(await maintenance.acknowledged(h.command,result),true);assert.equal(h.reloads(),1);
  }finally{await h.close();}
});
