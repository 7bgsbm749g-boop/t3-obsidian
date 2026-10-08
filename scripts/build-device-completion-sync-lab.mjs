// Installs a synthetic fixture ONLY into the two dedicated Sync test vaults.
// Original desktop configuration is retained outside Sync and restored by --restore.
import {build} from 'esbuild';
import {builtinModules} from 'node:module';
import {mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {editorExternals} from '../esbuild.config.mjs';
const evidence=await realpath(resolve(process.argv[2]));
if(!evidence.startsWith('/home/ubuntu/backups/send-to-t3-code/'))throw Error('Private evidence directory required.');
const roles=['a','b'],id='device-completion-sync-lab';
if(process.argv.includes('--rebuild')){
  for(const role of roles)await build({entryPoints:['validation/device-completion-sync-lab.ts'],bundle:true,external:['electron','@electron/remote','obsidian',...editorExternals,'node:*',...builtinModules.filter(n=>n!=='buffer')],platform:'browser',format:'cjs',target:'es2022',outfile:`/home/ubuntu/vaults/Sync Test ${role.toUpperCase()}/.obsidian/plugins/${id}/main.js`});
  process.stdout.write('Rebuilt the dedicated synthetic fixture.\n');process.exit(0);
}
if(process.argv.includes('--restore')){
  const backups=JSON.parse(await readFile(join(evidence,'CONFIG-BACKUPS.json'),'utf8'));
  for(const entry of backups){if(entry.bytes===null)await rm(entry.path,{force:true});else await writeFile(entry.path,Buffer.from(entry.bytes,'base64'));}
  for(const role of roles)await rm(`/home/ubuntu/vaults/Sync Test ${role.toUpperCase()}/.obsidian/plugins/${id}`,{recursive:true,force:true});
  process.stdout.write('Restored synthetic lab configuration.\n');process.exit(0);
}
const binding=randomUUID(),actor=randomUUID(),vaultId=randomUUID(),note=`Device completion ${binding}.md`,directory='private/synthetic/inline';
const {responseAnchor}=await import('../native-response-projection.ts');
const original=`# Device completion Sync fixture\n\nOrdinary heading\n\n${responseAnchor(binding)}\n\nOrdinary tail\n`;
const request={version:4,id:binding,initialOwner:randomUUID(),nativeProjection:true,independent:true,vaultId,host:{environmentId:'synthetic-host',workspaceRoot:'/unavailable-synthetic-host',directory},notePath:note,threadId:'synthetic-thread',projectId:'synthetic-project',messageId:randomUUID(),threadEnvironmentId:'synthetic-host',initialHash:'0'.repeat(64),createdAt:new Date().toISOString()};
const backups=[],source=await readFile('validation/device-completion-sync-lab.ts');
await writeFile(join(evidence,'SYNTHETIC-SYNC-LAB'),'Synthetic content only. No production settings or T3 dispatch.\n');
await writeFile(join(evidence,'SOURCE.json'),JSON.stringify({fixtureHash:createHash('sha256').update(source).digest('hex')}));
for(const role of roles){
  const vault=`/home/ubuntu/vaults/Sync Test ${role.toUpperCase()}`,plugin=join(vault,'.obsidian/plugins',id);
  try{await readFile(join(plugin,'manifest.json'));throw Error('A fixture is already installed. Restore it first.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(plugin,{recursive:true});
  for(const name of ['app.json','community-plugins.json']){
    const file=join(vault,'.obsidian',name);let bytes=null;try{bytes=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    backups.push({path:file,bytes:bytes?.toString('base64')??null});
    const parsed=bytes?JSON.parse(bytes.toString()):name==='app.json'?{}:[];
    await writeFile(file,JSON.stringify(name==='app.json'?{...parsed,safeMode:false,livePreview:true}:Array.from(new Set([...parsed,id]))));
  }
  await writeFile(join(plugin,'manifest.json'),JSON.stringify({id,name:'Synthetic device completion Sync lab',version:'0.0.1',minAppVersion:'1.8.7',description:'Dedicated synthetic test only',author:'Local validation',isDesktopOnly:true}));
  await writeFile(join(plugin,'config.json'),JSON.stringify({role,evidence,note,actor,request,original,body:'> Synthetic locally completed reply.\n'}));
  await writeFile(join(plugin,'styles.css'),await readFile('styles.css'));
  await build({entryPoints:['validation/device-completion-sync-lab.ts'],bundle:true,external:['electron','@electron/remote','obsidian',...editorExternals,'node:*',...builtinModules.filter(n=>n!=='buffer')],platform:'browser',format:'cjs',target:'es2022',outfile:join(plugin,'main.js')});
}
await writeFile(join(evidence,'CONFIG-BACKUPS.json'),JSON.stringify(backups));
await writeFile(join(evidence,'FIXTURE.json'),JSON.stringify({note,actor,binding,original}));
process.stdout.write(JSON.stringify({evidence,note,binding})+'\n');
