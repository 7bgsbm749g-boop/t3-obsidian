import {validateEventCommand,type EventSubscriptionCommand,type EventCommandResult} from './event-subscriptions';
import {safeNotePath} from './hosted-inline';
import {isFolderCommand,validateFolderCommand,type FolderCommand,type FolderCommandResult} from './folder-command';
export interface NoteCommand {
  version:1;id:string;kind:'send-note'|'attach-response';notePath:string;
  destinations:string[];threadId?:string;messageId?:string;streamReply:boolean;
}
export interface NoteCommandResult {id:string;ok:boolean;threadId?:string;messageId?:string;bindingIds?:string[];error?:string}
export function validateNoteCommand(value:any):NoteCommand {
  if(value?.version!==1||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id??'')||!['send-note','attach-response'].includes(value.kind)||!safeNotePath(value.notePath)||typeof value.streamReply!=='boolean'||!Array.isArray(value.destinations)||value.destinations.length>32||value.destinations.some((path:unknown)=>!safeNotePath(path))||new Set(value.destinations).size!==value.destinations.length)throw Error('Invalid Obsidian note command.');
  if(value.threadId!==undefined&&(typeof value.threadId!=='string'||!value.threadId||value.threadId.length>200))throw Error('Invalid thread ID.');
  if(value.kind==='attach-response'&&(!value.streamReply||!value.threadId||typeof value.messageId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.messageId)))throw Error('Attaching requires a thread and user-message ID.');
  if(!value.streamReply&&value.destinations.length)throw Error('Destinations require editor streaming.');
  return value;
}

export type AgentCommand=NoteCommand|EventSubscriptionCommand|FolderCommand;
export type AgentCommandResult=NoteCommandResult|EventCommandResult|FolderCommandResult;
export function isEventCommand(value:{kind:string}):value is EventSubscriptionCommand{return ['subscribe','subscriptions','update-subscription','pause-subscription','resume-subscription','cancel-subscription'].includes(value.kind);}
export function validateAgentCommand(value:any):AgentCommand{return isFolderCommand(value??{})?validateFolderCommand(value):isEventCommand(value??{})?validateEventCommand(value):validateNoteCommand(value);}
