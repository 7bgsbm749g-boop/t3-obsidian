import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectVaultRemote,discoverVaultRoots,vaultRegistration,vaultIdentity,waitForVaultNote,type VaultRemote} from '../vault-connection';
import {randomUUID} from 'node:crypto';

function harness(){
  const id=randomUUID(),c={host:'direct',executable:'',transport:'direct' as const,url:'https://laptop.example',environmentId:'laptop-env'};
  const session={url:c.url,environmentId:c.environmentId,token:'private-token',expiresAt:Date.now()+600_000};
  let projects:any[]=[],lose=false,closed=0,noteChecks=0;
  const files=new Map<string,string>();
  const commands:any[]=[],rpc:any[]=[],requests:string[]=[];
  const fetcher=async(url:any,options:any)=>{
    requests.push(String(url));
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    const response=(v:any)=>new Response(JSON.stringify(v));
    if(String(url).endsWith('/.well-known/t3/environment'))return response({environmentId:c.environmentId,label:'Laptop',orchestrationProtocolVersion:1});
    assert.equal(options.headers.Authorization,'Bearer private-token');
    if(String(url).endsWith('/websocket-ticket'))return response({ticket:'short-lived-ticket'});
    if(String(url).endsWith('/shell'))return response({projects});
    assert.ok(String(url).endsWith('/dispatch'));
    const command=JSON.parse(options.body);commands.push(command);
    if(!projects.length)projects.push({id:command.projectId,title:command.title,workspaceRoot:command.workspaceRoot});
    if(lose){lose=false;throw Error('Lost response after commit');}
    return response({});
  };
  const socket=(url:string)=>{
    const u=new URL(url);assert.equal(u.origin,'wss://laptop.example');assert.equal(u.pathname,'/ws');assert.equal(u.searchParams.get('wsTicket'),'short-lived-ticket');assert.ok(!url.includes(session.token));
    const ws:any={close(){closed++;queueMicrotask(()=>ws.onclose?.());},send(text:string){
      const req=JSON.parse(text);rpc.push(req);
      let value:any;
      if(req.tag==='filesystem.browse')value={parentPath:'C:\\Users\\Alex\\Vault',entries:[]};
      else if(req.tag==='projects.readFile'){
        if(req.payload.cwd==='missing'){queueMicrotask(()=>ws.onmessage({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'ProjectReadFileError'}}]}})}));return;}
        const contents=files.get(req.payload.relativePath);
        if(contents===undefined&&!req.payload.relativePath.endsWith('/data.json')){queueMicrotask(()=>ws.onmessage({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'ProjectReadFileError'}}]}})}));return;}
        value={contents:contents??JSON.stringify({vaultId:req.payload.cwd==='wrong'?'another-vault':id}),truncated:false};
      }else if(req.tag==='projects.writeFile'){files.set(req.payload.relativePath,req.payload.contents);value={relativePath:req.payload.relativePath};}
      else if(req.tag==='projects.deleteEntry'){files.delete(req.payload.relativePath);value={relativePath:req.payload.relativePath};}
      else {noteChecks++;value={entries:noteChecks<2?[]:[{path:'Notes/Draft.md',kind:'file'}]};}
      queueMicrotask(()=>ws.onmessage({data:JSON.stringify([{_tag:'Exit',requestId:req.id,exit:{_tag:'Success',value}}])}));
    }};queueMicrotask(()=>ws.onopen());return ws as WebSocket;
  };
  return {id,c,session,commands,rpc,requests,files,connect:()=>connectVaultRemote(c,session,fetcher,socket),lose:()=>{lose=true;},setProjects:(p:any[])=>{projects=p;},closed:()=>closed};
}

test('remote vault discovery uses identity across different folder names and handles missing settings',async()=>{
  const h=harness(),r=await h.connect();
  try{
    assert.deepEqual(await discoverVaultRoots(r,['C:\\Users\\Alex\\QLO2','C:/Users/Alex/QLO2','wrong','missing'],'CustomConfig/plugins/send-to-t3-code/data.json',h.id),['C:\\Users\\Alex\\QLO2']);
    assert.ok(h.rpc.every(x=>x.payload.relativePath==='CustomConfig/plugins/send-to-t3-code/data.json'));
    assert.equal(h.commands.length,0,'Discovery must never create a project');
    assert.equal((await r.browse('~')).parentPath,'C:\\Users\\Alex\\Vault');
  }finally{r.close();}
  assert.equal(h.closed(),1);
});

test('remote project registration reuses an existing root and recovers a lost creation response without a second project',async()=>{
  const h=harness(),r=await h.connect();
  try{
    const registration=vaultRegistration(h.c.environmentId,'C:\\Users\\Alex\\Vault',h.id,'Phone vault name');
    h.lose();await assert.rejects(r.ensureProject(registration),/Cannot reach T3/);
    const result=await r.ensureProject(registration);
    assert.equal(result.id,registration.projectId);assert.equal(h.commands.length,1);
    assert.deepEqual(h.commands[0],registration);
    assert.ok(!('createWorkspaceRootIfMissing' in h.commands[0]),'Only register a verified existing folder');
    const same=vaultRegistration(h.c.environmentId,'c:/users/alex/vault',h.id,'Renamed');
    assert.equal(same.projectId,registration.projectId);
    const other=vaultRegistration('other-machine',registration.workspaceRoot,h.id,registration.title);
    assert.notEqual(other.projectId,registration.projectId);
  }finally{r.close();}
});

test('sync preflight waits for a note listing without copying its Markdown and stops on cancellation',async()=>{
  const h=harness(),r=await h.connect();let waits=0;
  try{
    await waitForVaultNote(r,'/vault','Notes/Draft.md',()=>true,()=>{waits++;},async()=>{});
    assert.equal(waits,1);assert.equal(h.rpc.length,2);
    assert.ok(h.rpc.every(x=>x.tag==='projects.listEntries'&&x.payload.directoryPath==='Notes'));
    await assert.rejects(waitForVaultNote(r,'/vault','Notes/Draft.md',()=>false,()=>{},async()=>{}),/cancelled/);
    let checks=0;
    await assert.rejects(waitForVaultNote({...r,hasNote:async()=>{checks++;return false;}},'/vault','Notes/Draft.md',()=>true,()=>{},async()=>{}),/not reached/);
    assert.equal(checks,6);
  }finally{r.close();}
});

test('a synced legacy root identity survives vault renames while explicit identity wins',()=>{
  assert.equal(vaultIdentity({folderLinks:[{folderPath:'/',id:'legacy'}]}),'legacy');
  assert.equal(vaultIdentity({vaultId:'stable',folderLinks:[{folderPath:'/',id:'changed-link'}]}),'stable');
});

test('remote vault access refuses credentials from another environment before opening a socket',async()=>{
  const h=harness();let calls=0;
  await assert.rejects(connectVaultRemote(h.c,{...h.session,environmentId:'other'},async()=>{calls++;return new Response('{}');},()=>{throw Error('must not open');}),/Pair this connection/);
  assert.equal(calls,0);
});
