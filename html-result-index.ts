import type {ChangeDesc,Text} from '@codemirror/state';
import type {ChangedRange,TreeFragment} from '@lezer/common';
import {htmlResultBlocks,type HtmlResultReference} from './html-results';

let runtime:{DocInput:typeof import('@codemirror/language').DocInput;TreeFragment:typeof import('@lezer/common').TreeFragment;parser:typeof import('@lezer/markdown').parser}|undefined;
function editorParser(){
  if(!runtime){
    const {DocInput}=require('@codemirror/language') as typeof import('@codemirror/language');
    const {TreeFragment}=require('@lezer/common') as typeof import('@lezer/common');
    const {parser}=require('@lezer/markdown') as typeof import('@lezer/markdown');
    runtime={DocInput,TreeFragment,parser};
  }
  return runtime;
}
type Block={from:number;to:number;reference:HtmlResultReference};
type Span={from:number;to:number};
function scan(doc:Text,from:number,to:number):number[]{
  return [...doc.sliceString(from,to).matchAll(/^ {0,3}```t3-html\r?$/gm)].map(match=>from+match.index!+match[0].indexOf('`'));
}

/** Scan only changed lines for possible references. Reused Markdown fragments
 * still account for distant fence, list and HTML-block context edits. Remark
 * validates each changed top-level fence in isolation, never the whole note. */
export class HtmlResultIndex {
  private constructor(readonly blocks:readonly Block[],private candidates:readonly number[],private fragments:readonly TreeFragment[],private references:ReadonlyMap<string,HtmlResultReference|undefined>){}
  static create(doc:Text){return this.parse(doc,scan(doc,0,doc.length),[],new Map());}
  private static parse(doc:Text,candidates:readonly number[],fragments:readonly TreeFragment[],previous:ReadonlyMap<string,HtmlResultReference|undefined>){
    if(!candidates.length)return new HtmlResultIndex([],[],[],new Map());
    const {parser,DocInput,TreeFragment}=editorParser(),tree=parser.parse(new DocInput(doc),fragments);
    const blocks:Block[]=[],references=new Map<string,HtmlResultReference|undefined>();
    for(const position of candidates){
      let node=tree.resolve(position,1);while(node.parent&&node.name!=='FencedCode')node=node.parent;
      if(node.name!=='FencedCode'||node.parent?.name!=='Document'||node.from!==position)continue;
      // Incomplete/oversized code cannot hold a valid bounded reference. The
      // factor allows Remark's removal of up to three indentation spaces per
      // payload line. Exclude trailing closing-line whitespace from the cache.
      const close=node.lastChild,code=node.getChild('CodeText');
      if(close?.name!=='CodeMark'||!code||code.to-code.from>8192*4)continue;
      // Retain the opener's indentation so Remark removes the same indentation
      // from the payload as it does in the complete document.
      const source=doc.sliceString(doc.lineAt(node.from).from,close.to);
      const reference=previous.has(source)?previous.get(source):htmlResultBlocks(source)[0]?.reference;
      references.set(source,reference);
      if(reference)blocks.push({from:node.from,to:node.to,reference});
    }
    return new HtmlResultIndex(blocks,candidates,TreeFragment.addTree(tree),references);
  }
  update(changes:ChangeDesc,doc:Text){
    if(changes.empty)return this;
    const changed:ChangedRange[]=[],windows:Span[]=[];
    changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
      changed.push({fromA,toA,fromB,toB});
      windows.push({from:doc.lineAt(Math.max(0,fromB-1)).from,to:doc.lineAt(Math.min(doc.length,toB+1)).to});
    });
    windows.sort((a,b)=>a.from-b.from);const merged:Span[]=[];
    for(const window of windows){const last=merged.at(-1);if(last&&window.from<=last.to)last.to=Math.max(last.to,window.to);else merged.push({...window});}
    const candidates=this.candidates.map(position=>changes.mapPos(position,1)).filter(position=>!merged.some(window=>position>=window.from&&position<=window.to));
    for(const window of merged)candidates.push(...scan(doc,window.from,window.to));
    candidates.sort((a,b)=>a-b);
    return HtmlResultIndex.parse(doc,candidates,this.fragments.length?editorParser().TreeFragment.applyChanges(this.fragments,changed):[],this.references);
  }
}
