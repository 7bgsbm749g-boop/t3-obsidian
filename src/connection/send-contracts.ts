import {isRecord} from '../shared/values';

export interface OutgoingAttachment {id:string;dataUrl?:string;type?:string;name?:string;mimeType?:string;sizeBytes?:number}
export interface OutgoingContext {version?:number;records?:Record<string,unknown>[]}
export interface OutgoingMessage {messageId:string;role?:string;text:string;attachments:OutgoingAttachment[];context?:OutgoingContext}

/** Saved launch/dispatch inputs keep their exact identities and extra wire
 * fields. Validate before an image upload can precede a message mutation. */
export function outgoingMessage(value:unknown):OutgoingMessage{
  if(!isRecord(value)||typeof value.messageId!=='string'||!value.messageId||typeof value.text!=='string'||value.attachments!==undefined&&!Array.isArray(value.attachments))throw Error('The saved T3 message is invalid. Nothing was sent.');
  const attachments:unknown[]=value.attachments??[];
  if(attachments.some(item=>!isRecord(item)||typeof item.id!=='string'||item.dataUrl!==undefined&&typeof item.dataUrl!=='string'))throw Error('The saved T3 image input is invalid. Nothing was sent.');
  if(value.context!==undefined&&(!isRecord(value.context)||value.context.records!==undefined&&(!Array.isArray(value.context.records)||value.context.records.some((record:unknown)=>!isRecord(record)))))throw Error('The saved T3 message context is invalid. Nothing was sent.');
  return {...value,attachments} as unknown as OutgoingMessage;
}

export interface CreateThreadCommand {
  type:'thread.create';commandId:string;threadId:string;projectId:string;title:string;createdAt:string;
  modelSelection?:import('../conversations/model-defaults').ModelSelection;runtimeMode?:string;interactionMode?:string;
  branch?:string|null;worktreePath?:string|null;
}
export interface TurnStartCommand<M=OutgoingMessage> {
  type:'thread.turn.start';commandId:string;threadId:string;message:M;createdAt:string;
  modelSelection?:import('../conversations/model-defaults').ModelSelection;runtimeMode?:string;interactionMode?:string;
}
export interface StartRequest {
  action?:string;requestId:string;project:string;title:string;prompt:string;threadId?:string;
  attachments?:OutgoingAttachment[];context?:OutgoingContext;
}
export type DesktopOperation={action:'projects'|'capabilities'|'no-project'}|{action:'threads';project:string}|{action:'read';threadId:string}|(StartRequest&{action:'start'});
