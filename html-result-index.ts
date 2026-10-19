import type {ChangeDesc,Text} from '@codemirror/state';
import {parse,preprocess} from 'micromark';
import {subtokenize} from 'micromark-util-subtokenize';
import {htmlResultBlocks,type HtmlResultReference} from './html-results';

type Block={from:number;to:number;reference:HtmlResultReference};
type Fence={from:number;to:number;source:string;reference:HtmlResultReference|undefined};
type Span={from:number;to:number};
function scan(doc:Text,from:number,to:number):number[]{
  return [...doc.sliceString(from,to).matchAll(/^ {0,3}```t3-html\r?$/gm)].map(match=>from+match.index!+match[0].indexOf('`'));
}

/** Use Remark's own flow grammar. Inline text and string decoding cannot affect
 * block boundaries, so leave those tokens unexpanded. A blank line outside any
 * top-level token is a restart point; blanks inside lists, code or HTML aren't.
 * Definitions and their following paragraph stay in the same content token. */
function section(doc:Text,from:number,to:number,candidates:ReadonlySet<number>,references:Map<string,HtmlResultReference|undefined>){
  const events=parse().document().write(preprocess()(doc.sliceString(from,to),undefined,true));
  for(;;){
    for(const [kind,token] of events)if(kind==='enter'&&(token.contentType==='text'||token.contentType==='string'))token.contentType=undefined;
    if(subtokenize(events))break;
  }
  const boundaries:number[]=[],fences:Fence[]=[],paragraphs:Span[]=[];
  let depth=0,opener:number|undefined,closingEnd=0,pendingBoundary:number|undefined;
  for(const [kind,token] of events){
    if(kind==='exit')depth--;
    if(depth===0){
      if(kind==='exit'&&token.type==='lineEndingBlank')pendingBoundary=from+token.end.offset;
      if(kind==='enter'&&!['lineEnding','lineEndingBlank','linePrefix','lineSuffix'].includes(token.type)&&pendingBoundary!==undefined){
        // Commit a blank run only after seeing the following block. At EOF a
        // list/indented-code block can still absorb blanks and later content.
        boundaries.push(pendingBoundary);pendingBoundary=undefined;
      }
      if(token.type==='codeFenced'){
        if(kind==='enter'){opener=from+token.start.offset;closingEnd=0;}
        else if(opener!==undefined&&candidates.has(opener)&&closingEnd>opener){
          // Each payload character can have up to three indentation spaces
          // removed. Exclude the closing fence's arbitrary trailing whitespace.
          const start=doc.lineAt(opener).from;
          if(closingEnd-start<=8192*4+32){
            const source=doc.sliceString(start,closingEnd);
            const reference=references.has(source)?references.get(source):htmlResultBlocks(source)[0]?.reference;
            references.set(source,reference);fences.push({from:opener,to:from+token.end.offset,source,reference});
          }
          opener=undefined;
        }
      }
    }
    if(kind==='enter'&&depth===1&&token.type==='paragraph'&&/^[a-z]$/i.test(doc.sliceString(from+token.start.offset,from+token.start.offset+1))){
      paragraphs.push({from:from+token.start.offset,to:from+token.end.offset});
    }
    if(kind==='exit'&&token.type==='codeFencedFenceSequence')closingEnd=from+token.end.offset;
    if(kind==='enter')depth++;
  }
  return {boundaries,fences,paragraphs};
}

/** Candidate discovery visits changed lines only. Context uses the same grammar
 * as full Remark, cached between verified top-level blank-line boundaries.
 * Reparse the edited section plus lookahead, then reuse the unchanged suffix
 * only if its restart boundary still exists. A newly unclosed container can
 * require the whole suffix; geometric window growth bounds repeated parsing. */
export class HtmlResultIndex {
  readonly blocks:readonly Block[];
  private constructor(private doc:Text,private candidates:readonly number[],private boundaries:readonly number[],private fences:readonly Fence[],private paragraphs:readonly Span[]){
    this.blocks=fences.flatMap(({from,to,reference})=>reference?[{from,to,reference}]:[]);
  }
  static create(doc:Text){
    const candidates=scan(doc,0,doc.length);
    if(!candidates.length)return new HtmlResultIndex(doc,[],[],[],[]);
    const parsed=section(doc,0,doc.length,new Set(candidates),new Map());
    return new HtmlResultIndex(doc,candidates,[0,...parsed.boundaries.filter(position=>position<doc.length),doc.length],parsed.fences,parsed.paragraphs);
  }
  update(changes:ChangeDesc,doc:Text){
    if(changes.empty)return this;
    // A line that keeps its initial ASCII letter cannot become a flow opener.
    // Within a paragraph that also starts with a letter, such edits cannot
    // complete a pending definition. Preserve that proven context directly,
    // including in very long paragraphs without blank-line restart points.
    let ordinary=this.candidates.length>0;
    changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
      const before=this.doc.lineAt(fromA),after=doc.lineAt(fromB);
      if(toA>before.to||toB>after.to||!this.paragraphs.some(span=>fromA>=span.from&&toA<=span.to)
        ||!(/^[a-z]$/i.test(this.doc.sliceString(before.from,before.from+1))&&/^[a-z]$/i.test(doc.sliceString(after.from,after.from+1))))ordinary=false;
    });
    const moveFence=(fence:Fence)=>({...fence,from:changes.mapPos(fence.from,1),to:changes.mapPos(fence.to,-1)});
    const moveParagraph=(span:Span)=>({from:changes.mapPos(span.from,-1),to:changes.mapPos(span.to,1)});
    if(ordinary)return new HtmlResultIndex(doc,this.candidates.map(position=>changes.mapPos(position,1)),
      this.boundaries.map((position,index)=>changes.mapPos(position,index===this.boundaries.length-1?1:-1)),this.fences.map(moveFence),this.paragraphs.map(moveParagraph));
    const windows:Span[]=[];let first=changes.length,last=0;
    changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
      first=Math.min(first,fromA);last=Math.max(last,toA);
      windows.push({from:doc.lineAt(Math.max(0,fromB-1)).from,to:doc.lineAt(Math.min(doc.length,toB+1)).to});
    });
    windows.sort((a,b)=>a.from-b.from);const merged:Span[]=[];
    for(const window of windows){const previous=merged.at(-1);if(previous&&window.from<=previous.to)previous.to=Math.max(previous.to,window.to);else merged.push({...window});}
    const candidates=this.candidates.map(position=>changes.mapPos(position,1)).filter(position=>!merged.some(window=>position>=window.from&&position<=window.to));
    for(const window of merged)candidates.push(...scan(doc,window.from,window.to));
    candidates.sort((a,b)=>a-b);
    if(!candidates.length)return new HtmlResultIndex(doc,[],[],[],[]);
    if(!this.candidates.length)return HtmlResultIndex.create(doc);

    // Include the preceding section even for edits inside leading whitespace:
    // adding indentation can extend the previous list or indented-code block.
    let startIndex=0;while(startIndex+1<this.boundaries.length-1&&this.boundaries[startIndex+1]<=first)startIndex++;
    startIndex=Math.max(0,startIndex-1);
    const from=changes.mapPos(this.boundaries[startIndex],-1),mapped=this.boundaries.map(position=>changes.mapPos(position,1));
    const joins=new Set(mapped.filter((_,index)=>index>startIndex&&this.boundaries[index]>last));
    let endIndex=startIndex+1;while(endIndex<this.boundaries.length-1&&this.boundaries[endIndex]<=last)endIndex++;
    let to=mapped[Math.min(endIndex+1,mapped.length-1)];
    const references=new Map(this.fences.map(fence=>[fence.source,fence.reference])),candidateSet=new Set(candidates);
    for(;;){
      const parsed=section(doc,from,to,candidateSet,references);
      const join=parsed.boundaries.find(position=>position<to&&joins.has(position));
      if(join!==undefined||to===doc.length){
        const end=join??doc.length;
        const fences=[...this.fences.filter(fence=>fence.to<=this.boundaries[startIndex]).map(moveFence),
          ...parsed.fences.filter(fence=>fence.from<end),
          ...this.fences.filter(fence=>changes.mapPos(fence.from,1)>=end).map(moveFence)];
        const paragraphs=[...this.paragraphs.filter(span=>span.to<=this.boundaries[startIndex]).map(moveParagraph),
          ...parsed.paragraphs.filter(span=>span.from<end),...this.paragraphs.filter(span=>changes.mapPos(span.from,1)>=end).map(moveParagraph)];
        const boundaries=[...mapped.filter((_,index)=>index<startIndex),from,...parsed.boundaries.filter(position=>position<end),...mapped.filter(position=>position>=end)];
        // A changed final section might have mapped an old boundary beyond the
        // end. Keep the actual document end as the sole terminal sentinel.
        return new HtmlResultIndex(doc,candidates,[...new Set([...boundaries.filter(position=>position<doc.length),doc.length])],fences,paragraphs);
      }
      const target=to+Math.max(1,to-from);
      while(endIndex<mapped.length-1&&mapped[endIndex]<target)endIndex++;
      to=mapped[endIndex];
    }
  }
}
