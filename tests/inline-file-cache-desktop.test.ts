import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename,rm,lstat,utimes,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DesktopInlineReadCache,inlineFileVersion} from '../inline-file-cache-desktop';

test('fresh file versions detect same-size rewrites, replacements, deletion and symlink targets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inline-file-version-')),path=join(root,'record.json'),other=join(root,'other.json'),date=new Date('2026-01-01T00:00:00Z');
 try{
  await writeFile(path,'old!');await utimes(path,date,date);const first=await inlineFileVersion(path);assert.ok(first);assert.equal(await inlineFileVersion(path),first);
  await writeFile(path,'new!');await utimes(path,date,date);const changed=await inlineFileVersion(path);assert.notEqual(changed,first);
  await writeFile(other,'new!');await utimes(other,date,date);await rename(other,path);assert.notEqual(await inlineFileVersion(path),changed);
  await rm(path);assert.equal(await inlineFileVersion(path),undefined);
  await writeFile(other,'link');await symlink(other,path);assert.equal(await inlineFileVersion(path),undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('unchanged reads reuse bytes while same-size, same-mtime edits, replacements and deletion remain fresh',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inline-byte-cache-')),path=join(root,'record.json'),date=new Date('2026-01-01T00:00:00Z'),cache=new DesktopInlineReadCache();
 try{
  await writeFile(path,'old!');await utimes(path,date,date);const before=await lstat(path,{bigint:true});
  for(let i=0;i<40;i++)assert.equal(await cache.read(path),'old!');
  assert.equal(cache.status().sourceReads,1);assert.equal(cache.status().hits,39);
  await writeFile(path,'new!');await utimes(path,date,date);const after=await lstat(path,{bigint:true});
  assert.equal(after.mtimeNs,before.mtimeNs);assert.equal(after.size,before.size);assert.notEqual(after.ctimeNs,before.ctimeNs);
  assert.equal(await cache.read(path),'new!');assert.equal(cache.status().sourceReads,2);
  const replacement=join(root,'replacement.json');await writeFile(replacement,'next');await utimes(replacement,date,date);await rename(replacement,path);
  assert.equal(await cache.read(path),'next');assert.equal(cache.status().sourceReads,3);
  await rm(path);assert.equal(await cache.read(path),undefined);assert.equal(cache.status().entries,0);
  await writeFile(path,'last');assert.equal(await cache.read(path),'last');assert.equal(cache.status().sourceReads,4);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a write during the source read cannot publish stale bytes into the cache',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inline-byte-race-')),path=join(root,'record.json');let race=true;
 const cache=new DesktopInlineReadCache(100,2,async file=>{const bytes=await readFile(file,'utf8');if(race){race=false;await writeFile(file,'after!');}return bytes;});
 try{
  await writeFile(path,'before');assert.equal(await cache.read(path),'before');assert.equal(cache.status().entries,0);
  assert.equal(await cache.read(path),'after!');assert.equal(await cache.read(path),'after!');assert.equal(cache.status().sourceReads,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('symlink contents are read afresh and do not reuse a former regular-file cache entry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inline-byte-link-')),path=join(root,'record.json'),target=join(root,'target.json'),cache=new DesktopInlineReadCache();
 try{
  await writeFile(path,'old!');assert.equal(await cache.read(path),'old!');
  await writeFile(target,'next');await rm(path);await symlink(target,path);assert.equal(await cache.read(path),'next');
  await writeFile(target,'last');assert.equal(await cache.read(path),'last');assert.equal(cache.status().entries,0);assert.equal(cache.status().sourceReads,3);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('source text and entry limits bound retained bytes, including oversized and empty files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inline-byte-limits-')),cache=new DesktopInlineReadCache(6,2);
 try{
  const paths=['a','b','c','large','empty'].map(name=>join(root,name));
  for(const [i,text] of ['aaa','bbb','ccc','oversized',''].entries())await writeFile(paths[i],text);
  await cache.read(paths[0]);await cache.read(paths[1]);await cache.read(paths[2]);
  assert.equal(cache.status().entries,2);assert.equal(cache.status().characters,6);
  assert.equal(await cache.read(paths[3]),'oversized');assert.equal(cache.status().characters,6);
  await cache.read(paths[4]);assert.ok(cache.status().entries<=2);assert.ok(cache.status().characters<=6);
  const reads=cache.status().sourceReads;await cache.read(paths[0]);assert.equal(cache.status().sourceReads,reads+1,'an evicted value requires a fresh source read');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('uncached recovery reads release previously retained bytes and always use the current file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inline-byte-transient-')),path=join(root,'record.json'),cache=new DesktopInlineReadCache();
 try{
  const body='Completed reply '.repeat(10000);await writeFile(path,body);assert.equal(await cache.read(path),body);assert.equal(cache.status().entries,1);
  assert.equal(await cache.read(path,false),body);assert.equal(cache.status().entries,0);assert.equal(cache.status().characters,0);
  await writeFile(path,'Changed completed reply');assert.equal(await cache.read(path,false),'Changed completed reply');assert.equal(cache.status().entries,0);assert.equal(cache.status().sourceReads,3);
  await rm(path);assert.equal(await cache.read(path,false),undefined);assert.equal(cache.status().characters,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
