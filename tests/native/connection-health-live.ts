/** Read-only relay test: delayed frames stay valid; explicit close cancels. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectT3Rpc} from '../../src/connection/t3-rpc';
import {environmentApi} from '../../src/connection/direct';
import {requireEvidenceDirectory} from '../../scripts/evidence-paths.mjs';

async function main(){
 const evidence=await requireEvidenceDirectory(process.argv[2]??'','Private evidence directory required.');await mkdir(evidence,{recursive:true});
 const [settingsPath,cli,base,vaultRoot,environmentId]=process.argv.slice(3);
 if(!settingsPath||!cli||!base||!vaultRoot||!environmentId)throw Error('Supply private settings, CLI, T3 home, vault root and environment ID arguments.');
 const settings=JSON.parse(await readFile(settingsPath,'utf8')),paired=settings.paired.find((c:any)=>c.environmentId===environmentId);
 if(!paired)throw Error('The requested paired environment is not configured.');
 const issued=JSON.parse(execFileSync(cli,['auth','session','issue','--base-dir',base,'--ttl','5m','--label','connection-health-read-only-validation','--json','--scope','filesystem:read'],{encoding:'utf8'}));
 let drop=false;const held:Array<()=>void>=[];
 const socket=(url:string)=>{
  const ws=new WebSocket(url);
  return new Proxy(ws,{get:(target,key)=>{const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},set:(target,key,value)=>{
   if(key==='onmessage')target.onmessage=event=>{
    if(!drop){value(event);return;}
    const decoded=JSON.parse(String(event.data)),frames=Array.isArray(decoded)?decoded:[decoded];
    const health=frames.filter(frame=>frame?._tag==='Ping'||frame?._tag==='Pong'),results=frames.filter(frame=>frame?._tag!=='Ping'&&frame?._tag!=='Pong');
    if(health.length)value(new MessageEvent('message',{data:JSON.stringify(health)}));
    if(results.length)held.push(()=>value(new MessageEvent('message',{data:JSON.stringify(results)})));
   };
   else Reflect.set(target,key,value,target);return true;
  }});
 };
 let rpc:Awaited<ReturnType<typeof connectT3Rpc>>|undefined,fresh:Awaited<ReturnType<typeof connectT3Rpc>>|undefined;
 try{
  const api=await environmentApi({transport:'direct',host:'direct',executable:'',url:paired.url,environmentId:paired.environmentId},{url:paired.url,environmentId:paired.environmentId,token:issued.token,expiresAt:Date.parse(issued.expiresAt)},globalThis.fetch);
  rpc=await connectT3Rpc(api,paired.url,socket);const payload={cwd:vaultRoot,relativePath:'.obsidian/t3-code/vault-identity.json'};
  const start=performance.now();await rpc.call('projects.readFile',payload);const initialReadMs=performance.now()-start;
  drop=true;const delayedAt=performance.now();let settled=false;
  const delayed=rpc.call('projects.readFile',payload).then(value=>{settled=true;return value;});
  const delayedMs=35_000;await new Promise(resolve=>setTimeout(resolve,delayedMs));
  assert.equal(settled,false);assert.equal(rpc.closed,false);assert.ok(held.length>0,'Retain actual server frames for this owned socket.');
  drop=false;for(const deliver of held.splice(0))deliver();await delayed;
  const acceptedLateMs=performance.now()-delayedAt;
  drop=true;const cancelled=assert.rejects(rpc.call('projects.readFile',payload),/closed/i);rpc.close();await cancelled;
  drop=false;fresh=await connectT3Rpc(api,paired.url);const freshAt=performance.now();await fresh.call('projects.readFile',payload);
  const result={at:new Date().toISOString(),status:'passed',transport:'real authenticated relay file RPC; frames delayed on this test socket only',initialReadMs,acceptedLateMs,explicitCloseCancelled:true,freshReadMs:performance.now()-freshAt,coverage:{realRelay:true,providerDispatch:false,nativeWindows:false,nativeMobile:false}};
  await writeFile(join(evidence,'real-relay-health.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{rpc?.close();fresh?.close();execFileSync(cli,['auth','session','revoke','--base-dir',base,issued.sessionId],{stdio:'pipe'});}
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
