import {contentHash} from './completion';
import type {InlineActivity} from './inline-thread';
import {unified} from 'unified';
import remarkParse from 'remark-parse';

/** Wire compatibility with T3's html_render result, not arbitrary response HTML. */
export interface HtmlRenderReference {attachmentId:string;title:string;height:number;heights?:Array<[number,number]>}
export interface HtmlResultReference extends HtmlRenderReference {version:1;environmentId:string;threadId:string;runId:string;itemId:string;revision?:string}
export const HTML_RESULT_LANGUAGE='t3-html';
export const HTML_RESULT_MAX_BYTES=25*1024*1024;
const record=(value:any):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:any,max=1024):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
export const htmlResultHeight=(height:number)=>Math.max(80,Math.min(2000,Math.round(height)));

export function readHtmlRenderReference(value:any):HtmlRenderReference|undefined {
  if(!record(value)||!id(value.attachmentId,256)||!/^[a-z0-9_-]+$/i.test(value.attachmentId)||typeof value.title!=='string'||typeof value.height!=='number'||!Number.isFinite(value.height))return;
  const heights=value.heights;
  const measured=Array.isArray(heights)&&heights.length>0&&heights.length<=24&&heights.every(row=>Array.isArray(row)&&row.length===2&&Number.isInteger(row[0])&&row[0]>0&&row[0]<=10_000&&typeof row[1]==='number'&&Number.isFinite(row[1]))
    ? heights.map(([width,height]:[number,number])=>[width,htmlResultHeight(height)] as [number,number]).sort((a,b)=>a[0]-b[0]):undefined;
  return {attachmentId:value.attachmentId,title:value.title.replace(/[\x00-\x1f]/g,' ').trim().slice(0,200)||'HTML',height:htmlResultHeight(value.height),...(measured?{heights:measured}:{})};
}

/** Providers wrap MCP results differently. Match T3's bounded result reader,
 * including error flags in any enclosing content envelope. */
export function htmlRenderFromToolItem(item:any):HtmlRenderReference|undefined {
  if(item?.type!=='dynamic_tool'||item.status!=='completed'||typeof item.toolName!=='string'||! /^(?:(?:mcp__t3[-_]code__|t3[-_]code[.]))?html_render$/.test(item.toolName))return;
  const budget={bytes:16_384,nodes:128,failed:false,exceeded:false};
  function read(value:any,depth=0):Record<string,any>|undefined {
    if(depth>4||--budget.nodes<0){budget.exceeded=true;return;}
    if(typeof value==='string'){
      if(value.length>budget.bytes){budget.exceeded=true;return;}
      budget.bytes-=new TextEncoder().encode(value).byteLength;if(budget.bytes<0){budget.exceeded=true;return;}
      try{return read(JSON.parse(value),depth+1);}catch{return;}
    }
    if(Array.isArray(value)){
      if(value.length>32){budget.exceeded=true;return;}
      let found:Record<string,any>|undefined;
      for(const block of value){const text=record(block)?block.text:undefined;const next=read(record(text)?text.text??text:text,depth+1);found??=next;if(budget.exceeded)break;}
      return found;
    }
    if(!record(value))return;
    budget.failed||=value.isError===true||value.is_error===true||value.error!=null||value._tag==='OrchestratorMcpFailure';
    const nested=value.structuredContent??value.content;
    return nested!==undefined?read(nested,depth+1):value;
  }
  const value=read(item.output);
  return budget.failed||budget.exceeded?undefined:readHtmlRenderReference(value?.htmlRender);
}

export function readHtmlResult(value:any):HtmlResultReference|undefined {
  const page=readHtmlRenderReference(value);
  if(!page||value.version!==1||![value.environmentId,value.threadId,value.runId,value.itemId].every(part=>id(part))||value.revision!==undefined&&!id(value.revision,128))return;
  return {version:1,environmentId:value.environmentId,threadId:value.threadId,runId:value.runId,itemId:value.itemId,...(value.revision?{revision:value.revision}:{}),...page};
}
export function parseHtmlResult(source:string):HtmlResultReference|undefined {
  if(source.length>8192)return;
  try{return readHtmlResult(JSON.parse(source));}catch{return;}
}
export function htmlResultIdentity(value:HtmlResultReference):string {
  return JSON.stringify([value.environmentId,value.threadId,value.runId,value.itemId,value.attachmentId,value.revision??null]);
}
export const htmlResultKey=(value:HtmlResultReference)=>contentHash(htmlResultIdentity(value));
export function renderHtmlResult(value:HtmlResultReference){return '```'+HTML_RESULT_LANGUAGE+'\n'+JSON.stringify(value)+'\n```';}

export function responseHtmlResults(activities:InlineActivity[],turns:string[],environmentId:string|undefined,threadId:string):HtmlResultReference[] {
  if(!environmentId)return [];
  const found=new Map<string,HtmlResultReference>();
  for(const activity of [...activities].sort((a,b)=>(a.sequence??0)-(b.sequence??0))){
    if(activity.kind!=='response.html'||!activity.turnId||!turns.includes(activity.turnId))continue;
    const value=readHtmlResult({version:1,environmentId,threadId,runId:activity.turnId,itemId:activity.payload?.itemId,revision:activity.payload?.revision,...activity.payload?.htmlRender});
    if(value)found.set(value.itemId,value);
  }
  return [...found.values()];
}

/** T3's sizing rule: prefer the live report, retain deliberate scroll caps. */
export function htmlResultFrameHeight(reference:HtmlRenderReference,width:number,reported?:number){
  const rows=reference.heights;
  const measured=(width:number)=>{const above=rows!.findIndex(row=>row[0]>=width),high=above<0?rows!.length-1:above,low=rows![high][0]===width?high:Math.max(0,high-1);return Math.max(rows![low][1],rows![high][1]);};
  const live=reported!==undefined&&Number.isFinite(reported)&&reported>0?reported:undefined;
  if(!rows?.length)return htmlResultHeight(Math.min(reference.height,live??reference.height));
  const cap=measured(728)>reference.height?reference.height:2000;
  return htmlResultHeight(Math.min(cap,live??measured(width)));
}

/** Source-mode references stay ordinary Markdown. Live Preview replaces only
 * complete, top-level, generated fences, never examples in another fence. */
export function htmlResultBlocks(document:string):Array<{from:number;to:number;reference:HtmlResultReference}> {
  const result:Array<{from:number;to:number;reference:HtmlResultReference}>=[];
  if(!document.includes('```'+HTML_RESULT_LANGUAGE))return result;
  for(const node of unified().use(remarkParse).parse(document).children){
    if(node.type!=='code'||node.lang!==HTML_RESULT_LANGUAGE||node.meta)continue;
    const from=node.position?.start.offset,to=node.position?.end.offset;
    if(from===undefined||to===undefined||!/^ {0,3}```t3-html\r?\n/.test(document.slice(from,to))||!/^```\s*$/.test(document.slice(from,to).split('\n').at(-1)??''))continue;
    const reference=parseHtmlResult(node.value);if(reference)result.push({from,to,reference});
  }
  return result;
}
