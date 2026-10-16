import {validateDestinationSection} from './destination-section';
import {contentHash} from './completion';
import {questionTargets} from './questions';
import {validateReplyFolders,type ReplyFolders} from './reply-locations';
import type {InlineSteering} from './inline-steering';
import type {InitialInlineInput,InlineMessage,InlineTurn,InlineBindingCheckpoint} from './inline-thread';
import type {InlineQuestionFollow} from './inline-questions';
import type {IntermediateMode,FinalAnswerFormat} from './response-presentation';
import type {StreamReadFailure} from './t3-response-limits';
import {submittedAnswers} from './response-answers';
/** Shared reply data and validation only. Remote lease writers are retired. */
export interface ResponseStorageTarget {environmentId:string;workspaceRoot:string;directory:string;connectionId?:string}
export interface ResponseRequest {
  /** Self-contained saved binding; no remote writer or registration grant. */
  localOnly?:true;
  localMessageId?:string;
  localSteering?:InlineSteering[];
  localStage?:{originalHash:string;stagedHash:string};
  localResume?:{bindingCheckpoint?:InlineBindingCheckpoint;turnIds?:string[];questionFollows?:InlineQuestionFollow[];incoming?:InlineSteering[];presentationTurns?:Record<string,InlineTurn>};
  /** Exact source lifecycle retained when importing an already existing run. */
  importTurn?:InlineTurn;
  replyFolders?:ReplyFolders;
  keepIntermediate?:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat;
  initialInput?:InitialInlineInput;
  independent?:boolean;
  nativeProjection?:boolean;
  responseContainer?:boolean;
  /** Negotiated once, before dispatch. Its immutable original travels in a
   * private sidecar, keeping full notes out of frequently polled metadata. */
  deviceCompletion?:{version:1;actor:string;originalHash:string};
  destinationSection?:string;
  threadTitle?:string;
  version:1|2|3|4;initialOwner?:string;id:string;vaultId:string;host:ResponseStorageTarget;notePath:string;
  threadId:string;messageId:string;projectId:string;threadEnvironmentId:string;initialHash:string;createdAt:string;
}
export interface ResponseState {
  deviceStaged?:{originalHash:string;hash:string};
  assetFailures?:Array<{source:string;error:string}>;
  delivery?:{commitId:string;hash:string;verifiedOnHost:boolean;observedBy:string[];proofHash?:string};
  requestHash:string;accepted:boolean;notePath:string;turnId?:string;messageId?:string;pendingMessageId?:string;
  status:'waiting'|'running'|'complete'|'interrupted'|'error'|'conflict'|'paused';
  hashes:string[];body?:string;detail?:string;updatedAt:string;
  streamFailure?:StreamReadFailure;
  locationConflict?:string[];
  bindingCheckpoint?:InlineBindingCheckpoint;
  /** Keep the last applied cursor while exact async-answer evidence is missing.
   * A snapshot replacement is not proof of a historical answer binding. */
  bindingRecoverySequence?:number;
  bindingRecoveryCheckpoint?:InlineBindingCheckpoint;
  bindingRecoveryIssue?:'history-unavailable';
  finishedAt?:string;presentationTurns?:Record<string,InlineTurn>;
  finalDocumentHash?:string;
  /** Positional provenance outside the note; never a retained Markdown marker. */
  responseAnchor?:{length:number;hash:string};
  finalBody?:string;
  /** Canonical formatted result before device-local asset import. */
  directFinalBody?:string;
  /** The proof was verified on disk before its temporary boundaries were removed. */
  finalSaved?:boolean;
  finalPhase?:'complete'|'interrupted';
  cleanupComplete?:boolean;
  userStopped?:boolean;
  deliveryFailed?:boolean;
  stoppedBody?:string;
  prose?:InlineMessage[];turnIds?:string[];steering?:InlineSteering[];incoming?:InlineSteering[];questionFollows?:InlineQuestionFollow[];
}
export interface ResponseFiles {
  read(path:string):Promise<string|undefined>;
  write(path:string,contents:string):Promise<void>;
}
export const legacyQuestionReply=(state:ResponseState|undefined)=>state?.status==='complete'&&state.questionFollows===undefined&&!!state.body?.includes('> **T3 · Question pending**')&&questionTargets(state.body).length>0;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function safeNotePath(path:unknown):path is string {
  return typeof path==='string'&&path.endsWith('.md')&&!path.includes('\\')&&!/[\x00-\x1f:]/.test(path)&&path.split('/').every(p=>!!p&&p!=='.'&&p!=='..'&&!p.startsWith('.'));
}
export function validateResponseRequest(value:any):ResponseRequest {
  if(value?.localOnly!==undefined&&(value.localOnly!==true||value.version!==4||value.nativeProjection!==true||value.responseContainer!==true))throw Error('Invalid local response binding.');
  if(value?.localStage!==undefined&&(!value.localOnly||![value.localStage.originalHash,value.localStage.stagedHash].every(hash=>typeof hash==='string'&&/^[0-9a-f]{64}$/.test(hash))))throw Error('Invalid local staged edit.');
  if(value?.importTurn!==undefined){const turn=value.importTurn;if(value.version!==4||turn.messageId!==value.messageId||typeof turn.turnId!=='string'||!turn.turnId||turn.turnId.length>200||!['running','completed','interrupted','error','cancelled'].includes(turn.state)||!Number.isFinite(Date.parse(turn.requestedAt)))throw Error('Invalid imported run evidence.');}
  if(value?.replyFolders!==undefined)validateReplyFolders(value.replyFolders);
  if(value?.nativeProjection!==undefined&&typeof value.nativeProjection!=='boolean')throw Error('Invalid native projection preference.');
  if(value?.responseContainer!==undefined&&(typeof value.responseContainer!=='boolean'||value.responseContainer&&!value.nativeProjection))throw Error('Invalid response container preference.');
  if(value?.deviceCompletion!==undefined&&(value.version!==4||value.nativeProjection!==true||value.deviceCompletion?.version!==1||!uuid.test(value.deviceCompletion.actor??'')||! /^[0-9a-f]{64}$/.test(value.deviceCompletion.originalHash??'')))throw Error('Invalid device completion registration.');
  validateDestinationSection(value?.destinationSection);
  if(value?.initialInput!==undefined){
    const input=value.initialInput,answer=input?.answer;
    const asyncAnswer=answer&&typeof answer.requestId==='string'&&answer.requestId.length>0&&input.messageId===`async-answer:${answer.requestId}`&&Array.isArray(answer.questions)&&answer.questions.every((question:any)=>question&&typeof question.id==='string'&&typeof question.question==='string')&&(!answer.answers||JSON.stringify(submittedAnswers(answer.answers))===JSON.stringify(answer.answers));
    if(!uuid.test(input?.messageId??'')&&!asyncAnswer||answer&&!asyncAnswer||input.messageId!==value.messageId||typeof input.text!=='string'||!input.text.trim()||input.text.length>120_000||input.label!==undefined&&(typeof input.label!=='string'||input.label.length>200))throw Error('Invalid initial response input.');
  }
  if(value?.threadTitle!==undefined&&(typeof value.threadTitle!=='string'||value.threadTitle.length>200))throw Error('Invalid thread title.');
  if(value?.independent!==undefined&&typeof value.independent!=='boolean')throw Error('Invalid binding preference.');
  if(value?.finalAnswerFormat!==undefined&&!['formatted','raw-markdown'].includes(value.finalAnswerFormat))throw Error('Invalid final answer format.');
  if(value?.finalAnswerFormat==='raw-markdown'&&![3,4].includes(value.version))throw Error('Raw Markdown requires an updated response writer.');
  if(value?.intermediateMode!==undefined&&!['remove','keep','collapse'].includes(value.intermediateMode))throw Error('Invalid hosted response preference.');
  if(value?.keepIntermediate!==undefined&&typeof value.keepIntermediate!=='boolean')throw Error('Invalid hosted response preference.');
  if(![1,2,3,4].includes(value?.version)||(value.version!==1&&!uuid.test(value.initialOwner??''))||!uuid.test(value.id??'')||!(typeof value.messageId==='string'&&(uuid.test(value.messageId)||/^async-answer:[^\s\x00-\x1f]{1,200}$/.test(value.messageId)))||!safeNotePath(value.notePath)||
    ![value.threadId,value.vaultId,value.projectId,value.threadEnvironmentId,value.createdAt,value.host?.environmentId,value.host?.workspaceRoot,value.host?.directory].every(x=>typeof x==='string'&&x.length>0)||
    !/^[0-9a-f]{64}$/.test(value.initialHash))throw Error('Invalid hosted response job.');
  return value;
}
export function responseRequestHash(request:ResponseRequest){return contentHash(JSON.stringify(request));}

