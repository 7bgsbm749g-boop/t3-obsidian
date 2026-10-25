// Builds only a uniquely named unsynced validation vault. This is not a product
// installation and never writes into either real vault or its plugin data.
import {build} from 'esbuild';
import {builtinModules} from 'node:module';
import {mkdir,readFile,writeFile,access,realpath,readdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join,dirname,basename} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {editorExternals} from '../esbuild.config.mjs';
if(!process.argv[2])throw Error('Specify a new private evidence directory.');
if(!['--thoughts','--autosave-recovery','--stream-close','--palette-selection','--run-import','--stream-stop','--per-note-sync','--import-save','--sign-in','--response-drag','--scroll-follow','--megapatch-typing','--languages','--dense','--direct','--codebase','--interaction','--html'].some(flag=>process.argv.includes(flag)))throw Error('Choose an existing local response validation mode; the lease-host lab is retired.');
async function canonical(path){try{return await realpath(path);}catch(error){if(error.code!=='ENOENT')throw error;return resolve(await canonical(dirname(path)),basename(path));}}
const root=await canonical(resolve(process.argv[2]));
for(const vault of ['/home/ubuntu/vaults/QLO2','/home/ubuntu/Obsidian Vault']){
  const rel=relative(await realpath(vault),root);
  if(!rel||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../'))throw Error('The lab must be outside synced vaults.');
}
const evidenceRoot=await canonical(resolve('evidence')),evidenceRelative=relative(evidenceRoot,root);
if(!evidenceRelative||isAbsolute(evidenceRelative)||evidenceRelative==='..'||evidenceRelative.startsWith('../'))throw Error('Use a task directory inside this project’s gitignored evidence/ folder.');
try{await access(root);throw Error('Use a new evidence directory; previous evidence is immutable.');}catch(error){if(error.code!=='ENOENT')throw error;}
const vault=join(root,'vault'),plugin=join(vault,'.obsidian/plugins/coordinated-response-lab'),profile=join(root,'profile');
await mkdir(plugin,{recursive:true});await mkdir(profile);
const inputs=[...(await readdir('.')).filter(name=>name.endsWith('.ts')),...(await readdir('validation')).filter(name=>name.endsWith('.ts')).map(name=>'validation/'+name),'styles.css'];
const hashes={};for(const file of inputs)hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile(join(root,'BUILD-SOURCE.json'),JSON.stringify({files:hashes},null,2));
await writeFile(join(root,'ISOLATED-NATIVE-LAB'),'Source-only native response validation. No Obsidian Sync configured.\n');
await writeFile(join(vault,'Reference.md'),'# Reference\n');await writeFile(join(vault,'Virtual.md'),'# Virtual\n');
await writeFile(join(vault,'.obsidian/app.json'),JSON.stringify({safeMode:false,livePreview:true,readableLineLength:false}));
await writeFile(join(vault,'.obsidian/community-plugins.json'),JSON.stringify(['coordinated-response-lab']));
await writeFile(join(vault,'.obsidian/core-plugins.json'),JSON.stringify(['file-explorer','command-palette',...(process.argv.includes('--import-save')?['page-preview']:[])]));
await writeFile(join(plugin,'manifest.json'),JSON.stringify({id:'coordinated-response-lab',name:'Isolated native response validation',version:'0.0.1',minAppVersion:'1.8.7',description:process.argv.includes('--autosave-recovery')?'Native autosave checks and one bounded synthetic T3 delivery; no Sync':'Source-only validation; no Sync or T3 dispatch',author:'Local validation',isDesktopOnly:!process.argv.includes('--interaction')}));
await writeFile(join(plugin,'styles.css'),await readFile('styles.css'));
await writeFile(join(profile,'obsidian.json'),JSON.stringify({vaults:{[randomBytes(8).toString('hex')]:{path:vault,ts:Date.now(),open:true}}}));
await build({entryPoints:[process.argv.includes('--thoughts')?'validation/thought-stream-lab.ts':process.argv.includes('--autosave-recovery')?'validation/autosave-recovery-lab.ts':process.argv.includes('--stream-close')?'validation/interrupted-stream-close-lab.ts':process.argv.includes('--palette-selection')?'validation/palette-selection-lab.ts':process.argv.includes('--run-import')?'validation/run-import-lab.ts':process.argv.includes('--stream-stop')?'validation/stream-stop-lab.ts':process.argv.includes('--per-note-sync')?'validation/per-note-sync-lab.ts':process.argv.includes('--import-save')?'validation/import-save-lab.ts':process.argv.includes('--sign-in')?'validation/sign-in-recovery-lab.ts':process.argv.includes('--response-drag')?'validation/response-drag-lab.ts':process.argv.includes('--html')?'validation/html-results-lab.ts':process.argv.includes('--scroll-follow')?'validation/scroll-follow-lab.ts':process.argv.includes('--megapatch-typing')?'validation/megapatch-typing-lab.ts':process.argv.includes('--languages')?'validation/language-views-lab.ts':process.argv.includes('--dense')?'validation/dense-stream-lab.ts':process.argv.includes('--direct')?'validation/direct-inline-lab.ts':process.argv.includes('--codebase')?'validation/codebase-lab.ts':process.argv.includes('--interaction')?'validation/stream-interaction-lab.ts':'validation/stream-interaction-lab.ts'],bundle:true,external:['electron','@electron/remote','obsidian',...editorExternals,'node:*',...builtinModules.filter(name=>name!=='buffer')],platform:'browser',format:'cjs',target:'es2022',outfile:join(plugin,'main.js')});
process.stdout.write(JSON.stringify({root,vault,profile,launchArguments:[`--user-data-dir=${profile}`,'--no-sandbox']})+'\n');
