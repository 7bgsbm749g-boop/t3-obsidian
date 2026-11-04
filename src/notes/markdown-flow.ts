import {parse,preprocess} from 'micromark';
import {subtokenize} from 'micromark-util-subtokenize';

/** CommonMark block context without allocating an inline AST. A token at a
 * paragraph's first character cannot be inside an earlier inline code span. */
export function markdownFlowContext(markdown:string){
 // eslint-disable-next-line no-unsanitized/method -- Markdown tokenizer, not DOM Document.write.
 const events=parse().document().write(preprocess()(markdown,undefined,true));
 for(;;){
  for(const [kind,token] of events)if(kind==='enter'&&(token.contentType==='text'||token.contentType==='string'))token.contentType=undefined;
  if(subtokenize(events))break;
 }
 const code:Array<[number,number]>=[],paragraphStarts=new Set<number>();
 for(const [kind,token] of events)if(kind==='enter'){
  if(token.type==='codeFenced'||token.type==='codeIndented')code.push([token.start.offset,token.end.offset]);
  if(token.type==='paragraph')paragraphStarts.add(token.start.offset);
 }
 return {code,paragraphStarts};
}
