/** No Obsidian, CodeMirror, or grammar initialization in the routing layer. */
export type CodeViewType='typescript'|'javascript'|'json'|'css'|'python'|'plaintext';
export type CodeGrammar=Exclude<CodeViewType,'plaintext'>|'tsx'|'jsx';
export interface CodeLanguage {type:CodeViewType;grammar?:CodeGrammar;extensions:readonly string[]}
export const CODE_LANGUAGES:readonly CodeLanguage[]=[
  {type:'typescript',grammar:'typescript',extensions:['ts','mts','cts']},
  {type:'typescript',grammar:'tsx',extensions:['tsx']},
  {type:'javascript',grammar:'javascript',extensions:['js','mjs','cjs']},
  {type:'javascript',grammar:'jsx',extensions:['jsx']},
  {type:'json',grammar:'json',extensions:['json']},
  {type:'css',grammar:'css',extensions:['css']},
  {type:'python',grammar:'python',extensions:['py','pyw']},
  {type:'plaintext',extensions:[]},
];
export const CODE_VIEW_TYPES:readonly CodeViewType[]=['typescript','javascript','json','css','python','plaintext'];
export const MAX_CODE_PARSE_LENGTH=300_000;
export function codeLanguage(extension:string):CodeLanguage|undefined {
  const ext=extension.toLowerCase();if(ext==='md')return undefined;
  return CODE_LANGUAGES.find(profile=>profile.extensions.includes(ext))??CODE_LANGUAGES[CODE_LANGUAGES.length-1];
}
export function nativeLanguageVersion(version:string):boolean {
  const match=/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);if(!match)return false;
  const major=Number(match[1]),minor=Number(match[2]),patch=Number(match[3]);return major===1&&(minor===13&&patch>=7||minor===14);
}
/** Presence matters: image/HTML-only transfers must not erase a selection. */
export function plainTransfer(transfer:Pick<DataTransfer,'types'|'getData'>|null):string|undefined {
  return transfer&&Array.from(transfer.types).includes('text/plain')?transfer.getData('text/plain'):undefined;
}
/** A linear scan avoids argument limits and handles hostile delimiter runs. */
export function codeReadingFence(text:string,grammar?:string):string {
  let run=0,longest=2;for(let index=0;index<text.length;index++){if(text.charCodeAt(index)===96){run++;if(run>longest)longest=run;}else run=0;}
  const fence='`'.repeat(longest+1);return `${fence}${grammar??''}\n${text}${text.endsWith('\n')?'':'\n'}${fence}`;
}
export class CodeGrammarCache<T> {
  private pending=new Map<CodeGrammar,Promise<T>>();
  constructor(private load:(grammar:CodeGrammar)=>Promise<T>){}
  get(grammar:CodeGrammar):Promise<T> {
    const existing=this.pending.get(grammar);if(existing)return existing;
    const work=Promise.resolve().then(()=>this.load(grammar));this.pending.set(grammar,work);
    void work.catch(()=>{if(this.pending.get(grammar)===work)this.pending.delete(grammar);});return work;
  }
}
