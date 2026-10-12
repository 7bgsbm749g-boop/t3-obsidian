import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveLegacyReplyImports} from '../legacy-reply-imports-desktop';
import {validateClientCommand} from '../client-command';

async function fixture(){
 const root=await fs.mkdtemp(join(tmpdir(),'t3-reply-archive-')),vaultRoot=join(root,'vault'),projectRoot=join(root,'project'),path='T3 Code Attachments/12345678-1234-1234-1234-123456789abc/0123456789abcdef-report.json';
 await fs.mkdir(join(vaultRoot,path,'..'),{recursive:true});await fs.mkdir(projectRoot);await fs.writeFile(join(vaultRoot,path),'original');
 const file:any={path},folder:any={path:path.slice(0,path.lastIndexOf('/')),children:[file]},top:any={path:'T3 Code Attachments',children:[folder]},items=new Map([[file.path,file],[folder.path,folder],[top.path,top]]);file.parent=folder;folder.parent=top;
 const app:any={workspace:{iterateAllLeaves:()=>{}},vault:{adapter:{getBasePath:()=>vaultRoot},getAbstractFileByPath:(path:string)=>items.get(path)??null,readBinary:async(file:any)=>{const bytes=await fs.readFile(join(vaultRoot,file.path));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);},delete:async(item:any)=>{assert.ok(!('children' in item),'The native Vault.delete file API must not receive a folder');await fs.unlink(join(vaultRoot,item.path));items.delete(item.path);if(item.parent)item.parent.children=item.parent.children.filter((child:any)=>child!==item);}}};
 return {app,root,vaultRoot,projectRoot,path,file,scope:{environmentId:'env',projectId:'project',root:projectRoot,title:'Project'},close:()=>fs.rm(root,{recursive:true,force:true})};
}
test('archive persists identities before removing checked vault bytes and empty folders',async()=>{
 const h=await fixture();try{
  const result=await archiveLegacyReplyImports(h.app,h.scope,'evidence/old-replies',async copies=>{assert.equal(await fs.readFile(join(h.vaultRoot,h.path),'utf8'),'original');assert.equal(await fs.readFile(join(h.projectRoot,copies[0].path),'utf8'),'original');});
  assert.equal(result.removed,1);assert.equal(await fs.readFile(join(h.projectRoot,'evidence/old-replies',h.path),'utf8'),'original');await assert.rejects(fs.stat(join(h.vaultRoot,'T3 Code Attachments')),/ENOENT/);
 }finally{await h.close();}
});
test('metadata failure preserves vault imports and an exact retry reuses the archive',async()=>{
 const h=await fixture();try{
  await assert.rejects(archiveLegacyReplyImports(h.app,h.scope,'archive',async()=>{throw Error('settings failed');}),/settings failed/);assert.equal(await fs.readFile(join(h.vaultRoot,h.path),'utf8'),'original');
  assert.equal((await archiveLegacyReplyImports(h.app,h.scope,'archive',async()=>{})).removed,1);
 }finally{await h.close();}
});
test('empty legacy folders are removed even while native folder child lists are stale',async()=>{
 const h=await fixture();try{
  await fs.unlink(join(h.vaultRoot,h.path));const folder=h.file.parent;folder.children=[];
  const result=await archiveLegacyReplyImports(h.app,h.scope,'archive',async()=>{});assert.equal(result.files,0);await assert.rejects(fs.stat(join(h.vaultRoot,'T3 Code Attachments')),/ENOENT/);
 }finally{await h.close();}
});
test('a new unrelated file prevents folder pruning without deleting the new file',async()=>{
 const h=await fixture();try{
  const added=join(h.vaultRoot,'T3 Code Attachments','user-file.txt');
  await assert.rejects(archiveLegacyReplyImports(h.app,h.scope,'archive',async()=>{await fs.writeFile(added,'user content');}),/ENOTEMPTY/);
  assert.equal(await fs.readFile(added,'utf8'),'user content');assert.equal(await fs.readFile(join(h.projectRoot,'archive',h.path),'utf8'),'original');
 }finally{await h.close();}
});
for(const scenario of ['changed source','changed archive','symlink','unrelated file','open file','inside vault'])test(`archive preserves imports when it finds ${scenario}`,async()=>{
 const h=await fixture();try{
  let scope=h.scope;
  if(scenario==='symlink'){await fs.symlink(h.vaultRoot,join(h.projectRoot,'archive'));}
  if(scenario==='unrelated file')h.file.path='T3 Code Attachments/personal.txt';
  if(scenario==='open file')h.app.workspace.iterateAllLeaves=(visit:any)=>visit({view:{file:h.file}});
  if(scenario==='inside vault')scope={...h.scope,root:h.vaultRoot};
  await assert.rejects(archiveLegacyReplyImports(h.app,scope,'archive',async copies=>{
   if(scenario==='changed source')await fs.writeFile(join(h.vaultRoot,h.path),'user update');
   if(scenario==='changed archive')await fs.writeFile(join(h.projectRoot,copies[0].path),'external update');
  }));
  assert.ok(await fs.stat(join(h.vaultRoot,h.path)));
 }finally{await h.close();}
});
test('archive commands reject missing identities, traversal and archive options on read-only commands',()=>{
 const base={version:1,id:'12345678-1234-1234-1234-123456789abc',kind:'archive-reply-imports',projectId:'p',environmentId:'e',archiveDirectory:'evidence/archive'};
 assert.equal(validateClientCommand(base),base);
 for(const archiveDirectory of ['', '../outside','/outside','one\\two','one//two'])assert.throws(()=>validateClientCommand({...base,archiveDirectory}));
 assert.throws(()=>validateClientCommand({...base,projectId:undefined}));assert.throws(()=>validateClientCommand({...base,kind:'client-status'}));
});
