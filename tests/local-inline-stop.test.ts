import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {initialRegion,replaceRegion} from '../inline-thread';

async function harness(hosted=false){
  const result=await build({stdin:{contents:"export {InlineChatManager} from './inline-chat'; export {nativeResponses} from './native-response-manager';",resolveDir:process.cwd(),sourcefile:'local-stop-harness.ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
  const module={exports:{} as any},realRequire=createRequire(import.meta.url);
  runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Notice:class{}}:realRequire(id),console,setTimeout,clearTimeout,TextEncoder,Uint8Array});
  const id=randomUUID(),initial=initialRegion(id),change=replaceRegion(initial.text,id,initial.bodyHash,'**T3 · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n\n> Partial answer edited in the note.')!;
  let value='Before'+initial.text.slice(0,change.from)+change.text+initial.text.slice(change.to)+'After',saved:any[]=[];
  const editor={getValue:()=>value,offsetToPos:(offset:number)=>offset,replaceRange:(text:string,from:number,to:number)=>{value=value.slice(0,from)+text+value.slice(to);}};
  const info:any={file:{path:'Note.md'},editor};
  const local=new Map<string,unknown>();const app={loadLocalStorage:(key:string)=>key==='jobs'?saved:local.get(key),saveLocalStorage:(key:string,jobs:any[])=>{if(key==='jobs')saved=JSON.parse(JSON.stringify(jobs));else local.set(key,structuredClone(jobs));},workspace:{getLeavesOfType:()=>[{view:info}]}};
  const create=(remote=async()=>{})=>new module.exports.InlineChatManager(app,'jobs',async()=>undefined,hosted?{prepare:async()=>{},stop:remote}:undefined);
  const manager=create(),job:any={id,path:'Note.md',requestId:id,bodyHash:initial.bodyHash,phase:'running',createdAt:'',hosted,...(!hosted?{threadId:'thread',turnId:'turn',connection:{transport:'direct',url:'https://test'}}:{})};
  manager.jobs.push(job);manager.runtime(job).state={messages:[{id:'old',role:'assistant',text:'STALE CACHE',turnId:'turn',streaming:true}],activities:[]};
  return {id,editor,info,app,native:()=>module.exports.nativeResponses(app),manager,job,create,get value(){return value;},set value(next:string){value=next;},get saved(){return saved;}};
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

test('stop all clears running and failed replies, including an orphan from another device, without touching another note or completed prose',async()=>{
  const h=await harness(true),failed=randomUUID(),orphan=randomUUID(),other=randomUUID(),completed=randomUUID();
  const append=(id:string,label:string)=>{const region=initialRegion(id);h.value+=region.text.replace('Working',label)+`\nAfter ${id}\n`;};
  append(failed,'Error');append(orphan,'Error');append(completed,'Complete');
  h.manager.jobs.push({...h.job,id:failed,requestId:failed,phase:'error'}, {...h.job,id:other,path:'Other.md'}, {...h.job,id:completed,phase:'complete',finalized:true});
  const calls:any[]=[];h.manager.hosted.stop=async(job:any)=>{calls.push(job);};
  const hostTarget={environmentId:'other-device',workspaceRoot:'/other-vault',directory:'/private-streams'};
  try{
    assert.equal(await h.manager.stopAllAt(h.editor,h.info,[{id:orphan,hostTarget}]),3);
    assert.match(h.value,/Partial answer edited in the note/);
    for(const id of [h.id,failed,orphan])assert.ok(!h.value.includes(`t3-inline:start:${id}`));
    assert.ok(h.value.includes(`t3-inline:start:${completed}`));
    assert.equal(h.manager.jobs.find((job:any)=>job.id===other).phase,'running');
    assert.deepEqual(calls.map(job=>job.id).sort(),[h.id,failed,orphan].sort());
    assert.deepEqual(calls.find(job=>job.id===orphan).hostTarget,hostTarget);
    assert.equal(await h.manager.stopAllAt(h.editor,h.info),0);
    assert.equal(calls.length,3);
  }finally{h.manager.dispose();}
});

test('stop all finishes each valid reply when another response has incomplete boundaries',async()=>{
  const h=await harness(true),broken=randomUUID();
  h.value+=`\n<!-- t3-inline:start:${broken} -->\n**T3 · Error**\nKeep this broken reply\n`;
  h.manager.jobs.push({...h.job,id:broken,requestId:broken,phase:'error',hosted:false});
  h.manager.hosted.stop=async()=>{};
  try{
    await assert.rejects(h.manager.stopAllAt(h.editor,h.info),/Could not finish 1 of 2 T3 responses/);
    assert.ok(!h.value.includes(`t3-inline:start:${h.id}`));
    assert.match(h.value,/Partial answer edited in the note/);
    assert.match(h.value,/Keep this broken reply/);
    assert.ok(h.saved.every(job=>job.phase==='cancelled'));
  }finally{h.manager.dispose();}
});

for(const failure of ['reject','hang'])test(`native hosted Stop finishes locally before remote ${failure}, then stays sealed after reload`,async()=>{
  const h=await harness(true),native=h.native(),body='**T3 · Working**\n\n> Keep the latest native partial reply';
  h.value=`Before\n<!-- t3-inline:start:${h.id} -->\n\n<!-- t3-inline:end:${h.id} -->\nAfter`;
  h.info.getViewData=()=>h.value;h.info.setViewData=(value:string)=>{h.value=value;};h.info.save=async()=>{};h.info.requestSave=()=>{};h.info.getMode=()=>'preview';
  native.configurePreviewCache('vault',undefined,async()=>{});native.preview(h.info,h.id,body);
  h.manager.hosted.stop=()=>failure==='reject'?Promise.reject(Error('offline')):new Promise(()=>{});
  try{
    await h.manager.stop(h.job);assert.doesNotMatch(h.value,/Working|spinner/);assert.match(h.value,/latest native partial reply/);
    native.stream({request:{id:h.id,notePath:'Note.md'},sequence:100,body:'**T3 · Working**\nLate native stream'});
    assert.doesNotMatch(h.value,/Late native stream|Working/);assert.equal(h.saved[0].finalized,true);
    h.manager.dispose();native.dispose();
    native.configurePreviewCache('vault',undefined,async()=>{});const reloaded=h.create();reloaded.resume();
    assert.doesNotMatch(h.value,/Working|spinner/);assert.match(h.value,/latest native partial reply/);reloaded.dispose();
  }finally{h.manager.dispose();native.dispose();}
});
