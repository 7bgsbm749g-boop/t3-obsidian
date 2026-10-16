import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID,webcrypto} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {dirname} from 'node:path';
import {responseAnchor} from '../native-response-projection';
import type {ResponseRequest} from '../response-model';

test('browser bundle stages through desktop require without a native dynamic import loader',async()=>{
  const bundle=await build({entryPoints:['local-response-staging.ts'],bundle:true,external:['node:*'],platform:'browser',format:'cjs',target:'es2022',write:false});
  const required:string[]=[],realRequire=createRequire(import.meta.url),module={exports:{} as any};
  // Electron's CommonJS plugin evaluator has require, but no browser resolution
  // for import('node:fs'). This VM deliberately has no importModuleDynamically.
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:(name:string)=>{required.push(name);return realRequire(name);},crypto:webcrypto,TextEncoder,TextDecoder,Buffer,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})}});
  assert.equal(required.length,0,'Loading the shared mobile module must not load desktop built-ins');
  const request:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:randomUUID(),host:{environmentId:'env',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Smoke.md',threadId:randomUUID(),messageId:randomUUID(),projectId:randomUUID(),threadEnvironmentId:'env',initialHash:'a'.repeat(64),createdAt:new Date().toISOString()};
  const document=`SMOKE_FIELD: before\n\n${responseAnchor(request.id)}\n`,data=new Map<string,string>();
  const files={read:async(path:string)=>data.get(path),write:async(path:string,text:string)=>{data.set(path,text);}};
  const stage=await module.exports.localStageCommand('stage-note-edit',request,document,files);
  try{
    await fs.writeFile(stage.stagingPath,document.replace('SMOKE_FIELD: before','SMOKE_FIELD: after'));
    const submitted=await module.exports.localStageCommand('submit-note-edit',request,document,files,stage.originalHash);
    assert.equal(submitted.staged,true);assert.match(await module.exports.localStagedDraft(document,submitted.request,files),/^SMOKE_FIELD: after/);
    assert.ok(required.includes('node:fs'));assert.ok(required.includes('node:path'));assert.ok(required.includes('node:os'));
  }finally{await fs.rm(dirname(stage.stagingPath),{recursive:true,force:true});}
});
