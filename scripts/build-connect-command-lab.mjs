// Prepare an isolated native host for the separately built production bundle.
import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile,access,realpath,readdir} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {editorExternals} from '../esbuild.config.mjs';
const [destination,asar]=process.argv.slice(2);if(!destination||!asar)throw Error('Use ROOT and the exact supported Obsidian app-cache ASAR.');
const config=JSON.parse(execFileSync('python3',['scripts/maintainer_config.py'],{encoding:'utf8',timeout:10000}));
const root=resolve(destination),evidence=resolve(config.canonicalRoot,'evidence');
const inside=(parent,child)=>{const rel=relative(parent,child);return !rel||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../');};
if(!inside(evidence,root)||root===evidence)throw Error('Use a new canonical project evidence subfolder.');
for(const plugins of [config.developmentPlugins,config.productionPlugins].filter(Boolean))if(inside(await realpath(resolve(plugins,'../..')),root))throw Error('Refuse a synced vault.');
try{await access(root);throw Error('Use a new native lab directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
const vault=join(root,'vault'),profile=join(root,'profile'),product=join(vault,'.obsidian/plugins/t-three-code'),controller=join(vault,'.obsidian/plugins/connect-note-lab');
await mkdir(product,{recursive:true});await mkdir(controller);await mkdir(profile);
await writeFile(join(root,'ISOLATED-NATIVE-LAB'),'Synthetic native checked-command test. No Sync.\n');
for(const [source,target] of [['dist/main.js','main.js'],['manifest.json','manifest.json'],['styles.css','styles.css']])await copyFile(source,join(product,target));
const appAsarName=asar.split('/').at(-1);if(!/^obsidian-1\.(?:13|14)\.[0-9]+\.asar$/.test(appAsarName))throw Error('Choose a supported pinned native test runtime.');await copyFile(asar,join(profile,appAsarName));
await writeFile(join(profile,'obsidian.json'),JSON.stringify({vaults:{[randomBytes(8).toString('hex')]:{path:vault,ts:Date.now(),open:true}}}));
await writeFile(join(vault,'.obsidian/community-plugins.json'),JSON.stringify(['connect-note-lab']));await writeFile(join(vault,'.obsidian/core-plugins.json'),JSON.stringify(['file-explorer','command-palette']));await writeFile(join(vault,'.obsidian/app.json'),JSON.stringify({livePreview:true,safeMode:false,readableLineLength:false}));
await writeFile(join(controller,'manifest.json'),JSON.stringify({id:'connect-note-lab',name:'Checked note protocol lab',version:'0.0.1',minAppVersion:'1.13.0',author:'Local validation',description:'Isolated native checks.',isDesktopOnly:true}));
await build({entryPoints:['tests/native/connect-note-edits-lab.ts'],bundle:true,platform:'browser',format:'cjs',external:['obsidian','electron','@electron/remote',...editorExternals,'node:*'],target:'es2022',outfile:join(controller,'main.js')});
const hashes={};for(const file of ['manifest.json','package.json','agent/mcp_server.py','skills/obsidian-t3/SKILL.md','scripts/connect_commands.py','scripts/obsidian-command.py','tests/native/connect-note-edits-lab.ts',...(await readdir('src',{recursive:true})).filter(name=>name.endsWith('.ts')).map(name=>'src/'+name),'styles.css'])hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const sourceBundleSha256=createHash('sha256').update(await readFile('dist/main.js')).digest('hex');
await writeFile(join(root,'BUILD-SOURCE.json'),JSON.stringify({sourceRoot:process.cwd(),sourceBundleSha256,files:hashes,appAsarSha256:createHash('sha256').update(await readFile(asar)).digest('hex')},null,2));
console.log(JSON.stringify({root,vault,profile,product,sourceBundleSha256,clientId:randomUUID(),vaultId:randomUUID(),launchArguments:[`--user-data-dir=${profile}`,'--no-sandbox','--force-renderer-accessibility']}));
