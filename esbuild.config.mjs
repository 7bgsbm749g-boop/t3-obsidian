import {build} from 'esbuild';
import {builtinModules} from 'node:module';
import {mkdir} from 'node:fs/promises';

await mkdir('dist',{recursive:true});
await build({entryPoints:['main.ts'],bundle:true,external:['obsidian','@codemirror/view','@codemirror/state','node:*',...builtinModules.filter(n=>n!=='buffer')],platform:'browser',format:'cjs',target:'es2022',outfile:'dist/main.js'});
