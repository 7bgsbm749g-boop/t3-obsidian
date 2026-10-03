import type {App,MarkdownView} from 'obsidian';
import {CoordinatedHost} from '../coordinated-host-desktop';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,type LeaseFiles} from '../inline-lease';
import {HostedInlineWriter,hostedRequestHash,type HostedInlineRequest,type HostedWriterIO} from '../hosted-inline';
import {nativeResponses} from '../native-response-manager';
import {deviceNoteIO} from '../inline-note-io';
import {editorStream} from '../editor-stream';
import {initialRegion} from '../inline-thread';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';
const fs=require('node:fs/promises'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function productionNative(app:App,root:string){
  const rows:any[]=[],id=crypto.randomUUID(),actor=crypto.randomUUID(),directory='.obsidian/native-production-fixture',identity={vaultId:crypto.randomUUID(),environmentId:'fixture',workspaceRoot:(app.vault.adapter as any).getFullPath(''),directory};
  const file=await app.vault.create('Production.md','# Fixture\n\n## CURRENT\n\n| Exercise | 20kg |\n| --- | ---: |\n| Barb | 20 |\n\n## NEXT\nOutside content\n');
  const leaves=app.workspace.getLeavesOfType('markdown');await leaves[0].openFile(file);await leaves[1].openFile(file);
  for(const leaf of leaves.slice(0,2))await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
  const views=leaves.slice(0,2).map(leaf=>leaf.view as MarkdownView);
  const source:HostedInlineRequest={version:2,nativeProjection:true,destinationSection:'CURRENT',independent:true,id,initialOwner:actor,vaultId:identity.vaultId,host:identity,notePath:file.path,threadId:'fixture-thread',messageId:crypto.randomUUID(),projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:initialRegion(id).bodyHash,createdAt:new Date().toISOString()};
  const binding=await editorStream(source,file.path,deviceNoteIO(app),()=>true);
  await views[0].save();await pause(200);
  const bytes=new Map<string,string>(),files:LeaseFiles={read:async key=>bytes.get(key),write:async(key,value)=>{bytes.set(key,value);},remove:async key=>{bytes.delete(key);},list:async dir=>[...bytes.keys()].filter(key=>key.startsWith(dir+'/'))};
  const authority=new InlineLeaseAuthority(identity,files),client=new InlineLeaseClient(actor,{...files,read:async key=>{if(key.includes('/replies/'))await authority.tick();return files.read(key);}},directory,undefined,undefined,async()=>{await authority.tick();});
  const host=await CoordinatedHost.open(app,identity,files,authority,{journalRoot:path.join(root,'production-journal')});
  const manager=nativeResponses(app);await client.command({kind:'register',jobId:binding.id,request:binding});await host.scan();
  let complete=false;
  const snapshot=()=>({thread:{id:binding.threadId,projectId:binding.projectId,messages:[{id:binding.messageId,role:'user',text:'Add 25kg',streaming:false,createdAt:binding.createdAt},{id:'answer',role:'assistant',text:complete?'Added **25kg**.':'Checking **native** streaming.',streaming:!complete,turnId:'turn'}],activities:[],latestTurn:{turnId:'turn',messageId:binding.messageId,state:complete?'completed':'running',requestedAt:binding.createdAt,assistantMessageId:'answer'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}}});
  const base:HostedWriterIO={...files,requests:async()=>[],access:async()=>({origin:'https://fixture',api:async()=>snapshot()}),updateNote:async()=>{throw Error('Unexpected legacy write');}};
  const nativeIO=host.io(base),requests=nativeIO.requests;nativeIO.requests=async()=> (await requests()).filter(key=>key.endsWith('/'+binding.id+'.json'));
  const writer=new HostedInlineWriter(identity,nativeIO);
  try{
    await writer.tick();await pause(200);const disk=await app.vault.read(file);
    rows.push({name:'production-two-native-views-local-stream',pass:views.every(view=>view.editor.getValue().includes('Checking **native** streaming.'))&&!disk.includes('Checking')&&disk.indexOf('t3-inline:start')<disk.indexOf('## NEXT')});
    const secondSource={...source,id:crypto.randomUUID(),threadId:'second-thread',messageId:crypto.randomUUID()};
    const second=await editorStream(secondSource,file.path,deviceNoteIO(app),()=>true);await views[0].save();await pause(200);
    await client.command({kind:'register',jobId:second.id,request:second});await host.scan();
    const secondRecord=await authority.checkpoint(second.id,{requestHash:hostedRequestHash(second),accepted:true,notePath:file.path,status:'running',hashes:[second.initialHash],body:'> Independent second response.',updatedAt:new Date().toISOString()});await manager.receive(secondRecord);await pause(200);
    rows.push({name:'production-independent-responses-in-two-views',pass:views.every(view=>view.editor.getValue().includes('Checking **native** streaming.')&&view.editor.getValue().includes('Independent second response.'))&&!(await app.vault.read(file)).includes('Independent second response.')});
    views[0].editor.replaceRange('Prefix edit\n',views[0].editor.offsetToPos(0));await views[0].save();await pause(300);
    views[1].editor.replaceRange('\nTail edit',views[1].editor.offsetToPos(views[1].editor.getValue().length));await views[1].save();await pause(300);
    rows.push({name:'production-concurrent-ordinary-views',pass:(await app.vault.read(file)).includes('Prefix edit')&&(await app.vault.read(file)).includes('Tail edit')&&views.every(view=>view.editor.getValue().includes('Prefix edit')&&view.editor.getValue().includes('Tail edit'))});
    const current=views[0].editor.getValue(),at=current.indexOf('Outside content');views[0].editor.replaceRange('User tail',views[0].editor.offsetToPos(at),views[0].editor.offsetToPos(at+15));await writer.tick();(views[0].editor as any).undo();const undone=!views[0].editor.getValue().includes('User tail');(views[0].editor as any).redo();const redone=views[0].editor.getValue().includes('User tail');await views[0].save();await pause(300);rows.push({name:'production-stream-update-undo-redo',pass:undone&&redone});
    // Native unsaved pane disagreement cannot be converted to a host commit.
    // Hold autosave during this bounded check so slow staging IO cannot make
    // the deliberately dirty precondition disappear before the host compares.
    const saves=views.map(view=>view.save);views.forEach(view=>{view.save=async()=>{};});
    views[1].editor.replaceRange('\nUnsaved pane',views[1].editor.offsetToPos(views[1].editor.getValue().length));
    const stage:any=await host.command('stage-note-edit',binding.id);const staged=(await fs.readFile(stage.stagingPath,'utf8')).replace('| Exercise | 20kg |','| Exercise | 20kg | 25kg |').replace('| --- | ---: |','| --- | ---: | ---: |').replace('| Barb | 20 |','| Barb | 20 | |');await fs.writeFile(stage.stagingPath,staged);await host.command('submit-note-edit',binding.id,stage.originalHash);
    complete=true;await writer.tick();rows.push({name:'production-dirty-pane-delays-final-save',pass:(await host.journal.read(binding.id))!.status==='commit-pending'&&!(await app.vault.read(file)).includes('Added **25kg**.')});
    views.forEach((view,index)=>{view.save=saves[index];});await views[1].save();await pause(300);await writer.tick();
    // Pending compare failure must rebase compatible ordinary changes, retaining
    // immutable results and creating a new intent rather than changing bytes.
    let result=await host.journal.read(binding.id);
    if(result?.status==='conflict')await host.command('repair-response',binding.id,contentHash(await app.vault.read(file)));
    await writer.tick();await pause(300);result=await host.journal.read(binding.id);
    const saved=await app.vault.read(file);rows.push({name:'production-staged-table-plus-final-native-save',pass:result?.status==='verified'&&saved.includes('| Barb | 20 | |')&&saved.includes('Added **25kg**.')&&!saved.includes('Checking')&&!saved.includes(binding.id)&&saved.includes('Prefix edit')&&saved.includes('Tail edit')&&saved.includes('Unsaved pane'),commitId:result?.verified?.commitId,hash:result?.verified?.hash});
    rows.push({name:'production-finished-two-views',pass:views.every(view=>view.getViewData()===saved&&view.editor.getValue().includes('Independent second response.')&&!view.editor.getValue().includes('Checking'))});
    const record=JSON.parse(bytes.get(leasePaths(directory,binding.id).record)!);if(result?.verified)await client.command({kind:'observe',jobId:binding.id,observed:{commitId:result.verified.commitId,hash:contentHash(saved)}});await host.scan();rows.push({name:'production-acknowledged-saved-read',pass:(await host.journal.read(binding.id))!.acknowledgements.length===1,delivery:record.state?.delivery});
    manager.dispose();rows.push({name:'production-shutdown-saved-projection',pass:views.every(view=>!view.editor.getValue().includes('Checking'))&&(await app.vault.read(file))===saved});
  }finally{writer.stop();host.stop();authority.stop();client.dispose();manager.dispose();}
  const conflictId=crypto.randomUUID(),conflictSaved='# Before\n\n'+responseAnchor(conflictId)+'\n\nAfter\n',conflictFile=await app.vault.create('Conflict.md',conflictSaved);
  await leaves[0].openFile(conflictFile);const conflictView=leaves[0].view as MarkdownView;
  await manager.receive({request:{...binding,id:conflictId,notePath:conflictFile.path},coordinated:true,owner:actor,epoch:1,expiresAt:Number.MAX_SAFE_INTEGER,revision:1,state:{requestHash:'fixture',accepted:true,notePath:conflictFile.path,status:'running',hashes:[],body:'> Local progress',updatedAt:''}});
  conflictView.editor.replaceRange('Local before',conflictView.editor.offsetToPos(2),conflictView.editor.offsetToPos(8));
  const remote=conflictSaved.replace('Before','Remote before');await app.vault.modify(conflictFile,remote);await pause(200);
  const preserved=manager.view(conflictView)?.conflictRecord();await manager.resolve(conflictView,remote,'saved');
  rows.push({name:'production-explicit-view-conflict-resolution',pass:!!preserved?.local.includes('Local before')&&conflictView.getViewData()===remote&&conflictView.editor.getValue().includes('Local progress')});manager.dispose();
  return rows;
}
