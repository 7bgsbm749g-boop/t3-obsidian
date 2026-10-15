import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {contentHash} from '../completion';
import {ensurePrivateStorage,existingPrivateStorage} from '../private-storage-desktop';
import {readPrivateStorageRoute,privateStorageResolver} from '../private-storage';
import {type ResponseStorageFiles} from '../response-record';
async function fixture(){const root=await fs.mkdtemp(join(tmpdir(),'t3-storage-lifecycle-')),vault=join(root,'vault'),privateRoot=join(root,'private');await fs.mkdir(vault);return {root,vault,privateRoot,close:()=>fs.rm(root,{recursive:true,force:true})};}

test('an existing remote connection follows a newly published private route',async()=>{
  let raw:string|undefined;const resolve=privateStorageResolver(async()=>raw,'/vault','.obsidian');
  assert.equal(await resolve(),'/vault');raw=JSON.stringify({version:1,workspaceRoot:'/vault',configDir:'.obsidian',storageRoot:'/private'});assert.equal(await resolve(),'/private');raw=undefined;assert.equal(await resolve(),'/private');
});
test('a failed cross-volume copy restores the original and never publishes a route',async t=>{
  const h=await fixture(),source=join(h.vault,'.obsidian/t3-code/commands/v1'),rename=fs.rename;try{await fs.mkdir(source,{recursive:true});await fs.writeFile(join(source,'pending.json'),'Pending private bytes');t.mock.method(fs,'rename',async(...args:any[])=>{if(args[0]===source&&args[1]!==source+'.private-migration')throw Object.assign(Error('Different volume'),{code:'EXDEV'});return (rename as any)(...args);});t.mock.method(fs,'copyFile',async()=>{throw Error('Disk full');});await assert.rejects(ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot}),/Disk full/);assert.equal(await fs.readFile(join(source,'pending.json'),'utf8'),'Pending private bytes');assert.equal(await existingPrivateStorage(h.vault,'.obsidian'),undefined);t.mock.restoreAll();assert.ok(await ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot}));}finally{t.mock.restoreAll();await h.close();}
});
test('restart resumes a cross-volume migration stopped before destination publication',async()=>{
  const h=await fixture(),source=join(h.vault,'.obsidian/t3-code/commands/v1');try{await fs.mkdir(source+'.private-migration',{recursive:true});await fs.writeFile(join(source+'.private-migration','pending.json'),'Retained command');const route=await ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot});assert.equal(await fs.readFile(join(route.storageRoot,'.obsidian/t3-code/commands/v1/pending.json'),'utf8'),'Retained command');await assert.rejects(fs.access(source+'.private-migration'),/ENOENT/);}finally{await h.close();}
});
test('different-filesystem migration verifies its copy before removing the frozen source',async t=>{
  const h=await fixture(),source=join(h.vault,'.obsidian/t3-code/commands/v1'),rename=fs.rename;try{
    await fs.mkdir(join(source,'requests'),{recursive:true});await fs.writeFile(join(source,'requests/pending.json'),'Unresolved command');
    t.mock.method(fs,'rename',async(...args:any[])=>{if(args[0]===source&&String(args[1]).startsWith(h.privateRoot)){const error:any=Error('Other filesystem');error.code='EXDEV';throw error;}return (rename as any)(...args);});
    await ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot});assert.equal(await fs.readFile(join(h.privateRoot,'.obsidian/t3-code/commands/v1/requests/pending.json'),'utf8'),'Unresolved command');await assert.rejects(fs.access(source+'.private-migration'),/ENOENT/);
  }finally{t.mock.restoreAll();await h.close();}
});
test('invalid routes and private locations inside a vault are rejected before any move',async()=>{
  const h=await fixture();try{
    await assert.rejects(ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:join(h.vault,'private')}),/outside/);
    assert.throws(()=>readPrivateStorageRoute(JSON.stringify({version:1,workspaceRoot:h.vault,configDir:'.obsidian',storageRoot:h.vault+'/inside'}),h.vault,'.obsidian'),/Invalid/);
    assert.equal(await existingPrivateStorage(h.vault,'.obsidian'),undefined);
  }finally{await h.close();}
});
