import type {InlineMessage,SelectionAnchor} from './inline-thread';

/** Stored with the response checkpoint, never inferred from editable Markdown. */
export interface InlineSteering {
  messageId:string;text:string;before:InlineMessage[];
  selection?:SelectionAnchor;selectionApplied?:boolean;confirmed?:boolean;
}
export interface SteeringInput {messageId:string;text:string;selection?:SelectionAnchor}

export function validSteeringInput(value:any):value is SteeringInput {
  const a=value?.selection;
  return !!value&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.messageId??'')&&typeof value.text==='string'&&!!value.text.trim()&&value.text.length<=120_000&&
    (!a||typeof a.text==='string'&&!!a.text&&Number.isSafeInteger(a.start)&&a.start>=0&&Number.isSafeInteger(a.end)&&a.end===a.start+a.text.length&&typeof a.before==='string'&&typeof a.after==='string');
}

/** Place input after complete paragraphs; never split a live code fence. */
export function steeringBoundary(messages:InlineMessage[]):InlineMessage[] {
  return messages.map(message=>{
    if(!message.streaming)return {...message};
    let fence:{char:string;size:number}|undefined,last=0,offset=0;
    for(const line of message.text.split('\n')){
      const match=/^ {0,3}(`{3,}|~{3,})/.exec(line);
      if(match){if(!fence)fence={char:match[1][0],size:match[1].length};else if(match[1][0]===fence.char&&match[1].length>=fence.size&&!line.slice(match[0].length).trim())fence=undefined;}
      if(!fence&&!line.trim()&&offset<message.text.length)last=offset+line.length+1;
      offset+=line.length+1;
    }
    return {...message,text:message.text.slice(0,last)};
  });
}

/** Merge snapshots without losing earlier explicitly tracked turns. */
export function mergeProse(saved:InlineMessage[],incoming:InlineMessage[],turns:string[]):InlineMessage[] {
  const result=saved.filter(m=>m.role==='assistant'&&turns.includes(m.turnId??''));
  for(const message of incoming.filter(m=>m.role==='assistant'&&turns.includes(m.turnId??''))){
    const index=result.findIndex(m=>m.id===message.id);
    if(index<0)result.push({...message});else result[index]={...message};
  }
  // A later stream event may arrive before an earlier paragraph recovered by
  // a snapshot. Keep T3's creation order rather than arrival order.
  return result.sort((a,b)=>a.createdAt&&b.createdAt?a.createdAt.localeCompare(b.createdAt):0);
}

export function steeringSegments(messages:InlineMessage[],steering:InlineSteering[]):Array<{role:'assistant'|'user';text:string}> {
  const result:Array<{role:'assistant'|'user';text:string}>=[],consumed=new Map<string,string>();
  const append=(items:InlineMessage[])=>{
    for(const message of items){
      const before=consumed.get(message.id)??'';
      const text=message.text.startsWith(before)?message.text.slice(before.length):message.text;
      if(text.trim())result.push({role:'assistant',text});
      consumed.set(message.id,message.text);
    }
  };
  for(const input of steering){append(input.before);result.push({role:'user',text:input.text});}
  append(messages);return result;
}

export function selectionRange(document:string,anchor:SelectionAnchor,exclude?:{from:number;to:number}):{from:number;to:number}|null {
  const at=(start:number)=>document.slice(start,start+anchor.text.length)===anchor.text&&document.slice(Math.max(0,start-anchor.before.length),start).endsWith(anchor.before)&&document.slice(start+anchor.text.length).startsWith(anchor.after);
  if(exclude){
    // The confirmed You quote is a second copy of the text, not a candidate
    // selection. Recheck the unchanged outside anchor if Sync restores it.
    const matches:number[]=[];
    for(let start=document.indexOf(anchor.text);start>=0;start=document.indexOf(anchor.text,start+1))if((start+anchor.text.length<=exclude.from||start>=exclude.to)&&at(start))matches.push(start);
    return matches.length===1?{from:matches[0],to:matches[0]+anchor.text.length}:null;
  }
  if(at(anchor.start))return {from:anchor.start,to:anchor.start+anchor.text.length};
  const start=document.indexOf(anchor.text);
  return start>=0&&document.indexOf(anchor.text,start+1)<0&&at(start)?{from:start,to:start+anchor.text.length}:null;
}
