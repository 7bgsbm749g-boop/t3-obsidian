import {commandId} from './direct';
import type {StreamNoteIO} from './editor-stream';
import {applyThreadItem,inlineBindingCheckpoint,turnForMessage} from './inline-thread';
import {responseAnchor} from './native-response-projection';
import {markdownCodeRanges} from './reply-html';
import {lateQuestionAnswer} from './inline-questions';
import {questionKey,questionSections,type QuestionTarget} from './questions';
import type {QuestionAnswerFollow} from './question-controller';
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
  savedBodies?(request:ResponseRequest):Promise<string[]>;
  followed?(request:ResponseRequest,requestId:string):boolean;
  ownsQuestion?(request:ResponseRequest,requestId:string,turnId:string):boolean;
  blocked?(target:QuestionTarget,detail:string):void;
  allowed():boolean;
}
export const questionAnswerBindingId=(target:QuestionTarget,path:string)=>commandId(target.threadId,JSON.stringify(['question-answer',target.environmentId,target.requestId,path]));

/** Attach only the exact canonical async-answer message. No prompt is sent.
 * The saved intent and deterministic binding survive reloads and lost acks. */
export async function continueQuestionAnswer(target:QuestionTarget,follow:QuestionAnswerFollow,io:QuestionContinuationIO):Promise<boolean>{
  if(!io.allowed())return false;
  const {request,command}=follow;
  if(request.responseMode!=='message'||request.requestId!==target.requestId||command.type!=='thread.user-input.respond'||command.requestId!==target.requestId||command.threadId!==target.threadId)throw Error('The saved question answer target changed.');
  const related=io.bindings().filter(binding=>binding.threadEnvironmentId===target.environmentId&&binding.threadId===target.threadId);
  const messageId=`async-answer:${target.requestId}`,access=await io.access(target.environmentId);
  let snapshot:any;
  try{snapshot=await readInlineSnapshot(access,target.threadId,undefined,{messageIds:[messageId,...related.map(binding=>binding.localMessageId??binding.messageId)],turnIds:request.turnId?[request.turnId]:[]});}finally{await access.close?.();}
  if(!io.allowed())return false;
  const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
  const reply=state.messages.find(message=>message.id===messageId&&message.role==='user');
  if(!reply)return false; // Acceptance can precede projection of the answer/run.
  const late=lateQuestionAnswer(state,request.turnId,reply);
  if(late===false)return true;
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
  for(const {path,document} of destinations){
    if(!io.allowed())return false;
    // Preserve already delivered continuations from older releases. Recovery
    // must not resurrect them or create another response for the same answer.
    const known=related.find(binding=>binding.notePath===path&&(binding.localMessageId??binding.messageId)===messageId);
    if(known){if(localResponseRange(document,known.id,[known]))await io.register({...known,notePath:path});continue;}
    const sources:ResponseRequest[]=[];
    for(const binding of related.filter(binding=>(binding.notePath===path||binding.notePath===follow.notePath)&&binding.projectId===projectId)){
      if(!request.turnId)continue;
      const bound=turnForMessage(state,binding.localMessageId??binding.messageId)===request.turnId||state.turns?.[request.turnId]?.messageId===(binding.localMessageId??binding.messageId)||binding.importTurn?.turnId===request.turnId||io.ownsQuestion?.(binding,target.requestId,request.turnId);
      const retained=bound?false:(await io.savedBodies?.(binding)??[]).some(body=>questionSections(body).some(section=>questionKey(section.target)===questionKey(target)));
      if(bound||retained)sources.push(binding);
    }
    if(sources.length!==1)return false;
    const source=sources[0],next:ResponseRequest={...source,notePath:path,localResume:{bindingCheckpoint:inlineBindingCheckpoint(state),turnIds:[request.turnId!],questionFollows:[{requestId:request.requestId,turnId:request.turnId,responseMode:'message',questions:request.questions,completed:true,answered:true}],prose:state.messages.filter(message=>message.role==='assistant'&&message.turnId===request.turnId)}};
    if(!localResponseRange(document,source.id,[source])){
      const matches:Array<{from:number;to:number}>=[],code=markdownCodeRanges(document);
      for(const body of new Set(await io.savedBodies?.(source)??[])){
        if(!body.trim())continue;
        const at=document.indexOf(body),end=at+body.length;
        if(at<0||document.indexOf(body,at+1)>=0||at>0&&document[at-1]!=='\n'||end<document.length&&document[end]!=='\n'||code.some(([from,to])=>at>=from&&at<to))continue;
        if(!matches.some(match=>match.from===at&&match.to===end))matches.push({from:at,to:end});
      }
      // Never guess at edited, copied or missing saved prose. The durable
      // accepted intent remains available; no second stream is spawned.
      if(matches.length!==1){io.blocked?.(target,'Your answer was sent. The saved response changed or cannot be identified safely, so its stream could not resume.');return false;}
      const range=matches[0];
      const inserted=await io.updateNote(path,current=>{if(current!==document)throw Error('The original response changed before it could resume.');return current.slice(0,range.from)+responseAnchor(source.id)+current.slice(range.to);},io.allowed);
      if(inserted===undefined)return false;
    }
    await io.register(next);
    if(io.followed&&!io.followed(next,target.requestId))return false;
  }
  return true;
}
