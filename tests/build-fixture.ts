import * as esbuild from 'esbuild';
import {editorExternals} from '../esbuild.config.mjs';
/** Match production's shared SDK identity and deferred native CJS imports. */
export const build:typeof esbuild.build=options=>esbuild.build({...options,external:[...new Set(['obsidian',...editorExternals,...options.external??[]])],supported:{...options.supported,'dynamic-import':false}});
