import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectCommandFiles} from '../src/notes/connect-command-files';
function fixture(){const data=new Map<string,string>(),calls:string[]=[],root='/scratch',base='.t3-obsidian/clients/test/payload.json';let truncate=false;
 const files=connectCommandFiles({call:async(tag,input:any)=>{calls.push(tag);assert.equal(input.cwd,root);if(tag==='projects.writeFile'){data.set(input.relativePath,input.contents);return {};}
 if(tag==='projects.readFile'){if(!data.has(input.relativePath))throw {kind:'ProjectReadFileError'};return {contents:data.get(input.relativePath),truncated:truncate};}
 if(tag==='projects.listEntries')return {entries:[...data.keys()].map(path=>({kind:'file',path}))};throw Error('unsupported');}},root);
 return {files,data,calls,base,truncate:()=>truncate=true};}
test('large UTF-8 snapshots round-trip with checksum-addressed bounded chunks, without delete RPC',async()=>{
 const f=fixture(),text='😀漢字\n'.repeat(30_000);await f.files.write(f.base,text);assert.ok(f.data.size>10);assert.equal(await f.files.read(f.base),text);assert.ok(f.calls.every(call=>['projects.readFile','projects.writeFile'].includes(call)));
 const part=[...f.data.keys()].find(key=>key.endsWith('/0.txt'))!;f.data.set(part,Buffer.from('changed').toString('base64'));await assert.rejects(f.files.read(f.base),/changed/);
});
test('partial, truncated, oversized and traversal payloads fail closed',async()=>{
 const f=fixture();assert.equal(await f.files.read(f.base),undefined);await assert.rejects(f.files.write('../bad','x'),/path/);await assert.rejects(f.files.write(f.base,'x'.repeat(2_000_001)),/large/);
 await f.files.write(f.base,'x'.repeat(60_000));f.data.delete([...f.data.keys()].find(key=>key.endsWith('/1.txt'))!);await assert.rejects(f.files.read(f.base),/missing/);f.truncate();await assert.rejects(f.files.read(f.base),/complete/);
});
