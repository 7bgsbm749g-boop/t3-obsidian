import {LanguageSupport,StreamLanguage} from '@codemirror/language';
import type {CodeGrammar} from './code-language';
/** esbuild initializes each bundled grammar only when this branch is reached. */
export async function loadCodeGrammar(grammar:CodeGrammar):Promise<LanguageSupport> {
  switch(grammar){
    case 'typescript':return (await import('@codemirror/lang-javascript')).javascript({typescript:true});
    case 'tsx':return (await import('@codemirror/lang-javascript')).javascript({typescript:true,jsx:true});
    case 'javascript':return (await import('@codemirror/lang-javascript')).javascript();
    case 'jsx':return (await import('@codemirror/lang-javascript')).javascript({jsx:true});
    case 'json':return (await import('@codemirror/lang-json')).json();
    case 'css':return (await import('@codemirror/lang-css')).css();
    case 'python':return (await import('@codemirror/lang-python')).python();
    case 'c':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).c));
  }
}
