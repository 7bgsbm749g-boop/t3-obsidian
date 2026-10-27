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
    // The LR C++ parser reports false directive errors on preserved CRLF text.
    // Its official stream grammar shares C's byte-preserving editor path.
    case 'cpp':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).cpp));
    case 'java':return (await import('@codemirror/lang-java')).java();
    case 'sql':return (await import('@codemirror/lang-sql')).sql();
    case 'rust':return (await import('@codemirror/lang-rust')).rust();
    case 'go':return (await import('@codemirror/lang-go')).go();
    case 'php':return (await import('@codemirror/lang-php')).php();
    case 'html':return (await import('@codemirror/lang-html')).html();
    case 'yaml':return (await import('@codemirror/lang-yaml')).yaml();
    case 'xml':return (await import('@codemirror/lang-xml')).xml();
    case 'csharp':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).csharp));
    case 'visual-basic':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/vb')).vb));
    case 'r':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/r')).r));
    case 'ruby':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/ruby')).ruby));
    case 'kotlin':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).kotlin));
    case 'swift':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/swift')).swift));
    case 'dart':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).dart));
    case 'bash':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell));
    case 'powershell':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/powershell')).powerShell));
    case 'lua':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/lua')).lua));
    case 'toml':return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml));
  }
}
