import {isRecord} from '../shared/values';
import type {InlineMessage} from './inline-thread';

export interface ChatObservations {source:string;inputTurns:Record<string,string>;inputBoundaries:Record<string,InlineMessage[]>}
/** Local display evidence, scoped to one source. Never an execution binding or
 * a server snapshot field. Keep exact prefixes, with a bounded workspace save. */
export function readChatObservations(value:unknown,source:string):ChatObservations {
  const empty={source,inputTurns:{},inputBoundaries:{}};
  if(!isRecord(value)||value.source!==source)return empty;
  const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=200;
  const inputTurns=Object.fromEntries(Object.entries(isRecord(value.inputTurns)?value.inputTurns:{}).slice(-200).filter((entry):entry is [string,string]=>id(entry[0])&&id(entry[1])));
  const boundaries:Array<[string,InlineMessage[]]>=[];let characters=0,rows=0;
  for(const [key,before] of Object.entries(isRecord(value.inputBoundaries)?value.inputBoundaries:{}).slice(-200).reverse()){
    if(!id(key)||!Array.isArray(before)||before.length>200)continue;
    const messages:InlineMessage[]=[];let size=0;
    for(const item of before as unknown[]){
      if(!isRecord(item)||!id(item.id)||!id(item.turnId)||item.role!=='assistant'||typeof item.text!=='string'||typeof item.streaming!=='boolean')break;
      size+=item.text.length;if(characters+size>1_000_000)break;
      messages.push({id:item.id,turnId:item.turnId,role:'assistant',text:item.text,streaming:item.streaming,
        ...(typeof item.createdAt==='string'?{createdAt:item.createdAt}:{}),...(typeof item.updatedAt==='string'?{updatedAt:item.updatedAt}:{}),
        ...(Number.isSafeInteger(item.sequence)?{sequence:Number(item.sequence)}:{})});
    }
    if(messages.length!==before.length||rows+messages.length>500)continue;
    boundaries.push([key,messages]);characters+=size;rows+=messages.length;
  }
  return {source,inputTurns,inputBoundaries:Object.fromEntries(boundaries.reverse())};
}
