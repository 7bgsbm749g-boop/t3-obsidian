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
test('direct request saves the reload acknowledgement before native dispatch and never repeats it across instances',async()=>{
  const h=await fixture();let server:NoteCommandServer|undefined;
  try{
    server=await NoteCommandServer.open(h.root,'.obsidian',command=>h.maintenance.execute(validateClientCommand(command)),()=>true,undefined,async(command,result)=>{
      const stored=JSON.parse(await readFile(join((await existingPrivateStorage(h.root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1/results',command.id+'.json'),'utf8'));
      assert.deepEqual(stored,result);return h.maintenance.acknowledged(validateClientCommand(command),result);
    });
    const endpoint=JSON.parse(await readFile(join((await existingPrivateStorage(h.root,'.obsidian'))!.storageRoot,'.obsidian/t3-code/commands/v1/endpoint.json'),'utf8'));
    const response=await fetch(endpoint.url,{method:'POST',headers:{Authorization:'Bearer '+endpoint.token},body:JSON.stringify({command:h.command})});assert.equal(response.status,200);await response.json();
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
test('direct reload accepts unsaved edits and newly synced runtime bytes',async()=>{
  const h=await fixture();try{
    h.view.getViewData=()=> 'unsaved user edit';const result=await h.maintenance.execute(h.command);
    await writeFile(join(h.directory,'styles.css'),'another release');
    assert.equal(await h.maintenance.acknowledged(h.command,result),true);assert.equal(h.reloads(),1);
  }finally{await h.close();}
});
test('native client commands require a complete immutable release and cannot request arbitrary app actions',()=>{
  const id=randomUUID();
  for(const value of [{version:1,id,kind:'reload-client'},{version:1,id,kind:'client-status',releaseVersion:'3.4.5'},{version:1,id,kind:'app:save'}])assert.throws(()=>validateClientCommand(value));
});
test('automatic recovery persists its decision and reloads with unsaved edits',async()=>{
 const h=await fixture();try{
  const current=new DesktopClientMaintenance(h.app,h.root,'.obsidian','3.4.5');let recorded=false;
  const execute=h.app.commands.executeCommandById;h.app.commands.executeCommandById=(id:string)=>{assert.equal(recorded,true);return execute(id);};
  h.view.getViewData=()=> 'unsaved edit';
  assert.equal(await current.reloadCurrent(()=>false),false);assert.equal(h.reloads(),0);
  assert.equal(await current.reloadCurrent(()=>{recorded=true;return true;}),true);assert.equal(h.reloads(),1);
 }finally{await h.close();}
});
test('automatic recovery loads newly synced bytes and does not need runtime files',async()=>{
 const h=await fixture();try{
  const current=new DesktopClientMaintenance(h.app,h.root,'.obsidian','3.4.5');
  await rm(h.directory,{recursive:true});
  assert.equal(await current.reloadCurrent(()=>true),true);assert.equal(h.reloads(),1);
 }finally{await h.close();}
});
test('reload does not inspect editors or wait for response recovery',async()=>{
  const h=await fixture();try{
    const unexpected=()=>{throw Error('Reload must not check editor or recovery state.');};
    h.app.workspace.getLeavesOfType=unexpected;h.app.vault.read=unexpected;
    const maintenance=new DesktopClientMaintenance(h.app,h.root,'.obsidian','3.4.4',unexpected,async()=>unexpected());
    const result=await maintenance.execute(h.command);
    assert.equal(await maintenance.acknowledged(h.command,result),true);assert.equal(h.reloads(),1);
  }finally{await h.close();}
});
