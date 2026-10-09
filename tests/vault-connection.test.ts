import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectVaultRemote,discoverVaultRoots,vaultRegistration,vaultIdentity,waitForVaultNote,type VaultRemote} from '../vault-connection';
import {randomUUID} from 'node:crypto';
import {pair} from '../direct';
import {PLUGIN_PERMISSIONS,PLUGIN_SCOPE} from '../environment-permissions';
import {T3RpcError} from '../t3-rpc';
import {vaultIdentityPath} from '../vault-identity';

function harness(initialPermissions:readonly string[]=PLUGIN_PERMISSIONS){
  let permissions=initialPermissions;
  const id=randomUUID(),c={host:'direct',executable:'',transport:'direct' as const,url:'https://laptop.example',environmentId:'laptop-env'};
  const session={url:c.url,environmentId:c.environmentId,token:'private-token',expiresAt:Date.now()+600_000};
  let projects:any[]=[],lose=false,closed=0,noteChecks=0,folderEntries:any[]|undefined;
  const files=new Map<string,string>();
  const commands:any[]=[],rpc:any[]=[],requests:string[]=[];
  const fetcher=async(url:any,options:any)=>{
    requests.push(String(url));
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    const response=(v:any)=>new Response(JSON.stringify(v));
    if(String(url).endsWith('/.well-known/t3/environment'))return response({environmentId:c.environmentId,label:'Laptop',orchestrationProtocolVersion:2});
    if(String(url).endsWith('/oauth/token')){permissions=new URLSearchParams(options.body).get('scope')!.split(' ');return response({token_type:'Bearer',access_token:'private-token',expires_in:600,scope:permissions.join(' ')});}
    assert.equal(options.headers.Authorization,'Bearer private-token');
    if(String(url).endsWith('/websocket-ticket'))return response({ticket:'short-lived-ticket'});
    if(String(url).endsWith('/shell'))return response({projects});
    assert.ok(String(url).endsWith('/api/projects/mutate'));
    const command=JSON.parse(options.body);commands.push(command);
    if(!projects.length)projects.push({id:command.projectId,title:command.title,workspaceRoot:command.workspaceRoot});
    if(lose){lose=false;throw Error('Lost response after commit');}
    return response({});
  };
  const socket=(url:string)=>{
    const u=new URL(url);assert.equal(u.origin,'wss://laptop.example');assert.equal(u.pathname,'/ws');assert.equal(u.searchParams.get('wsTicket'),'short-lived-ticket');assert.ok(!url.includes(session.token));
    const ws:any={close(){closed++;queueMicrotask(()=>ws.onclose?.());},send(text:string){
      const req=JSON.parse(text);rpc.push(req);
      const requiredPermission=req.tag==='projects.writeFile'||req.tag==='projects.deleteEntry'?'filesystem:write':'filesystem:read';
      if(!permissions.includes(requiredPermission)){queueMicrotask(()=>ws.onmessage({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'EnvironmentAuthorizationError',requiredScope:'orchestration:operate',requiredPermission,message:'Bearer DO_NOT_LEAK'}}]}})}));return;}
      let value:any;
      if(req.tag==='filesystem.browse')value={parentPath:'C:\\Users\\Alex\\Vault',entries:[]};
      else if(req.tag==='projects.readFile'){
        if(req.payload.cwd==='missing'){queueMicrotask(()=>ws.onmessage({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'ProjectReadFileError'}}]}})}));return;}
        const contents=files.get(req.payload.relativePath);
        if(contents===undefined&&!req.payload.relativePath.endsWith('/data.json')){queueMicrotask(()=>ws.onmessage({data:JSON.stringify({_tag:'Exit',requestId:req.id,exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'ProjectReadFileError'}}]}})}));return;}
        const complete=contents??JSON.stringify({vaultId:req.payload.cwd==='wrong'?'another-vault':id});
        value={contents:complete.slice(0,1024*1024),byteLength:complete.length,truncated:complete.length>1024*1024};
      }else if(req.tag==='projects.writeFile'){files.set(req.payload.relativePath,req.payload.contents);value={relativePath:req.payload.relativePath};}
      else if(req.tag==='projects.deleteEntry'){files.delete(req.payload.relativePath);value={relativePath:req.payload.relativePath};}
      else if(req.tag==='projects.listEntries'&&folderEntries!==undefined)value={entries:folderEntries,truncated:false};
      else {noteChecks++;value={entries:noteChecks<2?[]:[{path:'Notes/Draft.md',kind:'file'}]};}
      queueMicrotask(()=>ws.onmessage({data:JSON.stringify([{_tag:'Exit',requestId:req.id,exit:{_tag:'Success',value}}])}));
    }};queueMicrotask(()=>ws.onopen());return ws as WebSocket;
  };
  return {id,c,session,commands,rpc,requests,files,connect:()=>connectVaultRemote(c,session,fetcher,socket),pairConnect:async()=>{const paired=await pair(c.url+'/pair#token=one-time','',fetcher);assert.equal(paired.session.permissions!.join(' '),PLUGIN_SCOPE);return connectVaultRemote(c,paired.session,fetcher,socket);},lose:()=>{lose=true;},setProjects:(p:any[])=>{projects=p;},setFolderEntries:(entries:any[])=>{folderEntries=entries;},closed:()=>closed};
}

