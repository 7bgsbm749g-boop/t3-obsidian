import {validateHostedRequest,type HostedInlineRequest,type InlineFiles} from './hosted-inline';
export type SendGuardStatus='prepared'|'accepted'|'failed'|'cleaned';
export interface SendResponseGuard {version:1;request:HostedInlineRequest;createdAt:string;status:SendGuardStatus;uncertain?:boolean;cleanedAt?:string}
export function sendGuardPath(request:HostedInlineRequest){validateHostedRequest(request);return `${request.host.directory}/send-guards/${request.id}.json`;}
/** Persist a recovery identity before any tag is written into the note. */
export async function prepareSendGuard(files:InlineFiles,request:HostedInlineRequest){
  const path=sendGuardPath(request),raw=await files.read(path);
  if(raw){const previous:SendResponseGuard=JSON.parse(raw);if(previous.request.id!==request.id||previous.request.notePath!==request.notePath||previous.request.threadId!==request.threadId||previous.request.messageId!==request.messageId)throw Error('The response reservation already belongs to another send.');if(previous.status!=='prepared')throw Error('This response reservation is already terminal.');await files.write(path,JSON.stringify({...previous,request}));return;}
  const guard:SendResponseGuard={version:1,request,createdAt:new Date().toISOString(),status:'prepared'};
  await files.write(path,JSON.stringify(guard));
}
export async function updateSendGuard(files:InlineFiles,request:HostedInlineRequest,status:'accepted'|'failed',uncertain=false){
  const path=sendGuardPath(request),raw=await files.read(path);if(!raw)return;
  const guard:SendResponseGuard=JSON.parse(raw);if(guard.request.id!==request.id||guard.request.notePath!==request.notePath||guard.request.threadId!==request.threadId||guard.request.messageId!==request.messageId||guard.request.vaultId!==request.vaultId)throw Error('The response reservation changed before its result.');
  if(guard.status==='accepted'||guard.status==='cleaned')return;
  await files.write(path,JSON.stringify({...guard,status,...(uncertain?{uncertain:true}:{})}));
}
