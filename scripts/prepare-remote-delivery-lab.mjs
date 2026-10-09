// Reusable isolated lab setup; never imports production settings or credentials.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const evidence=resolve(process.argv[2]||'');
if(!evidence.startsWith('/home/ubuntu/backups/send-to-t3-code/'))throw Error('Private evidence directory required.');
await mkdir(evidence,{recursive:true});
if(process.argv.includes('--revoke-session')){
  const lab=JSON.parse(await readFile(join(evidence,'LAB.json'),'utf8'));
  execFileSync('/home/ubuntu/.local/bin/t3',['auth','session','revoke','--base-dir','/home/ubuntu/.t3',lab.sessionId],{stdio:'pipe'});
  console.log('Revoked the lab session. Linked synthetic folder and evidence retained.');process.exit(0);
}
if(process.argv.includes('--refresh-session')){
  const lab=JSON.parse(await readFile(join(evidence,'LAB.json'),'utf8'));
  const permissions=['orchestration:read','orchestration:operate','filesystem:read','filesystem:write'];
  const issued=JSON.parse(execFileSync('/home/ubuntu/.local/bin/t3',['auth','session','issue','--base-dir','/home/ubuntu/.t3','--ttl','2h','--label','synthetic-remote-delivery-lab','--json',...permissions.flatMap(p=>['--scope',p])],{encoding:'utf8'}));
  for(const role of ['a','b']){const path=join(evidence,`credential-${role}.json`),local=JSON.parse(await readFile(path,'utf8'));Object.assign(local.pairedSessions[lab.connectionId],{token:issued.token,expiresAt:Date.parse(issued.expiresAt),permissions});await writeFile(path,JSON.stringify(local),{mode:0o600});}
  execFileSync('/home/ubuntu/.local/bin/t3',['auth','session','revoke','--base-dir','/home/ubuntu/.t3',lab.sessionId],{stdio:'pipe'});
  await writeFile(join(evidence,'LAB.json'),JSON.stringify({...lab,sessionId:issued.sessionId},null,2));console.log('Renewed the lab session; reload the two lab clients before use.');process.exit(0);
}
if(process.argv.includes('--fixed')){
  for(const role of ['a','b'])for(const [name,source] of [['main.js','dist/main.js'],['manifest.json','manifest.json'],['styles.css','styles.css']])await writeFile(`/home/ubuntu/vaults/Sync Test ${role.toUpperCase()}/.obsidian/plugins/send-to-t3-code/${name}`,await readFile(source));
  console.log('Installed reviewed build in synthetic lab only; reload both lab plugins.');process.exit(0);
}
try{await access(join(evidence,'LAB.json'));throw Error('Lab setup already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
for(const role of ['a','b'])try{await access(`/home/ubuntu/vaults/Sync Test ${role.toUpperCase()}/.obsidian/plugins/send-to-t3-code`);throw Error('Lab already has Send to T3 Code; preserve it before setup.');}catch(error){if(error.code!=='ENOENT')throw error;}
const base='/home/ubuntu/.t3',{origin}=JSON.parse(await readFile(base+'/userdata/server-runtime.json','utf8'));
const descriptor=await (await fetch(origin+'/.well-known/t3/environment')).json();
const permissions=['orchestration:read','orchestration:operate','filesystem:read','filesystem:write'];
const issued=JSON.parse(execFileSync('/home/ubuntu/.local/bin/t3',['auth','session','issue','--base-dir',base,'--ttl','2h','--label','synthetic-remote-delivery-lab','--json',...permissions.flatMap(p=>['--scope',p])],{encoding:'utf8'}));
const api=async(path,payload)=>{const response=await fetch(origin+path,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+issued.token,'Content-Type':'application/json','x-t3-orchestration-protocol':'2'},...(payload?{body:JSON.stringify(payload)}:{})});if(!response.ok)throw Error(`T3 ${path}: ${response.status}`);return response.json();};
const vaultId=randomUUID(),connectionId=randomUUID(),root='/home/ubuntu/vaults/Sync Test A',workspace=join(evidence,'workspace'),folder='Remote delivery regression',note=folder+'/Remote delivery regression.md';
await mkdir(workspace,{recursive:true});await writeFile(join(workspace,'AGENTS.md'),'Synthetic plugin delivery lab. Follow the bounded test prompt. Do not modify files or use tools.\n');
const projectId=randomUUID(),vaultProjectId=randomUUID();
for(const [id,title,workspaceRoot] of [[projectId,'Remote delivery regression lab',workspace],[vaultProjectId,'Remote delivery host lab',root]])await api('/api/projects/mutate',{type:'project.create',commandId:randomUUID(),projectId:id,title,workspaceRoot});
const paired={id:connectionId,name:'Synthetic VPS remote RPC',url:origin,environmentId:descriptor.environmentId};
const projects=(await api('/api/orchestration/shell')).projects.filter(p=>[projectId,vaultProjectId].includes(p.id)).map(p=>({...p,connectionId,connectionName:paired.name}));
// Thousands of synthetic historical thread records keep the settings large
// even after the production plugin normalizes and saves them.
const noteThreads=Array.from({length:5000},(_,i)=>({notePath:`Synthetic history/Archived ${i}.md`,threadId:`synthetic-history-${i}`,projectId,workspaceRoot:workspace,connectionId,environmentId:descriptor.environmentId,selectedAt:'2026-01-01T00:00:00.000Z',deletedAt:'2026-01-02T00:00:00.000Z'}));
const settings={vaultId,paired:[paired],directProjects:projects,directSelected:[connectionId+':'+projectId],directScanId:connectionId,inlineStreaming:{enabled:true},autoSettleThreads:false,noteThreads,folderLinks:[{id:randomUUID(),folderPath:'/',projectId:vaultProjectId,projectTitle:'Remote delivery host lab',workspaceRoot:root,connectionId,environmentId:descriptor.environmentId,self:true,vaultId}]};
const archiveOption=process.argv.indexOf('--archive');
const oldZip=resolve(archiveOption>=0?process.argv[archiveOption+1]:'release/send-to-t3-code-2.36.2.zip'),backups=[];
const oldVersion=JSON.parse(execFileSync('python3',['-c','import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("send-to-t3-code/manifest.json").decode())',oldZip],{encoding:'utf8'})).version;
for(const role of ['a','b']){
  const vault=`/home/ubuntu/vaults/Sync Test ${role.toUpperCase()}`,configDir=join(vault,'.obsidian'),plugin=join(configDir,'plugins/send-to-t3-code'),observer=join(configDir,'plugins/remote-delivery-lab');
  try{await access(plugin);throw Error('Lab already has Send to T3 Code; preserve it before setup.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(plugin,{recursive:true});await mkdir(observer,{recursive:true});await mkdir(join(vault,folder),{recursive:true});
  for(const name of ['app.json','community-plugins.json']){const path=join(configDir,name);let bytes;try{bytes=await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}backups.push({path,bytes:bytes?.toString('base64')??null});const data=bytes?JSON.parse(bytes):name==='app.json'?{}:[];await writeFile(path,JSON.stringify(name==='app.json'?{...data,safeMode:false}:['remote-delivery-lab',...data,'send-to-t3-code']));}
  execFileSync('python3',['-c','import zipfile,sys,pathlib\nz=zipfile.ZipFile(sys.argv[1]);p=pathlib.Path(sys.argv[2])\nfor n in ["main.js","manifest.json","styles.css"]: (p/n).write_bytes(z.read("send-to-t3-code/"+n))',oldZip,plugin]);
  await writeFile(join(plugin,'data.json'),JSON.stringify(settings,null,2));
  await writeFile(join(vault,note),'# Remote delivery regression\n\nThis is a bounded plugin integration test. Reply with exactly REMOTE_DELIVERY_BASELINE_OK. Do not use tools or modify files.\n');
  await writeFile(join(evidence,`credential-${role}.json`),JSON.stringify({deviceId:randomUUID(),mode:'direct',pairedSessions:{[connectionId]:{url:origin,environmentId:descriptor.environmentId,token:issued.token,expiresAt:Date.parse(issued.expiresAt),permissions}}}),{mode:0o600});
  await writeFile(join(observer,'manifest.json'),JSON.stringify({id:'remote-delivery-lab',name:'Synthetic remote delivery lab observer',version:'0.0.1',minAppVersion:'1.8.7',description:'Test vault only',author:'Local validation',isDesktopOnly:true}));
  await writeFile(join(observer,'config.json'),JSON.stringify({evidence,role,note}));
  await build({entryPoints:['validation/remote-delivery-lab.ts'],bundle:true,external:['obsidian','node:*'],platform:'browser',format:'cjs',target:'es2022',outfile:join(observer,'main.js')});
}
const receipt={vaultId,connectionId,environmentId:descriptor.environmentId,projectId,vaultProjectId,workspace,folder,note,hostRoot:root,sourceRoot:'/home/ubuntu/vaults/Sync Test B',sessionId:issued.sessionId,oldVersion,oldArchiveSha256:createHash('sha256').update(await readFile(oldZip)).digest('hex')};
await writeFile(join(evidence,'LAB.json'),JSON.stringify(receipt,null,2));await writeFile(join(evidence,'CONFIG-BACKUPS.json'),JSON.stringify(backups));console.log(JSON.stringify(receipt));
