import {build} from 'esbuild';
import {builtinModules} from 'node:module';
await build({entryPoints:['main.ts'],bundle:true,external:['obsidian','node:*',...builtinModules.filter(n=>n!=='buffer')],platform:'browser',format:'cjs',target:'es2022',outfile:'main.js'});
