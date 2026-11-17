import {isRecord} from '../shared/values';
import type {ResponseRequest} from '../responses/response-model';
import type {ExplorerResponse,NoteIndicator} from '../responses/explorer-responses';
import {contentHash} from '../responses/completion';

export type InboxSection='pinned'|'working'|'regular'|'snoozed'|'settled';
export const INBOX_SECTIONS:readonly InboxSection[]=['pinned','working','regular','snoozed','settled'];
type Register<T>={value:T;clock:number;actor:string};
export interface InboxEntry {pinned?:Register<boolean>;shelf?:Register<{kind:'regular'|'settled'|'snoozed';activity:string;until?:number}>}
/** Stream IDs retain note choices through moves and response removal. No note text. */
export type NoteInboxData=Record<string,InboxEntry>;
export interface InboxNote {path:string;ids:string[];title:string;folder:string;activity:string;updatedAt:number;section:InboxSection;pinned:boolean;indicator:NoteIndicator;until?:number}
const newer=<T>(a:Register<T>|undefined,b:Register<T>|undefined):Register<T>|undefined=>!a?b:!b?a:b.clock>a.clock||b.clock===a.clock&&(b.actor>a.actor||b.actor===a.actor&&JSON.stringify(b.value)>JSON.stringify(a.value))?b:a;
export function mergeNoteInbox(...sources:unknown[]):NoteInboxData {
  const result:NoteInboxData=Object.create(null) as NoteInboxData;
  for(const source of sources){
    if(!isRecord(source))continue;
    for(const [id,value] of Object.entries(source)){
      if(!id||id.length>256||!isRecord(value))continue;
      const entry:InboxEntry=result[id]??{};
      for(const field of ['pinned','shelf'] as const){
        const raw=value[field];
        if(!isRecord(raw)||!Number.isSafeInteger(raw.clock)||(raw.clock as number)<0||typeof raw.actor!=='string'||!raw.actor||raw.actor.length>200)continue;
        if(field==='pinned'&&typeof raw.value==='boolean')entry.pinned=newer(entry.pinned,{value:raw.value,clock:raw.clock as number,actor:raw.actor});
        if(field==='shelf'&&isRecord(raw.value)&&['regular','settled','snoozed'].includes(String(raw.value.kind))&&typeof raw.value.activity==='string'&&raw.value.activity.length<=1024&&(raw.value.kind!=='snoozed'||typeof raw.value.until==='number'&&Number.isFinite(raw.value.until))){
          const shelf=raw.value as unknown as NonNullable<InboxEntry['shelf']>['value'];
          entry.shelf=newer(entry.shelf,{value:{kind:shelf.kind,activity:shelf.activity,...(shelf.kind==='snoozed'?{until:shelf.until}:{})},clock:raw.clock as number,actor:raw.actor});
        }
      }
      if(entry.pinned||entry.shelf)result[id]=entry;
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
function choices(data:NoteInboxData,ids:string[]):InboxEntry {
  const result:InboxEntry={};for(const id of ids){result.pinned=newer(result.pinned,data[id]?.pinned);result.shelf=newer(result.shelf,data[id]?.shelf);}return result;
}
export type InboxAction={kind:'pin';value:boolean}|{kind:'regular'|'settled'}|{kind:'snoozed';until:number};
export function changeNoteInbox(data:NoteInboxData,note:InboxNote,action:InboxAction,actor:string,now=Date.now()):NoteInboxData {
  if(action.kind==='snoozed'&&(!Number.isFinite(action.until)||action.until<=now))throw Error('Choose a future snooze time.');
  if(action.kind!=='pin'&&(note.indicator.active||note.indicator.input)&&action.kind!=='regular')throw Error('Wait for the response or answer its question before settling or snoozing this note.');
  const previous=choices(data,note.ids),clock=Math.max(now,(previous.pinned?.clock??0)+1,(previous.shelf?.clock??0)+1);
  const patch:InboxEntry=action.kind==='pin'?{pinned:{clock,actor,value:action.value}}:{shelf:{clock,actor,value:{kind:action.kind,activity:note.activity,...(action.kind==='snoozed'?{until:action.until}:{})}}};
  return mergeNoteInbox(data,Object.fromEntries(note.ids.map(id=>[id,patch])));
}
/** Bindings, not sends or folder links, define membership. Completed and stopped
 * bindings remain eligible; deleted files and other vaults never appear. */
export function inboxNotes(bindings:readonly ResponseRequest[],responses:readonly ExplorerResponse[],indicators:Map<string,NoteIndicator>,data:NoteInboxData,vaultId:string,exists:(path:string)=>boolean,now=Date.now()):InboxNote[] {
  const groups=new Map<string,{ids:Set<string>;activity:Map<string,string>;updatedAt:number}>();
  const add=(path:string,id:string,activity:string,at=0)=>{
    if(!path.toLowerCase().endsWith('.md')||!exists(path))return;
    const group=groups.get(path)??{ids:new Set<string>(),activity:new Map<string,string>(),updatedAt:0};
    group.ids.add(id);group.activity.set(id,activity);group.updatedAt=Math.max(group.updatedAt,at||0);groups.set(path,group);
  };
  const known=new Set<string>();
  for(const binding of bindings)if(binding.vaultId===vaultId){
    known.add(binding.id);add(binding.notePath,binding.id,JSON.stringify([binding.messageId,binding.localMessageId,...binding.localSteering?.map(input=>input.messageId)??[]]),Date.parse(binding.createdAt));
  }
  for(const response of responses)if(!known.has(response.id)&&!response.deleted)add(response.notePath,response.id,response.completionId??response.id);
  const result:InboxNote[]=[];
  for(const [path,group] of groups){
    const ids=[...group.ids].sort(),activity=contentHash(JSON.stringify([...group.activity].sort(([a],[b])=>a.localeCompare(b)))),state=choices(data,ids),indicator=indicators.get(path)??{active:0,input:0,complete:0,total:ids.length};
    const shelf=state.shelf?.value,sameActivity=shelf?.activity===activity,pinned=state.pinned?.value??false;
    // A new send or pending input wakes old work. A finished run alone never settles it.
    const section:InboxSection=sameActivity&&!indicator.active&&!indicator.input&&shelf?.kind==='snoozed'&&(shelf.until??0)>now?'snoozed':sameActivity&&!indicator.active&&!indicator.input&&shelf?.kind==='settled'?'settled':pinned?'pinned':indicator.active?'working':'regular';
    result.push({path,ids,title:path.slice(path.lastIndexOf('/')+1,-3),folder:path.includes('/')?path.slice(0,path.lastIndexOf('/')):'',activity,updatedAt:group.updatedAt,section,pinned,indicator,...(section==='snoozed'?{until:shelf?.until}:{})});
  }
  return result.sort((a,b)=>a.section==='snoozed'&&b.section==='snoozed'?(a.until??0)-(b.until??0):b.updatedAt-a.updatedAt||a.path.localeCompare(b.path));
}