test('file permissions protect remote vault checks and repaired pairing permits reply storage',async()=>{
 const h=harness(['orchestration:read','orchestration:operate']);const old=await h.connect();
 try{
  await assert.rejects(old.matches('/vault','.obsidian/plugins/send-to-t3-code/data.json',h.id),(error:any)=>error instanceof T3RpcError&&error.kind==='EnvironmentAuthorizationError'&&error.requiredPermission==='filesystem:read'&&error.rpcMethod==='projects.readFile'&&/Reconnect/.test(error.message)&&!error.message.includes('DO_NOT_LEAK'));
 }finally{old.close();}
 const repaired=await h.pairConnect();
 try{
  assert.equal(await repaired.matches('/vault','.obsidian/plugins/send-to-t3-code/data.json',h.id),true);
  await repaired.writeFile('/private-storage','replies/test.json','synthetic reply');
  assert.equal(await repaired.readFile('/private-storage','replies/test.json'),'synthetic reply');
 }finally{repaired.close();}
 assert.equal(h.commands.length,0,'Permission repair must not create projects or dispatch work');
});

test('read-only grants report the missing write permission instead of a missing vault',async()=>{
 const h=harness(['orchestration:read','orchestration:operate','filesystem:read']);const remote=await h.connect();
 try{
  assert.equal(await remote.matches('/vault','.obsidian/plugins/send-to-t3-code/data.json',h.id),true);
  await assert.rejects(remote.writeFile('/private-storage','reply.json','synthetic'),(error:any)=>error.requiredPermission==='filesystem:write'&&error.rpcMethod==='projects.writeFile');
  assert.equal(h.files.size,0);
 }finally{remote.close();}
});

test('remote vault discovery uses identity across different folder names and handles missing settings',async()=>{
  const h=harness(),r=await h.connect();
  try{
    assert.deepEqual(await discoverVaultRoots(r,['C:\\Users\\Alex\\QLO2','C:/Users/Alex/QLO2','wrong','missing'],'CustomConfig/plugins/send-to-t3-code/data.json',h.id),['C:\\Users\\Alex\\QLO2']);
    assert.ok(h.rpc.every(x=>['CustomConfig/t3-code/vault-identity.json','CustomConfig/plugins/send-to-t3-code/data.json'].includes(x.payload.relativePath)));
    assert.equal(h.commands.length,0,'Discovery must never create a project');
    assert.equal((await r.browse('~')).parentPath,'C:\\Users\\Alex\\Vault');
  }finally{r.close();}
  assert.equal(h.closed(),1);
});

