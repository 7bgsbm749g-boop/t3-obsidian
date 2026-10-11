import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {localInlineFiles} from '../hosted-inline-desktop';

test('body evidence reads stay transient while unchanged small metadata still uses the byte cache',async t=>{
 const root=await fs.mkdtemp(join(tmpdir(),'inline-evidence-retention-')),directory='.obsidian/t3-code/inline/v1',storage=join(root,'private'),files=localInlineFiles(join(root,'vault'),directory,storage),body='Completed recovery bytes '.repeat(10000),read=fs.readFile,reads=new Map<string,number>();
 const paths=['leases/id.json','materializations/id/commit.json','originals/id.md','staged-results/id/hash.md','stopped-bodies/id/hash.txt'].map(path=>directory+'/'+path),metadata=directory+'/routes/id.json';
 try{
  for(const path of paths)await files.write(path,body);await files.write(metadata,'{"id":"binding"}');
  t.mock.method(fs,'readFile',async(...args:any[])=>{const path=String(args[0]);if(path.startsWith(storage))reads.set(path,(reads.get(path)??0)+1);return (read as any)(...args);});
  for(const path of paths){assert.equal(await files.read(path),body);assert.equal(await files.read(path),body);assert.equal(reads.get(join(storage,path)),2);}
  assert.equal(await files.read(metadata),'{"id":"binding"}');assert.equal(await files.read(metadata),'{"id":"binding"}');assert.equal(reads.get(join(storage,metadata)),1);
  await files.write(paths[1],'Changed evidence');assert.equal(await files.read(paths[1]),'Changed evidence');assert.equal(reads.get(join(storage,paths[1])),3);
 }finally{t.mock.restoreAll();await files.remove(metadata);await files.close?.();await fs.rm(root,{recursive:true,force:true});}
});
