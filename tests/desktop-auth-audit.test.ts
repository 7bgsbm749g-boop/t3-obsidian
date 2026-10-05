import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordDesktopAuth,DESKTOP_AUTH_AUDIT_MAX_BYTES} from '../desktop-auth-audit';

test('local credential audit retains closure reason and caller, excludes extra fields, and rotates bounded files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-auth-audit-')),path=join(root,'userdata/logs/obsidian-stream-auth.jsonl');
  const metadata={sessionId:'synthetic-session',component:'response-host' as const,issuedAt:Date.now(),expiresAt:Date.now()+300000};
  try{
    await Promise.all([
      recordDesktopAuth(root,{...metadata,event:'issued',token:'PRIVATE_TOKEN',prompt:'PRIVATE_PROMPT'} as any),
      recordDesktopAuth(root,{...metadata,event:'closing',reason:'auth-rejected',caller:['ThreadAccessCache.close']}),
    ]);
    const rows=(await readFile(path,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(rows.map(row=>row.event),['issued','closing']);assert.equal(rows[1].reason,'auth-rejected');assert.deepEqual(rows[1].caller,['ThreadAccessCache.close']);
    assert.doesNotMatch(await readFile(path,'utf8'),/PRIVATE_TOKEN|PRIVATE_PROMPT|token|prompt/);assert.equal((await stat(path)).mode&0o777,0o600);
    await writeFile(path,'x'.repeat(DESKTOP_AUTH_AUDIT_MAX_BYTES-1));
    await recordDesktopAuth(root,{...metadata,event:'revoke-completed',reason:'host-disposed'});
    assert.equal((await stat(path+'.1')).size,DESKTOP_AUTH_AUDIT_MAX_BYTES-1);assert.ok((await stat(path)).size<DESKTOP_AUTH_AUDIT_MAX_BYTES);
    assert.equal(JSON.parse((await readFile(path,'utf8')).trim()).reason,'host-disposed');
    await writeFile(path,'x'.repeat(DESKTOP_AUTH_AUDIT_MAX_BYTES-1));
    await recordDesktopAuth(root,{...metadata,event:'issued'});assert.ok((await stat(path)).size<DESKTOP_AUTH_AUDIT_MAX_BYTES);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('an unavailable audit path cannot fail credential operations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-auth-audit-failure-'));
  try{
    await writeFile(join(root,'userdata'),'not a directory');
    await recordDesktopAuth(root,{sessionId:'synthetic',component:'thread-reader',issuedAt:Date.now(),event:'closing',reason:'caller-closed'});
  }finally{await rm(root,{recursive:true,force:true});}
});
