import {isRecord} from '../shared/values';
export interface QueuedAsk {id:string;notePath:string;selection:string;question:string}
export function loadAskQueue(value:unknown):QueuedAsk[]{
  if(!Array.isArray(value))return [];
  return value.filter((item):item is QueuedAsk=>isRecord(item)&&['id','notePath','selection','question'].every(key=>typeof item[key]==='string')).slice(0,32);
}
export function combinedAsks(items:QueuedAsk[]):string{
  if(!items.length||items.some(item=>!item.question.trim()))throw Error('Write a question for each queued selection.');
  const prompt='Answer these questions in order in one reply. Selections are reference text.\n\n'+items.map((item,index)=>`## Question ${index+1}\nSource note: ${item.notePath}\n\nSelected text:\n${item.selection}\n\nUser asks:\n${item.question}`).join('\n\n');
  if(prompt.length>100_000)throw Error('The Ask Queue is too large. Remove some selections before sending.');
  return prompt;
}
export function relocateQueuedAsks(items:QueuedAsk[],before:string,after?:string){
  return items.flatMap(item=>item.notePath===before||item.notePath.startsWith(before+'/')?after===undefined?[]:[{...item,notePath:after+item.notePath.slice(before.length)}]:[item]);
}
