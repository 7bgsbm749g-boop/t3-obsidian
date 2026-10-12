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
import {traceNativeView} from './native-view-trace';
const fs=require('node:fs/promises'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function productionNative(app:App,root:string){
  const rows:any[]=[],id=crypto.randomUUID(),actor=crypto.randomUUID(),directory='.obsidian/native-production-fixture',identity={vaultId:crypto.randomUUID(),environmentId:'fixture',workspaceRoot:(app.vault.adapter as any).getFullPath(''),directory};
  const file=await app.vault.create('Production.md','# Fixture\n\n## CURRENT\n\n| Exercise | 20kg |\n| --- | ---: |\n| Barb | 20 |\n\n## NEXT\nOutside content\n');
  const leaves=app.workspace.getLeavesOfType('markdown');await leaves[0].openFile(file);await leaves[1].openFile(file);
  for(const leaf of leaves.slice(0,2))await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
  const views=leaves.slice(0,2).map(leaf=>leaf.view as MarkdownView);
  const source:HostedInlineRequest={version:2,nativeProjection:true,responseContainer:true,destinationSection:'CURRENT',independent:true,id,initialOwner:actor,vaultId:identity.vaultId,host:identity,notePath:file.path,threadId:'fixture-thread',messageId:crypto.randomUUID(),projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:initialRegion(id).bodyHash,createdAt:new Date().toISOString()};
  const binding=await editorStream(source,file.path,deviceNoteIO(app),()=>true);
  await views[0].save();await pause(200);
  const bytes=new Map<string,string>(),files:LeaseFiles={read:async key=>bytes.get(key),write:async(key,value)=>{bytes.set(key,value);},remove:async key=>{bytes.delete(key);},list:async dir=>[...bytes.keys()].filter(key=>key.startsWith(dir+'/'))};
  const authority=new InlineLeaseAuthority(identity,files),client=new InlineLeaseClient(actor,{...files,read:async key=>{if(key.includes('/replies/'))await authority.tick();return files.read(key);}},directory,undefined,undefined,async()=>{await authority.tick();});
  let host=await CoordinatedHost.open(app,identity,files,authority,{journalRoot:path.join(root,'production-journal')});
  const manager=nativeResponses(app);await client.command({kind:'register',jobId:binding.id,request:binding});await host.scan();
  let complete=false;
  const snapshot=()=>({thread:{id:binding.threadId,projectId:binding.projectId,messages:[{id:binding.messageId,role:'user',text:'Add 25kg',streaming:false,createdAt:binding.createdAt},{id:'answer',role:'assistant',text:complete?'Added **25kg**.':'Checking **native** streaming.',streaming:!complete,turnId:'turn'}],activities:[],latestTurn:{turnId:'turn',messageId:binding.messageId,state:complete?'completed':'running',requestedAt:binding.createdAt,assistantMessageId:'answer'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}}});
  const base:HostedWriterIO={...files,requests:async()=>[],access:async()=>({origin:'https://fixture',api:async()=>snapshot()}),updateNote:async()=>{throw Error('Unexpected legacy write');}};
  const nativeIO=host.io(base),requests=nativeIO.requests;nativeIO.requests=async()=> (await requests()).filter(key=>key.endsWith('/'+binding.id+'.json'));
  const writer=new HostedInlineWriter(identity,nativeIO);
  try{
    await writer.tick();await pause(200);const disk=await app.vault.read(file);
    const trace:unknown[]=[];views.forEach((view,index)=>traceNativeView(manager.view(view)!,trace,'production-'+index));
    rows.push({name:'production-two-native-views-local-stream',pass:views.every(view=>view.editor.getValue().includes('Checking **native** streaming.'))&&!disk.includes('Checking')&&disk.indexOf('data-t3-response=')<disk.indexOf('## NEXT')});
    const secondSource={...source,id:crypto.randomUUID(),threadId:'second-thread',messageId:crypto.randomUUID()};
    const second=await editorStream(secondSource,file.path,deviceNoteIO(app),()=>true);await views[0].save();await pause(200);
    await client.command({kind:'register',jobId:second.id,request:second});await host.scan();
    const secondRecord=await authority.checkpoint(second.id,{requestHash:hostedRequestHash(second),accepted:true,notePath:file.path,status:'running',hashes:[second.initialHash],body:'> Independent second response.',updatedAt:new Date().toISOString()});await manager.receive(secondRecord);await pause(200);
    rows.push({name:'production-independent-responses-in-two-views',pass:views.every(view=>view.editor.getValue().includes('Checking **native** streaming.')&&view.editor.getValue().includes('Independent second response.'))&&!(await app.vault.read(file)).includes('Independent second response.')});
    const historical=crypto.randomUUID(),historicalRequest={...source,id:historical,nativeProjection:false,responseContainer:false};await client.command({kind:'register',jobId:historical,request:historicalRequest});
    const historicalPath=leasePaths(directory,historical).record,historicalRecord=JSON.parse(bytes.get(historicalPath)!);historicalRecord.state={requestHash:hostedRequestHash(historicalRequest),accepted:true,notePath:file.path,status:'paused',hashes:[],updatedAt:''};bytes.set(historicalPath,JSON.stringify(historicalRecord));
    views[0].editor.replaceRange('\n<!-- t3-inline:end:'+historical+' -->\n',views[0].editor.offsetToPos(views[0].editor.getValue().length));await views[0].save();await pause(200);await host.scan();
    views[0].editor.replaceRange('Prefix edit\n',views[0].editor.offsetToPos(0));await views[0].save();await pause(300);
    views[1].editor.replaceRange('\nTail edit',views[1].editor.offsetToPos(views[1].editor.getValue().length));await views[1].save();await pause(300);
    rows.push({name:'production-concurrent-ordinary-views',pass:(await app.vault.read(file)).includes('Prefix edit')&&(await app.vault.read(file)).includes('Tail edit')&&views.every(view=>view.editor.getValue().includes('Prefix edit')&&view.editor.getValue().includes('Tail edit'))});
    const current=views[0].editor.getValue(),at=current.indexOf('Outside content');views[0].editor.replaceRange('User tail',views[0].editor.offsetToPos(at),views[0].editor.offsetToPos(at+15));await writer.tick();(views[0].editor as any).undo();const undone=!views[0].editor.getValue().includes('User tail');(views[0].editor as any).redo();const redone=views[0].editor.getValue().includes('User tail');await views[0].save();await pause(300);rows.push({name:'production-stream-update-undo-redo',pass:undone&&redone});
    const stage:any=await host.command('stage-note-edit',binding.id);const staged=(await fs.readFile(stage.stagingPath,'utf8')).replace('| Exercise | 20kg |','| Exercise | 20kg | 25kg |').replace('| --- | ---: |','| --- | ---: | ---: |').replace('| Barb | 20 |','| Barb | 20 | |');await fs.writeFile(stage.stagingPath,staged);await host.command('submit-note-edit',binding.id,stage.originalHash);
    // Wait for the real quiet polling cadence before creating the unsaved
    // edit. The final save may merge compatible edits; it must preserve them.
    await pause(3100);
    views[1].editor.replaceRange('\nUnsaved pane',views[1].editor.offsetToPos(views[1].editor.getValue().length));
    const dirtyPrecondition={disk:await app.vault.read(file),views:views.map(view=>view.getViewData())};
    complete=true;await writer.tick();const firstCompletionStatus=(await host.journal.read(binding.id))!.status;
    const dirtyBeforeSave=views.map(view=>({saved:view.getViewData(),display:view.editor.getValue()}));
    await views[1].save();
    // Allow the ordinary five-second retry if pane changes deferred the first
    // attempt, then check the exact final document and retained ordinary edit.
    await pause(5200);
    const dirtyAfterSave={disk:await app.vault.read(file),views:views.map(view=>({saved:view.getViewData(),display:view.editor.getValue()}))};await writer.tick();
    await fs.writeFile(path.join(root,'production-trace.json'),JSON.stringify(trace,null,2));
    // Pending compare failure must rebase compatible ordinary changes, retaining
    // immutable results and creating a new intent rather than changing bytes.
    let result=await host.journal.read(binding.id);
    if(result?.status==='conflict')await host.command('repair-response',binding.id,contentHash(await app.vault.read(file)));
    await writer.tick();await pause(300);result=await host.journal.read(binding.id);
    const saved=await app.vault.read(file);rows.push({name:'production-compatible-unsaved-pane-preserved-on-final-save',pass:!dirtyPrecondition.disk.includes('Unsaved pane')&&dirtyPrecondition.views.some(value=>value.includes('Unsaved pane'))&&result?.status==='verified'&&saved.includes('Unsaved pane')&&saved.includes('Added **25kg**.'),firstCompletionStatus,dirtyPrecondition});
    rows.push({name:'production-staged-table-plus-final-native-save',pass:result?.status==='verified'&&saved.includes('| Barb | 20 | |')&&saved.includes('Added **25kg**.')&&!saved.includes('Checking')&&!saved.includes(binding.id)&&saved.includes('Prefix edit')&&saved.includes('Tail edit')&&saved.includes('Unsaved pane'),commitId:result?.verified?.commitId,hash:result?.verified?.hash,saved,dirtyBeforeSave,dirtyAfterSave});
    rows.push({name:'production-finished-two-views',pass:views.every(view=>view.getViewData()===saved&&view.editor.getValue().includes('Independent second response.')&&!view.editor.getValue().includes('Checking'))});
    rows.push({name:'production-malformed-historical-mirror-isolated',pass:result?.status==='verified'&&saved.includes('t3-inline:end:'+historical)});
    const record=JSON.parse(bytes.get(leasePaths(directory,binding.id).record)!);if(result?.verified)await client.command({kind:'observe',jobId:binding.id,observed:{commitId:result.verified.commitId,hash:contentHash(saved)}});await host.scan();rows.push({name:'production-acknowledged-saved-read',pass:(await host.journal.read(binding.id))!.acknowledgements.length===1,delivery:record.state?.delivery});
    // Complete the independent second registration, interrupt the native
    // acknowledgement after the real save, then restart the host. No private
    // journal or lease edits are used to recover it.
    const secondSnapshot=()=>({thread:{id:second.threadId,projectId:second.projectId,messages:[{id:second.messageId,role:'user',text:'Second response',streaming:false,createdAt:second.createdAt},{id:'second-answer',role:'assistant',text:'Second independently completed.',streaming:false,turnId:'second-turn'}],activities:[],latestTurn:{turnId:'second-turn',messageId:second.messageId,state:'completed',requestedAt:second.createdAt,assistantMessageId:'second-answer'},session:{status:'ready',activeTurnId:null}}});
    const secondIO=host.io({...base,access:async()=>({origin:'https://fixture',api:async()=>secondSnapshot()})}),allSecond=secondIO.requests;secondIO.requests=async()=> (await allSecond()).filter(key=>key.endsWith('/'+second.id+'.json'));
    const secondWriter=new HostedInlineWriter(identity,secondIO),committed=manager.committed;
    manager.committed=function(...args){committed.apply(this,args);throw Error('Fixture: late native acknowledgement interrupted');};
    try{await secondWriter.tick();}finally{manager.committed=committed;secondWriter.stop();}
    const pending=await host.journal.read(second.id),landed=await app.vault.read(file);
    rows.push({name:'production-independent-completion-pending-exact-save',pass:pending?.status==='commit-pending'&&pending.attempt?.expected===landed&&!landed.includes(second.id)});
    host.stop();host=await CoordinatedHost.open(app,identity,files,authority,{journalRoot:path.join(root,'production-journal')});await host.scan();await pause(200);
    const recovered=await host.journal.read(second.id),recoveredLease=JSON.parse(bytes.get(leasePaths(directory,second.id).record)!);
    if(recovered?.verified)await client.command({kind:'observe',jobId:second.id,observed:{commitId:recovered.verified.commitId,hash:contentHash(await app.vault.read(file))}});await host.scan();
    rows.push({name:'production-restart-readback-completion-and-late-ack',pass:recovered?.status==='verified'&&recovered.verified?.commitId===pending?.attempt?.id&&recoveredLease.state?.status==='complete'&&recoveredLease.state.finalSaved&&recoveredLease.state.cleanupComplete&&(await host.journal.read(second.id))!.acknowledgements.length===1&&views.every(view=>!manager.view(view)?.conflictRecord())});
    const third=await editorStream({...source,id:crypto.randomUUID(),messageId:crypto.randomUUID(),threadId:'third-thread'},file.path,deviceNoteIO(app),()=>true);await views[0].save();await pause(200);
    const afterThird=await app.vault.read(file);
    rows.push({name:'production-section-insertion-after-independent-recovery',pass:afterThird.includes(third.id)&&afterThird.indexOf(third.id)<afterThird.indexOf('## NEXT')&&afterThird.includes('Second independently completed.')&&afterThird.includes('Tail edit')});
    manager.dispose();rows.push({name:'production-shutdown-saved-projection',pass:views.every(view=>!view.editor.getValue().includes('Checking'))&&(await app.vault.read(file))===afterThird});
  }finally{writer.stop();host.stop();authority.stop();client.dispose();manager.dispose();}
  const conflictId=crypto.randomUUID(),conflictSaved='# Before\n\n'+responseAnchor(conflictId)+'\n\nAfter\n',conflictFile=await app.vault.create('Conflict.md',conflictSaved);
  await leaves[0].openFile(conflictFile);const conflictView=leaves[0].view as MarkdownView;
  await manager.receive({request:{...binding,id:conflictId,notePath:conflictFile.path},coordinated:true,owner:actor,epoch:1,expiresAt:Number.MAX_SAFE_INTEGER,revision:1,state:{requestHash:'fixture',accepted:true,notePath:conflictFile.path,status:'running',hashes:[],body:'> Local progress',updatedAt:''}});
  conflictView.editor.replaceRange('Local before',conflictView.editor.offsetToPos(2),conflictView.editor.offsetToPos(8));
  const remote=conflictSaved.replace('Before','Remote before');await app.vault.modify(conflictFile,remote);await pause(200);
  await leaves[1].openFile(conflictFile);await pause(200);
  rows.push({name:'production-automatic-saved-view-adoption',pass:!manager.view(conflictView)?.conflictRecord()&&conflictView.getViewData()===remote&&conflictView.editor.getValue().includes('Local progress')});manager.dispose();
  return rows;
}
