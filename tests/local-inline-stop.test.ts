import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {initialRegion,replaceRegion} from '../inline-thread';

async function harness(hosted=false){
  const result=await build({entryPoints:['inline-chat.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
  const module={exports:{} as any},realRequire=createRequire(import.meta.url);
  runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Notice:class{}}:realRequire(id),console,setTimeout,clearTimeout,TextEncoder,Uint8Array});
  const id=randomUUID(),initial=initialRegion(id),change=replaceRegion(initial.text,id,initial.bodyHash,'**T3 · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n\n> Partial answer edited in the note.')!;
  let value='Before'+initial.text.slice(0,change.from)+change.text+initial.text.slice(change.to)+'After',saved:any[]=[];
  const editor={getValue:()=>value,offsetToPos:(offset:number)=>offset,replaceRange:(text:string,from:number,to:number)=>{value=value.slice(0,from)+text+value.slice(to);}};
  const info={file:{path:'Note.md'},editor};
  const app={loadLocalStorage:()=>saved,saveLocalStorage:(_key:string,jobs:any[])=>{saved=JSON.parse(JSON.stringify(jobs));},workspace:{getLeavesOfType:()=>[{view:info}]}};
  const create=(remote=async()=>{})=>new module.exports.InlineChatManager(app,'jobs',async()=>undefined,hosted?{prepare:async()=>{},stop:remote}:undefined);
  const manager=create(),job:any={id,path:'Note.md',requestId:id,bodyHash:initial.bodyHash,phase:'running',createdAt:'',hosted,...(!hosted?{threadId:'thread',turnId:'turn',connection:{transport:'direct',url:'https://test'}}:{})};
  manager.jobs.push(job);manager.runtime(job).state={messages:[{id:'old',role:'assistant',text:'STALE CACHE',turnId:'turn',streaming:true}],activities:[]};
  return {id,editor,info,manager,job,create,get value(){return value;},set value(next:string){value=next;},get saved(){return saved;}};
}

for(const failure of ['reject','hang'])test(`local stop finalizes before remote ${failure}, ignores late snapshots, and survives reload`,async()=>{
  const h=await harness();let attempts=0;
  h.manager.access=async()=>{attempts++;if(failure==='reject')throw Error('offline');return new Promise(()=>{});};
  try{
    await h.manager.stop(h.job);
    assert.doesNotMatch(h.value,/t3-inline:|Working|spinner|STALE CACHE/);assert.match(h.value,/Partial answer edited in the note/);
    assert.equal(h.saved[0].phase,'cancelled');assert.equal(h.saved[0].remoteStopPending,true);assert.equal(h.job.finalized,true);
    const sealed=h.value;
    h.manager.receive(h.job,{kind:'snapshot',snapshot:{thread:{messages:[],activities:[],latestTurn:{turnId:'turn',state:'running'}}}});
    h.manager.flush(h.job);assert.equal(h.value,sealed);assert.equal(h.job.phase,'cancelled');
    await h.manager.stop(h.job);assert.equal(attempts,1);
    h.manager.dispose();
    const reloaded=h.create();reloaded.access=async()=>{throw Error('still offline');};reloaded.resume();assert.equal(h.value,sealed);assert.equal(reloaded.activeFor('Note.md').length,0);reloaded.dispose();
  }finally{h.manager.dispose();}
});

test('hosted stop cleans immediately while the host request is stalled',async()=>{
  const h=await harness(true);h.manager.hosted.stop=()=>new Promise(()=>{});
  try{await h.manager.stop(h.job);assert.doesNotMatch(h.value,/t3-inline:|Working|spinner/);assert.match(h.value,/Partial answer/);assert.equal(h.saved[0].remoteStopPending,true);}
  finally{h.manager.dispose();}
});

test('orphan stop uses the clicked editor, and saved stop intent cleans a restored block on reload',async()=>{
  const h=await harness(true),original=h.value;h.manager.jobs=[];
  try{
    await h.manager.stopAt(h.id,h.editor,h.info);assert.doesNotMatch(h.value,/t3-inline:|Working/);
    h.manager.dispose();h.value=original;
    const reloaded=h.create();reloaded.resume();assert.doesNotMatch(h.value,/t3-inline:|Working/);assert.match(h.value,/edited in the note/);reloaded.dispose();
  }finally{h.manager.dispose();}
});
