// Builds only a uniquely named unsynced validation vault. This is not a product
// installation and never writes into either real vault or its plugin data.
import {build} from 'esbuild';
import {builtinModules} from 'node:module';
import {mkdir,readFile,writeFile,access,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join,dirname,basename} from 'node:path';
import {randomBytes} from 'node:crypto';
if(!process.argv[2])throw Error('Specify a new private evidence directory.');
async function canonical(path){try{return await realpath(path);}catch(error){if(error.code!=='ENOENT')throw error;return resolve(await canonical(dirname(path)),basename(path));}}
const root=await canonical(resolve(process.argv[2]));
for(const vault of ['/home/ubuntu/vaults/QLO2','/home/ubuntu/Obsidian Vault',process.cwd()]){
  const rel=relative(await realpath(vault),root);
  if(!rel||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../'))throw Error('The lab must be outside source and synced vaults.');
}
try{await access(root);throw Error('Use a new evidence directory; previous evidence is immutable.');}catch(error){if(error.code!=='ENOENT')throw error;}
const vault=join(root,'vault'),plugin=join(vault,'.obsidian/plugins/coordinated-response-lab'),profile=join(root,'profile');
await mkdir(plugin,{recursive:true});await mkdir(profile);
await writeFile(join(root,'ISOLATED-NATIVE-LAB'),'Source-only native response validation. No Obsidian Sync configured.\n');
await writeFile(join(vault,'Reference.md'),'# Reference\n');await writeFile(join(vault,'Virtual.md'),'# Virtual\n');
await writeFile(join(vault,'.obsidian/app.json'),JSON.stringify({safeMode:false,livePreview:true,readableLineLength:false}));
await writeFile(join(vault,'.obsidian/community-plugins.json'),JSON.stringify(['coordinated-response-lab']));
await writeFile(join(vault,'.obsidian/core-plugins.json'),JSON.stringify(['file-explorer','command-palette']));
await writeFile(join(plugin,'manifest.json'),JSON.stringify({id:'coordinated-response-lab',name:'Isolated native response validation',version:'0.0.1',minAppVersion:'1.8.7',description:'Source-only validation; no Sync or T3 dispatch',author:'Local validation',isDesktopOnly:true}));
await writeFile(join(plugin,'styles.css'),await readFile('styles.css'));
await writeFile(join(profile,'obsidian.json'),JSON.stringify({vaults:{[randomBytes(8).toString('hex')]:{path:vault,ts:Date.now(),open:true}}}));
await build({entryPoints:['validation/native-response-lab.ts'],bundle:true,external:['obsidian','@codemirror/view','@codemirror/state','node:*',...builtinModules.filter(name=>name!=='buffer')],platform:'browser',format:'cjs',target:'es2022',outfile:join(plugin,'main.js')});
process.stdout.write(JSON.stringify({root,vault,profile,launchArguments:[`--user-data-dir=${profile}`,'--no-sandbox']})+'\n');
