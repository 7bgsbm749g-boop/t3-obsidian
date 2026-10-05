import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {jsonHttp} from '../direct';

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

test('oversized streamed HTTP bodies cancel and release the reader before decoding',async()=>{
  let cancelled=false,released=false;
  const fetcher=async()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(4_000_001)}),cancel:async()=>{cancelled=true;},releaseLock:()=>{released=true;}})}});
  await assert.rejects(jsonHttp('https://t3.example/api/test',{},fetcher as any),/response exceeds 4 MB/);
  assert.equal(cancelled,true);assert.equal(released,true);
});

test('declared oversized HTTP bodies are rejected before acquiring a reader',async()=>{
  let read=false;
  const fetcher=async()=>({ok:true,headers:new Headers({'content-length':'4000001'}),body:{getReader:()=>{read=true;throw Error('Unexpected read');}}});
  await assert.rejects(jsonHttp('https://t3.example/api/test',{},fetcher as any),/response exceeds 4 MB/);assert.equal(read,false);
});
