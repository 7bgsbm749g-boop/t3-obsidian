import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ThreadTitleFeed,type TitleDestination} from '../thread-title-feed';
import type {ThreadStreamCallbacks} from '../thread-stream';

const destination:TitleDestination={id:'one',threadId:'thread',projectId:'project',threadEnvironmentId:'host'};
function fixture(){
  const streams:Array<{thread:string;callbacks:ThreadStreamCallbacks;stopped:boolean}>=[],titles:Array<[string,string]>=[];
  const feed=new ThreadTitleFeed(async()=>({origin:'https://fixture',api:async()=>{}}),(id,title)=>titles.push([id,title]),(thread,_access,callbacks,_socket,_targets,replay)=>{
    assert.equal(replay?.pollSnapshots,false);assert.equal(replay?.titleOnly,true);assert.equal(replay?.afterSequence(),undefined);
    const stream={thread,callbacks,stopped:false};streams.push(stream);return {stop:()=>{stream.stopped=true;}};
  });
  return {feed,streams,titles};
}
test('title metadata reaches every destination without messages or a bound turn, ignoring stale snapshots',()=>{
 const h=fixture();try{
  h.feed.sync([destination,{...destination,id:'two'}]);assert.equal(h.streams.length,1);
  const {callbacks}=h.streams[0];
  callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:1,thread:{id:'thread',projectId:'project',title:'New thread',messages:[]}}});
  callbacks.item({kind:'event',event:{sequence:2,type:'thread.metadata-updated',payload:{title:'Generated title'}}});
  assert.deepEqual(h.titles.slice(-2),[['one','Generated title'],['two','Generated title']]);
  callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:1,thread:{id:'thread',projectId:'project',title:'New thread',messages:[]}}});
  assert.equal(h.titles.at(-1)?.[1],'Generated title');
  h.feed.sync([{...destination,id:'three'}]);assert.equal(h.streams.length,1);assert.deepEqual(h.titles.at(-1),['three','Generated title']);
 }finally{h.feed.dispose();}
});
test('v2 title snapshots keep their cursor after newer metadata and unknown events',()=>{
 const h=fixture();try{
  h.feed.sync([destination]);const {callbacks}=h.streams[0];
  const snapshot=(sequence:number,title:string)=>callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{id:'thread',projectId:'project',protocolVersion:2,title,messages:[]}}});
  snapshot(10,'Initial');
  callbacks.item({kind:'event',event:{sequence:11,type:'thread.metadata-updated',payload:{title:'Changed'}}});
  snapshot(10,'Stale');assert.equal(h.titles.at(-1)?.[1],'Changed');
  callbacks.item({kind:'event',event:{sequence:12,type:'v2.unknown',payload:{}}});
  callbacks.item({kind:'event',event:{sequence:11,type:'thread.metadata-updated',payload:{title:'Stale event'}}});
  snapshot(11,'Stale snapshot');assert.equal(h.titles.at(-1)?.[1],'Changed');
  snapshot(12,'Fresh');assert.equal(h.titles.at(-1)?.[1],'Fresh');
 }finally{h.feed.dispose();}
});
test('title feeds isolate environments, reject another project, and fence late events after closure',()=>{
 const h=fixture();h.feed.sync([destination,{...destination,id:'remote',threadEnvironmentId:'other-host'}]);assert.equal(h.streams.length,2);
 h.streams[0].callbacks.item({kind:'snapshot',snapshot:{thread:{id:'thread',projectId:'wrong',title:'Wrong title'}}});assert.equal(h.titles.length,0);
 h.feed.sync([]);assert.ok(h.streams.every(stream=>stream.stopped));
 h.streams[0].callbacks.item({kind:'event',event:{sequence:2,type:'thread.metadata-updated',payload:{title:'Late title'}}});assert.equal(h.titles.length,0);
 h.feed.sync([destination]);h.feed.dispose();assert.ok(h.streams[2].stopped);
});
