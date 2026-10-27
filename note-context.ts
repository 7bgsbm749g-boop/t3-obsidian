import {safeNotePath,type ResponseRequest} from './response-model';

export interface NoteContextCommand {version:1;id:string;kind:'note-context';notePath?:string;threadId?:string;messageId?:string;environmentId?:string}
/** Small, immutable send identities. No prompt, response body, or credentials. */
export interface NoteContextRecord {messageId:string;threadId:string;projectId:string;environmentId:string;notePath?:string;bindingIds:string[];createdAt:string}
export interface NoteContextResult {id:string;ok:true;context:{vault:{name:string;id:string;workspaceRoot?:string};send:NoteContextRecord;destinations:Array<{bindingId:string;notePath:string;host:ResponseRequest['host'];stagingSupported:boolean}>}}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const identity=(value:unknown)=>typeof value==='string'&&!!value&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
export function contextBindingIds(request:{inlineBindings?:{id:string}[];inlineHost?:{id:string};inlineSteering?:{jobId:string;targets?:{jobId:string}[]};inlineFollow?:{jobId:string}}):string[]{
  return [...new Set([...(request.inlineBindings??(request.inlineHost?[request.inlineHost]:[])).map(binding=>binding.id),...(request.inlineSteering?.targets??(request.inlineSteering?[request.inlineSteering]:[])).map(target=>target.jobId),...(request.inlineFollow?[request.inlineFollow.jobId]:[])])];
}
export function isNoteContextCommand(value:{kind?:string}):value is NoteContextCommand{return value.kind==='note-context';}
export function validateNoteContextCommand(value:any):NoteContextCommand {
  if(value?.version!==1||!uuid(value.id)||!isNoteContextCommand(value)||value.notePath!==undefined&&!safeNotePath(value.notePath)||value.threadId!==undefined&&!identity(value.threadId)||value.messageId!==undefined&&!uuid(value.messageId)||value.environmentId!==undefined&&!identity(value.environmentId)||!value.notePath&&!value.threadId&&!value.messageId)throw Error('Choose a note or exact T3 message for context lookup.');
  return value;
}
export function mergeNoteContexts(...sources:unknown[]):NoteContextRecord[] {
  const records=new Map<string,NoteContextRecord>();
  for(const source of sources)if(Array.isArray(source))for(const item of source){
    if(!uuid(item?.messageId)||![item.threadId,item.projectId,item.environmentId].every(identity)||item.notePath!==undefined&&!safeNotePath(item.notePath)||!Array.isArray(item.bindingIds)||item.bindingIds.length>32||!item.bindingIds.every(uuid)||new Set(item.bindingIds).size!==item.bindingIds.length||typeof item.createdAt!=='string'||!Number.isFinite(Date.parse(item.createdAt)))continue;
    const record:NoteContextRecord={messageId:item.messageId,threadId:item.threadId,projectId:item.projectId,environmentId:item.environmentId,...(item.notePath?{notePath:item.notePath}:{}),bindingIds:[...item.bindingIds],createdAt:item.createdAt};
    const key=JSON.stringify([record.environmentId,record.threadId,record.messageId]),old=records.get(key);
    if(!old||JSON.stringify(record)>JSON.stringify(old))records.set(key,record);
  }
  return [...records.values()].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||JSON.stringify(a).localeCompare(JSON.stringify(b))).slice(-256);
}
export function noteContext(command:NoteContextCommand,records:readonly NoteContextRecord[],bindings:readonly ResponseRequest[],vault:NoteContextResult['context']['vault']):NoteContextResult {
  validateNoteContextCommand(command);
  const matches=records.filter(record=>(!command.notePath||record.notePath===command.notePath)&&(!command.threadId||record.threadId===command.threadId)&&(!command.messageId||record.messageId===command.messageId)&&(!command.environmentId||record.environmentId===command.environmentId));
  if(matches.length!==1)throw Error(matches.length?'Several sends match. Supply the exact thread, message and environment IDs.':'No matching send context is available. Check the vault and exact T3 message.');
  const send=matches[0];
  const destinations=send.bindingIds.map(id=>{
    const binding=bindings.find(binding=>binding.id===id&&binding.vaultId===vault.id&&binding.threadId===send.threadId&&binding.projectId===send.projectId&&binding.threadEnvironmentId===send.environmentId);
    if(!binding)throw Error('A response destination is unavailable. Wait for its binding to reach this client.');
    return {bindingId:binding.id,notePath:binding.notePath,host:binding.host,stagingSupported:binding.localOnly===true&&binding.nativeProjection===true};
  });
  return {id:command.id,ok:true,context:{vault,send,destinations}};
}
