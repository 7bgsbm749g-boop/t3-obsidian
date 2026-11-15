import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function helper(endpoint:string,packageName='md.obsidian',exception=false){
  const source=(await readFile('scripts/mobile-cdp.mjs','utf8')).replace(/^import .*;$/m,'');
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  const writes:string[]=[],requests:any[]=[],sockets:any[]=[];
  const fetcher=async(url:string)=>{requests.push(url);return {json:async()=>url.endsWith('/json/version')?{'Android-Package':packageName}:[{type:'page',title:'Test note - Obsidian',url:'http://localhost/',webSocketDebuggerUrl:'ws://127.0.0.1:1234/owned'}]};};
  class Socket {
    listeners=new Map<string,Array<(event:any)=>void>>();closed=false;
    constructor(_url:string){sockets.push(this);queueMicrotask(()=>this.emit('open',{}));}
    addEventListener(name:string,fn:(event:any)=>void){const list=this.listeners.get(name)??[];list.push(fn);this.listeners.set(name,list);}
    emit(name:string,event:any){for(const fn of this.listeners.get(name)??[])fn(event);}
    send(value:string){const request=JSON.parse(value);assert.equal(request.method,'Runtime.evaluate');queueMicrotask(()=>this.emit('message',{data:JSON.stringify({id:request.id,result:exception?{exceptionDetails:{text:'Synthetic fixture failed'}}:{result:{value:4}}})}));}
    close(){this.closed=true;}
  }
  const execute=()=>new AsyncFunction('process','fetch','WebSocket','readFile',source)({argv:['node','helper',endpoint,'owned-expression.js'],stdout:{write:(value:string)=>writes.push(value)}},fetcher,Socket,async()=> '2+2');
  return {execute,writes,requests,sockets};
}

test('mobile debugging rejects non-loopback endpoints before opening any connection',async()=>{
  const h=await helper('https://example.com');await assert.rejects(h.execute(),/loopback/);assert.equal(h.requests.length,0);assert.equal(h.sockets.length,0);
});
test('mobile debugging rejects another Android package before opening its WebSocket',async()=>{
  const h=await helper('http://127.0.0.1:1234','com.android.chrome');await assert.rejects(h.execute(),/does not belong/);assert.equal(h.sockets.length,0);
});
test('mobile debugging accepts changing note titles and closes the owned connection after a result',async()=>{
  const h=await helper('http://127.0.0.1:1234');await h.execute();assert.equal(h.writes.join(''),'4\n');assert.ok(h.sockets[0].closed);
});
test('mobile debugging reports fixture exceptions and still closes the owned connection',async()=>{
  const h=await helper('http://127.0.0.1:1234','md.obsidian',true);await assert.rejects(h.execute(),/Synthetic fixture failed/);assert.ok(h.sockets[0].closed);
});
test('the native mobile recovery fixture refuses a production vault before accessing plugins',async()=>{
  const source=await readFile('tests/native/mobile-recovery-lab.js','utf8');
  assert.throws(()=>runInNewContext(source,{app:{vault:{getName:()=> 'QLO2'}}}),/isolated mobile lab/);
});
