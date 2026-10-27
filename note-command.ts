import {isResponseCommand,validateResponseCommand,type ResponseCommand} from './response-command';
import {isRecoveryCommand,validateRecoveryCommand,type RecoveryCommand,type RecoveryCommandResult} from './recovery-command';
import {isClientCommand,validateClientCommand,type ClientCommand,type ClientCommandResult} from './client-command';
import {validateDestinationSection} from './destination-section';
import {validateEventCommand,type EventSubscriptionCommand,type EventCommandResult} from './event-subscriptions';
import {safeNotePath} from './response-model';
import {isFolderCommand,validateFolderCommand,type FolderCommand,type FolderCommandResult} from './folder-command';
import {isNoteContextCommand,validateNoteContextCommand,type NoteContextCommand,type NoteContextResult} from './note-context';
import {isT3MessageId} from './t3-message-id';
export interface NoteCommand {
  version:1;id:string;kind:'send-note'|'attach-response';notePath:string;
  destinationSection?:string;destinations:string[];threadId?:string;messageId?:string;streamReply:boolean;
}
export interface NoteCommandResult {id:string;ok:boolean;threadId?:string;messageId?:string;bindingIds?:string[];error?:string}
export function validateNoteCommand(value:any):NoteCommand {
  if(value?.version!==1||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id??'')||!['send-note','attach-response'].includes(value.kind)||!safeNotePath(value.notePath)||typeof value.streamReply!=='boolean'||!Array.isArray(value.destinations)||value.destinations.length>32||value.destinations.some((path:unknown)=>!safeNotePath(path))||new Set(value.destinations).size!==value.destinations.length)throw Error('Invalid Obsidian note command.');
  if(value.threadId!==undefined&&(typeof value.threadId!=='string'||!value.threadId||value.threadId.length>200))throw Error('Invalid thread ID.');
  if(value.kind==='attach-response'&&(!value.streamReply||!value.threadId||!isT3MessageId(value.messageId)))throw Error('Attaching requires a thread and user-message ID.');
  if(!value.streamReply&&value.destinations.length)throw Error('Destinations require editor streaming.');
  validateDestinationSection(value.destinationSection);
  if(value.destinationSection&&!value.streamReply)throw Error('Sections require streaming.');
  return value;
}

export type AgentCommand=RecoveryCommand|ResponseCommand|NoteCommand|EventSubscriptionCommand|FolderCommand|ClientCommand|NoteContextCommand;
export type AgentCommandResult=RecoveryCommandResult|NoteCommandResult|EventCommandResult|FolderCommandResult|ClientCommandResult|NoteContextResult;
export function isEventCommand(value:{kind:string}):value is EventSubscriptionCommand{return ['stream-thread','thread-streams','pause-thread-stream','resume-thread-stream','cancel-thread-stream','remove-stream-destination','subscribe-job','subscribe','subscriptions','update-subscription','pause-subscription','resume-subscription','cancel-subscription'].includes(value.kind);}
export function validateAgentCommand(value:any):AgentCommand{return isNoteContextCommand(value??{})?validateNoteContextCommand(value):isRecoveryCommand(value??{})?validateRecoveryCommand(value):isClientCommand(value??{})?validateClientCommand(value):isResponseCommand(value??{})?validateResponseCommand(value):isFolderCommand(value??{})?validateFolderCommand(value):isEventCommand(value??{})?validateEventCommand(value):validateNoteCommand(value);}
