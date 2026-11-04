import type {ChangeDesc,Text} from '@codemirror/state';
import type {TreeFragment,ChangedRange,Tree} from '@lezer/common';
import type {ResponseBoundary} from './response-container';

// This private incremental parser does not install a language or change the
// native editor grammar. Like the canonical code-range query, it recognizes
// Markdown code inside tool HTML. HTML pre/code spans are protected separately.
let runtime:{DocInput:typeof import('@codemirror/language').DocInput;TreeFragment:typeof import('@lezer/common').TreeFragment;markdown:typeof import('@lezer/markdown').parser}|undefined;
function editorParser(){
  if(!runtime){
    // Match the existing editor extension's lazy loading. Startup, read-only
    // commands and mobile account actions must not load the editor runtime.
    const {DocInput}=require('@codemirror/language') as typeof import('@codemirror/language');
    const {TreeFragment}=require('@lezer/common') as typeof import('@lezer/common');
    const {parser}=require('@lezer/markdown') as typeof import('@lezer/markdown');
    runtime={DocInput,TreeFragment,markdown:parser.configure({remove:['HTMLBlock','HTMLTag']})};
  }
  return runtime;
}
const expression=/:::[A-Za-z][\w-]* data-t3-response="[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"|:::\/send-to-t3-response/g;
const htmlTags=/<\/?(?:pre|code)\b[^>]*>/gi;
type Candidate={from:number;to:number;text:string};
type Span={from:number;to:number};

function scan(doc:Text,from:number,to:number):Candidate[]{
  const source=doc.sliceString(from,to);
  // An unfinished HTML tag can consume a later directive in a regex match.
  // Discover the two kinds independently; only a complete tag pair hides code.
  return [...source.matchAll(expression),...source.matchAll(htmlTags)].map(match=>({from:from+match.index!,to:from+match.index!+match[0].length,text:match[0]})).sort((a,b)=>a.from-b.from);
}
function codeAt(tree:Tree,position:number){
  for(let node=tree.resolve(position,1);node;node=node.parent!)if(['FencedCode','CodeBlock','InlineCode'].includes(node.name))return true;
  return false;
}
function escaped(doc:Text,position:number){
  let count=0;while(position>0&&doc.sliceString(position-1,position)==='\\'){position--;count++;}return count%2===1;
}
function boundaries(doc:Text,candidates:readonly Candidate[],tree?:Tree):ResponseBoundary[]{
  if(!tree)return [];
  const html=new Map<string,Candidate>(),protectedHtml:Span[]=[],result:ResponseBoundary[]=[],sections:Array<ResponseBoundary|undefined>=[];
  for(const token of candidates){
    const tag=/^<(\/)?(pre|code)\b/i.exec(token.text);if(!tag||codeAt(tree,token.from))continue;
    const name=tag[2].toLowerCase();
    if(!tag[1]){if(!html.has(name))html.set(name,token);}
    else{const opening=html.get(name);if(opening){protectedHtml.push({from:opening.from,to:token.to});html.delete(name);}}
  }
  for(const token of candidates){
    if(!token.text.startsWith(':::')||codeAt(tree,token.from)||protectedHtml.some(range=>token.from>=range.from&&token.from<range.to)||escaped(doc,token.from))continue;
    if(token.text===':::/send-to-t3-response'){
      const opening=sections.pop();if(opening)result.push({...opening,kind:'end',...token});
    }else{
      const id=/\bdata-t3-response="([0-9a-fA-F-]+)"/.exec(token.text)?.[1];
      const opening=id?{id,kind:'start' as const,format:'container' as const,...token}:undefined;
      sections.push(opening);if(opening)result.push(opening);
    }
  }
  return result.sort((a,b)=>a.from-b.from);
}

/** Index marker candidates in the Text rope. Edits rescan changed lines and
 * touched HTML tags only. Unchanged Markdown blocks reuse their syntax trees;
 * a legacy-only or marker-free note never starts this parser. */
export class ContainerMarkerIndex {
  readonly boundaries:readonly ResponseBoundary[];
  private constructor(private candidates:readonly Candidate[],private tree:Tree|undefined,private fragments:readonly TreeFragment[],doc:Text){this.boundaries=boundaries(doc,candidates,tree);}
  static create(doc:Text){return this.parse(doc,scan(doc,0,doc.length),[]);}
  private static parse(doc:Text,candidates:readonly Candidate[],fragments:readonly TreeFragment[]){
    if(!candidates.some(token=>token.text.startsWith(':::')))return new ContainerMarkerIndex(candidates,undefined,[],doc);
    const {markdown,DocInput,TreeFragment}=editorParser(),tree=markdown.parse(new DocInput(doc),fragments);
    return new ContainerMarkerIndex(candidates,tree,TreeFragment.addTree(tree),doc);
  }
  update(changes:ChangeDesc,doc:Text){
    if(changes.empty)return this;
    const changed:ChangedRange[]=[],windows:Span[]=[];
    changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
      changed.push({fromA,toA,fromB,toB});
      let from=doc.lineAt(Math.max(0,fromB-1)).from,to=doc.lineAt(Math.min(doc.length,toB+1)).to;
      // Editing a multiline HTML tag must invalidate its entire old extent.
      for(const token of this.candidates)if(token.from<=toA&&token.to>=fromA){from=Math.min(from,changes.mapPos(token.from,-1));to=Math.max(to,changes.mapPos(token.to,1));}
      windows.push({from,to});
    });
    windows.sort((a,b)=>a.from-b.from);
    const merged:Span[]=[];
    for(const window of windows){const last=merged.at(-1);if(last&&window.from<=last.to)last.to=Math.max(last.to,window.to);else merged.push({...window});}
    const candidates=this.candidates.map(token=>({...token,from:changes.mapPos(token.from,1),to:changes.mapPos(token.to,-1)})).filter(token=>token.from<token.to&&!merged.some(window=>token.from<=window.to&&token.to>=window.from));
    for(const window of merged)candidates.push(...scan(doc,window.from,window.to));
    candidates.sort((a,b)=>a.from-b.from);
    return ContainerMarkerIndex.parse(doc,candidates,this.fragments.length?editorParser().TreeFragment.applyChanges(this.fragments,changed):[]);
  }
}
