import {Plugin,MarkdownView} from 'obsidian';
import {DirectInlinePreview} from '../../src/responses/direct-inline-preview';
import {SharedThreadStreams} from '../../src/conversations/shared-thread-stream';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {responseAnchor} from '../../src/responses/native-response-projection';
import {hiddenInlineMarkerExtension} from '../../src/conversations/inline-markers';
import {installResponsePresentation} from '../../src/responses/response-presentation';
import {contentHash} from '../../src/responses/completion';
import {EventJournal,configureDiagnostics,connectionDiagnosticPolicy,diagnosticCategory} from '../../src/app/diagnostics';
import {DiagnosticArchive} from '../../src/app/diagnostic-archive';
import {connectDiagnosticFiles} from '../../src/notes/connect-command-files';
import {streamMemory} from '../../src/app/stream-memory-diagnostics';
import type {ResponseRecord} from '../../src/responses/response-record';
import type {ThreadStreamCallbacks,watchThread} from '../../src/conversations/thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** A bounded synthetic stream in an unsynced vault, with no backend dispatch. */
export default class StreamMemoryLab extends Plugin {
  private root='';private preview?:DirectInlinePreview;private sources?:SharedThreadStreams;private journal?:EventJournal;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated native fixture vault is required.');
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document));
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>nativeResponses(this.app).filter(transaction)));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('error.json',{message:String(error),stack:error.stack})));
  }
  private write(name:string,data:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
  async run(){
    await pause(800);const app=this.app,manager=nativeResponses(app),id=crypto.randomUUID(),startedAt=new Date().toISOString();
    let archiveTime=Date.now();const archive=new DiagnosticArchive('fixture-vault','isolated-stream-memory',undefined,()=>archiveTime);
    const logFiles=connectDiagnosticFiles({call:async(tag,input:any)=>{if(tag!=='projects.writeFile')throw Error('Unexpected log RPC');const destination=path.join(this.root,'machine',input.relativePath);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,input.contents);return {};}},'/synthetic-machine');
    const logTarget={environmentId:'synthetic',workspaceRoot:'/synthetic-machine',directory:'.t3-obsidian/diagnostics/fixture-vault/isolated-stream-memory'};
    this.journal=new EventJournal({retain:event=>archive.record(event),load:async()=>undefined,save:async state=>this.write('PERSISTED.json',state),id:()=>crypto.randomUUID(),context:{deviceId:'isolated-stream-memory',pluginVersion:'source-candidate'}},{...connectionDiagnosticPolicy,accept:event=>diagnosticCategory(event)!==undefined});
    configureDiagnostics(this.journal);streamMemory.reset();streamMemory.sample('enabled');
    const saved='# Memory fixture\n\n'+responseAnchor(id)+'\n';
    const file=await app.vault.create('Memory.md',saved),leaf=app.workspace.getLeaf(false);await leaf.openFile(file);
    const record:ResponseRecord={coordinated:true,migrating:true,owner:'host',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:4,nativeProjection:true,id,initialOwner:crypto.randomUUID(),vaultId:crypto.randomUUID(),host:{environmentId:'fixture',workspaceRoot:'/unavailable-host',directory:'.obsidian/inline'},notePath:file.path,threadId:'synthetic-memory-thread',messageId:'prompt',projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:startedAt,intermediateMode:'keep',threadTitle:'Memory fixture'}};
    let callbacks!:ThreadStreamCallbacks,closed=0,updates=0,body='';
    const watch:typeof watchThread=(_id,_access,next)=>{callbacks=next;return {stop:()=>{closed++;}};};
    this.sources=new SharedThreadStreams(watch);
    this.preview=new DirectInlinePreview(record,async()=>{throw Error('No network in memory fixture');},update=>{updates++;body=update.body;manager.stream(update);},this.sources.forSource('synthetic-source'));
    await manager.receive(record);this.preview.tick(true);await pause(100);
    callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:2,thread:{id:'synthetic-memory-thread',projectId:'fixture-project',messages:[{id:'prompt',role:'user',text:'SYNTHETIC_PRIVATE_PROMPT',turnId:'turn',streaming:false},{id:'answer',role:'assistant',text:'SYNTHETIC_PRIVATE_BODY',turnId:'turn',streaming:true}],activities:[],latestTurn:{turnId:'turn',messageId:'prompt',state:'running'},session:{status:'running',activeTurnId:'turn'}}}});
    // Twelve seconds, 300 frames, less than 40k characters. Never forced GC.
    for(let i=0;i<300;i++){
      callbacks.item({kind:'event',event:{type:'thread.message-sent',sequence:3+i,occurredAt:new Date().toISOString(),threadId:'synthetic-memory-thread',payload:{messageId:'answer',role:'assistant',text:' synthetic growth '.repeat(5),turnId:'turn',streaming:true}}} as any);
      if(i===140)streamMemory.sample('manual',()=>({...manager.memoryStatus(),...this.sourceCounters(),bindingId:id,bodyLength:body.length}));
      await pause(40);
    }
    const release=await manager.beginFinalSave(file.path);release();
    streamMemory.sample('manual',()=>({...manager.memoryStatus(),...this.sourceCounters(),bindingId:id,bodyLength:body.length}));
    const visible=(leaf.view as MarkdownView).contentEl.innerText.includes('synthetic growth');
    const capture=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,'native.png'),capture.toPNG());
    this.preview.dispose();this.sources.dispose();leaf.detach();manager.refresh();manager.dispose();
    streamMemory.sample('manual',()=>({...manager.memoryStatus(),...this.sourceCounters()}));
    for(let i=0;i<700;i++)this.journal.record('memory.streaming',{checkpoint:'retention-fixture',bodyLength:i});
    await this.journal.flush();await archive.settle();for(let i=0;i<8;i++){archiveTime+=5001;await archive.sync(logFiles,logTarget);}
    const directory=path.join(this.root,'machine',logTarget.directory),segments=fs.readdirSync(directory,{recursive:true}).filter((name:string)=>name.endsWith('.jsonl'));
    const retained=segments.flatMap((name:string)=>fs.readFileSync(path.join(directory,name),'utf8').trim().split('\n').map((line:string)=>JSON.parse(line)));
    await archive.close();const log=this.journal.snapshot(),memory=retained.filter((event:any)=>event.event==='memory.streaming');
    const serialized=JSON.stringify(retained),samples=memory.filter((event:any)=>event.fields.checkpoint==='sample');
    const checks={automaticPlainFiles:segments.length>1,unlimitedRetainedHistory:retained.length>700,visible,updates:updates>30,heapSupported:memory.some((event:any)=>(event.fields.heap as any)?.status==='supported'),activitySamples:samples.length>=2,rateBound:samples.every((event:any,index:number)=>index===0||Date.parse(event.at)-Date.parse(samples[index-1].at)>=4900),noContent:!serialized.includes('SYNTHETIC_PRIVATE')&&!serialized.includes('synthetic growth'),bounded:log.events.length<=512&&Buffer.byteLength(JSON.stringify(log.events))<256000,disposed:closed===1&&this.sources.status().sources===0&&manager.memoryStatus().viewCount===0};
    await app.vault.delete(file);this.write('RESULT.json',{startedAt,finishedAt:new Date().toISOString(),checks,pass:Object.values(checks).every(Boolean),updates,memoryEvents:memory.length,archive:{directory,segments:segments.length,retainedEvents:retained.length},cleanup:{noteDeleted:!app.vault.getFileByPath('Memory.md'),backendThreadsCreated:0},log});
    await this.journal.close();configureDiagnostics();streamMemory.reset();
  }
  private sourceCounters(){const status=this.sources!.status();return {sourceCount:status.sources,readerCount:status.readers,cacheCharacters:status.cacheCharacters};}
  onunload(){this.preview?.dispose();this.sources?.dispose();nativeResponses(this.app).dispose();configureDiagnostics();streamMemory.reset();void this.journal?.close();}
}
