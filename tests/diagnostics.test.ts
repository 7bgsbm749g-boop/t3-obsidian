import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventJournal,configureDiagnostics,redact,type DiagnosticState} from '../diagnostics';
import {SyncedEventLogs,EVENT_LOG_FOLDER} from '../synced-event-logs';
import {instrumentOperations} from '../diagnostic-operations';
function fixture(deviceId='device',data=new Map<string,string>()){
  let time=Date.parse('2026-10-01T12:00:00Z'),serial=0,saved:any,fail=false,writes=0;
  const files={exists:async(path:string)=>data.has(path),mkdir:async(path:string)=>{data.set(path,'');},read:async(path:string)=>{if(!data.has(path))throw Error('missing');return data.get(path)!;},write:async(path:string,text:string)=>{if(fail)throw Error('offline');writes++;data.set(path,text);},remove:async(path:string)=>{data.delete(path);}};
  const sync=new SyncedEventLogs(files,deviceId,()=>[...data.keys()],()=>time);
  const io={id:()=>`${deviceId}-${++serial}`,now:()=>time,context:{deviceId},load:async()=>saved,save:async(state:DiagnosticState)=>{saved=structuredClone(state);},publish:(events:any)=>sync.publish(events),readSynced:()=>sync.read()};
  return {io,sync,data,get saved(){return saved;},get writes(){return writes;},setSaved:(value:any)=>saved=value,setFail:(value:boolean)=>fail=value,advance:(ms:number)=>time+=ms};
}
test('metadata redaction excludes credentials and note bodies',()=>{
  const bytes=JSON.stringify(redact({prompt:'private note',selection:{text:'private'},nested:{accessToken:'secret',url:'https://host/?ticket=secret'},error:Error('Request https://host failed token=secret')}));assert.doesNotMatch(bytes,/private note|"secret"|ticket=secret|token=secret/);assert.match(bytes,/redacted/);
});
test('old local timelines migrate without any reporting state',async()=>{
  const f=fixture(),j=new EventJournal(f.io);j.record('old');const old=JSON.parse(j.export());delete old.events[0].deviceId;f.setSaved({...old,incidents:[{status:'queued'}],attempts:[1],watches:[{}]});
  const restored=new EventJournal(f.io);await restored.load();await restored.flush(true);assert.equal(f.saved.events[0].deviceId,'device');assert.deepEqual(Object.keys(f.saved),['schema','events']);
});
test('separate devices publish separate Markdown logs and exports merge and deduplicate',async()=>{
  const data=new Map<string,string>(),a=fixture('a',data),b=fixture('b',data),ja=new EventJournal(a.io),jb=new EventJournal(b.io);
  ja.record('a.error',{error:Error('bad'),prompt:'private'},'error');jb.record('b.connected');await Promise.all([ja.flush(true),jb.flush(true)]);
  const paths=[...data.keys()].filter(path=>path.endsWith('.md'));assert.equal(paths.length,2);assert.ok(paths.every(path=>path.startsWith(EVENT_LOG_FOLDER+'/')));
  const exported=JSON.parse(await ja.exportSynced());assert.equal(exported.events.length,2);assert.deepEqual(new Set(exported.events.map((event:any)=>event.deviceId)),new Set(['a','b']));assert.doesNotMatch(JSON.stringify(exported),/"private"/);
});
test('failed vault publication retains local data and retries without duplicating events',async()=>{
  const f=fixture(),j=new EventJournal(f.io);j.record('event');f.setFail(true);await assert.rejects(j.flush(true),/offline/);assert.equal(f.saved.events.length,1);assert.ok(j.storageError);
  f.setFail(false);await j.flush(true);assert.equal(j.storageError,'');assert.equal(JSON.parse(await j.exportSynced()).events.length,1);const writes=f.writes;await j.flush(true);assert.equal(f.writes,writes);
});
test('reload retains old session and adds a separate writer session',async()=>{
  const f=fixture(),j=new EventJournal(f.io);j.record('first');await j.close();const restored=new EventJournal(f.io);await restored.load();restored.record('second');await restored.close();
  assert.equal([...f.data.keys()].filter(path=>path.endsWith('.md')).length,2);assert.notEqual(f.saved.events[0].sessionId,f.saved.events[1].sessionId);
});
test('retention is bounded and pruning never removes another device logs',async()=>{
  const data=new Map<string,string>(),a=fixture('a',data),b=fixture('b',data),ja=new EventJournal(a.io),jb=new EventJournal(b.io);ja.record('old-a');jb.record('old-b');await ja.close();await jb.close();
  a.advance(8*24*60*60_000);const restored=new EventJournal(a.io);await restored.load();for(let i=0;i<10_100;i++)restored.record('event',{i});await restored.flush(true);
  assert.equal(a.saved.events.length,10_000);assert.equal([...data.keys()].filter(path=>path.startsWith(EVENT_LOG_FOLDER+'/a/')&&path.endsWith('.md')).length,1);assert.equal([...data.keys()].filter(path=>path.startsWith(EVENT_LOG_FOLDER+'/b/')&&path.endsWith('.md')).length,1);
});
test('logging preserves observed sync and async results and errors',async()=>{
  const f=fixture(),j=new EventJournal(f.io);configureDiagnostics(j);const target={sync(value:number){return value+1;},async asyncMethod(){return 7;},async fail(){throw Error('bad');}};
  const undo=instrumentOperations(target,['sync','asyncMethod','fail']);try{assert.equal(target.sync(2),3);assert.equal(await target.asyncMethod(),7);await assert.rejects(target.fail(),/bad/);await j.flush(true);assert.equal(f.saved.events.length,6);}finally{undo();configureDiagnostics();}
});
