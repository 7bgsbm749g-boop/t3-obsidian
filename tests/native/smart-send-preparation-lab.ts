import {Plugin,MarkdownView} from 'obsidian';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const hash=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
const pack=(text:string)=>({hash:hash(text),encoding:'gzip',data:zlib.gzipSync(text).toString('base64')});
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};

/** Uses the installed product's methods in the native editor. All acceptance
 * is synthetic; settings and account state stay on the installed instance. */
export default class SmartSendPreparationLab extends Plugin {
  async onload(){
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>{
      const config=this.config();fs.writeFileSync(path.join(config.output,'ERROR.json'),JSON.stringify({message:String(error),stack:error.stack},null,2));
    }));
  }
  private config(){return JSON.parse(fs.readFileSync((this.app.vault.adapter as any).getFullPath(`${this.app.vault.configDir}/plugins/${this.manifest.id}/config.json`),'utf8'));}
  private async run(){
    const config=this.config(),root=(this.app.vault.adapter as any).getBasePath(),notes:string[]=[],samples:any[]=[],checks:string[]=[];
    assert(root===config.allowedVaultRoot,'Wrong native test target');
    assert(!(this.app as any).internalPlugins.getPluginById('sync')?.enabled,'Sync must be disabled');
    const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(config.output,name),JSON.stringify(value,null,2)+'\n');
    await (this.app as any).plugins.enablePlugin('t-three-code');
    const installed=(this.app as any).plugins.plugins['t-three-code'],version=installed.clientMaintenance.client.loadedVersion;
    assert(version===config.expectedVersion,'Actual compiled version does not match the test build');
    const assets:Record<string,string>={};for(const name of ['main.js','manifest.json','styles.css'])assets[name]=hash(fs.readFileSync(path.join(root,this.app.vault.configDir,'plugins/t-three-code',name)));
    assert(JSON.stringify(assets)===JSON.stringify(config.assets),'Installed assets do not match provenance');
    write('IDENTITY.json',{version,assets,syncEnabled:false,signedIn:!!installed.nativeAccount||Object.keys(installed.pairedSessions??{}).length>0,profileCopied:false});
    const leaf=this.app.workspace.getLeaf('tab');
    try{
      for(const [size,count] of [['small',24],['large',600]] as const){
        const note=`perf-08-recheck-preparation-${size}.md`;assert(!this.app.vault.getAbstractFileByPath(note),'Owned fixture already exists');
        const file=await this.app.vault.create(note,'');notes.push(note);await leaf.openFile(file);
        await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false},active:true});const view=leaf.view as MarkdownView;
        for(let trial=0;trial<6;trial++){
          const original=Array.from({length:count},(_,i)=>`Line ${i} trial ${trial}: **original request** with unique details for the preparation benchmark.`).join('\n');
          const added=`\nNew user addition ${trial}.`,responses=Array.from({length:8},(_,n)=>`Agent response ${n} trial ${trial}. `+'Generated answer. '.repeat(size==='large'?500:50)),document=original+'\n\n'+responses.join('\n\n')+added;view.editor.setValue(document);await view.save();
          const source=view.editor.getValue(),noteId=hash(note),destination=JSON.stringify(['synthetic-environment','synthetic-project','synthetic-thread']);
          const data:any={version:1,notes:{[noteId]:{path:note,revision:1}},responses:{},noteEdits:{},bodies:{},heads:{},retired:[]};
          for(let n=0;n<responses.length;n++){const body=pack(responses[n]);data.bodies[body.hash]=body;data.responses['response-'+n]={noteId,body:body.hash,before:'',after:'',offset:document.indexOf(responses[n])};}
          // Concurrent receipt branches are legitimate after cross-device sends.
          // Their decoded history exceeds the existing 2M-character text cache.
          for(let n=0;n<4;n++)data.heads['previous-'+n]={noteId,destination,source:pack(original+'\nHistorical branch '+n+' '+String.fromCharCode(65+n).repeat(560000)),covered:[[0,original.length]],parents:[],bindings:['original-binding']};
          const subject:any=new installed.constructor(this.app,installed.manifest),project={id:'synthetic-project',title:'Synthetic preparation',workspaceRoot:'/synthetic'};
          subject.settings={projects:[project],directProjects:[],paired:[],noteThreads:[],noteContexts:[],responseBindings:{},folderLinks:[],pending:[],settlementJobs:[],inlineStreaming:{enabled:false}};
          subject.chatDraftKey='perf-08-preparation-draft';subject.smartData=()=>data;subject.recoverSmartReplies=async()=>{};subject.smartKey=async()=>destination;
          subject.chatTarget=async()=>({project,link:{}});subject.projectReadinessError=()=>undefined;subject.connection=()=>({transport:'desktop',environmentId:'synthetic-environment'});
          subject.assertNoteMode=async()=>{};subject.requestTitle=async()=> 'Synthetic preparation';subject.noteThreadIntent=()=>undefined;subject.folderLinkIntent=()=>({});subject.prepareNoteSteering=async()=>{};
          subject.prepareImages=async(markdown:string)=>({markdown,attachments:[],context:undefined});subject.messageFooter=()=>'';subject.save=async()=>{};
          let dispatches=0,prepared:any,reads=0,compressions=0;
          const Decompress=globalThis.DecompressionStream,Compress=globalThis.CompressionStream;
          globalThis.DecompressionStream=class extends Decompress{constructor(format:CompressionFormat){super(format);reads++;}};
          globalThis.CompressionStream=class extends Compress{constructor(format:CompressionFormat){super(format);compressions++;}};
          subject.dispatch=async(request:any)=>{dispatches++;prepared=request;};
          const context={smartDocument:source},target={projectKey:project.id,threadId:'synthetic-thread'};
          const observed:Array<{phase:string;ms:number;decompressions:number;compressions:number}>=[];let previousReads=0,previousCompressions=0;
          const observe=(phase:string,ms:number)=>{observed.push({phase,ms,decompressions:reads-previousReads,compressions:compressions-previousCompressions});previousReads=reads;previousCompressions=compressions;};
          try{let started=performance.now();assert(await subject.hasSmartContent(file,target,context),'Unsent addition was lost');const firstCheckMs=performance.now()-started;observe('cold-check',firstCheckMs);
          const repeatChecksMs:number[]=[];for(let n=0;n<3;n++){started=performance.now();assert(await subject.hasSmartContent(file,target,context),'Repeated check changed availability');repeatChecksMs.push(performance.now()-started);observe('warm-check',repeatChecksMs.at(-1)!);}
          started=performance.now();await subject.sendChat('Prepare note',file,{threadId:'synthetic-thread',sourceContext:context});const sendPreparationMs=performance.now()-started;observe('send-preparation',sendPreparationMs);
          assert(dispatches===1&&prepared.prompt.trim()===added.trim(),'Only the exact user addition should send');
          assert(prepared.smartSend.noteId===noteId&&prepared.smartSend.parents.length===4&&prepared.smartSend.bindings[0]==='original-binding','Coverage identity was lost');
          // Model only the local acceptance receipt; no transport/provider is measured.
          data.heads={accepted:{...prepared.smartSend,destination,bindings:['original-binding']}};data.retired=prepared.smartSend.parents;
          assert(!await subject.hasSmartContent(file,target,context),'Confirmed duplicate still available');
          await subject.sendChat('Prepare note',file,{threadId:'synthetic-thread',sourceContext:context});assert(dispatches===1,'Duplicate note was dispatched');
          await subject.sendChat('Selected text',file,{threadId:'synthetic-thread',sourceContext:{smartDocument:source,smartScope:[0,'Line 0'.length]}});assert(dispatches===2&&prepared.prompt==='Line 0','Explicit resend was blocked');
          const typed=source+'\nFresh typing.';view.editor.setValue(typed);await view.save();assert(await subject.hasSmartContent(file,target,{smartDocument:typed}),'Typing did not invalidate preparation');
          await subject.sendChat('Prepare note',file,{threadId:'synthetic-thread',sourceContext:{smartDocument:typed}});assert(dispatches===3&&prepared.prompt.trim()==='Fresh typing.','Typing was lost or old text resent');
          const elsewhere=JSON.stringify(['synthetic-environment',project.id,'other-thread']);subject.smartKey=async()=>elsewhere;
          assert(await subject.hasSmartContent(file,{...target,threadId:'other-thread'},context),'Destination coverage leaked');
          assert(view.editor.getValue()===typed&&await this.app.vault.read(file)===typed,'Checked native output changed');
          const responseUpdate='\nAgent streamed update '+trial;view.editor.setValue(typed+responseUpdate);await view.save();
          const body=pack(responseUpdate.trim());data.bodies[body.hash]=body;data.responses={...data.responses,stream:{noteId,body:body.hash,before:'',after:'',offset:typed.length+1}};
          subject.smartKey=async()=>destination;
          await subject.sendChat('Prepare note',file,{threadId:'synthetic-thread',sourceContext:{smartDocument:typed+responseUpdate}});
          assert(dispatches===4&&prepared.prompt.trim()==='Fresh typing.','Response update reused stale preparation or sent agent text');
          assert(await this.app.vault.read(file)===typed+responseUpdate,'Response update was not saved exactly');
          samples.push({observed,responseCount:responses.length,historyHeads:4,syntheticAcknowledgement:true,responseInvalidation:true,size,trial,characters:source.length,firstCheckMs,repeatChecksMs,sendPreparationMs,duplicateBlocked:true,explicitSelectionRetained:true,typingDetected:true,destinationIndependent:true,coverageIdentityRetained:true});
          }finally{globalThis.DecompressionStream=Decompress;globalThis.CompressionStream=Compress;}
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        checks.push(`${size}: 6 trials; exact output, duplicates, explicit selections, typing, destination and coverage identity passed`);
      }
      write('RESULT.json',{ok:true,version,round:config.round,scope:'Native Obsidian editor and installed product content-check/send preparation. Local synthetic acceptance; no transport/provider/Sync/mobile measurement.',samples,checks});
    }finally{
      await (leaf.view as MarkdownView).save();leaf.detach();
      for(const name of notes){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
      write('CLEANUP.json',{ownedNotesAbsent:notes.every(name=>!this.app.vault.getAbstractFileByPath(name)),threadsCreated:[],settingsWritten:false,sessionRevoked:false});
    }
  }
}