test('remote identity uses a small host record when linked-vault settings exceed the file preview limit',async()=>{
  const h=harness(),r=await h.connect(),settingsPath='.obsidian/plugins/send-to-t3-code/data.json';
  h.files.set(settingsPath,JSON.stringify({padding:'x'.repeat(1_200_000),vaultId:h.id}));
  try{
    await assert.rejects(r.matches('/vault',settingsPath,h.id),/Update and reload/,'An old host with large settings must reproduce the failure');
    h.files.set(vaultIdentityPath('.obsidian'),JSON.stringify({version:1,vaultId:h.id}));h.rpc.length=0;
    assert.equal(await r.matches('/vault',settingsPath,h.id),true);
    assert.deepEqual(h.rpc.map(x=>x.payload.relativePath),[vaultIdentityPath('.obsidian')]);
  }finally{r.close();}
});

for(const record of [{version:1,vaultId:'different'},{version:2,vaultId:'expected'},'{broken','x'.repeat(1_200_000)])test(`remote identity refuses ${typeof record==='string'?record.slice(0,8):JSON.stringify(record)} without trusting legacy settings`,async()=>{
  const h=harness(),r=await h.connect();h.files.set(vaultIdentityPath('.obsidian'),typeof record==='string'?record:JSON.stringify({...record,vaultId:record.vaultId==='expected'?h.id:record.vaultId}));
  try{assert.equal(await r.matches('/vault','.obsidian/plugins/send-to-t3-code/data.json',h.id),false);assert.equal(h.rpc.length,1);}finally{r.close();}
});

test('remote project registration reuses an existing root and recovers a lost creation response without a second project',async()=>{
  const h=harness(),r=await h.connect();
  try{
    const registration=vaultRegistration(h.c.environmentId,'C:\\Users\\Alex\\Vault',h.id,'Phone vault name');
    h.lose();await assert.rejects(r.ensureProject(registration),/Cannot reach T3/);
    const result=await r.ensureProject(registration);
    assert.equal(result.id,registration.projectId);assert.equal(h.commands.length,1);
    const {createdAt,...wire}=registration;assert.deepEqual(h.commands[0],wire);
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

test('new remote workspace uses explicit directory creation and recovers a lost response',async()=>{
  const h=harness(),r=await h.connect();
  try{
    h.setFolderEntries([{path:'unrelated:linux-name',kind:'directory'}]);
    const folder={parentPath:'C:\\Users\\Alex',name:'New workspace'};
    const registration=vaultRegistration(h.c.environmentId,'C:\\Users\\Alex\\New workspace',h.id,'New project');
    h.lose();await assert.rejects(r.ensureProject(registration,folder),/Cannot reach T3/);
    const project=await r.ensureProject(registration,folder);
    assert.equal(project.workspaceRoot,registration.workspaceRoot);assert.equal(h.commands.length,1);
    assert.equal(h.commands[0].createWorkspaceRootIfMissing,true);
    assert.deepEqual(h.rpc[0].payload,{cwd:folder.parentPath,directoryPath:''});
    assert.equal(h.rpc.length,1,'A retry with an existing project must not try to create its directory again');
  }finally{r.close();}
});

for(const kind of ['file','directory'])test(`new remote folder rejects an existing ${kind} before dispatch`,async()=>{
  const h=harness(),r=await h.connect();
  try{
    h.setFolderEntries([{path:'NEW',kind}]);
    const registration=vaultRegistration(h.c.environmentId,'C:/Work/new',h.id,'New');
    await assert.rejects(r.ensureProject(registration,{parentPath:'C:/Work',name:'new'}),/already exists/);
    assert.equal(h.commands.length,0);
    await assert.rejects(r.ensureProject(registration,{parentPath:'C:/Other',name:'new'}),/does not match/);
    assert.equal(h.commands.length,0);
  }finally{r.close();}
});
