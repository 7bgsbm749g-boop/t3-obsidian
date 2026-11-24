import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';


test('signed publication reaches connected clients and reconnecting clients receive latest', {timeout:10000}, async t => {
  // @ts-expect-error The standalone Node service is a JavaScript module.
  const {releaseRelay}=await import('../scripts/release-relay/server.mjs') as {releaseRelay(key:string,initial:string):Server};
  const key='test-only', server=releaseRelay(key,'0.0.9');
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
  async function publish(tag:string, secret=key, prerelease=false){
    const body=JSON.stringify({action:'published',repository:{full_name:'7bgsbm749g-boop/t3-obsidian'},release:{tag_name:tag,draft:false,prerelease}});
    return (await fetch(url+'/hook',{method:'POST',body,headers:{'x-github-event':'release','x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')}})).status;
  }
  assert.equal(await publish('0.0.12','wrong'),403);
  assert.equal(await publish('0.0.11',key,true),204);
  assert.equal(await publish('0.0.10'),204);
  assert.equal(await frame(reader),'data: 0.0.10\n\n');
  await reader.cancel();
  assert.equal(await publish('0.0.9'),204);
  const next=await stream();
  assert.equal(await frame(next),'data: 0.0.10\n\n');
  await next.cancel();
});
