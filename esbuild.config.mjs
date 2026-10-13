import {build} from 'esbuild';
import {builtinModules} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

// Obsidian provides one shared editor runtime. Grammar packages must not bundle
// a second state, language, or parser runtime with incompatible identities.
export const editorExternals=['@codemirror/view','@codemirror/state','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight'];

export function desktopTimersPlugin(){
  return {name:'desktop-lock-timers',setup(build){
    // proper-lockfile is loaded only by the desktop host. Its bundled global
    // timers otherwise become throttled renderer timers too, risking a stale
    // coordinator lock while the desktop is still running.
    build.onLoad({filter:/[\\/]proper-lockfile[\\/]lib[\\/]lockfile\.js$/},async ({path})=>({
      contents:"const {setTimeout,clearTimeout}=require('node:timers');\n"+await readFile(path,'utf8'),
      loader:'js',resolveDir:dirname(path),
    }));
  }};
}

async function main(){
  await mkdir('dist',{recursive:true});
  const host=await build({entryPoints:['response-host-entry.ts'],bundle:true,external:['obsidian',...editorExternals,'node:*'],platform:'node',format:'cjs',target:'node22',write:false});
  const payload=gzipSync(host.outputFiles[0].contents).toString('base64');
  await build({entryPoints:['main.ts'],bundle:true,external:['obsidian',...editorExternals,'node:*',...builtinModules.filter(n=>n!=='buffer')],platform:'browser',format:'cjs',target:'es2022',outfile:'dist/main.js',plugins:[desktopTimersPlugin()],footer:{js:`// T3_RESPONSE_HOST_RUNTIME_V1:${payload}`}});
}
if(process.argv[1]===fileURLToPath(import.meta.url))void main().catch(error=>{console.error(error);process.exitCode=1;});
