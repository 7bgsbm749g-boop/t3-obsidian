/** Bounded read-only test of the real T3 relay and a silently broken socket. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {connectT3Rpc,T3ConnectionTimeoutError} from '../t3-rpc';
import {environmentApi} from '../direct';

async function main(){
 const evidence=resolve(process.argv[2]??'');if(!evidence.startsWith('/home/ubuntu/backups/send-to-t3-code/'))throw Error('Private evidence directory required.');await mkdir(evidence,{recursive:true});
 const settings=JSON.parse(await readFile('/home/ubuntu/vaults/QLO2/.obsidian/plugins/send-to-t3-code/data.json','utf8')),paired=settings.paired.find((c:any)=>c.environmentId==='3630e7fa-f1df-4631-b5a2-6086ddaf28a1');
 const cli='/home/ubuntu/.local/bin/t3',base='/home/ubuntu/.t3',issued=JSON.parse(execFileSync(cli,['auth','session','issue','--base-dir',base,'--ttl','5m','--label','connection-health-read-only-validation','--json','--scope','filesystem:read'],{encoding:'utf8'}));
 let drop=false,pongs=0;
 const socket=(url:string)=>{
  const ws=new WebSocket(url);
  return new Proxy(ws,{get:(target,key)=>{const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},set:(target,key,value)=>{
   if(key==='onmessage')target.onmessage=event=>{if(drop)return;try{const frames=JSON.parse(String(event.data));pongs+=(Array.isArray(frames)?frames:[frames]).filter((f:any)=>f._tag==='Pong').length;}catch{}value(event);};
   else Reflect.set(target,key,value,target);return true;
  }});
 };
 let rpc:Awaited<ReturnType<typeof connectT3Rpc>>|undefined,fresh:Awaited<ReturnType<typeof connectT3Rpc>>|undefined;
 try{
  const api=await environmentApi({transport:'direct',host:'direct',executable:'',url:paired.url,environmentId:paired.environmentId},{url:paired.url,environmentId:paired.environmentId,token:issued.token,expiresAt:Date.parse(issued.expiresAt)});
  rpc=await connectT3Rpc(api,paired.url,socket);const payload={cwd:'/home/ubuntu/vaults/QLO2',relativePath:'.obsidian/t3-code/vault-identity.json'};
  const start=performance.now();await rpc.call('projects.readFile',payload);const initialReadMs=performance.now()-start;
  await new Promise(resolve=>setTimeout(resolve,5500));assert.ok(pongs>0,'The actual server must answer the client Ping.');
  drop=true;const brokenAt=performance.now();let failure:T3ConnectionTimeoutError|undefined;
  await assert.rejects(rpc.call('projects.readFile',payload),(error:any)=>{failure=error;return error instanceof T3ConnectionTimeoutError;});assert.equal(rpc.closed,true);
  const confirmedDeadMs=performance.now()-brokenAt;
  drop=false;fresh=await connectT3Rpc(api,paired.url);const freshAt=performance.now();await fresh.call('projects.readFile',payload);
  const result={at:new Date().toISOString(),status:'passed',transport:'real authenticated relay file RPC; incoming frames discarded on this test socket only',initialReadMs,pongs,confirmedDeadMs,timeout:{kind:failure!.kind,method:failure!.rpcMethod,elapsedMs:failure!.elapsedMs,idleMs:failure!.idleMs},freshReadMs:performance.now()-freshAt,coverage:{realRelay:true,providerDispatch:false,nativeWindows:false,nativeMobile:false}};
  await writeFile(join(evidence,'real-relay-health.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{rpc?.close();fresh?.close();execFileSync(cli,['auth','session','revoke','--base-dir',base,issued.sessionId],{stdio:'pipe'});}
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
