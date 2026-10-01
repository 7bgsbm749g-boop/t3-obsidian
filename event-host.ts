import {sha256} from '@noble/hashes/sha256';
import {validateEventCommand,type EventSubscriptionCommand,type EventCommandResult} from './event-subscriptions';
export interface EventHostIdentity {vaultId:string;environmentId:string;workspaceRoot:string;directory:string}
export interface EventHostFiles {read(path:string):Promise<string|undefined>;write(path:string,value:string):Promise<void>;remove(path:string):Promise<void>}
export function eventCanonical(value:any):string {return value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(eventCanonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+eventCanonical(value[key])).join(',')+'}';}
export function eventRequest(identity:EventHostIdentity,command:EventSubscriptionCommand){
  validateEventCommand(command);
  const body=eventCanonical({version:1,host:identity,command});
  const digest=Array.from(sha256(new TextEncoder().encode(body)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const name=`${command.id}-${digest}.json`;
  return {body,name,request:`${identity.directory}/requests/${name}`,result:`${identity.directory}/results/${name}`};
}
export async function forwardEventCommand(identity:EventHostIdentity,command:EventSubscriptionCommand,files:EventHostFiles,pause:(ms:number)=>Promise<void>,timeout=60_000):Promise<EventCommandResult>{
  const request=eventRequest(identity,command);
  const read=async()=>{
    const raw=await files.read(request.result);if(!raw)return undefined;
    const value=JSON.parse(raw);
    if(value.version!==1||eventCanonical(value.host)!==eventCanonical(identity)||value.request!==request.name||value.result?.id!==command.id||typeof value.result?.ok!=='boolean')throw Error('Subscription host returned an invalid acknowledgement.');
    return value.result as EventCommandResult;
  };
  const prior=await read();if(prior?.ok)return prior;
  // Only failed acknowledgements may be retried. Successful IDs remain immutable.
  if(prior)await files.remove(request.result);
  const existing=await files.read(request.request);
  if(existing!==undefined&&existing!==request.body)throw Error('Subscription request bytes changed.');
  if(existing===undefined)await files.write(request.request,request.body);
  const deadline=Date.now()+timeout;
  do {const result=await read();if(result)return result;await pause(250);}while(Date.now()<deadline);
  throw Error('The vault project machine has not acknowledged this subscription command. Keep its Obsidian client running and retry the same request ID.');
}
