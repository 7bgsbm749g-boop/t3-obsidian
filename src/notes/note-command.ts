import {isRecord} from '../shared/values';
import {isResponseCommand,validateResponseCommand,type ResponseCommand} from '../responses/response-command';
import {isRecoveryCommand,validateRecoveryCommand,type RecoveryCommand,type RecoveryCommandResult} from '../responses/recovery-command';
import {isClientCommand,validateClientCommand,type ClientCommand,type ClientCommandResult} from '../app/client-command';
import {validateDestinationSection} from './destination-section';
import {isThreadCommand,validateThreadCommand,type ThreadCommand,type ThreadDisplayResult} from '../conversations/thread-displays';
import {isNoteEditCommand,validateNoteEditCommand,type NoteEditCommand} from './checked-note-edits';
import {safeNotePath} from '../responses/response-model';
import {isFolderCommand,validateFolderCommand,type FolderCommand,type FolderCommandResult} from '../projects/folder-command';
import {isNoteContextCommand,validateNoteContextCommand,type NoteContextCommand,type NoteContextResult} from './note-context';
import {isT3MessageId} from '../connection/t3-message-id';
export interface NoteCommand {
  version:1;id:string;kind:'send-note'|'attach-response';notePath:string;
  destinationSection?:string;destinations:string[];threadId?:string;messageId?:string;streamReply:boolean;
}
export interface NoteCommandResult {id:string;ok:boolean;threadId?:string;messageId?:string;bindingIds?:string[];error?:string}
export function validateNoteCommand(input:unknown):NoteCommand {
  if(!isRecord(input))throw Error('Invalid command object.');
  // Retain every command-specific validation below before exposing the domain value.
  const value=input as unknown as NoteCommand;
  if(value?.version!==1||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id??'')||!['send-note','attach-response'].includes(value.kind)||!safeNotePath(value.notePath)||typeof value.streamReply!=='boolean'||!Array.isArray(value.destinations)||value.destinations.length>32||value.destinations.some((path:unknown)=>!safeNotePath(path))||new Set(value.destinations).size!==value.destinations.length)throw Error('Invalid Obsidian note command.');
  if(value.threadId!==undefined&&(typeof value.threadId!=='string'||!value.threadId||value.threadId.length>200))throw Error('Invalid thread ID.');
  if(value.kind==='attach-response'&&(!value.streamReply||!value.threadId||!isT3MessageId(value.messageId)))throw Error('Attaching requires a thread and user-message ID.');
  if(!value.streamReply&&value.destinations.length)throw Error('Destinations require editor streaming.');
  validateDestinationSection(value.destinationSection);
  if(value.destinationSection&&!value.streamReply)throw Error('Sections require streaming.');
  return value;
}

export type AgentCommand=RecoveryCommand|ResponseCommand|NoteCommand|ThreadCommand|FolderCommand|ClientCommand|NoteContextCommand|NoteEditCommand;
export type AgentCommandResult=RecoveryCommandResult|NoteCommandResult|ThreadDisplayResult|FolderCommandResult|ClientCommandResult|NoteContextResult|Record<string,unknown>;
export function validateAgentCommand(value:unknown):AgentCommand{return isNoteEditCommand(value)?validateNoteEditCommand(value):isNoteContextCommand(value??{})?validateNoteContextCommand(value):isRecoveryCommand(value??{})?validateRecoveryCommand(value):isClientCommand(value??{})?validateClientCommand(value):isResponseCommand(value??{})?validateResponseCommand(value):isFolderCommand(value??{})?validateFolderCommand(value):isThreadCommand(value)?validateThreadCommand(value):validateNoteCommand(value);}
