import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DeviceInlineManager} from '../leased-inline';
import {connectVaultRemote} from '../vault-connection';
import {InlineLeaseAuthority,type LeaseFiles} from '../inline-lease';
import {initialRegion} from '../inline-thread';

test('a truncated historical lease does not close a shared RPC socket or abort concurrent registration',async()=>{
  const directory='.obsidian/t3-code/inline/v1',vaultId=randomUUID(),actor=randomUUID(),id=randomUUID(),identity={vaultId,environmentId:'host',workspaceRoot:'/vault',directory};
  const data=new Map<string,string>(),files:LeaseFiles={read:async path=>data.get(path),write:async(path,bytes)=>{data.set(path,bytes);},remove:async path=>{data.delete(path);},list:async directory=>[...data.keys()].filter(path=>path.startsWith(directory+'/'))};
  const authority=new InlineLeaseAuthority(identity,files);let closes=0,opens=0;const sockets:any[]=[];
  const fetcher=async(url:any)=>new Response(JSON.stringify(String(url).endsWith('/.well-known/t3/environment')?{environmentId:'host',label:'Test host',orchestrationProtocolVersion:1}: {ticket:'test-only'}));
  const socket=()=>{
    opens++;const ws:any={close(){closes++;queueMicrotask(()=>ws.onclose?.());},send(raw:string){void (async()=>{
      const request=JSON.parse(raw);let value:any;
      if(request.tag==='projects.writeFile'){await files.write(request.payload.relativePath,request.payload.contents);value={};}
      else if(request.payload.relativePath==='historical-large.json'){await new Promise(resolve=>setTimeout(resolve,5));value={truncated:true,contents:'x'.repeat(1_048_576),byteLength:1_676_065};}
      else {if(request.payload.relativePath.includes('/replies/'))await authority.tick();const contents=await files.read(request.payload.relativePath);
        if(contents===undefined){ws.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:request.id,exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'ProjectReadFileError'}}]}})});return;}
        await new Promise(resolve=>setTimeout(resolve,20));value={truncated:false,contents};}
      ws.onmessage?.({data:JSON.stringify({_tag:'Exit',requestId:request.id,exit:{_tag:'Success',value}})});
    })();}};sockets.push(ws);queueMicrotask(()=>ws.onopen?.());return ws as WebSocket;
  };
  const manager=new DeviceInlineManager(actor,vaultId,{access:async()=>{throw Error('not needed');},readNote:async()=>undefined,isOpen:()=>false,updateNote:async()=>undefined},async()=>{
    const remote=await connectVaultRemote({host:'direct',executable:'',transport:'direct',url:'https://host.example',environmentId:'host'},{url:'https://host.example',environmentId:'host',token:'test-only',expiresAt:Date.now()+600000},fetcher,socket);
    return {get closed(){return remote.closed;},files:{read:(path:string)=>remote.readFile('/vault',path),write:(path:string,bytes:string)=>remote.writeFile('/vault',path,bytes)},close:()=>remote.close()};
  });
  const request={version:2 as const,id,initialOwner:actor,vaultId,host:identity,notePath:'Note.md',threadId:'thread',messageId:randomUUID(),projectId:'project',threadEnvironmentId:'host',initialHash:initialRegion(id).bodyHash,createdAt:new Date().toISOString()};
  try{
    const host=(manager as any).host(identity);
    const failed=host.files.read('historical-large.json');const registration=manager.register(request);
    await assert.rejects(failed,/complete file/);await registration;assert.equal(closes,0);assert.equal(opens,1);
    await host.files.write('healthy.json','still connected');assert.equal(await host.files.read('healthy.json'),'still connected');
    sockets[0].onclose();await assert.rejects(host.files.read('healthy.json'),/connection closed/);
    assert.equal(await host.files.read('healthy.json'),'still connected');assert.equal(opens,2);
  }finally{manager.dispose();authority.stop();}
});
