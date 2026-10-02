import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {initialRegion} from '../inline-thread';

for(const text of [undefined,'Explain the selection.'])test(`device-local jobs retain progress and ${text?'initial input':'legacy behavior'} across follow, reload and completion`,async()=>{
  const result=await build({entryPoints:['inline-chat.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
  const module={exports:{} as any},realRequire=createRequire(import.meta.url);
  runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Notice:class{}}:realRequire(id),console,setTimeout,clearTimeout,TextEncoder,Uint8Array});
  const id=randomUUID(),initialInput=text?{messageId:randomUUID(),text}:undefined,initial=initialRegion(id,initialInput),oldTime='2026-09-30T04:00:00Z',nextTime='2026-09-30T04:01:00Z';
  let value='User text\n'+initial.text,saved:any[]=[];
  const editor={getValue:()=>value,offsetToPos:(offset:number)=>offset,replaceRange:(text:string,from:number,to:number)=>{value=value.slice(0,from)+text+value.slice(to);}};
  const app={loadLocalStorage:()=>saved,saveLocalStorage:(_key:string,jobs:any[])=>{saved=JSON.parse(JSON.stringify(jobs));},workspace:{getLeavesOfType:()=>[{view:{file:{path:'Note.md'},editor}}]}};
  saved=[{id,path:'Note.md',requestId:id,threadId:'thread',messageId:'original',bodyHash:initial.bodyHash,phase:'running',createdAt:oldTime,keepIntermediate:true,...(initialInput?{initialInput}:{})}];
  const create=()=>{const manager=new module.exports.InlineChatManager(app,'jobs',async()=>undefined);manager.schedule=()=>{};manager.start=()=>{};return manager;};
  let manager=create(),job=manager.find(id);
  const old={id:'old',role:'assistant',text:'Old progress.',turnId:'old-turn',streaming:false,createdAt:oldTime};
  const snapshot=(messages:any[],turnId:string,state:string,requestedAt:string,sequence:number)=>({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{messages,activities:[],latestTurn:{turnId,state,requestedAt,assistantMessageId:messages.at(-1).id},session:{status:state==='running'?'running':state==='error'?'error':'ready',activeTurnId:state==='running'?turnId:null}}}});
  const original={id:'original',role:'user',text:'Begin',turnId:null,streaming:false,createdAt:oldTime};
  manager.receive(job,snapshot([original,old],'old-turn','error',oldTime,1));manager.flush(job);assert.match(value,/Old progress/);
  manager.follow(job,'continue');manager.dispose();manager=create();job=manager.find(id);
  const continued={id:'continue',role:'user',text:'Continue',turnId:null,streaming:false,createdAt:nextTime},next={id:'next',role:'assistant',text:'New progress.',turnId:'next-turn',streaming:false,createdAt:nextTime};
  value=value.replace('Old progress.','SYNC_DUPLICATE\n> SYNC_DUPLICATE')+'\nOutside edit';
  manager.receive(job,snapshot([original,old,continued,next],'next-turn','running',nextTime,2));manager.flush(job);
  assert.doesNotMatch(value,/SYNC_DUPLICATE/);assert.match(value,/Outside edit/);
  assert.deepEqual(Array.from(job.turnIds),['old-turn','next-turn']);assert.match(value,/> Old progress\.\n>\n> New progress\./);
  value=value.replace('New progress.','SYNC_FINAL_DUPLICATE');
  const final={...next,id:'final',text:'Final answer.'};
  manager.receive(job,snapshot([original,old,continued,next,final],'next-turn','completed',nextTime,3));manager.flush(job);
  assert.doesNotMatch(value,/SYNC_FINAL_DUPLICATE/);assert.match(value,/Outside edit/);
  assert.match(value,/> Old progress\.\n>\n> New progress\.\n>\n> Final answer\./);assert.doesNotMatch(value,/t3-inline:/);assert.equal(job.finalized,true);
  if(text){assert.match(value,/> Explain the selection\.[\s\S]*> Old progress\./);assert.equal(value.split('> Explain the selection.').length-1,1);}
  manager.dispose();
});

for(const dismiss of [false,true])test(`local async ${dismiss?'dismissal':'answer'} after completion keeps watching through reload`,async()=>{
  const result=await build({entryPoints:['inline-chat.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
  const module={exports:{} as any},realRequire=createRequire(import.meta.url);
  runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Notice:class{}}:realRequire(id),console,setTimeout,clearTimeout,TextEncoder,Uint8Array});
  const id=randomUUID(),initial=initialRegion(id),time='2026-10-01T19:00:00Z';
  let value=initial.text,saved:any[]=[{id,path:'Note.md',requestId:id,threadId:'thread',messageId:'original',bodyHash:initial.bodyHash,phase:'running',createdAt:time}];
  const editor={getValue:()=>value,offsetToPos:(offset:number)=>offset,replaceRange:(text:string,from:number,to:number)=>{value=value.slice(0,from)+text+value.slice(to);}};
  const app={loadLocalStorage:()=>saved,saveLocalStorage:(_key:string,jobs:any[])=>{saved=JSON.parse(JSON.stringify(jobs));},workspace:{getLeavesOfType:()=>[{view:{file:{path:'Note.md'},editor}}]}};
  const create=()=>{const manager=new module.exports.InlineChatManager(app,'jobs',async()=>undefined);manager.schedule=()=>{};manager.start=()=>{};return manager;};
  let manager=create(),job=manager.find(id);
  const thread:any={messages:[{id:'original',role:'user',turnId:null,text:'Begin',streaming:false,createdAt:time},{id:'first',role:'assistant',turnId:'first-turn',text:'First final.',streaming:false}],activities:[{id:'asked',kind:'user-input.requested',summary:'Question',turnId:'first-turn',payload:{requestId:'late',responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Continue?',options:[{label:'Yes',description:''}]}]}}],latestTurn:{turnId:'first-turn',state:'completed',requestedAt:time,assistantMessageId:'first'},session:{status:'ready',activeTurnId:null}};
  const receive=()=>{manager.receive(job,{kind:'snapshot',snapshot:{thread,snapshotSequence:1}});manager.flush(job);};
  receive();assert.equal(job.finalized,undefined);assert.match(value,/First final/);assert.doesNotMatch(value,/T3 · Working/);
  manager.dispose();manager=create();job=manager.find(id);
  thread.activities.push({id:'resolved',kind:'user-input.resolved',summary:'Resolved',turnId:'first-turn',payload:{requestId:'late',...(!dismiss?{answers:{choice:'Yes'}}:{})}});
  if(!dismiss){
    receive();assert.equal(job.finalized,undefined);
    thread.messages.push({id:'async-answer:late',role:'user',turnId:null,text:'Yes',streaming:false,createdAt:'2026-10-01T19:01:00Z'},{id:'next',role:'assistant',turnId:'next-turn',text:'Follow-up final.',streaming:false});
    thread.latestTurn={turnId:'next-turn',state:'completed',requestedAt:'2026-10-01T19:01:00Z',assistantMessageId:'next'};
  }
  receive();assert.equal(job.finalized,true);assert.doesNotMatch(value,/t3-inline:|t3-question:/);
  if(!dismiss){assert.match(value,/First final[\s\S]*> \[!t3-steering\] You\n> Yes[\s\S]*Follow-up final/);assert.equal(value.split('> Yes').length-1,1);}
  manager.dispose();
});
