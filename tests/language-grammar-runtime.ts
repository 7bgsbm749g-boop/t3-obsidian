import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import type {CodeGrammar} from '../code-language';
import type {LanguageSupport} from '@codemirror/language';

// Match the plugin's bundled grammar modules and one shared CJS editor runtime.
// Direct Node import() selects ESM packages beside tsx's CJS test imports.
const external=['@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight'];
const runtime=createRequire(process.cwd()+'/package.json');
let pending:Promise<{loadCodeGrammar:(grammar:CodeGrammar)=>Promise<LanguageSupport>}>|undefined;
export function grammarRuntime(){
  return pending??=build({entryPoints:['language-grammars.ts'],bundle:true,write:false,platform:'node',format:'cjs',external}).then(result=>{
    const module={exports:{} as any};
    runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:runtime,console,setTimeout,clearTimeout,queueMicrotask});
    return module.exports;
  });
}
