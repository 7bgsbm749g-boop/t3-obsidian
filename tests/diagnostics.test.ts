import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventJournal,configureDiagnostics,redact,type DiagnosticState} from '../diagnostics';
import {SyncedEventLogs,EVENT_LOG_PATH,EVENT_LOG_FOLDER} from '../synced-event-logs';
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
test('devices and sessions share one hidden file; exports merge and deduplicate',async()=>{
  const data=new Map<string,string>(),a=fixture('a',data),b=fixture('b',data),ja=new EventJournal(a.io),jb=new EventJournal(b.io);
  ja.record('a.error',{error:Error('bad'),prompt:'private'},'error');jb.record('b.connected');await ja.flush(true);await jb.flush(true);
  assert.deepEqual([...data.keys()].filter(path=>path!=='.obsidian'),[EVENT_LOG_PATH]);
  const exported=JSON.parse(await ja.exportSynced());assert.equal(exported.events.length,2);assert.deepEqual(new Set(exported.events.map((event:any)=>event.deviceId)),new Set(['a','b']));assert.doesNotMatch(JSON.stringify(exported),/"private"/);
});
test('failed vault publication retains local data and retries without duplicating events',async()=>{
  const f=fixture(),j=new EventJournal(f.io);j.record('event');f.setFail(true);await assert.rejects(j.flush(true),/offline/);assert.equal(f.saved.events.length,1);assert.ok(j.storageError);
  f.setFail(false);await j.flush(true);assert.equal(j.storageError,'');assert.equal(JSON.parse(await j.exportSynced()).events.length,1);const writes=f.writes;await j.flush(true);assert.equal(f.writes,writes);
});
test('reload keeps current-day sessions in the same file',async()=>{
  const f=fixture(),j=new EventJournal(f.io);j.record('first');await j.close();const restored=new EventJournal(f.io);await restored.load();restored.record('second');await restored.close();
  assert.deepEqual([...f.data.keys()].filter(path=>path!=='.obsidian'),[EVENT_LOG_PATH]);assert.notEqual(f.saved.events[0].sessionId,f.saved.events[1].sessionId);
});
test('UTC midnight clears all devices and idle local buffers without resurrecting stale events',async()=>{
  const data=new Map<string,string>(),a=fixture('a',data),b=fixture('b',data),ja=new EventJournal(a.io),jb=new EventJournal(b.io);ja.record('old-a');jb.record('old-b');await ja.flush(true);await jb.flush(true);
  a.advance(12*60*60_000);await ja.tick();assert.equal(a.saved.events.length,0);assert.deepEqual(JSON.parse(data.get(EVENT_LOG_PATH)!).events,[]);assert.equal(JSON.parse(data.get(EVENT_LOG_PATH)!).day,'2026-10-02');
  b.advance(12*60*60_000);await jb.flush(true);assert.equal(JSON.parse(data.get(EVENT_LOG_PATH)!).events.length,0);
  ja.record('new');await ja.flush(true);assert.equal(JSON.parse(await ja.exportSynced()).events[0].event,'new');
});
test('startup offline across several midnights drops old buffered events',async()=>{
  const f=fixture(),j=new EventJournal(f.io);j.record('old');await j.flush(true);f.advance(3*24*60*60_000);const restored=new EventJournal(f.io);await restored.load();await restored.flush(true);assert.equal(JSON.parse(await restored.exportSynced()).events.length,0);
});
test('legacy generated Markdown migrates only today after durable replacement; user files survive',async()=>{
  const f=fixture(),j=new EventJournal(f.io);const event=j.record('today');const old={...event,at:'2026-09-30T23:59:59.000Z',event:'yesterday'};
  const legacy=EVENT_LOG_FOLDER+'/device/session.md';f.data.set(legacy,'# T3 Code plugin event log\n\n```json\n'+JSON.stringify({schema:1,events:[old,event]})+'\n```\n');f.data.set(EVENT_LOG_FOLDER+'/user.md','My own note');
  f.setFail(true);await assert.rejects(j.flush(true));assert.ok(f.data.has(legacy));f.setFail(false);await j.flush(true);assert.equal(f.data.has(legacy),false);assert.ok(f.data.has(EVENT_LOG_FOLDER+'/user.md'));assert.deepEqual(JSON.parse(f.data.get(EVENT_LOG_PATH)!).events.map((e:any)=>e.event),['today']);
});
test('corrupt shared log is reported instead of silently overwriting other device data',async()=>{
  const f=fixture(),j=new EventJournal(f.io);f.data.set(EVENT_LOG_PATH,'corrupt');j.record('event');await assert.rejects(j.flush(true));assert.equal(f.data.get(EVENT_LOG_PATH),'corrupt');assert.equal(f.saved.events.length,1);
});
test('custom configuration directory and same-instance concurrent publication preserve entries',async()=>{
  const f=fixture(),j=new EventJournal(f.io);const custom=new SyncedEventLogs({exists:async path=>f.data.has(path),mkdir:async path=>{f.data.set(path,'');},read:async path=>f.data.get(path)!,write:async(path,text)=>{f.data.set(path,text);},remove:async path=>{f.data.delete(path);}},'device',()=>[],()=>f.io.now(),'.custom');
  await Promise.all([custom.publish([j.record('a')]),custom.publish([j.record('b')])]);assert.equal(JSON.parse(f.data.get('.custom/t3-code-log.json')!).events.length,2);
});
test('logging preserves observed sync and async results and errors',async()=>{
  const f=fixture(),j=new EventJournal(f.io);configureDiagnostics(j);const target={sync(value:number){return value+1;},async asyncMethod(){return 7;},async fail(){throw Error('bad');}};
  const undo=instrumentOperations(target,['sync','asyncMethod','fail']);try{assert.equal(target.sync(2),3);assert.equal(await target.asyncMethod(),7);await assert.rejects(target.fail(),/bad/);await j.flush(true);assert.equal(f.saved.events.length,6);}finally{undo();configureDiagnostics();}
});
test('errors publish immediately without a housekeeping tick and survive failed Sync writes',async()=>{
  const f=fixture(),j=new EventJournal(f.io);await j.flush(true);f.setFail(true);
  j.record('request.saved',{requestId:'original'});j.record('request.dispatch.failed',{requestId:'original'},'error');
  await assert.rejects(j.flush(),/offline/);assert.equal(f.saved.events.length,2);
  f.setFail(false);f.advance(30_000);await j.tick();
  assert.deepEqual(JSON.parse(f.data.get(EVENT_LOG_PATH)!).events.map((e:any)=>e.event),['request.saved','request.dispatch.failed']);
  j.record('request.retry.failed',{requestId:'original'},'error');await j.flush();
  assert.equal(JSON.parse(f.data.get(EVENT_LOG_PATH)!).events.at(-1).event,'request.retry.failed','errors bypass the normal 30-second publication interval');
});
test('errors arriving during persistence are included in a subsequent urgent publication',async()=>{
  const f=fixture();let release!:()=>void,entered!:()=>void;
  const blocked=new Promise<void>(r=>release=r),saving=new Promise<void>(r=>entered=r);let saves=0;
  const j=new EventJournal({...f.io,save:async state=>{if(++saves===1){entered();await blocked;}await f.io.save(state);}});
  j.record('first.failure',{},'error');await saving;j.record('second.failure',{},'error');release();
  await j.flush();await j.flush();
  assert.deepEqual(JSON.parse(f.data.get(EVENT_LOG_PATH)!).events.map((e:any)=>e.event),['first.failure','second.failure']);
});
test('devices recover their events after a concurrent shared-file replacement',async()=>{
  const data=new Map<string,string>(),a=fixture('a',data),b=fixture('b',data),ja=new EventJournal(a.io),jb=new EventJournal(b.io);
  ja.record('phone.send');await ja.flush(true);const phoneCopy=data.get(EVENT_LOG_PATH)!;
  jb.record('host.received');await jb.flush(true);
  data.set(EVENT_LOG_PATH,phoneCopy);b.advance(30_000);await jb.tick();
  assert.deepEqual(JSON.parse(data.get(EVENT_LOG_PATH)!).events.map((e:any)=>e.event),['phone.send','host.received']);
});
