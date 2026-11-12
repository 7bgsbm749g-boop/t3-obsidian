import {build} from 'esbuild';
import {mkdir,writeFile,copyFile,access,readFile,readdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {editorExternals} from '../esbuild.config.mjs';
import {requireEvidenceDirectory} from './evidence-paths.mjs';
const [destination,asar]=process.argv.slice(2);if(!destination||!asar)throw Error('Supply a new external evidence directory and Obsidian ASAR.');
const root=await requireEvidenceDirectory(destination);
try{await access(root);throw Error('Use a new lab directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
// The evidence store may be remote. Keep the live app and its databases local.
await mkdir(root);const runtime=await mkdtemp(join(tmpdir(),'t3-floating-panels-'));
const vault=join(runtime,'vault'),profile=join(runtime,'profile'),plugin=join(vault,'.obsidian/plugins/floating-panels-lab');await mkdir(plugin,{recursive:true});await mkdir(profile);
await writeFile(join(runtime,'REPORTS.json'),JSON.stringify({evidence:root}));
await writeFile(join(runtime,'ISOLATED-NATIVE-LAB'),'Production UI components with synthetic API inputs. No Sync.\n');
await copyFile(asar,join(profile,asar.split('/').at(-1)));await writeFile(join(profile,'obsidian.json'),JSON.stringify({vaults:{[randomBytes(8).toString('hex')]:{path:vault,ts:Date.now(),open:true}}}));
for(const [name,value] of Object.entries({'community-plugins':['floating-panels-lab'],'core-plugins':['command-palette'],app:{safeMode:false},appearance:{theme:'obsidian'}}))await writeFile(join(vault,'.obsidian',name+'.json'),JSON.stringify(value));
await copyFile('styles.css',join(plugin,'styles.css'));await writeFile(join(plugin,'manifest.json'),JSON.stringify({id:'floating-panels-lab',name:'Floating controls design lab',version:'0.0.1',minAppVersion:'1.13.0',author:'Local validation',description:'Isolated production UI checks.',isDesktopOnly:true}));
await build({entryPoints:['tests/native/floating-panels-lab.ts'],bundle:true,platform:'browser',format:'cjs',external:['obsidian','@electron/remote','node:*',...editorExternals],target:'es2022',outfile:join(plugin,'main.js')});
const files={};for(const file of ['styles.css','tests/native/floating-panels-lab.ts',...(await readdir('src',{recursive:true})).filter(name=>name.endsWith('.ts')).map(name=>'src/'+name)])files[file]=createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile(join(root,'BUILD-SOURCE.json'),JSON.stringify({sourceRoot:process.cwd(),files,syntheticApiData:true},null,2));console.log(JSON.stringify({root,runtime,vault,profile}));
