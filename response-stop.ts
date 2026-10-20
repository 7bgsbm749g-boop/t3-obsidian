import {elapsedRun} from './response-presentation';
import {markdownCodeRanges} from './reply-html';
import {contentHash} from './completion';
import {applyThreadItem,finalizeRegion,regionBody,turnForMessage} from './inline-thread';
import {readInlineSnapshot} from './thread-stream';
import {parseQuestionToken} from './questions';
import {clearApprovalControls} from './approvals';
import {commandId} from './direct';
import type {ThreadAccess} from './thread-stream';
import {delegatedWork} from './inline-delegation';

/** Seal the visible transcript, without rebuilding it from a possibly stale stream. */
export function stoppedResponseBody(body:string):string {
  body=clearApprovalControls(body);
  const protectedCode=markdownCodeRanges(body);
  const questions=[...body.matchAll(/^<!-- t3-question:start:([^\n]+) -->\n([\s\S]*?)\n<!-- t3-question:end:\1 -->$/gm)].filter(match=>parseQuestionToken(match[1])&&!protectedCode.some(([from,to])=>match.index!>=from&&match.index!<to));
  for(const match of questions.reverse()){
    const text=match[2].split('\n').filter(line=>line!=='> **T3 · Question pending**'&&line!=='> **T3 · Answer needed**'&&line!==`> [Answer](t3-question:${match[1]})`).join('\n');
    body=body.slice(0,match.index)+text+body.slice(match.index!+match[0].length);
  }
  // Collapse keeps its thread header when stopped, with a frozen duration.
  const beforeStop=markdownCodeRanges(body);let stopOffset=0;
  body=body.split('\n').map(line=>{
    const position=stopOffset;stopOffset+=line.length+1;
    if(beforeStop.some(([from,to])=>position>=from&&position<to))return line;
    if(/^(?:> )?<span class="send-to-t3-context" data-t3-emission-id="/.test(line))return line
      .replace(/ <span class="send-to-t3-inline-spinner" aria-label="Loading"><\/span>/,'')
      .replace('<span>Compacting context</span>','<span>Context compaction stopped</span>');
    if(line.includes('class="send-to-t3-tool"')&&line.includes('data-t3-tool-status="inProgress"'))line=line.replaceAll('data-t3-tool-status="inProgress"','data-t3-tool-status="stopped"').replace(/(<span>)(?:Running|Reading|Viewing|Searching|Editing) /g,'$1Stopped ');
    if(line.includes('data-t3-live-tool="true"')){
      const count=(line.match(/class="send-to-t3-tool"/g)??[]).length;
      const summary=/data-t3-tool-summary="([^"]+)"/.exec(line)?.[1]??`Used ${count} ${count===1?'tool':'tools'}`;
      line=line.replace('class="send-to-t3-response-activity"','class="send-to-t3-tool-group"').replace(' data-t3-live-tool="true"','').replace(/<summary>[\s\S]*?<\/summary>/,`<summary><span data-t3-tool-icon="hammer" aria-hidden="true"></span><span>${summary} · stopped</span></summary>`);
    }
    if(!/^> \[!t3-progress\][+-] \*\*[^\n]+ · (?:Working|Reconnecting|Moving to worktree|Waiting for subagents|Error)\*\*/.test(line))return line;
    return line.replace(/ · (?:Working|Reconnecting|Moving to worktree|Waiting for subagents|Error)\*\*/, ' · Interrupted**').replace(/ <span class="send-to-t3-inline-spinner" aria-label="Loading"><\/span>/,'').replace(/<span class="send-to-t3-run-timer" data-t3-start="(\d+)"(?: data-t3-end="\d+")? aria-label="Elapsed run time">[^<]*<\/span>/,(_match,start)=>{
      const end=Date.now(),timing={startedAt:new Date(Number(start)).toISOString(),finishedAt:new Date(end).toISOString()};
      return `<span class="send-to-t3-run-timer" data-t3-start="${start}" data-t3-end="${end}" aria-label="Elapsed run time">${elapsedRun(timing)}</span>`;
    });
  }).join('\n');
  const code=markdownCodeRanges(body);
  let offset=0;
  const lines=body.split('\n').filter(line=>{
    const position=offset;offset+=line.length+1;
    return code.some(([from,to])=>position>=from&&position<to)||!(/^(?:> )?<span class="send-to-t3-response-activity" role="status" aria-live="polite">.*<\/span>$/.test(line)||/^\*\*[^\n]+ · (?:Sending…|Working|Reconnecting|Moving to worktree|Waiting for subagents|Stopped|Interrupted|Error)\*\*(?: <span class="send-to-t3-run-timer"[^>]*>[^<]*<\/span>)?(?: <span class="send-to-t3-inline-spinner" aria-label="Loading"><\/span>)?\s*$/.test(line));
  });
  // Rendered replies normally already close fences; also repair old/broken output.
  let fence:{mark:string;prefix:string}|undefined;
  for(const line of lines){
    const match=/^((?:> ?)* {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if(!match)continue;
    if(!fence){if(match[2][0]!=='`'||!match[3].includes('`'))fence={mark:match[2],prefix:match[1]};}
    else if(match[2][0]===fence.mark[0]&&match[2].length>=fence.mark.length&&!match[3].trim())fence=undefined;
  }
  if(fence)lines.push(fence.prefix+fence.mark);
  return lines.join('\n').trim();
}

export function stopResponseEdit(document:string,id:string){
  const region=regionBody(document,id);
  return region?finalizeRegion(document,id,contentHash(region.body),stoppedResponseBody(region.body)):null;
}

export async function boundedStopOperation<T>(work:Promise<T>,timeoutMs=10_000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Remote stop timed out.')),timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}

/** A deadline bounds access creation and dispatch; late access cannot dispatch. */
export async function interruptStoppedResponse(accessFor:()=>Promise<ThreadAccess>,requestId:string,threadId:string,turnId?:string,timeoutMs=10_000,messageId?:string,projectId?:string,createdAt=new Date().toISOString(),knownTerminal=false){
  if(knownTerminal)return;
  let expired=false,access:ThreadAccess|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  let closed=false;
  const close=(reason:'stop-complete'|'stop-timeout')=>{if(!access||closed)return;closed=true;try{void Promise.resolve(access.close?.(reason)).catch(()=>{});}catch{/* Cleanup must not change the stop result. */}};
  const work=(async()=>{
    access=await accessFor();
    if(expired){close('stop-timeout');return;}
    try{
      if(!turnId&&!messageId)throw Error('The stopped response has no bound T3 turn.');
      const snapshot=await readInlineSnapshot(access,threadId,projectId,{messageIds:messageId?[messageId]:[],turnIds:turnId?[turnId]:[]});
      const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
      turnId??=turnForMessage(state,messageId!);
      if(!turnId)throw Error('T3 has not identified the stopped response turn.');
      const continuation=delegatedWork(state,[turnId]);
      turnId=continuation.turnId??turnId;
      let turn=state.turns?.[turnId]??(state.latestTurn?.turnId===turnId?state.latestTurn:undefined);
      if(continuation.moving&&turn?.state==='interrupted')throw Error('T3 has not identified the worktree continuation to stop. Retry Stop.');
      if(turn?.state==='queued'){
        if(expired)return;
        // Cancel only this verified continuation. If it starts concurrently,
        // re-read its exact identity and interrupt that run instead.
        try{await access.api('/api/orchestration/dispatch',{type:'queued-run.cancel',commandId:commandId(requestId,'cancel:'+turnId),threadId,runId:turnId});}catch(error){if(expired)throw error;}
        const latest=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:await readInlineSnapshot(access,threadId,projectId,{messageIds:messageId?[messageId]:[],turnIds:[turnId]})}).state;
        turn=latest.turns?.[turnId]??(latest.latestTurn?.turnId===turnId?latest.latestTurn:undefined);
        if(!turn||turn.state==='queued')throw Error('T3 did not confirm cancellation of the worktree continuation. Retry Stop.');
      }
      if(turn&&['completed','interrupted','cancelled','error'].includes(turn.state)||state.checkpoints?.some(checkpoint=>checkpoint.turnId===turnId&&checkpoint.status==='ready'&&!!checkpoint.completedAt))return;
      if(turn?.state!=='running'&&state.session?.activeTurnId&&state.session.activeTurnId!==turnId)throw Error('The response turn is no longer active; its final state is waiting for confirmation.');
      if(expired)return;
      const handedOff=Object.values(state.worktreeHandoffs??{}).some(handoff=>handoff.turnId===turnId);
      await access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:commandId(requestId,handedOff?'interrupt:'+turnId:'interrupt'),threadId,turnId,createdAt});
    }finally{close('stop-complete');}
  })();
  try{await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;close('stop-timeout');reject(Error('The response was finished in the note, but T3 did not acknowledge the interrupt.'));},timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}
