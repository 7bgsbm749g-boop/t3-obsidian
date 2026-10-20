// Install only in the two synthetic desktop vaults. Backups and credentials
// remain outside synced vaults; production settings are never imported.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,cp,rm,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
const evidence=resolve(process.argv[2]||'');
if(!evidence.startsWith('/home/ubuntu/backups/send-to-t3-code/'))throw Error('Private evidence directory required.');
await mkdir(evidence,{recursive:true});
const record=join(evidence,'SETUP.json');
if(process.argv.includes('--restore')){
  const setup=JSON.parse(await readFile(record,'utf8'));
  for(const role of ['a','b']){
    const config=`/home/ubuntu/vaults/Sync Test ${role.toUpperCase()}/.obsidian`;
    await rm(join(config,'plugins/smart-send-rename-lab'),{recursive:true,force:true});
    await rm(join(config,'plugins/send-to-t3-code'),{recursive:true});
    await cp(join(evidence,role+'-plugin-backup'),join(config,'plugins/send-to-t3-code'),{recursive:true});
    await writeFile(join(config,'community-plugins.json'),await readFile(join(evidence,role+'-community.json')));
  }
  execFileSync('/home/ubuntu/.local/bin/t3',['auth','session','revoke','--base-dir','/home/ubuntu/.t3',setup.sessionId],{stdio:'pipe'});
  console.log('Restored synthetic lab plugins and revoked its test session.');process.exit(0);
}
try{await access(record);throw Error('Setup already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
const projectId=process.argv[3];if(!projectId)throw Error('Registered synthetic project ID required.');
const {origin}=JSON.parse(await readFile('/home/ubuntu/.t3/userdata/server-runtime.json','utf8'));
const descriptor=await (await fetch(origin+'/.well-known/t3/environment')).json();
const permissions=['orchestration:read','orchestration:operate','filesystem:read','filesystem:write'];
const issued=JSON.parse(execFileSync('/home/ubuntu/.local/bin/t3',['auth','session','issue','--base-dir','/home/ubuntu/.t3','--ttl','2h','--label','smart-send-rename-lab','--json',...permissions.flatMap(p=>['--scope',p])],{encoding:'utf8'}));
const connectionId=randomUUID(),vaultId=randomUUID(),prefix='Smart Send Rename 20261020 ',workspace=join(evidence,'workspace');
await writeFile(join(workspace,'AGENTS.md'),'Synthetic plugin smoke test. Follow the bounded prompt. Do not read or change files.\n');
const pair={id:connectionId,name:'Synthetic rename lab',url:origin,environmentId:descriptor.environmentId};
const api=await fetch(origin+'/api/orchestration/shell',{headers:{Authorization:'Bearer '+issued.token,'x-t3-orchestration-protocol':'2'}});
if(!api.ok)throw Error('Project discovery failed: '+api.status);
const projects=(await api.json()).projects.filter(p=>p.id===projectId||p.workspaceRoot==='/home/ubuntu/vaults/Sync Test A').map(p=>({...p,connectionId,connectionName:pair.name}));
const host=projects.find(p=>p.workspaceRoot==='/home/ubuntu/vaults/Sync Test A');if(!host)throw Error('Synthetic host project missing.');
const settings={vaultId,paired:[pair],directProjects:projects,directSelected:[connectionId+':'+projectId],directScanId:connectionId,inlineStreaming:{enabled:true,intermediateMode:'collapse'},autoSettleThreads:false,
  folderLinks:[{id:randomUUID(),folderPath:'/',projectId:host.id,projectTitle:host.title,workspaceRoot:host.workspaceRoot,connectionId,environmentId:descriptor.environmentId,self:true,vaultId}]};
for(const role of ['a','b']){
  const config=`/home/ubuntu/vaults/Sync Test ${role.toUpperCase()}/.obsidian`,plugin=join(config,'plugins/send-to-t3-code'),observer=join(config,'plugins/smart-send-rename-lab');
  await cp(plugin,join(evidence,role+'-plugin-backup'),{recursive:true,errorOnExist:true,force:false});
  await writeFile(join(evidence,role+'-community.json'),await readFile(join(config,'community-plugins.json')));
  await mkdir(observer,{recursive:false});
  for(const [name,source] of [['main.js','dist/main.js'],['manifest.json','manifest.json'],['styles.css','styles.css']])await writeFile(join(plugin,name),await readFile(source));
  await writeFile(join(plugin,'data.json'),JSON.stringify(settings));
  await writeFile(join(config,'community-plugins.json'),JSON.stringify(['smart-send-rename-lab','send-to-t3-code']));
  await writeFile(join(evidence,`credential-${role}.json`),JSON.stringify({deviceId:randomUUID(),mode:'direct',pairedSessions:{[connectionId]:{url:origin,environmentId:descriptor.environmentId,token:issued.token,expiresAt:Date.parse(issued.expiresAt),permissions}}}),{mode:0o600});
  await writeFile(join(observer,'manifest.json'),JSON.stringify({id:'smart-send-rename-lab',name:'Synthetic Smart Send rename observer',version:'0.0.1',minAppVersion:'1.8.7',description:'Test vault only',author:'Local validation',isDesktopOnly:true}));
  await writeFile(join(observer,'config.json'),JSON.stringify({evidence,role,prefix}));
  await build({entryPoints:['validation/smart-send-rename-lab.ts'],bundle:true,external:['obsidian','node:*'],platform:'browser',format:'cjs',target:'es2022',outfile:join(observer,'main.js')});
}
await writeFile(record,JSON.stringify({projectId,connectionId,vaultId,prefix,sessionId:issued.sessionId,workspace,environmentId:descriptor.environmentId},null,2));
console.log('Prepared both synthetic clients; private setup receipt retained outside Sync.');
