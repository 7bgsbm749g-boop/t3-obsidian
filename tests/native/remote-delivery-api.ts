/** Real file RPC preconditions for the isolated desktop delivery regression. */
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {T3_RESPONSE_MAX_BYTES} from '../../src/connection/t3-response-limits';
import {environmentApi} from '../../src/connection/direct';
import {connectT3Rpc,T3RpcError} from '../../src/connection/t3-rpc';
import {connectVaultRemote} from '../../src/connection/vault-connection';
import {identityPathForSettings} from '../../src/app/vault-identity';
import {requireEvidenceDirectory} from '../../scripts/evidence-paths.mjs';

const officialCli=(args:string[])=>new Promise<string>((resolve,reject)=>{
  execFile('/home/ubuntu/.local/bin/t3',args,{shell:false,windowsHide:true,timeout:45_000,maxBuffer:T3_RESPONSE_MAX_BYTES,encoding:'utf8'},(error,stdout)=>error?reject(Error('The official T3 test command failed; credential output withheld.')):resolve(stdout));
});

async function main(){
  const evidence=await requireEvidenceDirectory(process.argv[2]??'','Supply a private lab directory and before/after phase.'),phase=process.argv[3];
  if(!['before','after'].includes(phase))throw Error('Supply a private lab directory and before/after phase.');
  const lab=JSON.parse(await readFile(join(evidence,'LAB.json'),'utf8')),local=JSON.parse(await readFile(join(evidence,'credential-b.json'),'utf8'));
  const session=local.pairedSessions[lab.connectionId],connection={transport:'direct' as const,host:'direct',executable:'',url:session.url,environmentId:lab.environmentId};
  const settingsPath='.obsidian/plugins/send-to-t3-code/data.json',rpc=await connectT3Rpc(await environmentApi(connection,session),session.url),remote=await connectVaultRemote(connection,session);
  const result:any={phase,at:new Date().toISOString(),hostRoot:lab.hostRoot,sourceRoot:lab.sourceRoot,transport:'authenticated projects.readFile RPC, separate vault roots'};
  try{
    const file=await rpc.call('projects.readFile',{cwd:lab.hostRoot,relativePath:settingsPath});
    assert.ok(file&&typeof file==='object'&&'byteLength' in file&&'contents' in file&&typeof file.contents==='string'&&'truncated' in file);
    result.settings={byteLength:file.byteLength,returnedBytes:Buffer.byteLength(file.contents),truncated:file.truncated};assert.equal(file.truncated,true,'The old fault requires settings larger than the real T3 limit.');
    if(phase==='before'){
      await assert.rejects(rpc.call('projects.readFile',{cwd:lab.hostRoot,relativePath:identityPathForSettings(settingsPath)}),(e:any)=>e.kind==='ProjectReadFileError');
      // The current reader also rejects this old host, with an actionable error.
      await assert.rejects(remote.matches(lab.hostRoot,settingsPath,lab.vaultId),/Update and reload/);result.oldHostRejected=true;
    }else{
      assert.equal(await remote.matches(lab.hostRoot,settingsPath,lab.vaultId),true);result.vaultIdentityVerified=true;
      try{await remote.writeFile(evidence,'synthetic-rpc.tmp','synthetic');assert.equal(await remote.readFile(evidence,'synthetic-rpc.tmp'),'synthetic');result.writeReadVerified=true;}finally{await rm(join(evidence,'synthetic-rpc.tmp'),{force:true});}
    }
  }finally{rpc.close();remote.close();}
  const issued=JSON.parse(await officialCli(['auth','session','issue','--base-dir','/home/ubuntu/.t3','--ttl','5m','--label','synthetic-old-grant-negative-test','--json','--scope','orchestration:read','--scope','orchestration:operate']));
  const old=await connectVaultRemote(connection,{...session,token:issued.token,expiresAt:Date.parse(issued.expiresAt)});
  try{await assert.rejects(old.matches(lab.hostRoot,settingsPath,lab.vaultId),(e:any)=>e instanceof T3RpcError&&e.requiredPermission==='filesystem:read');result.oldGrantsRejected=true;}finally{old.close();await officialCli(['auth','session','revoke','--base-dir','/home/ubuntu/.t3',issued.sessionId]);}
  await writeFile(join(evidence,`api-${phase}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
void main().catch(error=>{console.error(JSON.stringify({message:error.message,kind:error.kind,rpcMethod:error.rpcMethod}));process.exitCode=1;});
