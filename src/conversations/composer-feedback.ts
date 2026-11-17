import {isRecord,records} from '../shared/values';

/** T3 useComposerSend.ts handles Codex /feedback locally, not as an agent prompt.
 * Only the explicit Send action calls this; suggestion selection never uploads. */
export async function composerFeedback(call:(method:string,input:unknown)=>Promise<unknown>,instanceId:string,threadId:string,command:string):Promise<string|undefined>{
  const config=await call('server.getConfig',{});
  const provider=isRecord(config)?records(config.providers).find(provider=>provider.instanceId===instanceId):undefined;
  if(provider?.driver!=='codex')return;
  const reason=command.replace(/^\/feedback\b/i,'').trim();
  const result=await call('provider.uploadFeedback',{threadId,...(reason?{reason}:{})});
  if(!isRecord(result)||typeof result.feedbackId!=='string'||!result.feedbackId)throw Error('T3 did not confirm the feedback upload. Check T3 before submitting it again.');
  return result.feedbackId;
}
