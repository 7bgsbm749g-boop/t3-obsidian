import {expectRecord} from './wire-fixture';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {jsonHttp} from '../src/connection/direct';

test('a valid response larger than the former 4 MB limit is accepted',async()=>{
 const text='x'.repeat(4_100_000),fetcher=async()=>new Response(JSON.stringify({text}));
 assert.equal(expectRecord(await jsonHttp('https://fixture/api/test',{},fetcher as any)).text,text);
});

const fetchBody=(bytes:Uint8Array)=>async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=2)controller.enqueue(bytes.slice(i,i+2));controller.close();}}),{status:200});

test('bounded HTTP decoding preserves multi-byte text split across stream chunks',async()=>{
  const value={text:'Progress: 日本語, café, 🧠',nested:['\u0000','line\nbreak']};
  assert.deepEqual(await jsonHttp('https://t3.example/api/test',{},fetchBody(Buffer.from(JSON.stringify(value))) as any),value);
});

test('HTTP decoding retains replacement characters and rejects a leading BOM without revealing invalid bodies',async()=>{
  const malformed=Buffer.concat([Buffer.from('{"text":"'),Buffer.from([0xc3,0x28,0xff]),Buffer.from('"}')]);
  assert.deepEqual(await jsonHttp('https://t3.example/api/test',{},fetchBody(malformed) as any),JSON.parse(malformed.toString('utf8')));
  await assert.rejects(jsonHttp('https://t3.example/api/test',{},fetchBody(Buffer.from('\ufeff{"private":"withheld"}')) as any),error=>error instanceof Error&&error.message==='T3 returned an invalid response; response contents withheld.');
});

test('streamed HTTP bodies above 8 MB finish and release the reader without a size rejection',async()=>{
  let cancelled=false,released=false;
  const text='x'.repeat(8_000_001);let sent=false;
  const fetcher=async()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:Buffer.from(JSON.stringify({text}))}),cancel:async()=>{cancelled=true;},releaseLock:()=>{released=true;}})}});
  assert.equal(expectRecord(await jsonHttp('https://t3.example/api/test',{},fetcher as any)).text,text);
  assert.equal(cancelled,false);assert.equal(released,true);
});

test('a large Content-Length does not reject a valid response',async()=>{
  let read=false;
  const fetcher=async()=>{read=true;return new Response('{"ok":true}',{headers:{'content-length':'8000001'}});};
  assert.deepEqual(await jsonHttp('https://t3.example/api/test',{},fetcher as any),{ok:true});assert.equal(read,true);
});

test('compact import reads retain exact UTF-8 messages and discard unrelated data while streaming',async()=>{
 const body={snapshotSequence:3,projection:{thread:{id:'thread'},messages:[{text:'日本語, café, 🧠',context:{file:'private'}}],subagents:[{result:'not needed'}],turnItems:[{id:'tool',input:{html:'not needed'},output:{htmlRender:{attachmentId:'kept'}}}]}};
 assert.deepEqual(await jsonHttp('https://fixture/api/test',{},fetchBody(Buffer.from(JSON.stringify(body))) as any,true),{snapshotSequence:3,projection:{thread:{id:'thread'},messages:[{text:'日本語, café, 🧠'}],turnItems:[{id:'tool',output:{htmlRender:{attachmentId:'kept'}}}]}});
});


test('a slow HTTP response remains cancellable and is accepted after the former deadline',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 let reply!:(response:Response)=>void,signal:AbortSignal|undefined;
 const work=jsonHttp('https://fixture/api/test',{},async(_url,options)=>{signal=options?.signal as AbortSignal;return new Promise(resolve=>{reply=resolve;});});
 context.mock.timers.tick(300_000);assert.equal(signal?.aborted,false);
 reply(new Response('{"complete":true}'));assert.deepEqual(await work,{complete:true});
 const cancel=new AbortController();const stopped=jsonHttp('https://fixture/api/test',{signal:cancel.signal},()=>new Promise(()=>{}));
 cancel.abort(Error('User cancelled'));await assert.rejects(stopped,/User cancelled/);
});
