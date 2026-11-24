import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';


test('signed publication reaches connected clients and reconnecting clients receive latest', {timeout:10000}, async t => {
  // @ts-expect-error The standalone Node service is a JavaScript module.
  const {releaseRelay}=await import('../scripts/release-relay/server.mjs') as {releaseRelay(key:string,latest:()=>Promise<string>,cacheMs:number):Server};
  let upstream='0.0.9';
  const key='test-only', server=releaseRelay(key,async()=>upstream,500);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/t3-obsidian/releases';
  t.after(()=>{server.closeAllConnections();server.close();});
  const stream=async()=>{
    const response=await fetch(url);
    assert.equal(response.headers.get('content-type'),'text/event-stream');
    return response.body!.getReader();
  };
  const frame=async (reader:ReadableStreamDefaultReader<Uint8Array>)=>Buffer.from((await reader.read()).value!).toString();
  const reader=await stream();
  assert.equal(await frame(reader),'data: 0.0.9\n\n');
  async function publish(tag:string, secret=key, prerelease=false, repo='7bgsbm749g-boop/t3-obsidian', event='release', draft=false){
    const body=JSON.stringify({action:'published',repository:{full_name:repo},release:{tag_name:tag,draft,prerelease}});
    return (await fetch(url+'/hook',{method:'POST',body,headers:{'x-github-event':event,'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')}})).status;
  }
  assert.equal(await publish('0.0.12','wrong'),403);
  assert.equal(await publish('0.0.11',key,true),204);
  assert.equal(await publish('0.0.12',key,false,'another/repo'),204);
  assert.equal(await publish('0.0.12',key,false,undefined,'ping'),204);
  assert.equal(await publish('0.0.12',key,false,undefined,'release',true),204);
  assert.equal(await publish('0.0.10'),204);
  assert.equal(await frame(reader),'data: 0.0.10\n\n');
  await reader.cancel();
  assert.equal(await publish('0.0.9'),204);
  const next=await stream();
  assert.equal(await frame(next),'data: 0.0.10\n\n');
  // A connection inside the shared cache window must still recover the miss.
  upstream='0.0.12';
  const recovered=await stream();
  assert.equal(await frame(next),'data: 0.0.12\n\n');
  await recovered.cancel();
  await next.cancel();
});

test('a publication during the first GitHub lookup wins over an older snapshot',{timeout:5000},async t=>{
  // @ts-expect-error The standalone Node service is a JavaScript module.
  const {releaseRelay}=await import('../scripts/release-relay/server.mjs') as {releaseRelay(key:string,readLatest:()=>Promise<string>):Server};
  let snapshot!:(version:string)=>void,started!:()=>void;
  const reading=new Promise<void>(resolve=>{started=resolve;});
  const server=releaseRelay('key',()=>{started();return new Promise(resolve=>{snapshot=resolve;});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/t3-obsidian/releases';
  const connecting=fetch(url);await reading;
  const body=JSON.stringify({repository:{full_name:'7bgsbm749g-boop/t3-obsidian'},action:'published',release:{draft:false,prerelease:false,tag_name:'0.0.10'}});
  const signature='sha256='+createHmac('sha256','key').update(body).digest('hex');
  assert.equal((await fetch(url+'/hook',{method:'POST',body,headers:{'x-hub-signature-256':signature,'x-github-event':'release'}})).status,204);
  snapshot('0.0.9');
  const reader=(await connecting).body!.getReader();
  assert.equal(Buffer.from((await reader.read()).value!).toString(),'data: 0.0.10\n\n');
  await reader.cancel();
});

test('a subscription during a stale in-flight lookup gets a shared follow-up snapshot',{timeout:5000},async t=>{
  // @ts-expect-error The standalone Node service is a JavaScript module.
  const {releaseRelay}=await import('../scripts/release-relay/server.mjs') as {releaseRelay(key:string,readLatest:()=>Promise<string>,cacheMs:number):Server};
  let snapshot!:(version:string)=>void, started!:()=>void, reads=0;
  const reading=new Promise<void>(resolve=>{started=resolve;});
  const server=releaseRelay('key',async()=>{
    if(++reads>1)return '0.0.10';
    started();return new Promise(resolve=>{snapshot=resolve;});
  },100);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/t3-obsidian/releases';
  const first=fetch(url);await reading;
  const request=once(server,'request');const second=fetch(url);await request;
  snapshot('0.0.9');
  for(const response of await Promise.all([first,second])){
    const reader=response.body!.getReader();let data='';
    while(!data.includes('data: 0.0.10'))data+=Buffer.from((await reader.read()).value!).toString();
    assert.ok(data.includes('data: 0.0.9'));await reader.cancel();
  }
  assert.equal(reads,2);
});
