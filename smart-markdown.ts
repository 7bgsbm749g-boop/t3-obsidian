import {parse,preprocess} from 'micromark';
import {subtokenize} from 'micromark-util-subtokenize';
import {gfmStrikethrough} from 'micromark-extension-gfm-strikethrough';
import type {Span} from './smart-send';

const views=new Map<string,ReturnType<typeof parseMarkdownText>>();
let cachedCharacters=0;
export function markdownText(source:string){
  const cached=views.get(source);if(cached)return cached;
  const view=parseMarkdownText(source);
  if(source.length<=2_000_000){
    views.set(source,view);cachedCharacters+=source.length;
    while(views.size>8||cachedCharacters>2_000_000){const oldest=views.keys().next().value!;views.delete(oldest);cachedCharacters-=oldest.length;}
  }
  return view;
}
export function mergeSpans(items:Span[]):Span[]{
  const out:Span[]=[];
  for(const [from,to] of items.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0])){const last=out.at(-1);if(last&&from<=last[1])last[1]=Math.max(to,last[1]);else out.push([from,to]);}
  return out;
}
export function subtractSpans(wanted:Span[],covered:Span[]):Span[]{
  const out:Span[]=[];
  for(const [from,to] of wanted){let cursor=from;for(const [left,right] of covered){if(right<=cursor||left>=to)continue;if(left>cursor)out.push([cursor,left]);cursor=Math.max(cursor,right);}if(cursor<to)out.push([cursor,to]);}
  return out;
}
/** Comparison omits parsed decoration, never literal code, escapes or URLs.
 * Offsets and wrapper pairs keep selections and outgoing Markdown intact. */
function parseMarkdownText(source:string){
  const marks:Array<{content:Span;syntax:Span[];container?:Span}>=[];
  const tasks:Span[]=[],headers:Span[]=[],quotes:Span[]=[];
  const events=parse({extensions:[gfmStrikethrough({singleTilde:false})]}).document().write(preprocess()(source,undefined,true));
  while(!subtokenize(events)){}
  for(const [kind,token] of events){
    const name=token.type,from=token.start.offset,to=token.end.offset;
    if(name==='blockQuote'&&kind==='exit'){quotes.pop();continue;}
    if(kind!=='enter')continue;
    if(name==='listItemPrefix'&&/^\[[ xX]\](?=[ \t])/.test(source.slice(to)))tasks.push([to,to+3]);
    if(['emphasis','strong','strikethrough'].includes(name)){
      const width=name==='emphasis'?1:2;
      marks.push({content:[from,to],syntax:[[from,from+width],[to-width,to]]});
    }
    if(name==='blockQuotePrefix'&&!headers.some(([a,b])=>a<=from&&b>=to)){
      marks.push({content:[from,source.indexOf('\n',to)<0?source.length:source.indexOf('\n',to)],container:quotes.at(-1),syntax:[[from,to]]});
    }
    if(name==='blockQuote'){
      quotes.push([from,to]);
      const header=/^(?:>\s*)+\[![\w-]+\][+-]?(?:[ \t]+|(?=\n|$))/.exec(source.slice(from,to));
      if(header){const syntax:Span=[from,from+header[0].length+(source[from+header[0].length]==='\n'?1:0)];headers.push(syntax);marks.push({content:[from,to],syntax:[syntax]});}
    }
  }
  const ignored=mergeSpans(marks.flatMap(mark=>mark.syntax)),segments:Array<{raw:Span;plain:Span}>=[];
  let text='';
  for(const raw of subtractSpans([[0,source.length]],ignored)){const from=text.length;text+=source.slice(...raw);segments.push({raw,plain:[from,text.length]});}
  const map=(spans:Span[],reverse=false)=>{
    const out:Span[]=[];
    for(const [from,to] of spans){
      let low=0,high=segments.length;
      while(low<high){const middle=(low+high)>>>1;if((reverse?segments[middle].plain:segments[middle].raw)[1]<=from)low=middle+1;else high=middle;}
      for(let i=low;i<segments.length;i++){
        const segment=segments[i],[a,b]=reverse?segment.plain:segment.raw,[target]=reverse?segment.raw:segment.plain;
        if(a>=to)break;const left=Math.max(from,a),right=Math.min(to,b);if(right>left)out.push([target+left-a,target+right-a]);
      }
    }
    return mergeSpans(out);
  };
  const taskText=map(tasks);
  return {text,map,marks,
    render:(spans:Span[])=>mergeSpans([...spans,...taskText.filter(([a,b])=>spans.some(([from,to])=>from<b&&to>a))]).map(span=>{
      const value=text.slice(...span),leading=/^\s*/.exec(value)![0],trailing=/\s*$/.exec(value)![0];
      if(!value.trim())return '';
      const parts=map([[span[0]+leading.length,span[1]-trailing.length]],true);if(!parts.length)return '';
      const raw:Span=[parts[0][0],parts.at(-1)![1]];
      const syntax=marks.filter(({content:[from,to]})=>from<raw[1]&&to>raw[0]).flatMap(mark=>mark.syntax);
      return leading+mergeSpans([raw,...syntax]).map(range=>source.slice(...range)).join('')+trailing;
    }).filter(text=>text.trim()).join('\n'),
  };
}
