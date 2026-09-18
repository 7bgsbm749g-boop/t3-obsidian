import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {uuid5,canonical,start,cli,parseOperation,requestJson} from '../desktop';
const id='98e4d70e-cbd5-4a23-aad0-a50732a59bf2';
test('native IDs and fingerprints match old durable requests',()=>{
 assert.equal(uuid5(id,'thread'),'6732c96c-84e7-5252-8c8a-ce9bb2d9ad50');
 assert.equal(canonical({z:'🧪',a:['é',true]}),'{"a": ["\\u00e9", true], "z": "\\ud83e\\uddea"}');
 assert.throws(()=>parseOperation(['rpc'],''));
 const r=parseOperation(['start','--project','p','--title','$(touch /tmp/unsafe); `whoami`','--request-id',id,'--prompt-file','-'],'🧪');assert.equal(r.prompt,'🧪');
});
test('durable native retry replays identical commands after a lost response',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-ledger-'));let fail=true;const calls:any[]=[];
 const api=async(path:string,payload?:any)=>{if(path==='shell')return {projects:[{id:'p',defaultModelSelection:{instanceId:'codex',model:'default'}}],threads:[]};calls.push(payload);if(payload.type==='thread.turn.start'&&fail){fail=false;throw Error('lost ack');}return {};};
 const req={action:'start',requestId:id,project:'p',title:'T',prompt:'🧪',attachments:[{id:'i',dataUrl:'data:image/png;base64,YQ=='}],context:{version:1}};
 try{
 await assert.rejects(start(api,req,dir),/lost ack/);
 const result=await start(api,req,dir);assert.equal(result.phase,'started');assert.equal(calls.length,3);assert.deepEqual(calls[1],calls[2]);assert.deepEqual(calls[2].message.attachments,req.attachments);
 await start(api,req,dir);assert.equal(calls.length,3);
 await assert.rejects(start(api,{...req,prompt:'changed'},dir),/different parameters/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('official CLI receives literal arguments with no shell',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-cli-'));
 try{const path=join(dir,'CLI with spaces.cjs');await writeFile(path,'console.log(JSON.stringify(process.argv.slice(2)))');const args=['$(touch /tmp/unsafe)','`whoami`','; & "quoted"'];assert.deepEqual(JSON.parse(await cli([process.execPath,path],args)),args);}finally{await rm(dir,{recursive:true,force:true});}
});
test('direct HTTP refuses remote origins and does not follow credential redirects',async()=>{
 assert.throws(()=>requestJson('https://example.com','secret','shell'),/loopback/);
 const server=createServer((_req,res)=>{res.writeHead(302,{Location:'http://example.com'});res.end();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const port=(server.address() as any).port;await assert.rejects(requestJson('http://127.0.0.1:'+port,'secret','shell'),/302/);}finally{server.close();}
});
