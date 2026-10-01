import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventJournal,DiagnosticDeferred,configureDiagnostics,logEvent,diagnosticPrompt,redact,type DiagnosticState,type Incident} from '../diagnostics';
import {instrumentOperations} from '../diagnostic-operations';
function fixture(){
  let time=Date.parse('2026-10-01T12:00:00Z'),serial=0,saved:DiagnosticState|undefined,sends=0,failSave=false;
  let report:(incident:Incident)=>Promise<string>=async()=>`thread-${++sends}`;
  const io={id:()=>`id-${++serial}`,now:()=>time,context:{deviceId:'device',pluginVersion:'1'},load:async()=>saved,save:async(state:DiagnosticState)=>{if(failSave)throw Error('disk unavailable');saved=structuredClone(state);},report:async(incident:Incident)=>report(incident)};
  return {io,get saved(){return saved;},get sends(){return sends;},advance:(ms:number)=>time+=ms,setFailSave:(value:boolean)=>failSave=value,setReport:(value:typeof report)=>report=value};
}
test('metadata redaction bounds nested data and excludes credentials and note bodies',()=>{
  const data=redact({prompt:'private note',selection:{text:'private'},attachments:['image'],nested:{accessToken:'secret',url:'https://host/?wsTicket=secret'},error:Error('Request to https://host/?ticket=secret failed token=secret')});
  const bytes=JSON.stringify(data);assert.doesNotMatch(bytes,/private note|"secret"|wsTicket|ticket=secret|token=secret/);assert.match(bytes,/redacted/);
});
test('timeline survives reload with session identity and finite retention',async()=>{
  const f=fixture(),journal=new EventJournal(f.io);await journal.load();
  journal.record('request.saved',{requestId:'request',notePath:'a.md'});await journal.flush();
  const restored=new EventJournal(f.io);await restored.load();restored.record('plugin.loaded');await restored.flush();
  assert.equal(f.saved?.events[0].fields.requestId,'request');assert.notEqual(f.saved?.events[0].sessionId,f.saved?.events[1].sessionId);
  for(let i=0;i<10_100;i++)restored.record('event',{i});await restored.flush();assert.equal(f.saved?.events.length,10_000);
  f.advance(8*24*60*60_000);restored.record('fresh');await restored.flush();assert.equal(f.saved?.events.length,1);
});
test('only reportable errors create incidents; duplicates and global hourly rate are bounded',async()=>{
  const f=fixture(),journal=new EventJournal(f.io);await journal.load();
  journal.record('guard.refused',{},'warning',true);journal.record('poll.failed',{},'error',false);await journal.tick();assert.equal(f.sends,0);
  for(let i=0;i<5;i++){journal.record(`failure.${i}`,{error:Error('failed')},'error',true);await journal.tick();}
  assert.equal(f.sends,3);assert.equal(journal.incidents().filter(x=>x.status==='queued').length,2);
  journal.record('failure.0',{error:Error('failed')},'error',true);assert.equal(journal.incidents().length,5);
  f.advance(60*60_000);await journal.tick();assert.equal(f.sends,4);
});
test('delivery reservation is saved before sending; crash and uncertain delivery never auto-resend',async()=>{
  const f=fixture();f.setReport(async incident=>{assert.equal(f.saved?.incidents.find(x=>x.id===incident.id)?.status,'attempted');throw Error('connection lost after dispatch');});
  const journal=new EventJournal(f.io);await journal.load();journal.record('dispatch.failed',{},'error',true);await journal.tick();assert.equal(journal.incidents()[0].status,'unknown');
  const restored=new EventJournal(f.io);await restored.load();await restored.tick();assert.equal(restored.incidents()[0].status,'unknown');
  // Also simulate a process dying between durable reservation and outcome save.
  f.saved!.incidents[0].status='attempted';const crashed=new EventJournal(f.io);await crashed.load();assert.equal(crashed.incidents()[0].status,'unknown');
});
test('failed storage blocks automatic delivery and can recover without losing events',async()=>{
  const f=fixture(),journal=new EventJournal(f.io);await journal.load();journal.record('dispatch.failed',{},'error',true);f.setFailSave(true);await journal.tick();assert.equal(f.sends,0);assert.ok(journal.storageError);
  f.setFailSave(false);await journal.tick();assert.equal(f.sends,1);assert.equal(journal.storageError,'');
});
test('deferred destination stays queued without burning rate budget; disabled automation only logs',async()=>{
  const f=fixture();f.setReport(async()=>{throw new DiagnosticDeferred('not connected');});const journal=new EventJournal(f.io);await journal.load();journal.record('failure',{},'error',true);
  await journal.tick(false);assert.equal(journal.incidents()[0].status,'queued');assert.equal(f.saved?.attempts.length,0);
  await journal.tick();assert.equal(journal.incidents()[0].status,'queued');assert.equal(f.saved?.attempts.length,0);
  f.setReport(async()=> 'thread');f.advance(30_000);await journal.tick();assert.equal(journal.incidents()[0].threadId,'thread');
});
test('canonical confirmation settles a watchdog; an unconfirmed reservation becomes a potential incident',async()=>{
  const f=fixture(),journal=new EventJournal(f.io);await journal.load();journal.watch('message-a','steering.reserved',{messageId:'a'},120_000);journal.watch('message-b','steering.reserved',{messageId:'b'},120_000);journal.settle('message-a');await journal.flush();
  const restored=new EventJournal(f.io);await restored.load();f.advance(120_001);await restored.tick();assert.equal(restored.incidents().length,1);assert.equal(restored.incidents()[0].event.fields.messageId,'b');assert.equal(f.sends,1);
});
test('diagnostic delivery failures do not recursively create diagnostic threads',async()=>{
  const f=fixture(),journal=new EventJournal(f.io);await journal.load();
  f.setReport(async()=>{journal.record('operation.save.failed',{error:Error('storage')},'error',true);throw Error('offline');});
  journal.record('failure',{},'error',true);await journal.tick();journal.record('diagnostics.request.failed',{},'error',true);assert.equal(journal.incidents().length,1);
});
test('operation instrumentation preserves sync, async and error behavior and can be removed',async()=>{
  const f=fixture(),journal=new EventJournal(f.io);await journal.load();configureDiagnostics(journal);
  const target={sync(value:number){return value+1;},async asyncMethod(){return 7;},async fail(){throw Error('bad');}};
  const undo=instrumentOperations(target,['sync','asyncMethod','fail'],['fail']);assert.equal(target.sync(2),3);assert.equal(await target.asyncMethod(),7);await assert.rejects(target.fail(),/bad/);undo();configureDiagnostics();await journal.flush();
  assert.equal(journal.incidents().length,1);assert.equal(f.saved?.events.length,6);
});
test('diagnostic prompts request read-only investigation and contain bounded sanitized evidence',async()=>{
  const f=fixture(),journal=new EventJournal(f.io);await journal.load();journal.record('failure',{prompt:'private',error:Error('bad')},'error',true);const incident=journal.incidents()[0];
  const prompt=diagnosticPrompt(incident,journal.timeline(incident),{deviceId:'device'});assert.match(prompt,/Work read-only/);assert.match(prompt,/untrusted diagnostic data/);assert.doesNotMatch(prompt,/"private"/);
});

test('overlapping ticks serialize report reservations and never dispatch two incidents concurrently',async()=>{
  const f=fixture(),journal=new EventJournal(f.io);await journal.load();let release!:()=>void,started=0;
  f.setReport(async()=>{started++;await new Promise<void>(resolve=>release=resolve);return 'thread';});
  journal.record('failure-a',{},'error',true);journal.record('failure-b',{},'error',true);
  const first=journal.tick(),second=journal.tick();await second;
  for(let i=0;i<10&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,1);release();await first;assert.equal(journal.incidents().filter(x=>x.status==='queued').length,1);
});
