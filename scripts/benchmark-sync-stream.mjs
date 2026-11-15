// Synthetic before/after measurements. No real note, provider or Sync account access.
import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const source=resolve(process.argv[2]??'.'),output=process.argv[3];
if(!output)throw Error('Supply SOURCE_ROOT and an external output JSON path.');
const scratch=await mkdtemp(join(tmpdir(),'t3-sync-benchmark-'));
try{
 const module=(path)=>JSON.stringify(resolve(source,path));
 const result=await build({stdin:{resolveDir:source,loader:'ts',contents:`
import {SharedThreadStreams} from ${module('src/conversations/shared-thread-stream.ts')};
import {LocalResponseManager} from ${module('src/responses/local-response-manager.ts')};
import {responseAnchor} from ${module('src/responses/native-response-projection.ts')};
import {updateResponseBindingData,responseBindingRequests} from ${module('src/responses/response-binding-data.ts')};
import {loadSmartSend,rememberResponse,prepareSmartSend} from ${module('src/notes/smart-send.ts')};
import {randomUUID} from 'node:crypto';
const drain=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
async function recovery(foreground){
 let now=0,reads=0,last=0,starts=0;const pool=new SharedThreadStreams((_id,_a,cb)=>{if(!starts++)queueMicrotask(()=>cb.item({kind:'snapshot',snapshot:{thread:{id:'thread',projectId:'project',messages:[]},snapshotSequence:1}}));return {stop(){}};},2,()=>now);
 pool.forSource('synthetic')('thread',async()=>({origin:'https://synthetic.invalid',api:async()=>{reads++;return {thread:{id:'thread',projectId:'project',messages:[]},snapshotSequence:2};}}),{item:i=>{if(i.kind==='snapshot')last=i.snapshot.snapshotSequence;},reconnecting(){}});
 await drain();let recoveredAt;
 for(now=foreground?2500:0;now<=60000;now+=150){pool.tick?.(foreground);await drain();if(last===2){recoveredAt=now;break;}if(foreground)break;}
 pool.dispose();return {recovered:last===2,recoveredAtSimulatedMs:recoveredAt??null,observedForSimulatedMs:foreground?2500:60000,canonicalReads:reads};
}
async function finalSave(){
 let ready=false,now=0,writes=0,emit,records={};const id=randomUUID(),binding={version:4,localOnly:true,nativeProjection:true,responseContainer:true,initialOwner:randomUUID(),independent:true,id,vaultId:'synthetic',host:{environmentId:'env',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Synthetic.md',threadId:randomUUID(),projectId:randomUUID(),messageId:randomUUID(),threadEnvironmentId:'env',initialHash:'a'.repeat(64),createdAt:'2026-11-15T00:00:00Z'};
 let document='User text\\n'+responseAnchor(id);
 const io={localBindings:()=>responseBindingRequests(records),saveLocalBinding:async r=>{records=updateResponseBindingData(records,r,'synthetic');},readNote:async()=>document,isOpen:()=>true,openedNotes:()=>[{path:binding.notePath,document}],syncReady:()=>ready,access:async()=>{throw Error('No network');}};
 const manager=new LocalResponseManager('synthetic','synthetic',io,{read:async()=>document,compareAndSet:async(_p,b,a,g)=>{if(document!==b||g?.()===false)return false;document=a;writes++;return true;}},()=>now,(_r,_a,receive)=>{emit=receive;return {tick(){},update(){},suspend(){},dispose(){}};});
 await manager.register(binding);await drain();emit({request:binding,messageId:binding.messageId,sequence:1,body:'Final synthetic answer',turnId:'turn',phase:'complete',completionVerified:true});await drain();const savedWhileSyncBusy=writes>0;
 if(!writes){now=120000;ready=true;manager.tick();await drain();}
 manager.dispose();return {savedWhileSyncBusy,saveLatencySimulatedMs:now,writes,userTextPreserved:document.includes('User text')};
}
async function smartSend(){
 const data=loadSmartSend(undefined),path='Synthetic.md';for(let i=0;i<4;i++)await rememberResponse(data,path,'reply-'+i,'Generated '+i+' '+String.fromCharCode(65+i).repeat(600000),'','',0);
 const Original=globalThis.DecompressionStream;let decompressions=0;globalThis.DecompressionStream=class extends Original{constructor(f){super(f);decompressions++;}};
 try{const times=[],counts=[];let preserved=true;for(let i=0;i<7;i++){const before=decompressions,start=performance.now();const result=await prepareSmartSend(data,path,'synthetic-destination','Current user text.');times.push(performance.now()-start);counts.push(decompressions-before);preserved&&=result.text==='Current user text.';}const sorted=times.slice(1).sort((a,b)=>a-b);return {fixture:'four compressed 600k-character replies; unchanged current user text',coldMs:times[0],warmMedianMs:sorted[Math.floor(sorted.length/2)],warmMaxMs:Math.max(...times.slice(1)),decompressionsPerPreparation:counts,sourceOutputPreserved:preserved,serializedSmartSendBytes:Buffer.byteLength(JSON.stringify(data))};}finally{globalThis.DecompressionStream=Original;}
}
(async()=>{console.log(JSON.stringify({syntheticOnly:true,clock:'stream/save latency uses controlled simulated time; Smart Send uses wall-clock performance.now()',node:process.version,foreground:await recovery(true),silentFeed:await recovery(false),finalSave:await finalSave(),smartSend:await smartSend(),peakRssKiB:process.resourceUsage().maxRSS},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
`},bundle:true,platform:'node',format:'cjs',write:false,nodePaths:[resolve('node_modules')],logLevel:'silent'});
 const entry=join(scratch,'benchmark.cjs');await writeFile(entry,result.outputFiles[0].contents);
 const stdout=execFileSync(process.execPath,[entry],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
 const value=JSON.parse(stdout);
 try{value.sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{value.sourceCommit='archived source';}
 value.measuredAt=new Date().toISOString();
 await writeFile(output,JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value,null,2));
}finally{await rm(scratch,{recursive:true,force:true});}
