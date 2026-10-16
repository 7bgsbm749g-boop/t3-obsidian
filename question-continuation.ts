import {commandId} from './direct';
import {editorStream,type StreamNoteIO} from './editor-stream';
import {applyThreadItem,initialRegion} from './inline-thread';
import {lateQuestionAnswer} from './inline-questions';
import {questionKey,questionSections,type QuestionTarget} from './questions';
import type {QuestionAnswerFollow} from './question-controller';
import {submittedAnswers} from './response-answers';
import {localResponseRange} from './local-response-binding';
import {safeNotePath,type ResponseRequest,type ResponseStorageTarget} from './response-model';
import {readInlineSnapshot,type ThreadAccess} from './thread-stream';
import type {FinalAnswerFormat,IntermediateMode} from './response-presentation';

export interface QuestionContinuationIO extends StreamNoteIO {
  vaultId:string;owner:string;
  access(environmentId:string):Promise<ThreadAccess>;
  bindings():readonly ResponseRequest[];
  notePaths():string[];
  readNote(path:string):Promise<string|undefined>;
  host():Promise<ResponseStorageTarget>;
  policy():{intermediateMode:IntermediateMode;finalAnswerFormat:FinalAnswerFormat};
  register(request:ResponseRequest):Promise<void>;
  allowed():boolean;
}
export const questionAnswerBindingId=(target:QuestionTarget,path:string)=>commandId(target.threadId,JSON.stringify(['question-answer',target.environmentId,target.requestId,path]));

/** Attach only the exact canonical async-answer message. No prompt is sent.
 * The saved intent and deterministic binding survive reloads and lost acks. */
export async function continueQuestionAnswer(target:QuestionTarget,follow:QuestionAnswerFollow,io:QuestionContinuationIO):Promise<boolean>{
  if(!io.allowed())return false;
  const {request,command}=follow;
  if(request.responseMode!=='message'||request.requestId!==target.requestId||command.type!=='thread.user-input.respond'||command.requestId!==target.requestId||command.threadId!==target.threadId)throw Error('The saved question answer target changed.');
  const messageId=`async-answer:${target.requestId}`,access=await io.access(target.environmentId);
  let snapshot:any;
  try{snapshot=await readInlineSnapshot(access,target.threadId,undefined,{messageIds:[messageId],turnIds:request.turnId?[request.turnId]:[]});}finally{await access.close?.();}
  if(!io.allowed())return false;
  const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
  const reply=state.messages.find(message=>message.id===messageId&&message.role==='user');
  if(!reply)return false; // Acceptance can precede projection of the answer/run.
  const late=lateQuestionAnswer(state,request.turnId,reply);
  if(late===false)return true;
  const related=io.bindings().filter(binding=>binding.threadEnvironmentId===target.environmentId&&binding.threadId===target.threadId);
  const candidates=[...new Set([...(follow.notePath?[follow.notePath]:[]),...io.notePaths(),...related.map(binding=>binding.notePath)])].filter(safeNotePath);
  const destinations:Array<{path:string;document:string}>=[];
  for(const path of candidates){
    const document=await io.readNote(path);if(document===undefined)continue;
    const hasQuestion=questionSections(document).some(section=>questionKey(section.target)===questionKey(target));
    if(path===follow.notePath||!follow.notePath&&hasQuestion)destinations.push({path,document});
  }
  // A renamed origin may be found through the surviving generated question.
  if(!destinations.length&&follow.notePath)for(const path of candidates){const document=await io.readNote(path);if(document!==undefined&&questionSections(document).some(section=>questionKey(section.target)===questionKey(target)))destinations.push({path,document});}
  if(!destinations.length)return false;
  if(late===undefined)return false;
  const projectId=snapshot.thread.projectId;if(typeof projectId!=='string'||!projectId)throw Error('The answered question has no T3 project.');
  const answers=submittedAnswers(state.activities.find(activity=>activity.kind==='user-input.resolved'&&activity.payload?.requestId===target.requestId)?.payload?.answers)??command.answers;
  const text=answers?Object.values(answers).map(value=>Array.isArray(value)?value.join(', '):value).join('\n\n'):reply.text;
  for(const {path,document} of destinations){
    if(!io.allowed())return false;
    const id=questionAnswerBindingId(target,path);
    const known=related.find(binding=>binding.id===id||binding.notePath===path&&(binding.localMessageId??binding.messageId)===messageId);
    if(known){if(localResponseRange(document,known.id,[known]))await io.register({...known,notePath:path});continue;}
    const source=related.filter(binding=>(binding.notePath===path||binding.notePath===follow.notePath)&&binding.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0],policy=io.policy();
    const initialInput={messageId,text:text.trim()?text:reply.text,answer:{requestId:target.requestId,questions:request.questions,answers}};
    const next:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id,initialOwner:io.owner,vaultId:io.vaultId,host:source?.host??await io.host(),notePath:path,threadId:target.threadId,projectId,threadEnvironmentId:target.environmentId,messageId,initialInput,initialHash:initialRegion(id).bodyHash,createdAt:reply.createdAt??command.createdAt,threadTitle:(state.title??source?.threadTitle)?.slice(0,200),intermediateMode:source?.intermediateMode??policy.intermediateMode,finalAnswerFormat:source?.finalAnswerFormat??policy.finalAnswerFormat,replyFolders:source?.replyFolders};
    const inserted=await editorStream(next,path,io,io.allowed,id);
    await io.register(inserted);
  }
  return true;
}
